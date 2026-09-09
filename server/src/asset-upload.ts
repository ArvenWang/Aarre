import type { z } from "zod";
import type { AuthenticatedAccount } from "./auth.js";
import { assetCompleteSchema, assetCreateSchema } from "./contracts.js";
import type { Config } from "./config.js";
import type { Database } from "./db.js";
import type { ObjectStore } from "./object-store.js";
import type { EnvelopeEncryption } from "./encryption.js";

type Metadata = Omit<z.infer<typeof assetCreateSchema>, "binding">;
interface Candidate { upload_id: string; asset_id: string; base_revision: string; object_key: string; metadata: Metadata; binding_payload: Buffer | null }
const fault = (message: string, statusCode: number) => Object.assign(new Error(message), { statusCode });
const protectionQuery = `SELECT 1 FROM protection_rules rules
 WHERE rules.user_id = $1 AND rules.deleted_at IS NULL AND (
 (rules.rule_kind = 'resource' AND rules.resource_key = $2) OR EXISTS (
 SELECT 1 FROM protection_rule_resources inherited WHERE inherited.user_id = rules.user_id
 AND inherited.protection_rule_id = rules.protection_rule_id AND inherited.resource_key = $2))`;

/** Candidate objects are immutable and become active only after HEAD verification and a revision check. */
export class AssetUploads {
  constructor(private database: Database, private store: ObjectStore, private config: Config, private encryption: EnvelopeEncryption) {}

  async create(account: AuthenticatedAccount, rawInput: unknown): Promise<Record<string, unknown>> {
    const { binding, ...input } = assetCreateSchema.parse(rawInput);
    if ((await this.database.query(protectionQuery, [account.userId, input.resourceKey])).rowCount) throw fault("Protected resources cannot upload cloud assets.", 423);
    const identity = await this.database.query<{ resource_key: string; asset_kind: string }>("SELECT resource_key, asset_kind FROM assets WHERE user_id=$1 AND asset_id=$2", [account.userId, input.assetId]);
    if (identity.rows[0] && (identity.rows[0].resource_key !== input.resourceKey || identity.rows[0].asset_kind !== input.kind)) throw fault("Asset identity cannot be moved to another resource or kind.", 409);
    const existing = await this.database.query<{ revision: string; byte_size: string }>(
      `SELECT revision, byte_size FROM assets WHERE user_id = $1 AND resource_key = $2 AND asset_kind = $3
       AND state = 'ready' AND deleted_at IS NULL ORDER BY revision DESC LIMIT 1`,
      [account.userId, input.resourceKey, input.kind]);
    const baseRevision = Number(existing.rows[0]?.revision || 0);
    if (input.baseRevision !== undefined && input.baseRevision !== baseRevision) throw fault("The cloud image changed; sync before retrying.", 409);
    const quota = await this.database.query<{ quota_bytes: string; metadata_bytes: string; asset_bytes: string }>(
      `SELECT u.quota_bytes, a.metadata_bytes, a.asset_bytes FROM users u JOIN account_usage a ON a.user_id = u.id WHERE u.id = $1`, [account.userId]);
    const usage = quota.rows[0];
    if (!usage || Number(usage.metadata_bytes) + Number(usage.asset_bytes) - Number(existing.rows[0]?.byte_size || 0) + input.byteSize > Number(usage.quota_bytes)) throw fault("Cloud storage quota has been reached.", 413);
    // A unique candidate path prevents an old signed PUT from corrupting the active image.
    const ext = ({ "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" })[input.mimeType];
    const objectKey = `users/${account.userId}/assets/${input.assetId}/${input.operationId}/${input.sha256}.${ext}`;
    const bindingPayload = binding ? await this.encryption.encryptJson(account.userId, `asset-binding:${input.assetId}`, binding) : null;
    await this.database.query(
      `INSERT INTO asset_uploads (user_id, upload_id, device_id, asset_id, base_revision, object_key, metadata, binding_payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (user_id, upload_id) DO NOTHING`,
      [account.userId, input.operationId, account.deviceId, input.assetId, baseRevision, objectKey, JSON.stringify(input), bindingPayload]);
    const saved = await this.database.query<Candidate>(
      "SELECT * FROM asset_uploads WHERE user_id = $1 AND upload_id = $2 AND device_id = $3 AND expires_at > now()",
      [account.userId, input.operationId, account.deviceId]);
    const candidate = saved.rows[0];
    if (!candidate || candidate.object_key !== objectKey || JSON.stringify(candidate.metadata, Object.keys(candidate.metadata).sort()) !== JSON.stringify(input, Object.keys(input).sort())) throw fault("Upload operation cannot be reused for another image.", 409);
    const signed = await this.store.signUpload(candidate.object_key, { mimeType: input.mimeType, byteSize: input.byteSize, sha256: input.sha256, expiresIn: this.config.ASSET_URL_TTL_SECONDS });
    return { assetId: input.assetId, uploadId: input.operationId, uploadUrl: signed.url, headers: signed.headers, expiresIn: signed.expiresIn };
  }

  async complete(account: AuthenticatedAccount, assetId: string, rawInput: unknown): Promise<Record<string, unknown>> {
    const input = assetCompleteSchema.parse(rawInput);
    const client = await this.database.connect();
    try {
      await client.query("BEGIN");
      // Lock account usage before image slots: serializes quota and brand-new slot decisions.
      const quota = await client.query<{ quota_bytes: string; metadata_bytes: string; asset_bytes: string }>(
        `SELECT u.quota_bytes, a.metadata_bytes, a.asset_bytes FROM users u JOIN account_usage a ON a.user_id = u.id
         WHERE u.id = $1 FOR UPDATE OF a`, [account.userId]);
      const repeated = await client.query<{ response: Record<string, unknown> }>(
        "SELECT response FROM sync_operations WHERE user_id = $1 AND operation_id = $2", [account.userId, input.operationId]);
      if (repeated.rows[0]) {
        if (repeated.rows[0].response.assetId !== assetId) throw fault("Operation identity does not match.", 409);
        await client.query("COMMIT");
        return repeated.rows[0].response;
      }
      const candidates = await client.query<Candidate>(
        `SELECT * FROM asset_uploads WHERE user_id = $1 AND asset_id = $2 AND device_id = $3
         AND ($4::uuid IS NULL OR upload_id = $4) AND expires_at > now() ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
        [account.userId, assetId, account.deviceId, input.uploadId || null]);
      const candidate = candidates.rows[0];
      if (!candidate) throw fault("Asset upload does not exist or expired; start the upload again.", 404);
      const meta = candidate.metadata;
      const identity = await client.query<{resource_key:string;asset_kind:string}>("SELECT resource_key,asset_kind FROM assets WHERE user_id=$1 AND asset_id=$2 FOR UPDATE", [account.userId,assetId]);
      if (identity.rows[0] && (identity.rows[0].resource_key !== meta.resourceKey || identity.rows[0].asset_kind !== meta.kind)) throw fault("Asset identity changed while the upload was pending.",409);
      if (input.sha256 && input.sha256 !== meta.sha256) throw fault("Upload digest does not match.", 409);
      if ((await client.query(protectionQuery, [account.userId, meta.resourceKey])).rowCount) throw fault("The resource became protected during upload.", 423);
      const current = await client.query<{ asset_id: string; object_key: string; byte_size: string; revision: string }>(
        `SELECT asset_id, object_key, byte_size, revision FROM assets WHERE user_id = $1 AND resource_key = $2 AND asset_kind = $3
         AND state = 'ready' AND deleted_at IS NULL FOR UPDATE`, [account.userId, meta.resourceKey, meta.kind]);
      const currentRevision = Math.max(0, ...current.rows.map((row) => Number(row.revision)));
      if (currentRevision !== Number(candidate.base_revision)) throw fault("The cloud image changed during upload; sync before retrying.", 409);
      const head = await this.store.head(candidate.object_key);
      if (head.byteSize !== meta.byteSize || head.sha256 !== meta.sha256 || !["AES256", "cos/kms"].includes(head.serverSideEncryption)) throw fault("Uploaded asset failed size, digest, or server-side encryption verification.", 422);
      const removedBytes = current.rows.reduce((sum, row) => sum + Number(row.byte_size), 0);
      const usage = quota.rows[0];
      if (!usage || Number(usage.metadata_bytes) + Number(usage.asset_bytes) - removedBytes + meta.byteSize > Number(usage.quota_bytes)) throw fault("Cloud storage quota has been reached.", 413);
      await client.query(
        `UPDATE assets SET state = 'deleting', deleted_at = now(), updated_at = now()
         WHERE user_id = $1 AND resource_key = $2 AND asset_kind = $3 AND asset_id <> $4 AND state = 'ready'`,
        [account.userId, meta.resourceKey, meta.kind, assetId]);
      for (const previous of current.rows) if (previous.object_key !== candidate.object_key) await client.query(
        "INSERT INTO asset_delete_jobs (user_id, asset_id, object_key) VALUES ($1,$2,$3)", [account.userId, previous.asset_id, previous.object_key]);
      const revision = currentRevision + 1;
      await client.query(
        `INSERT INTO assets (user_id, asset_id, resource_key, asset_kind, object_key, sha256, byte_size,
         width, height, mime_type, captured_at, binding_payload, state, revision, cos_version_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'ready',$13,$14)
         ON CONFLICT (user_id, asset_id) DO UPDATE SET resource_key=EXCLUDED.resource_key, asset_kind=EXCLUDED.asset_kind,
         object_key=EXCLUDED.object_key, sha256=EXCLUDED.sha256, byte_size=EXCLUDED.byte_size, width=EXCLUDED.width,
         height=EXCLUDED.height, mime_type=EXCLUDED.mime_type, captured_at=EXCLUDED.captured_at, binding_payload=EXCLUDED.binding_payload,
         state='ready', revision=EXCLUDED.revision, cos_version_id=EXCLUDED.cos_version_id, deleted_at=NULL, updated_at=now()`,
        [account.userId, assetId, meta.resourceKey, meta.kind, candidate.object_key, meta.sha256, meta.byteSize,
         meta.width || null, meta.height || null, meta.mimeType, meta.capturedAt || null, candidate.binding_payload, revision, head.versionId || null]);
      await client.query(
        `UPDATE account_usage SET asset_bytes=GREATEST(0,asset_bytes-$2+$3), asset_count=GREATEST(0,asset_count-$4+1), updated_at=now() WHERE user_id=$1`,
        [account.userId, removedBytes, meta.byteSize, current.rows.length]);
      const change = await client.query<{ sequence: string }>(
        "INSERT INTO sync_changes (user_id, entity_type, entity_id, revision, deleted) VALUES ($1,'asset',$2,$3,false) RETURNING sequence",
        [account.userId, assetId, revision]);
      const response = { assetId, revision, sequence: Number(change.rows[0].sequence), byteSize: meta.byteSize, kind: meta.kind, resourceKey: meta.resourceKey };
      await client.query("INSERT INTO sync_operations (user_id,operation_id,response) VALUES ($1,$2,$3)", [account.userId, input.operationId, JSON.stringify(response)]);
      await client.query("DELETE FROM asset_uploads WHERE user_id=$1 AND upload_id=$2", [account.userId, candidate.upload_id]);
      await client.query("COMMIT");
      return response;
    } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
    finally { client.release(); }
  }

  async expire(userId?: string): Promise<number> {
    const result = await this.database.query(
      `WITH expired AS (DELETE FROM asset_uploads WHERE ($1::uuid IS NULL AND expires_at <= now()) OR user_id=$1
       RETURNING user_id,asset_id,object_key)
       INSERT INTO asset_delete_jobs (user_id,asset_id,object_key) SELECT user_id,asset_id,object_key FROM expired`, [userId || null]);
    return result.rowCount || 0;
  }
}

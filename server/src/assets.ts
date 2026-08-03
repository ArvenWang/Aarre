import type { AuthenticatedAccount } from "./auth.js";
import { assetCompleteSchema, assetCreateSchema } from "./contracts.js";
import type { Config } from "./config.js";
import type { Database } from "./db.js";
import type { ObjectStore } from "./object-store.js";
import type { EnvelopeEncryption } from "./encryption.js";

function extensionForMime(mimeType: string): string {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/gif") return "gif";
  return "webp";
}

export class AssetService {
  private readonly database: Database;
  private readonly objectStore: ObjectStore;
  private readonly config: Config;
  private readonly encryption: EnvelopeEncryption;

  constructor(
    database: Database,
    objectStore: ObjectStore,
    config: Config,
    encryption: EnvelopeEncryption
  ) {
    this.database = database;
    this.objectStore = objectStore;
    this.config = config;
    this.encryption = encryption;
  }

  async createUpload(account: AuthenticatedAccount, rawInput: unknown): Promise<Record<string, unknown>> {
    const input = assetCreateSchema.parse(rawInput);
    const protectedResult = await this.database.query(
      `SELECT 1
       FROM protection_rules rules
       WHERE rules.user_id = $1
         AND rules.deleted_at IS NULL
         AND (
           (rules.rule_kind = 'resource' AND rules.resource_key = $2)
           OR EXISTS (
             SELECT 1 FROM protection_rule_resources inherited
             WHERE inherited.user_id = rules.user_id
               AND inherited.protection_rule_id = rules.protection_rule_id
               AND inherited.resource_key = $2
           )
         )`,
      [account.userId, input.resourceKey]
    );
    if (protectedResult.rowCount) {
      throw Object.assign(new Error("Protected resources cannot upload cloud assets."), { statusCode: 423 });
    }
    const quota = await this.database.query<{
      quota_bytes: string;
      metadata_bytes: string;
      asset_bytes: string;
    }>(
      `SELECT u.quota_bytes, a.metadata_bytes, a.asset_bytes
       FROM users u JOIN account_usage a ON a.user_id = u.id
       WHERE u.id = $1`,
      [account.userId]
    );
    const usage = quota.rows[0];
    if (
      !usage ||
      Number(usage.metadata_bytes) + Number(usage.asset_bytes) + input.byteSize > Number(usage.quota_bytes)
    ) {
      throw Object.assign(new Error("Cloud storage quota has been reached."), { statusCode: 413 });
    }
    const objectKey = `users/${account.userId}/assets/${input.assetId}/${input.sha256}.${extensionForMime(input.mimeType)}`;
    const bindingPayload = input.binding
      ? await this.encryption.encryptJson(
          account.userId,
          `asset-binding:${input.assetId}`,
          input.binding
        )
      : null;
    const existing = await this.database.query<{ object_key: string; state: string }>(
      "SELECT object_key, state FROM assets WHERE user_id = $1 AND asset_id = $2",
      [account.userId, input.assetId]
    );
    if (existing.rows[0] && existing.rows[0].object_key !== objectKey) {
      throw Object.assign(new Error("The asset identifier is already bound to different content."), { statusCode: 409 });
    }
    await this.database.query(
      `INSERT INTO assets
        (user_id, asset_id, resource_key, asset_kind, object_key, sha256,
         byte_size, width, height, mime_type, captured_at, binding_payload, state)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'uploading')
       ON CONFLICT (user_id, asset_id) DO UPDATE SET
         resource_key = EXCLUDED.resource_key,
         asset_kind = EXCLUDED.asset_kind,
         object_key = EXCLUDED.object_key,
         sha256 = EXCLUDED.sha256,
         byte_size = EXCLUDED.byte_size,
         width = EXCLUDED.width,
         height = EXCLUDED.height,
         mime_type = EXCLUDED.mime_type,
         captured_at = EXCLUDED.captured_at,
         binding_payload = EXCLUDED.binding_payload,
         updated_at = now(),
         state = CASE WHEN assets.state = 'ready' THEN assets.state ELSE 'uploading' END`,
      [
        account.userId,
        input.assetId,
        input.resourceKey,
        input.kind,
        objectKey,
        input.sha256,
        input.byteSize,
        input.width || null,
        input.height || null,
        input.mimeType,
        input.capturedAt || null,
        bindingPayload
      ]
    );
    // 取消该对象仍在排队的删除任务：历史清空/替换后，删除 worker
    // 可能把客户端刚重新上传的对象物理删除，导致 complete 校验
    // （head 404 / 元数据缺失）失败。新上传应优先于旧删除任务。
    await this.database.query(
      "DELETE FROM asset_delete_jobs WHERE object_key = $1 AND completed_at IS NULL",
      [objectKey]
    );
    const signed = await this.objectStore.signUpload(objectKey, {
      mimeType: input.mimeType,
      byteSize: input.byteSize,
      sha256: input.sha256,
      expiresIn: this.config.ASSET_URL_TTL_SECONDS
    });
    return {
      assetId: input.assetId,
      uploadUrl: signed.url,
      headers: signed.headers,
      expiresIn: signed.expiresIn
    };
  }

  async completeUpload(
    account: AuthenticatedAccount,
    assetId: string,
    rawInput: unknown
  ): Promise<Record<string, unknown>> {
    const input = assetCompleteSchema.parse(rawInput);
    const client = await this.database.connect();
    try {
      await client.query("BEGIN");
      const repeated = await client.query<{ response: Record<string, unknown> }>(
        "SELECT response FROM sync_operations WHERE user_id = $1 AND operation_id = $2",
        [account.userId, input.operationId]
      );
      if (repeated.rows[0]) {
        await client.query("COMMIT");
        return repeated.rows[0].response;
      }
      const result = await client.query<{
        resource_key: string;
        asset_kind: string;
        object_key: string;
        sha256: string;
        byte_size: string;
        state: string;
        revision: string;
      }>(
        `SELECT resource_key, asset_kind, object_key, sha256, byte_size, state, revision
         FROM assets WHERE user_id = $1 AND asset_id = $2 FOR UPDATE`,
        [account.userId, assetId]
      );
      const asset = result.rows[0];
      if (!asset) throw Object.assign(new Error("Asset upload does not exist."), { statusCode: 404 });
      if (asset.state === "ready") {
        const response = {
          assetId,
          revision: Number(asset.revision),
          byteSize: Number(asset.byte_size),
          kind: asset.asset_kind,
          resourceKey: asset.resource_key
        };
        await client.query(
          `INSERT INTO sync_operations (user_id, operation_id, response)
           VALUES ($1, $2, $3) ON CONFLICT (user_id, operation_id) DO NOTHING`,
          [account.userId, input.operationId, JSON.stringify(response)]
        );
        await client.query("COMMIT");
        return response;
      }
      const blocked = await client.query(
        `SELECT 1
         FROM protection_rules rules
         WHERE rules.user_id = $1
           AND rules.deleted_at IS NULL
           AND (
             (rules.rule_kind = 'resource' AND rules.resource_key = $2)
             OR EXISTS (
               SELECT 1 FROM protection_rule_resources inherited
               WHERE inherited.user_id = rules.user_id
                 AND inherited.protection_rule_id = rules.protection_rule_id
                 AND inherited.resource_key = $2
             )
           )`,
        [account.userId, asset.resource_key]
      );
      if (blocked.rowCount) {
        throw Object.assign(new Error("The resource became protected during upload."), { statusCode: 423 });
      }
      const head = await this.objectStore.head(asset.object_key);
      if (
        head.byteSize !== Number(asset.byte_size) ||
        head.sha256 !== asset.sha256 ||
        !["AES256", "cos/kms"].includes(head.serverSideEncryption)
      ) {
        throw Object.assign(new Error("Uploaded asset failed size, digest, or server-side encryption verification."), { statusCode: 422 });
      }
      const previous = await client.query<{
        asset_id: string;
        object_key: string;
        byte_size: string;
      }>(
        `UPDATE assets SET state = 'deleting', deleted_at = now(), updated_at = now()
         WHERE user_id = $1 AND resource_key = $2 AND asset_kind = $3
           AND asset_id <> $4 AND state = 'ready'
         RETURNING asset_id, object_key, byte_size`,
        [account.userId, asset.resource_key, asset.asset_kind, assetId]
      );
      const removedBytes = previous.rows.reduce((sum, row) => sum + Number(row.byte_size), 0);
      const quota = await client.query<{
        quota_bytes: string;
        metadata_bytes: string;
        asset_bytes: string;
      }>(
        `SELECT u.quota_bytes, a.metadata_bytes, a.asset_bytes
         FROM users u JOIN account_usage a ON a.user_id = u.id
         WHERE u.id = $1 FOR UPDATE`,
        [account.userId]
      );
      const usage = quota.rows[0];
      if (
        !usage ||
        Number(usage.metadata_bytes) + Number(usage.asset_bytes) - removedBytes + Number(asset.byte_size) > Number(usage.quota_bytes)
      ) {
        throw Object.assign(new Error("Cloud storage quota has been reached."), { statusCode: 413 });
      }
      for (const row of previous.rows) {
        await client.query(
          "INSERT INTO asset_delete_jobs (user_id, asset_id, object_key) VALUES ($1, $2, $3)",
          [account.userId, row.asset_id, row.object_key]
        );
      }
      const revision = Number(asset.revision) + 1;
      await client.query(
        `UPDATE assets SET state = 'ready', cos_version_id = $3, revision = $4,
                           deleted_at = NULL, updated_at = now()
         WHERE user_id = $1 AND asset_id = $2`,
        [account.userId, assetId, head.versionId || null, revision]
      );
      await client.query(
        `UPDATE account_usage
         SET asset_bytes = GREATEST(0, asset_bytes - $2 + $3),
             asset_count = GREATEST(0, asset_count - $4 + 1), updated_at = now()
         WHERE user_id = $1`,
        [account.userId, removedBytes, Number(asset.byte_size), previous.rowCount || 0]
      );
      const change = await client.query<{ sequence: string }>(
        `INSERT INTO sync_changes (user_id, entity_type, entity_id, revision, deleted)
         VALUES ($1, 'asset', $2, $3, false) RETURNING sequence`,
        [account.userId, assetId, revision]
      );
      const response = {
        assetId,
        revision,
        sequence: Number(change.rows[0].sequence),
        byteSize: Number(asset.byte_size),
        kind: asset.asset_kind,
        resourceKey: asset.resource_key
      };
      await client.query(
        "INSERT INTO sync_operations (user_id, operation_id, response) VALUES ($1, $2, $3)",
        [account.userId, input.operationId, JSON.stringify(response)]
      );
      await client.query("COMMIT");
      return response;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async downloadUrl(account: AuthenticatedAccount, assetId: string): Promise<Record<string, unknown>> {
    const result = await this.database.query<{
      object_key: string;
      mime_type: string;
      byte_size: string;
      sha256: string;
    }>(
      `SELECT object_key, mime_type, byte_size, sha256 FROM assets
       WHERE user_id = $1 AND asset_id = $2 AND state = 'ready' AND deleted_at IS NULL`,
      [account.userId, assetId]
    );
    const asset = result.rows[0];
    if (!asset) throw Object.assign(new Error("Asset is unavailable."), { statusCode: 404 });
    return {
      assetId,
      downloadUrl: await this.objectStore.signDownload(asset.object_key, this.config.ASSET_URL_TTL_SECONDS),
      expiresIn: this.config.ASSET_URL_TTL_SECONDS,
      mimeType: asset.mime_type,
      byteSize: Number(asset.byte_size),
      sha256: asset.sha256
    };
  }

  async list(account: AuthenticatedAccount): Promise<Array<Record<string, unknown>>> {
    const result = await this.database.query<{
      asset_id: string;
      resource_key: string;
      asset_kind: string;
      sha256: string;
      byte_size: string;
      width: number | null;
      height: number | null;
      mime_type: string;
      captured_at: Date | null;
      binding_payload: Buffer | null;
      revision: string;
    }>(
      `SELECT asset_id, resource_key, asset_kind, sha256, byte_size, width, height,
              mime_type, captured_at, binding_payload, revision
       FROM assets
       WHERE user_id = $1 AND state = 'ready' AND deleted_at IS NULL
       ORDER BY updated_at DESC LIMIT 5000`,
      [account.userId]
    );
    return Promise.all(result.rows.map(async (row) => ({
      assetId: row.asset_id,
      resourceKey: row.resource_key,
      kind: row.asset_kind,
      sha256: row.sha256,
      byteSize: Number(row.byte_size),
      width: row.width,
      height: row.height,
      mimeType: row.mime_type,
      capturedAt: row.captured_at?.toISOString() || null,
      binding: row.binding_payload
        ? await this.encryption.decryptJson<Record<string, unknown>>(
            account.userId,
            `asset-binding:${row.asset_id}`,
            row.binding_payload
          )
        : null,
      revision: Number(row.revision)
    })));
  }

  async deleteAllForAccount(account: AuthenticatedAccount): Promise<{ queued: number }> {
    const client = await this.database.connect();
    try {
      await client.query("BEGIN");
      const assets = await client.query<{
        asset_id: string;
        object_key: string;
        byte_size: string;
        previous_state: string;
      }>(
        `UPDATE assets
         SET state = 'deleting', deleted_at = now(), updated_at = now()
         WHERE user_id = $1 AND state NOT IN ('deleting', 'deleted')
         RETURNING asset_id, object_key, byte_size, 'ready' AS previous_state`,
        [account.userId]
      );
      for (const asset of assets.rows) {
        await client.query(
          "INSERT INTO asset_delete_jobs (user_id, asset_id, object_key) VALUES ($1, $2, $3)",
          [account.userId, asset.asset_id, asset.object_key]
        );
      }
      await client.query(
        `UPDATE account_usage
         SET asset_bytes = 0, asset_count = 0, updated_at = now()
         WHERE user_id = $1`,
        [account.userId]
      );
      await client.query("COMMIT");
      return { queued: assets.rows.length };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async processDeleteJobs(limit = 50): Promise<{ processed: number; failed: number }> {
    const jobs = await this.database.query<{
      id: string;
      user_id: string;
      asset_id: string;
      object_key: string;
      attempts: number;
    }>(
      `SELECT id, user_id, asset_id, object_key, attempts
       FROM asset_delete_jobs
       WHERE completed_at IS NULL AND next_attempt_at <= now()
       ORDER BY id LIMIT $1`,
      [limit]
    );
    let processed = 0;
    let failed = 0;
    for (const job of jobs.rows) {
      try {
        await this.objectStore.deleteAllVersions(job.object_key);
        await this.objectStore.deleteAllBackupVersions(job.object_key);
        const client = await this.database.connect();
        try {
          await client.query("BEGIN");
          await client.query(
            `UPDATE assets SET state = 'deleted', updated_at = now()
             WHERE user_id = $1 AND asset_id = $2`,
            [job.user_id, job.asset_id]
          );
          await client.query(
            "UPDATE asset_delete_jobs SET completed_at = now() WHERE id = $1",
            [job.id]
          );
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK").catch(() => undefined);
          throw error;
        } finally {
          client.release();
        }
        processed += 1;
      } catch (error) {
        failed += 1;
        const message = error instanceof Error ? error.message.slice(0, 500) : "COS deletion failed";
        await this.database.query(
          `UPDATE asset_delete_jobs
           SET attempts = attempts + 1,
               next_attempt_at = now() + (LEAST(86400, 30 * power(2, attempts))::text || ' seconds')::interval,
               last_error = $2
           WHERE id = $1`,
          [job.id, message]
        );
      }
    }
    return { processed, failed };
  }
}

import type { AuthenticatedAccount } from "./auth.js";
import { AssetUploads } from "./asset-upload.js";
import type { Config } from "./config.js";
import type { Database } from "./db.js";
import type { ObjectStore } from "./object-store.js";
import type { EnvelopeEncryption } from "./encryption.js";

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

  private get uploads() { return new AssetUploads(this.database, this.objectStore, this.config, this.encryption); }

  createUpload(account: AuthenticatedAccount, input: unknown) { return this.uploads.create(account, input); }
  completeUpload(account: AuthenticatedAccount, assetId: string, input: unknown) { return this.uploads.complete(account, assetId, input); }

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
    await this.uploads.expire(account.userId);
    const client = await this.database.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT user_id FROM account_usage WHERE user_id = $1 FOR UPDATE", [account.userId]);
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
    await this.uploads.expire();
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
          // 只有当这条资产仍指向被回收的对象时才标记删除。
          // 同一 assetId 换过内容时，它已指向新对象，不能被旧对象的回收任务连坐。
          await client.query(
            `UPDATE assets SET state = 'deleted', updated_at = now()
             WHERE user_id = $1 AND asset_id = $2 AND object_key = $3`,
            [job.user_id, job.asset_id, job.object_key]
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

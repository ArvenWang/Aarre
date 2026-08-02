import type { AuthenticatedAccount } from "./auth.js";
import type { Database } from "./db.js";
import type { EnvelopeEncryption } from "./encryption.js";

export class AccountService {
  private readonly database: Database;
  private readonly encryption: EnvelopeEncryption;

  constructor(database: Database, encryption: EnvelopeEncryption) {
    this.database = database;
    this.encryption = encryption;
  }

  async usage(account: AuthenticatedAccount): Promise<Record<string, unknown>> {
    const result = await this.database.query<{
      quota_bytes: string;
      metadata_bytes: string;
      asset_bytes: string;
      asset_count: number;
      resource_count: string;
    }>(
      `SELECT u.quota_bytes, a.metadata_bytes, a.asset_bytes, a.asset_count,
              (SELECT COUNT(*) FROM resources r WHERE r.user_id = u.id AND r.deleted_at IS NULL) AS resource_count
       FROM users u JOIN account_usage a ON a.user_id = u.id
       WHERE u.id = $1`,
      [account.userId]
    );
    const row = result.rows[0];
    if (!row) throw Object.assign(new Error("Account is unavailable."), { statusCode: 404 });
    const usedBytes = Number(row.metadata_bytes) + Number(row.asset_bytes);
    return {
      quotaBytes: Number(row.quota_bytes),
      usedBytes,
      metadataBytes: Number(row.metadata_bytes),
      assetBytes: Number(row.asset_bytes),
      assetCount: row.asset_count,
      resourceCount: Number(row.resource_count),
      usageRatio: Number(row.quota_bytes) ? usedBytes / Number(row.quota_bytes) : 0
    };
  }

  async devices(account: AuthenticatedAccount): Promise<Array<Record<string, unknown>>> {
    const result = await this.database.query<{
      device_id: string;
      name_payload: Buffer | null;
      created_at: Date;
      last_seen_at: Date;
      revoked_at: Date | null;
    }>(
      `SELECT device_id, name_payload, created_at, last_seen_at, revoked_at
       FROM devices WHERE user_id = $1 ORDER BY last_seen_at DESC`,
      [account.userId]
    );
    return Promise.all(result.rows.map(async (row) => {
      const name = row.name_payload
        ? (await this.encryption.decryptJson<{ name: string }>(
            account.userId,
            `device:${row.device_id}`,
            row.name_payload
          )).name
        : "Chrome 设备";
      return {
        deviceId: row.device_id,
        name,
        current: row.device_id === account.deviceId,
        createdAt: row.created_at.toISOString(),
        lastSeenAt: row.last_seen_at.toISOString(),
        revokedAt: row.revoked_at?.toISOString() || null
      };
    }));
  }

  async revokeDevice(account: AuthenticatedAccount, deviceId: string): Promise<void> {
    if (deviceId === account.deviceId) {
      throw Object.assign(new Error("Use sign out to revoke the current device."), { statusCode: 409 });
    }
    const client = await this.database.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `UPDATE devices SET revoked_at = now()
         WHERE user_id = $1 AND device_id = $2 AND revoked_at IS NULL`,
        [account.userId, deviceId]
      );
      if (!result.rowCount) throw Object.assign(new Error("Device does not exist."), { statusCode: 404 });
      await client.query(
        "UPDATE token_families SET revoked_at = now() WHERE user_id = $1 AND device_id = $2",
        [account.userId, deviceId]
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async requestDeletion(account: AuthenticatedAccount): Promise<{ deletionRequested: true }> {
    const client = await this.database.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "UPDATE users SET deletion_requested_at = now(), updated_at = now() WHERE id = $1",
        [account.userId]
      );
      await client.query(
        "UPDATE token_families SET revoked_at = now() WHERE user_id = $1",
        [account.userId]
      );
      const assets = await client.query<{ asset_id: string; object_key: string }>(
        `UPDATE assets SET state = 'deleting', deleted_at = now(), updated_at = now()
         WHERE user_id = $1 AND state NOT IN ('deleting', 'deleted')
         RETURNING asset_id, object_key`,
        [account.userId]
      );
      for (const asset of assets.rows) {
        await client.query(
          "INSERT INTO asset_delete_jobs (user_id, asset_id, object_key) VALUES ($1, $2, $3)",
          [account.userId, asset.asset_id, asset.object_key]
        );
      }
      for (const table of [
        "resources",
        "bookmark_items",
        "protection_rules",
        "user_settings",
        "conversations",
        "reports",
        "usage_periods",
        "operation_history",
        "conflict_versions",
        "sync_changes",
        "sync_operations"
      ]) {
        await client.query(`DELETE FROM ${table} WHERE user_id = $1`, [account.userId]);
      }
      await client.query(
        `UPDATE account_usage
         SET metadata_bytes = 0, asset_bytes = 0, asset_count = 0, updated_at = now()
         WHERE user_id = $1`,
        [account.userId]
      );
      await client.query("COMMIT");
      this.encryption.clearUser(account.userId);
      return { deletionRequested: true };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async finalizeDeletions(): Promise<number> {
    const result = await this.database.query<{ id: string }>(
      `SELECT u.id FROM users u
       WHERE u.deletion_requested_at IS NOT NULL AND u.deleted_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM asset_delete_jobs j
           WHERE j.user_id = u.id AND j.completed_at IS NULL
         )
       LIMIT 100`
    );
    for (const row of result.rows) {
      await this.database.query("DELETE FROM users WHERE id = $1", [row.id]);
      this.encryption.clearUser(row.id);
    }
    return result.rowCount || 0;
  }
}

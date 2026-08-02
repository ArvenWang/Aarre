import type { Database } from "./db.js";

export class MaintenanceService {
  constructor(private readonly database: Database) {}

  async cleanup(): Promise<Record<string, number>> {
    const staleUploads = await this.database.query<{
      user_id: string;
      asset_id: string;
      object_key: string;
    }>(
      `UPDATE assets
       SET state = 'deleting', deleted_at = now(), updated_at = now()
       WHERE state IN ('uploading', 'failed')
         AND updated_at < now() - interval '1 hour'
       RETURNING user_id, asset_id, object_key`
    );
    for (const asset of staleUploads.rows) {
      await this.database.query(
        `INSERT INTO asset_delete_jobs (user_id, asset_id, object_key)
         SELECT $1, $2, $3
         WHERE NOT EXISTS (
           SELECT 1 FROM asset_delete_jobs
           WHERE user_id = $1 AND asset_id = $2 AND completed_at IS NULL
         )`,
        [asset.user_id, asset.asset_id, asset.object_key]
      );
    }

    const resources = await this.database.query(
      "DELETE FROM resources WHERE deleted_at IS NOT NULL AND purge_after <= now()"
    );
    const operations = await this.database.query(
      "DELETE FROM sync_operations WHERE created_at < now() - interval '30 days'"
    );
    const changes = await this.database.query(
      "DELETE FROM sync_changes WHERE created_at < now() - interval '180 days'"
    );
    const history = await this.database.query(
      "DELETE FROM operation_history WHERE expires_at <= now()"
    );
    const conflicts = await this.database.query(
      `WITH removed AS (
         DELETE FROM conflict_versions
         WHERE status = 'resolved' AND resolved_at < now() - interval '180 days'
         RETURNING user_id, octet_length(payload) AS bytes
       ), totals AS (
         SELECT user_id, SUM(bytes)::bigint AS bytes FROM removed GROUP BY user_id
       )
       UPDATE account_usage a
       SET metadata_bytes = GREATEST(0, a.metadata_bytes - totals.bytes), updated_at = now()
       FROM totals WHERE a.user_id = totals.user_id`
    );
    const authTickets = await this.database.query(
      "DELETE FROM auth_tickets WHERE expires_at < now() - interval '1 day' OR consumed_at < now() - interval '1 day'"
    );
    const oauthRequests = await this.database.query(
      "DELETE FROM oauth_requests WHERE expires_at < now() - interval '1 day' OR consumed_at < now() - interval '1 day'"
    );
    const accessTokens = await this.database.query(
      "DELETE FROM access_tokens WHERE expires_at < now() - interval '7 days' OR revoked_at < now() - interval '7 days'"
    );
    const refreshTokens = await this.database.query(
      "DELETE FROM refresh_tokens WHERE expires_at < now() - interval '7 days' OR revoked_at < now() - interval '7 days'"
    );
    const deletedRules = await this.database.query(
      "DELETE FROM protection_rules WHERE deleted_at < now() - interval '30 days'"
    );
    let deletedEntityCount = 0;
    for (const table of ["bookmark_items", "user_settings", "conversations", "reports"]) {
      const deleted = await this.database.query(
        `DELETE FROM ${table} WHERE deleted_at < now() - interval '30 days'`
      );
      deletedEntityCount += deleted.rowCount || 0;
    }
    return {
      staleUploads: staleUploads.rowCount || 0,
      resources: resources.rowCount || 0,
      operations: operations.rowCount || 0,
      changes: changes.rowCount || 0,
      history: history.rowCount || 0,
      conflicts: conflicts.rowCount || 0,
      authTickets: authTickets.rowCount || 0,
      oauthRequests: oauthRequests.rowCount || 0,
      accessTokens: accessTokens.rowCount || 0,
      refreshTokens: refreshTokens.rowCount || 0,
      deletedRules: deletedRules.rowCount || 0,
      deletedEntities: deletedEntityCount
    };
  }
}

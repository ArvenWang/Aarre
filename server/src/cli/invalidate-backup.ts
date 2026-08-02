import { loadConfig } from "../config.js";
import { createDatabase } from "../db.js";
import { TencentCosObjectStore } from "../object-store.js";

const config = loadConfig();
const objectKey = process.env.AARRE_INVALIDATE_BACKUP_OBJECT_KEY || "";
const reason = (process.env.AARRE_INVALIDATE_BACKUP_REASON || "").trim();

if (process.env.AARRE_INVALIDATE_BACKUP_CONFIRM !== "INVALIDATE AARRE BACKUP") {
  throw new Error("Set AARRE_INVALIDATE_BACKUP_CONFIRM to the exact invalidation phrase.");
}
if (!objectKey.startsWith("backups/database/") || !reason) {
  throw new Error("An exact database backup object key and an invalidation reason are required.");
}
if (!config.TENCENT_BACKUP_SECRET_ID || !config.TENCENT_BACKUP_SECRET_KEY) {
  throw new Error("The dedicated Tencent backup CAM identity is required.");
}

const database = createDatabase(config.DATABASE_URL);
const objectStore = new TencentCosObjectStore({
  secretId: config.TENCENT_CLOUD_SECRET_ID,
  secretKey: config.TENCENT_CLOUD_SECRET_KEY,
  backupSecretId: config.TENCENT_BACKUP_SECRET_ID,
  backupSecretKey: config.TENCENT_BACKUP_SECRET_KEY,
  bucket: config.COS_BUCKET,
  backupBucket: config.COS_BACKUP_BUCKET,
  region: config.COS_REGION,
  backupRegion: config.COS_BACKUP_REGION
});

try {
  const run = await database.query<{ id: string }>(
    "SELECT id FROM backup_runs WHERE object_key = $1 LIMIT 1",
    [objectKey]
  );
  if (!run.rows[0]) throw new Error("The backup run was not found in the production ledger.");

  const invalidatedAt = new Date().toISOString();
  await database.query(
    `UPDATE backup_runs
     SET status = 'failed', completed_at = COALESCE(completed_at, now()),
         details = details || $2::jsonb
     WHERE id = $1`,
    [run.rows[0].id, JSON.stringify({ invalidatedAt, invalidationReason: reason, objectVersionsDeleted: false })]
  );

  try {
    await objectStore.deleteAllBackupVersions(objectKey);
  } catch (error) {
    const deletionError = error instanceof Error ? error.message.slice(0, 500) : "Backup deletion failed";
    await database.query(
      `UPDATE backup_runs SET details = details || $2::jsonb WHERE id = $1`,
      [run.rows[0].id, JSON.stringify({ deletionError })]
    ).catch(() => undefined);
    throw error;
  }

  await database.query(
    `UPDATE backup_runs
     SET details = (details - 'deletionError') || $2::jsonb
     WHERE id = $1`,
    [run.rows[0].id, JSON.stringify({ objectVersionsDeleted: true })]
  );
  process.stdout.write(JSON.stringify({ ok: true, objectKey, objectVersionsDeleted: true }) + "\n");
} finally {
  await database.end();
}

import COS from "cos-nodejs-sdk-v5";
import { loadConfig } from "../config.js";
import { createDatabase } from "../db.js";

type BucketUsage = {
  versionCount: number;
  deleteMarkerCount: number;
  versionBytes: number;
};

async function measurePrefix(client: COS, bucket: string, region: string, prefix: string): Promise<BucketUsage> {
  let marker: string | undefined;
  let versionMarker: string | undefined;
  let versionCount = 0;
  let deleteMarkerCount = 0;
  let versionBytes = 0;

  do {
    const listed = await client.listObjectVersions({
      Bucket: bucket,
      Region: region,
      Prefix: prefix,
      Marker: marker,
      VersionIdMarker: versionMarker,
      MaxKeys: "1000"
    });
    const versions = listed.Versions || [];
    versionCount += versions.length;
    deleteMarkerCount += (listed.DeleteMarkers || []).length;
    versionBytes += versions.reduce((total, version) => total + Number(version.Size || 0), 0);
    marker = listed.NextMarker;
    versionMarker = listed.NextVersionIdMarker;
    if (listed.IsTruncated !== "true") break;
  } while (marker || versionMarker);

  return { versionCount, deleteMarkerCount, versionBytes };
}

async function measureBucket(
  client: COS,
  bucket: string,
  region: string,
  prefixes: string[]
): Promise<BucketUsage> {
  const measured = await Promise.all(prefixes.map((prefix) => measurePrefix(client, bucket, region, prefix)));
  return measured.reduce<BucketUsage>((total, usage) => ({
    versionCount: total.versionCount + usage.versionCount,
    deleteMarkerCount: total.deleteMarkerCount + usage.deleteMarkerCount,
    versionBytes: total.versionBytes + usage.versionBytes
  }), { versionCount: 0, deleteMarkerCount: 0, versionBytes: 0 });
}

const config = loadConfig();
if (
  !config.TENCENT_CLOUD_SECRET_ID ||
  !config.TENCENT_CLOUD_SECRET_KEY ||
  !config.TENCENT_BACKUP_SECRET_ID ||
  !config.TENCENT_BACKUP_SECRET_KEY ||
  !config.COS_BUCKET ||
  !config.COS_BACKUP_BUCKET
) {
  throw new Error("Both Tencent COS identities and buckets are required for a production capacity measurement.");
}

const database = createDatabase(config.DATABASE_URL);
try {
  const [databaseSize, accountCount, successfulBackupBytes, mainUsage, backupUsage] = await Promise.all([
    database.query<{ bytes: string }>("SELECT pg_database_size(current_database())::text AS bytes"),
    database.query<{ count: string }>("SELECT count(*)::text AS count FROM users"),
    database.query<{ bytes: string }>(
      "SELECT COALESCE(sum(byte_size), 0)::text AS bytes FROM backup_runs WHERE status = 'succeeded'"
    ),
    measureBucket(new COS({
      SecretId: config.TENCENT_CLOUD_SECRET_ID,
      SecretKey: config.TENCENT_CLOUD_SECRET_KEY,
      Protocol: "https:",
      Timeout: 30_000,
      KeepAlive: true,
      ForceSignHost: true
    }), config.COS_BUCKET, config.COS_REGION, ["users/"]),
    measureBucket(new COS({
      SecretId: config.TENCENT_BACKUP_SECRET_ID,
      SecretKey: config.TENCENT_BACKUP_SECRET_KEY,
      Protocol: "https:",
      Timeout: 30_000,
      KeepAlive: true,
      ForceSignHost: true
    }), config.COS_BACKUP_BUCKET, config.COS_BACKUP_REGION, ["users/", "backups/database/"])
  ]);

  process.stdout.write(JSON.stringify({
    measuredAt: new Date().toISOString(),
    accounts: Number(accountCount.rows[0]?.count || 0),
    databaseBytes: Number(databaseSize.rows[0]?.bytes || 0),
    successfulBackupLedgerBytes: Number(successfulBackupBytes.rows[0]?.bytes || 0),
    mainCos: mainUsage,
    backupCos: backupUsage
  }) + "\n");
} finally {
  await database.end();
}

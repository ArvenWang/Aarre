import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import COS from "cos-nodejs-sdk-v5";
import { loadConfig } from "../config.js";
import { createDatabase } from "../db.js";
import { databaseToolMajor, runDatabaseTool } from "./database-process.js";

async function fileSha256(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

const config = loadConfig();
if (!config.COS_BACKUP_BUCKET || !config.COS_BACKUP_REGION) {
  throw new Error("A dedicated Tencent COS backup bucket is required.");
}
const backupClass = process.env.AARRE_BACKUP_CLASS === "monthly" ? "monthly" : "daily";
const database = createDatabase(config.DATABASE_URL);
const runId = randomUUID();
const temporaryDirectory = await mkdtemp(join(tmpdir(), "aarre-db-backup-"));
const dumpPath = join(temporaryDirectory, "aarre.dump");
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const objectKey = `backups/database/${backupClass}/${timestamp}-${runId}.dump`;

await database.query(
  `INSERT INTO backup_runs (id, backup_kind, status, object_key, details)
   VALUES ($1, 'database', 'running', $2, $3)`,
  [runId, objectKey, JSON.stringify({ backupClass, region: config.COS_BACKUP_REGION })]
);

try {
  const versionResult = await database.query<{ server_version_num: string }>("SHOW server_version_num");
  const serverMajor = Math.floor(Number(versionResult.rows[0]?.server_version_num || 0) / 10_000);
  const clientMajor = await databaseToolMajor("pg_dump", config.DATABASE_URL);
  if (!serverMajor || clientMajor !== serverMajor) {
    throw new Error(`pg_dump major ${clientMajor} does not match PostgreSQL server major ${serverMajor}.`);
  }
  await database.query(
    `UPDATE backup_runs SET details = details || $2::jsonb WHERE id = $1`,
    [runId, JSON.stringify({ postgresServerMajor: serverMajor, postgresClientMajor: clientMajor })]
  );
  await runDatabaseTool("pg_dump", [
    "--format=custom",
    "--compress=6",
    "--no-owner",
    "--no-privileges",
    "--file",
    dumpPath
  ], config.DATABASE_URL);
  const [sha256, file] = await Promise.all([fileSha256(dumpPath), stat(dumpPath)]);
  const client = new COS({
    SecretId: config.TENCENT_BACKUP_SECRET_ID,
    SecretKey: config.TENCENT_BACKUP_SECRET_KEY,
    Protocol: "https:",
    Timeout: 30_000,
    KeepAlive: true,
    ForceSignHost: true
  });
  if (!config.TENCENT_BACKUP_SECRET_ID || !config.TENCENT_BACKUP_SECRET_KEY) {
    throw new Error("The dedicated Tencent backup CAM identity is required.");
  }
  await client.sliceUploadFile({
    Bucket: config.COS_BACKUP_BUCKET,
    Region: config.COS_BACKUP_REGION,
    Key: objectKey,
    FilePath: dumpPath,
    ContentType: "application/vnd.postgresql.custom-dump",
    ServerSideEncryption: "AES256",
    "x-cos-meta-sha256": sha256,
    "x-cos-meta-backup-class": backupClass,
    "x-cos-meta-postgres-server-major": String(serverMajor),
    "x-cos-meta-postgres-client-major": String(clientMajor)
  });
  await database.query(
    `UPDATE backup_runs
     SET status = 'succeeded', completed_at = now(), sha256 = $2, byte_size = $3
     WHERE id = $1`,
    [runId, sha256, file.size]
  );
  process.stdout.write(JSON.stringify({
    ok: true,
    objectKey,
    sha256,
    byteSize: file.size,
    postgresServerMajor: serverMajor,
    postgresClientMajor: clientMajor
  }) + "\n");
} catch (error) {
  const message = error instanceof Error ? error.message.slice(0, 500) : "Backup failed";
  await database.query(
    `UPDATE backup_runs
     SET status = 'failed', completed_at = now(), details = details || $2::jsonb
     WHERE id = $1`,
    [runId, JSON.stringify({ error: message })]
  ).catch(() => undefined);
  throw error;
} finally {
  await database.end();
  await rm(temporaryDirectory, { recursive: true, force: true });
}

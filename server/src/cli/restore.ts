import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
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
const objectKey = process.env.AARRE_RESTORE_OBJECT_KEY || "";
const targetUrl = process.env.AARRE_RESTORE_DATABASE_URL || "";
if (process.env.AARRE_RESTORE_CONFIRM !== "RESTORE AARRE DATABASE") {
  throw new Error("Set AARRE_RESTORE_CONFIRM to the exact restore confirmation phrase.");
}
if (!objectKey.startsWith("backups/database/") || !targetUrl) {
  throw new Error("A backup object key and an explicit target database URL are required.");
}
if (
  targetUrl === config.DATABASE_URL &&
  process.env.AARRE_ALLOW_IN_PLACE_RESTORE !== "YES I UNDERSTAND"
) {
  throw new Error("In-place production restore is blocked; restore into an isolated drill database first.");
}

const temporaryDirectory = await mkdtemp(join(tmpdir(), "aarre-db-restore-"));
const dumpPath = join(temporaryDirectory, "aarre.dump");
const targetDatabase = decodeURIComponent(new URL(targetUrl).pathname.replace(/^\//, ""));
if (!targetDatabase) throw new Error("The restore target database name is missing.");
try {
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
  const downloaded = await client.getObject({
    Bucket: config.COS_BACKUP_BUCKET,
    Region: config.COS_BACKUP_REGION,
    Key: objectKey,
    Output: createWriteStream(dumpPath, { flags: "wx" })
  });
  const headers = Object.fromEntries(
    Object.entries(downloaded.headers || {}).map(([name, value]) => [name.toLowerCase(), String(value)])
  );
  const expectedSha = headers["x-cos-meta-sha256"] || "";
  const actualSha = await fileSha256(dumpPath);
  if (!expectedSha || expectedSha !== actualSha) {
    throw new Error("Backup digest verification failed; restore was not started.");
  }
  const backupServerMajor = Number(headers["x-cos-meta-postgres-server-major"] || 0);
  const backupClientMajor = Number(headers["x-cos-meta-postgres-client-major"] || 0);
  const targetDatabaseClient = createDatabase(targetUrl);
  let targetServerMajor = 0;
  try {
    const targetVersion = await targetDatabaseClient.query<{ server_version_num: string }>("SHOW server_version_num");
    targetServerMajor = Math.floor(Number(targetVersion.rows[0]?.server_version_num || 0) / 10_000);
  } finally {
    await targetDatabaseClient.end();
  }
  const restoreClientMajor = await databaseToolMajor("pg_restore", targetUrl);
  if (
    !backupServerMajor ||
    backupClientMajor !== backupServerMajor ||
    restoreClientMajor !== targetServerMajor ||
    backupServerMajor !== targetServerMajor
  ) {
    throw new Error(
      `Backup/restore PostgreSQL major versions are incompatible (dump client ${backupClientMajor}, source ${backupServerMajor}, restore client ${restoreClientMajor}, target ${targetServerMajor}).`
    );
  }
  await runDatabaseTool("pg_restore", [
    "--dbname",
    targetDatabase,
    "--clean",
    "--if-exists",
    "--no-owner",
    "--no-privileges",
    "--exit-on-error",
    dumpPath
  ], targetUrl);
  process.stdout.write(JSON.stringify({
    ok: true,
    objectKey,
    sha256: actualSha,
    postgresMajor: targetServerMajor
  }) + "\n");
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}

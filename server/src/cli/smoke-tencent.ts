import { createHash, randomUUID } from "node:crypto";
import COS from "cos-nodejs-sdk-v5";
import { CommonClient } from "tencentcloud-sdk-nodejs-common";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function client(secretId: string, secretKey: string): COS {
  return new COS({
    SecretId: secretId,
    SecretKey: secretKey,
    Protocol: "https:",
    Timeout: 20_000,
    KeepAlive: true,
    ForceSignHost: true
  });
}

function header(result: { headers?: Record<string, unknown> }, name: string): string {
  const entry = Object.entries(result.headers || {})
    .find(([key]) => key.toLowerCase() === name.toLowerCase());
  return entry ? String(entry[1]) : "";
}

async function deleteEveryVersion(cos: COS, bucket: string, region: string, key: string): Promise<void> {
  let marker: string | undefined;
  let versionMarker: string | undefined;
  do {
    const listed = await cos.listObjectVersions({
      Bucket: bucket,
      Region: region,
      Prefix: key,
      Marker: marker,
      VersionIdMarker: versionMarker,
      MaxKeys: "1000"
    });
    const objects = [...(listed.Versions || []), ...(listed.DeleteMarkers || [])]
      .filter((item) => item.Key === key)
      .map((item) => ({ Key: item.Key, VersionId: item.VersionId }));
    if (objects.length) {
      const deleted = await cos.deleteMultipleObject({
        Bucket: bucket,
        Region: region,
        Objects: objects,
        Quiet: true
      });
      if (deleted.Error?.length) throw new Error(`Failed to clean ${deleted.Error.length} smoke-test object versions.`);
    }
    marker = listed.NextMarker;
    versionMarker = listed.NextVersionIdMarker;
    if (listed.IsTruncated !== "true") break;
  } while (marker || versionMarker);
}

async function assertNoCamAdministration(secretId: string, secretKey: string): Promise<void> {
  const cam = new CommonClient("cam.tencentcloudapi.com", "2019-01-16", {
    credential: { secretId, secretKey },
    profile: {
      signMethod: "TC3-HMAC-SHA256",
      httpProfile: {
        endpoint: "cam.tencentcloudapi.com",
        protocol: "https://",
        reqMethod: "POST",
        reqTimeout: 15
      }
    }
  });
  try {
    await cam.request("ListUsers", {});
  } catch {
    return;
  }
  throw new Error("The Aarre API CAM identity unexpectedly has CAM administration access.");
}

const primarySecretId = required("TENCENT_CLOUD_SECRET_ID");
const primarySecretKey = required("TENCENT_CLOUD_SECRET_KEY");
const backupSecretId = required("TENCENT_BACKUP_SECRET_ID");
const backupSecretKey = required("TENCENT_BACKUP_SECRET_KEY");
const primaryBucket = required("COS_BUCKET");
const primaryRegion = required("COS_REGION");
const backupBucket = required("COS_BACKUP_BUCKET");
const backupRegion = required("COS_BACKUP_REGION");
const primary = client(primarySecretId, primarySecretKey);
const backup = client(backupSecretId, backupSecretKey);
const runId = randomUUID();
const primaryKey = `users/_deployment-smoke/${runId}.txt`;
const backupKey = `backups/database/smoke/${runId}.txt`;
const body = Buffer.from(`Aarre production smoke ${runId}`, "utf8");
const sha256 = createHash("sha256").update(body).digest("hex");
let replicated = false;
let operationError: unknown;
let summary: Record<string, unknown> | null = null;

try {
  await assertNoCamAdministration(primarySecretId, primarySecretKey);
  await primary.putObject({
    Bucket: primaryBucket,
    Region: primaryRegion,
    Key: primaryKey,
    Body: body,
    ContentType: "text/plain; charset=utf-8",
    ServerSideEncryption: "AES256",
    "x-cos-meta-sha256": sha256
  });
  const primaryHead = await primary.headObject({
    Bucket: primaryBucket,
    Region: primaryRegion,
    Key: primaryKey
  });
  if (header(primaryHead, "x-cos-server-side-encryption") !== "AES256") {
    throw new Error("Primary COS smoke object is not protected by SSE-COS AES256.");
  }

  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const replicaHead = await backup.headObject({
        Bucket: backupBucket,
        Region: backupRegion,
        Key: primaryKey
      });
      if (header(replicaHead, "x-cos-server-side-encryption") !== "AES256") {
        throw new Error("Replicated COS smoke object is not protected by SSE-COS AES256.");
      }
      replicated = true;
      break;
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      if (status !== 404) throw error;
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }
  if (!replicated) throw new Error("Cross-region COS replication did not complete within 40 seconds.");

  await backup.putObject({
    Bucket: backupBucket,
    Region: backupRegion,
    Key: backupKey,
    Body: body,
    ContentType: "text/plain; charset=utf-8",
    ServerSideEncryption: "AES256",
    "x-cos-meta-sha256": sha256
  });
  const backupHead = await backup.headObject({
    Bucket: backupBucket,
    Region: backupRegion,
    Key: backupKey
  });
  if (header(backupHead, "x-cos-server-side-encryption") !== "AES256") {
    throw new Error("Direct backup COS smoke object is not protected by SSE-COS AES256.");
  }
  summary = {
    ok: true,
    primaryWrite: true,
    crossRegionReplication: true,
    backupWrite: true,
    serverSideEncryption: "AES256",
    apiCamAdministrationDenied: true
  };
} catch (error) {
  operationError = error;
  throw error;
} finally {
  const cleanup = await Promise.allSettled([
    deleteEveryVersion(primary, primaryBucket, primaryRegion, primaryKey),
    deleteEveryVersion(backup, backupBucket, backupRegion, primaryKey),
    deleteEveryVersion(backup, backupBucket, backupRegion, backupKey)
  ]);
  const cleanupFailures = cleanup.filter((result) => result.status === "rejected");
  if (cleanupFailures.length && !operationError) {
    throw new Error(`Tencent smoke test passed but ${cleanupFailures.length} cleanup operation(s) failed.`);
  }
}

if (summary) process.stdout.write(JSON.stringify(summary) + "\n");

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import COS from "cos-nodejs-sdk-v5";
import { CommonClient } from "tencentcloud-sdk-nodejs-common";

const CONFIRMATION = "CREATE AARRE PRODUCTION RESOURCES";

type TencentCredential = {
  secretId: string;
  secretKey: string;
};

type CamAccess = TencentCredential & {
  uin: string;
};

type ProvisionState = {
  version: 2;
  accountUin: string;
  appId: string;
  primaryBucket: string;
  backupBucket: string;
  serverSideEncryption: "AES256";
  apiUserUin: string;
  backupUserUin: string;
  apiPolicyId: number;
  backupPolicyId: number;
  dnsRecordId: number | null;
  dnsStatus: "managed" | "external-pending";
  completedAt: string;
};

type ExistingState = Partial<ProvisionState>;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function errorCode(error: unknown): string {
  if (!error || typeof error !== "object") return "UnknownError";
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : "UnknownError";
}

function statusCode(error: unknown): number {
  if (!error || typeof error !== "object") return 0;
  const status = (error as { statusCode?: unknown }).statusCode;
  return typeof status === "number" ? status : 0;
}

async function atomicWrite(path: string, contents: string): Promise<void> {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, contents, { mode: 0o600 });
  await rename(temporary, path);
}

async function readState(path: string): Promise<ExistingState> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as ExistingState;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

function createClient(endpoint: string, version: string, credential: TencentCredential, region?: string): CommonClient {
  return new CommonClient(endpoint, version, {
    credential,
    region,
    profile: {
      signMethod: "TC3-HMAC-SHA256",
      httpProfile: {
        endpoint,
        protocol: "https://",
        reqMethod: "POST",
        reqTimeout: 30
      }
    }
  });
}

function createCos(credential: TencentCredential): COS {
  return new COS({
    SecretId: credential.secretId,
    SecretKey: credential.secretKey,
    Protocol: "https:",
    Timeout: 30_000,
    KeepAlive: true,
    ForceSignHost: true
  });
}

async function ensureBucket(client: COS, bucket: string, region: string): Promise<void> {
  try {
    await client.headBucket({ Bucket: bucket, Region: region });
  } catch (error) {
    if (statusCode(error) !== 404 && errorCode(error) !== "NoSuchBucket") throw error;
    await client.putBucket({ Bucket: bucket, Region: region, ACL: "private" });
  }
  await client.putBucketVersioning({
    Bucket: bucket,
    Region: region,
    VersioningConfiguration: { Status: "Enabled" }
  });
  let encryption: COS.GetBucketEncryptionResult | null = null;
  try {
    encryption = await client.getBucketEncryption({ Bucket: bucket, Region: region });
  } catch (error) {
    if (statusCode(error) !== 404 && errorCode(error) !== "NoSuchEncryptionConfiguration") throw error;
  }
  if (encryptionAlgorithm(encryption) !== "AES256") {
    await client.putBucketEncryption({
      Bucket: bucket,
      Region: region,
      ServerSideEncryptionConfiguration: {
        Rule: [{
          ApplySideEncryptionConfiguration: {
            SSEAlgorithm: "AES256"
          }
        }]
      }
    });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      encryption = await client.getBucketEncryption({ Bucket: bucket, Region: region });
      if (encryptionAlgorithm(encryption) === "AES256") return;
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
    throw new Error(`Tencent COS did not enable SSE-COS AES256 for ${bucket}.`);
  }
}

function encryptionAlgorithm(result: COS.GetBucketEncryptionResult | null): string {
  if (!result) return "";
  const configuration = result.ServerSideEncryptionConfiguration as unknown as {
    Rule?: Array<Record<string, Record<string, string>>> | Record<string, Record<string, string>>;
  };
  const rules = Array.isArray(configuration?.Rule) ? configuration.Rule : [configuration?.Rule || {}];
  const settings = rules[0]?.ApplyServerSideEncryptionByDefault
    || rules[0]?.ApplySideEncryptionConfiguration
    || {};
  return settings.SSEAlgorithm || "";
}

async function configureBuckets(input: {
  client: COS;
  primaryBucket: string;
  backupBucket: string;
  primaryRegion: string;
  backupRegion: string;
  extensionIds: string[];
  accountUin: string;
}): Promise<void> {
  const {
    client,
    primaryBucket,
    backupBucket,
    primaryRegion,
    backupRegion,
    extensionIds,
    accountUin
  } = input;
  await ensureBucket(client, primaryBucket, primaryRegion);
  await ensureBucket(client, backupBucket, backupRegion);

  await client.putBucketLifecycle({
    Bucket: primaryBucket,
    Region: primaryRegion,
    Rules: [
      {
        ID: "expire-noncurrent-versions",
        Status: "Enabled",
        Filter: { Prefix: "" },
        NoncurrentVersionExpiration: { NoncurrentDays: "30" },
        AbortIncompleteMultipartUpload: { DaysAfterInitiation: "7" }
      }
    ]
  });
  await client.putBucketLifecycle({
    Bucket: backupBucket,
    Region: backupRegion,
    Rules: [
      {
        ID: "expire-user-object-noncurrent-versions",
        Status: "Enabled",
        Filter: { Prefix: "users/" },
        NoncurrentVersionExpiration: { NoncurrentDays: "30" }
      },
      {
        ID: "expire-daily-database-backups",
        Status: "Enabled",
        Filter: { Prefix: "backups/database/daily/" },
        Expiration: { Days: "35" },
        NoncurrentVersionExpiration: { NoncurrentDays: "35" }
      },
      {
        ID: "expire-monthly-database-backups",
        Status: "Enabled",
        Filter: { Prefix: "backups/database/monthly/" },
        Expiration: { Days: "365" },
        NoncurrentVersionExpiration: { NoncurrentDays: "365" }
      },
      {
        ID: "abort-incomplete-backup-uploads",
        Status: "Enabled",
        Filter: { Prefix: "" },
        AbortIncompleteMultipartUpload: { DaysAfterInitiation: "7" }
      }
    ]
  });

  if (extensionIds.length) {
    await client.putBucketCors({
      Bucket: primaryBucket,
      Region: primaryRegion,
      ResponseVary: "true",
      CORSRules: extensionIds.map((id) => ({
        ID: `aarre-extension-${id}`,
        AllowedOrigin: [`chrome-extension://${id}`],
        AllowedMethod: ["PUT", "GET", "HEAD"],
        AllowedHeader: [
          "content-type",
          "x-cos-meta-sha256",
          "x-cos-server-side-encryption"
        ],
        ExposeHeader: ["ETag", "x-cos-version-id", "x-cos-server-side-encryption"],
        MaxAgeSeconds: 600
      }))
    });
  }

  const [primaryEncryption, backupEncryption] = await Promise.all([
    client.getBucketEncryption({ Bucket: primaryBucket, Region: primaryRegion }),
    client.getBucketEncryption({ Bucket: backupBucket, Region: backupRegion })
  ]);
  if (
    encryptionAlgorithm(primaryEncryption) !== "AES256" ||
    encryptionAlgorithm(backupEncryption) !== "AES256"
  ) {
    throw new Error("Tencent COS bucket encryption verification failed.");
  }

  await client.putBucketReplication({
    Bucket: primaryBucket,
    Region: primaryRegion,
    ReplicationConfiguration: {
      Role: `qcs::cam::uin/${accountUin}:uin/${accountUin}`,
      Rules: [{
        ID: "replicate-aarre-assets-to-singapore",
        Status: "Enabled",
        Prefix: "users/",
        Priority: 1,
        Destination: {
          Bucket: `qcs::cos:${backupRegion}::${backupBucket}`,
          StorageClass: "STANDARD"
        },
        DeleteMarkerReplication: { Status: "Enabled" }
      }]
    }
  } as unknown as COS.PutBucketReplicationParams);
}

function policyDocuments(input: {
  appId: string;
  primaryRegion: string;
  backupRegion: string;
  primaryBucket: string;
  backupBucket: string;
}): { api: string; backup: string } {
  const primaryObjects = `qcs::cos:${input.primaryRegion}:uid/${input.appId}:${input.primaryBucket}/users/*`;
  const backupObjects = `qcs::cos:${input.backupRegion}:uid/${input.appId}:${input.backupBucket}/users/*`;
  const backupDumps = `qcs::cos:${input.backupRegion}:uid/${input.appId}:${input.backupBucket}/backups/database/*`;
  const primaryBucket = `qcs::cos:${input.primaryRegion}:uid/${input.appId}:${input.primaryBucket}/*`;
  const backupBucket = `qcs::cos:${input.backupRegion}:uid/${input.appId}:${input.backupBucket}/*`;
  const objectActions = [
    "name/cos:PutObject",
    "name/cos:InitiateMultipartUpload",
    "name/cos:UploadPart",
    "name/cos:ListParts",
    "name/cos:CompleteMultipartUpload",
    "name/cos:AbortMultipartUpload",
    "name/cos:GetObject",
    "name/cos:HeadObject",
    "name/cos:DeleteObject",
    "name/cos:DeleteMultipleObjects"
  ];
  const bucketActions = [
    "name/cos:ListMultipartUploads",
    "name/cos:GetBucketObjectVersions"
  ];
  return {
    api: JSON.stringify({
      version: "2.0",
      statement: [
        { effect: "allow", action: objectActions, resource: [primaryObjects] },
        {
          effect: "allow",
          action: bucketActions,
          resource: [primaryBucket],
          condition: { string_like: { "cos:prefix": "users%2F*" } }
        }
      ]
    }),
    backup: JSON.stringify({
      version: "2.0",
      statement: [
        { effect: "allow", action: objectActions, resource: [backupObjects, backupDumps] },
        {
          effect: "allow",
          action: bucketActions,
          resource: [backupBucket],
          condition: { string_like: { "cos:prefix": "users%2F*" } }
        },
        {
          effect: "allow",
          action: bucketActions,
          resource: [backupBucket],
          condition: { string_like: { "cos:prefix": "backups%2Fdatabase%2F*" } }
        }
      ]
    })
  };
}

function findUser(data: unknown, name: string): { Uin?: number; Name?: string } | undefined {
  if (!Array.isArray(data)) return undefined;
  return data.find((item) => item && typeof item === "object" && (item as { Name?: string }).Name === name);
}

async function ensureUser(input: {
  cam: CommonClient;
  allUsers: unknown;
  name: string;
  remark: string;
  existingCredential: TencentCredential | null;
}): Promise<CamAccess> {
  const existing = findUser(input.allUsers, input.name);
  if (existing) {
    if (!input.existingCredential) {
      throw new Error(`CAM user ${input.name} already exists but its local credential file is unavailable; refusing to create an untracked second key.`);
    }
    return { ...input.existingCredential, uin: String(existing.Uin) };
  }
  const created = await input.cam.request("AddUser", {
    Name: input.name,
    Remark: input.remark,
    ConsoleLogin: 0,
    UseApi: 1
  }) as Record<string, unknown>;
  const nested = (created.Data && typeof created.Data === "object" ? created.Data : created) as Record<string, unknown>;
  const uin = String(nested.Uin || nested.uin || "");
  let secretId = String(nested.SecretId || nested.secretId || "");
  let secretKey = String(nested.SecretKey || nested.secretKey || "");
  if (!uin) throw new Error(`Tencent CAM did not return a UIN for ${input.name}.`);
  if (!secretId || !secretKey) {
    const key = await input.cam.request("CreateAccessKey", { TargetUin: Number(uin) }) as {
      AccessKey?: { AccessKeyId?: string; SecretAccessKey?: string };
    };
    secretId = key.AccessKey?.AccessKeyId || "";
    secretKey = key.AccessKey?.SecretAccessKey || "";
  }
  if (!secretId || !secretKey) throw new Error(`Tencent CAM did not return an API key for ${input.name}.`);
  return { uin, secretId, secretKey };
}

async function ensurePolicy(input: {
  cam: CommonClient;
  existingId?: number;
  name: string;
  description: string;
  document: string;
  userUin: string;
}): Promise<number> {
  let policyId = input.existingId;
  if (policyId) {
    await input.cam.request("UpdatePolicy", {
      PolicyId: policyId,
      PolicyName: input.name,
      Description: input.description,
      PolicyDocument: input.document
    });
  } else {
    const created = await input.cam.request("CreatePolicy", {
      PolicyName: input.name,
      Description: input.description,
      PolicyDocument: input.document
    }) as { PolicyId?: number };
    policyId = created.PolicyId;
  }
  if (!policyId) throw new Error(`Tencent CAM did not return a policy ID for ${input.name}.`);
  try {
    await input.cam.request("AttachUserPolicy", {
      PolicyId: policyId,
      AttachUin: Number(input.userUin)
    });
  } catch (error) {
    const code = errorCode(error);
    if (!code.includes("Already") && !code.includes("Duplicate")) throw error;
  }
  return policyId;
}

async function findPolicyId(cam: CommonClient, name: string): Promise<number | undefined> {
  const result = await cam.request("ListPolicies", {
    Page: 1,
    Rp: 200,
    Scope: "Local",
    Keyword: name
  }) as {
    List?: Array<{ PolicyId?: number; PolicyName?: string }>;
  };
  const matches = (result.List || []).filter((policy) => policy.PolicyName === name);
  if (matches.length > 1) {
    throw new Error(`Multiple CAM policies are named ${name}; refusing to choose one automatically.`);
  }
  return matches[0]?.PolicyId;
}

function parseEnv(contents: string): TencentCredential | null {
  const entries = new Map<string, string>();
  for (const line of contents.split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (match) entries.set(match[1], match[2]);
  }
  const secretId = entries.get("TENCENT_CLOUD_SECRET_ID") || entries.get("TENCENT_BACKUP_SECRET_ID") || "";
  const secretKey = entries.get("TENCENT_CLOUD_SECRET_KEY") || entries.get("TENCENT_BACKUP_SECRET_KEY") || "";
  return secretId && secretKey ? { secretId, secretKey } : null;
}

async function readCredential(path: string): Promise<TencentCredential | null> {
  try {
    return parseEnv(await readFile(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function ensureDns(input: {
  credential: TencentCredential;
  domain: string;
  subdomain: string;
  value: string;
}): Promise<number> {
  const client = createClient("dnspod.tencentcloudapi.com", "2021-03-23", input.credential);
  const described = await client.request("DescribeRecordList", {
    Domain: input.domain,
    SubDomain: input.subdomain,
    RecordType: "A",
    Limit: 100
  }) as { RecordList?: Array<{ RecordId?: number; Value?: string; Line?: string; Name?: string }> };
  const records = described.RecordList || [];
  if (records.length > 1) {
    throw new Error(`DNS ${input.subdomain}.${input.domain} has multiple A records; refusing to choose one automatically.`);
  }
  if (!records.length) {
    const created = await client.request("CreateRecord", {
      Domain: input.domain,
      SubDomain: input.subdomain,
      RecordType: "A",
      RecordLine: "默认",
      Value: input.value,
      TTL: 600,
      Status: "ENABLE",
      Remark: "Aarre production sync API"
    }) as { RecordId?: number };
    if (!created.RecordId) throw new Error("DNSPod did not return the created record ID.");
    return created.RecordId;
  }
  const record = records[0];
  if (!record.RecordId) throw new Error("DNSPod returned a record without an ID.");
  if (record.Value !== input.value) {
    await client.request("ModifyRecord", {
      Domain: input.domain,
      RecordId: record.RecordId,
      SubDomain: input.subdomain,
      RecordType: "A",
      RecordLine: record.Line || "默认",
      Value: input.value,
      TTL: 600
    });
  }
  return record.RecordId;
}

async function main(): Promise<void> {
  if (process.env.AARRE_TENCENT_PROVISION_CONFIRM !== CONFIRMATION) {
    throw new Error(`Set AARRE_TENCENT_PROVISION_CONFIRM=${JSON.stringify(CONFIRMATION)} to create or update production resources.`);
  }
  const rootCredential = {
    secretId: required("TENCENT_CLOUD_SECRET_ID"),
    secretKey: required("TENCENT_CLOUD_SECRET_KEY")
  };
  const outputDirectory = process.env.AARRE_PROVISION_OUTPUT_DIR?.trim() || "/out";
  const primaryRegion = process.env.AARRE_PRIMARY_REGION?.trim() || "ap-hongkong";
  const backupRegion = process.env.AARRE_BACKUP_REGION?.trim() || "ap-singapore";
  const extensionIds = (process.env.AARRE_EXTENSION_IDS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (extensionIds.some((id) => !/^[a-p]{32}$/.test(id))) {
    throw new Error("Every AARRE_EXTENSION_IDS entry must contain 32 a-p characters.");
  }
  await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
  const statePath = join(outputDirectory, "tencent-provision-state.json");
  const apiEnvPath = join(outputDirectory, "api-cam.env");
  const backupEnvPath = join(outputDirectory, "backup.env");
  const existingState = await readState(statePath);

  const sts = createClient("sts.tencentcloudapi.com", "2018-08-13", rootCredential, primaryRegion);
  const cam = createClient("cam.tencentcloudapi.com", "2019-01-16", rootCredential);
  const identity = await sts.request("GetCallerIdentity", {}) as {
    AccountId?: string;
    PrincipalId?: string;
    Type?: string;
  };
  if (!identity.AccountId || !identity.PrincipalId) throw new Error("Tencent STS did not identify the caller.");
  if (identity.Type !== "Root" && identity.AccountId !== identity.PrincipalId) {
    throw new Error("Provisioning requires a Tencent identity with explicit account-administrator approval.");
  }
  const app = await cam.request("GetUserAppId", {}) as { AppId?: number };
  if (!app.AppId) throw new Error("Tencent CAM did not return the account APPID.");
  const appId = String(app.AppId);
  const accountUin = String(identity.AccountId);
  const primaryBucket = `aarre-private-${appId}`;
  const backupBucket = `aarre-backup-${appId}`;
  if (existingState.accountUin && existingState.accountUin !== accountUin) {
    throw new Error("The existing Aarre provision state belongs to another Tencent account.");
  }

  const cos = createCos(rootCredential);
  await configureBuckets({
    client: cos,
    primaryBucket,
    backupBucket,
    primaryRegion,
    backupRegion,
    extensionIds,
    accountUin
  });

  const listed = await cam.request("ListUsers", {}) as { Data?: unknown };
  const apiAccess = await ensureUser({
    cam,
    allUsers: listed.Data,
    name: "aarre-production-api",
    remark: "Aarre production API; no console access; least-privilege primary COS only.",
    existingCredential: await readCredential(apiEnvPath)
  });
  await atomicWrite(apiEnvPath, [
    `TENCENT_CLOUD_SECRET_ID=${apiAccess.secretId}`,
    `TENCENT_CLOUD_SECRET_KEY=${apiAccess.secretKey}`,
    `TENCENT_CLOUD_REGION=${primaryRegion}`,
    `COS_BUCKET=${primaryBucket}`,
    `COS_REGION=${primaryRegion}`,
    `COS_BACKUP_BUCKET=${backupBucket}`,
    `COS_BACKUP_REGION=${backupRegion}`,
    ""
  ].join("\n"));

  const refreshed = await cam.request("ListUsers", {}) as { Data?: unknown };
  const backupAccess = await ensureUser({
    cam,
    allUsers: refreshed.Data,
    name: "aarre-production-backup",
    remark: "Aarre short-lived backup and deletion worker; no console access.",
    existingCredential: await readCredential(backupEnvPath)
  });
  await atomicWrite(backupEnvPath, [
    `TENCENT_BACKUP_SECRET_ID=${backupAccess.secretId}`,
    `TENCENT_BACKUP_SECRET_KEY=${backupAccess.secretKey}`,
    ""
  ].join("\n"));

  const documents = policyDocuments({
    appId,
    primaryRegion,
    backupRegion,
    primaryBucket,
    backupBucket
  });
  const apiPolicyId = await ensurePolicy({
    cam,
    existingId: existingState.apiPolicyId || await findPolicyId(cam, "AarreProductionApiAccess"),
    name: "AarreProductionApiAccess",
    description: "Least-privilege access to Aarre primary assets.",
    document: documents.api,
    userUin: apiAccess.uin
  });
  const backupPolicyId = await ensurePolicy({
    cam,
    existingId: existingState.backupPolicyId || await findPolicyId(cam, "AarreProductionBackupAccess"),
    name: "AarreProductionBackupAccess",
    description: "Least-privilege access for Aarre database backup and cross-region deletion jobs.",
    document: documents.backup,
    userUin: backupAccess.uin
  });
  const skipDns = process.env.AARRE_SKIP_DNS === "1";
  const dnsRecordId = skipDns ? null : await ensureDns({
    credential: rootCredential,
    domain: process.env.AARRE_DNS_DOMAIN?.trim() || "nexvoice.cc",
    subdomain: process.env.AARRE_DNS_SUBDOMAIN?.trim() || "sync",
    value: process.env.AARRE_API_IPV4?.trim() || "43.161.230.52"
  });

  const state: ProvisionState = {
    version: 2,
    accountUin,
    appId,
    primaryBucket,
    backupBucket,
    serverSideEncryption: "AES256",
    apiUserUin: apiAccess.uin,
    backupUserUin: backupAccess.uin,
    apiPolicyId,
    backupPolicyId,
    dnsRecordId,
    dnsStatus: skipDns ? "external-pending" : "managed",
    completedAt: new Date().toISOString()
  };
  await atomicWrite(statePath, JSON.stringify(state, null, 2) + "\n");
  process.stdout.write(JSON.stringify({
    ok: true,
    accountType: identity.Type,
    primaryRegion,
    backupRegion,
    primaryBucket,
    backupBucket,
    serverSideEncryption: "AES256",
    extensionOriginCount: extensionIds.length,
    camUsers: 2,
    camPolicies: 2,
    dnsStatus: skipDns ? "external-pending" : "managed",
    dns: `${process.env.AARRE_DNS_SUBDOMAIN?.trim() || "sync"}.${process.env.AARRE_DNS_DOMAIN?.trim() || "nexvoice.cc"}`,
    secretsWrittenTo: outputDirectory
  }, null, 2) + "\n");
}

await main();

import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import { resolve } from "node:path";
import { AuthService } from "../src/auth.js";
import { loadConfig } from "../src/config.js";
import { createDatabase } from "../src/db.js";
import { EnvelopeEncryption, LocalTestKeyWrapper } from "../src/encryption.js";
import { applyMigrations } from "../src/migrations.js";
import { sha256Base64Url, tokenHash } from "../src/security.js";
import { SyncService } from "../src/sync.js";
import { AssetService } from "../src/assets.js";
import { AccountService } from "../src/account.js";
import type { ObjectMetadata, ObjectStore, SignedUpload } from "../src/object-store.js";

const databaseUrl = process.env.AARRE_TEST_DATABASE_URL || "postgres://localhost/aarre_sync_test";
const localKey = randomBytes(32);
const config = loadConfig({
  NODE_ENV: "test",
  DATABASE_URL: databaseUrl,
  PUBLIC_BASE_URL: "https://sync.example.test",
  ALLOWED_EXTENSION_IDS: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  TOKEN_PEPPER: "test-token-pepper-that-is-longer-than-thirty-two-characters",
  GOOGLE_CLIENT_ID: "google-client-id-for-tests",
  GOOGLE_CLIENT_SECRET: "google-client-secret-for-tests",
  GOOGLE_REDIRECT_URI: "https://sync.example.test/v1/auth/google/callback",
  LOCAL_KEK_BASE64: localKey.toString("base64")
});
const database = createDatabase(databaseUrl);
const encryption = new EnvelopeEncryption(database, new LocalTestKeyWrapper(localKey));
const auth = new AuthService(database, config, encryption);
const sync = new SyncService(database, encryption);

class FakeObjectStore implements ObjectStore {
  configured = true;
  backupDeletionConfigured = true;
  metadata = new Map<string, ObjectMetadata>();
  deleted: string[] = [];
  deletedBackup: string[] = [];

  async signUpload(key: string, input: { mimeType: string; byteSize: number; sha256: string; expiresIn: number }): Promise<SignedUpload> {
    return {
      url: `https://cos.example.test/${key}`,
      headers: {
        "content-type": input.mimeType,
        "content-length": String(input.byteSize),
        "x-cos-meta-sha256": input.sha256,
        "x-cos-server-side-encryption": "AES256"
      },
      expiresIn: input.expiresIn
    };
  }

  async signDownload(key: string): Promise<string> {
    return `https://cos.example.test/${key}?signed=1`;
  }

  async head(key: string): Promise<ObjectMetadata> {
    const metadata = this.metadata.get(key);
    if (!metadata) throw new Error("missing fake object");
    return metadata;
  }

  async deleteAllVersions(key: string): Promise<void> {
    this.deleted.push(key);
  }

  async deleteAllBackupVersions(key: string): Promise<void> {
    this.deletedBackup.push(key);
  }
}

const objectStore = new FakeObjectStore();
const assets = new AssetService(database, objectStore, config, encryption);
const accounts = new AccountService(database, encryption);

async function resetDatabase() {
  const tables = [
    "backup_runs", "account_usage", "audit_events", "sync_operations", "sync_changes",
    "conflict_versions",
    "asset_delete_jobs", "assets", "operation_history", "usage_periods", "reports",
    "conversations", "user_settings", "protection_rules", "bookmark_items", "resources",
    "auth_tickets", "oauth_requests", "refresh_tokens", "access_tokens", "token_families",
    "devices", "user_keys", "users"
  ];
  await database.query(`TRUNCATE ${tables.join(", ")} RESTART IDENTITY CASCADE`);
  objectStore.metadata.clear();
  objectStore.deleted.length = 0;
  objectStore.deletedBackup.length = 0;
}

async function signedInAccount(email = "owner@example.test") {
  const userId = randomUUID();
  const deviceId = randomUUID();
  const verifier = randomBytes(48).toString("base64url");
  const ticket = randomBytes(32).toString("base64url");
  await database.query(
    `INSERT INTO users (id, google_sub_hash, email_hash, profile_payload, quota_bytes)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, `sub:${userId}`, `mail:${userId}`, Buffer.alloc(0), 262_144_000]
  );
  await database.query("INSERT INTO account_usage (user_id) VALUES ($1)", [userId]);
  const profile = await encryption.encryptJson(userId, "profile", {
    email,
    name: "Test Owner",
    avatarUrl: ""
  });
  await database.query("UPDATE users SET profile_payload = $2 WHERE id = $1", [userId, profile]);
  await database.query(
    `INSERT INTO auth_tickets
      (ticket_hash, user_id, device_id, code_challenge, redirect_uri, expires_at)
     VALUES ($1, $2, $3, $4, $5, now() + interval '5 minutes')`,
    [
      tokenHash(ticket, config.TOKEN_PEPPER),
      userId,
      deviceId,
      sha256Base64Url(verifier),
      "https://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.chromiumapp.org/auth"
    ]
  );
  const issued = await auth.exchangeTicket({ ticket, codeVerifier: verifier, deviceId, deviceName: "Test Chrome" });
  const account = await auth.authenticateAccessToken(issued.accessToken);
  assert.ok(account);
  return { userId, deviceId, ticket, verifier, issued, account };
}

const resourcePayload = (updatedAt = "2026-08-02T10:00:00.000Z") => ({
  canonicalUrl: "https://example.test/library",
  summary: "A durable summary",
  tags: ["reference"],
  tagsSource: "user" as const,
  topics: ["testing"],
  categoryCoverId: "generic-webpage",
  createdAt: "2026-08-02T09:00:00.000Z",
  updatedAt
});

before(async () => {
  const client = await database.connect();
  try {
    await applyMigrations(client, resolve(process.cwd(), "migrations"));
  } finally {
    client.release();
  }
});

beforeEach(resetDatabase);

after(async () => {
  await database.end();
});

test("ticket exchange issues revocable opaque tokens and detects refresh replay", async () => {
  const { issued, account, ticket, verifier, deviceId } = await signedInAccount();
  assert.equal((await auth.profile(account)).email, "owner@example.test");
  await assert.rejects(() => auth.exchangeTicket({ ticket, codeVerifier: verifier, deviceId }), /invalid|expired/i);
  const rotated = await auth.refresh(issued.refreshToken);
  assert.ok(await auth.authenticateAccessToken(rotated.accessToken));
  await assert.rejects(() => auth.refresh(issued.refreshToken), /replay/i);
  assert.equal(await auth.authenticateAccessToken(rotated.accessToken), null);
});

test("OAuth start only accepts the exact allowlisted Chromium extension redirect", async () => {
  const codeChallenge = sha256Base64Url(randomBytes(48).toString("base64url"));
  const deviceId = randomUUID();
  await assert.rejects(() => auth.beginGoogleLogin({
    codeChallenge,
    deviceId,
    redirectUri: "https://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.chromiumapp.org/auth"
  }), /not allowed/i);
  const redirect = new URL(await auth.beginGoogleLogin({
    codeChallenge,
    deviceId,
    redirectUri: "https://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.chromiumapp.org/auth"
  }));
  assert.equal(redirect.origin, "https://accounts.google.com");
  assert.equal(redirect.searchParams.get("redirect_uri"), config.GOOGLE_REDIRECT_URI);
  assert.ok(redirect.searchParams.get("state"));
  assert.ok(redirect.searchParams.get("nonce"));
});

test("resource sync is encrypted, idempotent, field-clock merged and user isolated", async () => {
  const first = await signedInAccount();
  const key = "a".repeat(64);
  const operationId = randomUUID();
  const initial = await sync.upsertResource(first.account, key, {
    operationId,
    clientRevision: randomUUID(),
    payload: resourcePayload(),
    fieldUpdatedAt: {},
    deleted: false
  });
  const repeated = await sync.upsertResource(first.account, key, {
    operationId,
    clientRevision: randomUUID(),
    payload: resourcePayload(),
    fieldUpdatedAt: {},
    deleted: false
  });
  assert.deepEqual(repeated, initial);
  await sync.upsertResource(first.account, key, {
    operationId: randomUUID(),
    clientRevision: randomUUID(),
    payload: { ...resourcePayload("2026-08-02T11:00:00.000Z"), summary: "Newer summary" },
    fieldUpdatedAt: { summary: "2026-08-02T11:00:00.000Z" },
    deleted: false
  });
  await sync.upsertResource(first.account, key, {
    operationId: randomUUID(),
    clientRevision: randomUUID(),
    payload: { ...resourcePayload("2026-08-02T10:30:00.000Z"), summary: "Stale summary", topics: ["new-topic"] },
    fieldUpdatedAt: {
      summary: "2026-08-02T10:30:00.000Z",
      topics: "2026-08-02T12:00:00.000Z"
    },
    deleted: false
  });
  const bootstrap = await sync.bootstrapResources(first.account, 0, 100);
  assert.equal(bootstrap.resources[0].payload.summary, "Newer summary");
  assert.deepEqual(bootstrap.resources[0].payload.topics, ["new-topic"]);
  const raw = await database.query<{ payload: Buffer }>("SELECT payload FROM resources WHERE user_id = $1", [first.userId]);
  assert.equal(raw.rows[0].payload.includes(Buffer.from("Newer summary")), false);
  const second = await signedInAccount("other@example.test");
  assert.equal((await sync.bootstrapResources(second.account, 0, 100)).resources.length, 0);
});

test("stale note and tag edits are preserved as resolvable encrypted conflicts", async () => {
  const owner = await signedInAccount();
  const key = "f".repeat(64);
  const first = await sync.upsertResource(owner.account, key, {
    operationId: randomUUID(),
    clientRevision: randomUUID(),
    baseRevision: 0,
    payload: { ...resourcePayload(), userNote: "initial", tags: ["initial"] },
    fieldUpdatedAt: {},
    deleted: false
  });
  const current = await sync.upsertResource(owner.account, key, {
    operationId: randomUUID(),
    clientRevision: randomUUID(),
    baseRevision: first.revision,
    payload: {
      ...resourcePayload("2026-08-02T11:00:00.000Z"),
      userNote: "server edit",
      tags: ["server"]
    },
    fieldUpdatedAt: {
      userNote: "2026-08-02T11:00:00.000Z",
      tags: "2026-08-02T11:00:00.000Z"
    },
    deleted: false
  });
  const stale = await sync.upsertResource(owner.account, key, {
    operationId: randomUUID(),
    clientRevision: randomUUID(),
    baseRevision: first.revision,
    payload: {
      ...resourcePayload("2026-08-02T11:30:00.000Z"),
      userNote: "offline edit",
      tags: ["offline"]
    },
    fieldUpdatedAt: {
      userNote: "2026-08-02T11:30:00.000Z",
      tags: "2026-08-02T11:30:00.000Z"
    },
    deleted: false
  });
  assert.equal(stale.conflictCount, 1);
  const beforeResolution = (await sync.bootstrapResources(owner.account, 0, 10)).resources[0];
  assert.equal(beforeResolution.payload.userNote, "server edit");
  assert.deepEqual(new Set(beforeResolution.payload.tags), new Set(["server", "offline"]));
  const conflicts = await sync.listConflicts(owner.account);
  assert.equal(conflicts.conflicts.length, 1);
  assert.equal(conflicts.conflicts[0].serverRevision, current.revision);
  assert.equal(conflicts.conflicts[0].fields.some((field) => field.field === "userNote"), true);
  const raw = await database.query<{ payload: Buffer }>(
    "SELECT payload FROM conflict_versions WHERE user_id = $1",
    [owner.userId]
  );
  assert.equal(raw.rows[0].payload.includes(Buffer.from("offline edit")), false);
  await sync.resolveConflict(owner.account, conflicts.conflicts[0].conflictId, {
    operationId: randomUUID(),
    resolution: "incoming"
  });
  const resolved = (await sync.bootstrapResources(owner.account, 0, 10)).resources[0];
  assert.equal(resolved.payload.userNote, "offline edit");
  assert.deepEqual(resolved.payload.tags, ["offline"]);
  assert.equal((await sync.listConflicts(owner.account)).conflicts.length, 0);
  const intruder = await signedInAccount("conflict-intruder@example.test");
  assert.equal((await sync.listConflicts(intruder.account)).conflicts.length, 0);
});

test("protection purges metadata and every COS object version and blocks stale devices", async () => {
  const owner = await signedInAccount();
  const key = "b".repeat(64);
  await sync.upsertResource(owner.account, key, {
    operationId: randomUUID(),
    clientRevision: randomUUID(),
    payload: resourcePayload(),
    fieldUpdatedAt: {},
    deleted: false
  });
  const assetId = randomUUID();
  const sha256 = "c".repeat(64);
  const upload = await assets.createUpload(owner.account, {
    assetId,
    operationId: randomUUID(),
    resourceKey: key,
    kind: "snapshot",
    sha256,
    byteSize: 128,
    width: 16,
    height: 10,
    mimeType: "image/webp",
    capturedAt: "2026-08-02T10:00:00.000Z",
    binding: { canonicalUrl: "https://example.test/library" }
  });
  const objectKey = new URL(String(upload.uploadUrl)).pathname.slice(1);
  objectStore.metadata.set(objectKey, {
    byteSize: 128,
    sha256,
    versionId: "v1",
    serverSideEncryption: "AES256"
  });
  await assets.completeUpload(owner.account, assetId, { operationId: randomUUID() });
  const intruder = await signedInAccount("intruder@example.test");
  await assert.rejects(() => assets.downloadUrl(intruder.account, assetId), /unavailable/i);
  await assert.rejects(
    () => assets.completeUpload(intruder.account, assetId, { operationId: randomUUID() }),
    /does not exist/i
  );
  const replacementAssetId = randomUUID();
  const replacementSha = "d".repeat(64);
  const replacement = await assets.createUpload(owner.account, {
    assetId: replacementAssetId,
    operationId: randomUUID(),
    resourceKey: key,
    kind: "snapshot",
    sha256: replacementSha,
    byteSize: 96,
    width: 16,
    height: 10,
    mimeType: "image/webp",
    capturedAt: "2026-08-02T10:30:00.000Z",
    binding: { canonicalUrl: "https://example.test/library" }
  });
  const replacementObjectKey = new URL(String(replacement.uploadUrl)).pathname.slice(1);
  objectStore.metadata.set(replacementObjectKey, {
    byteSize: 96,
    sha256: replacementSha,
    versionId: "v2",
    serverSideEncryption: "AES256"
  });
  await assets.completeUpload(owner.account, replacementAssetId, { operationId: randomUUID() });
  assert.deepEqual(await assets.processDeleteJobs(), { processed: 1, failed: 0 });
  const ruleId = randomUUID();
  await sync.upsertEntity(owner.account, {
    operationId: randomUUID(),
    entityType: "protection-rule",
    entityId: ruleId,
    updatedAt: "2026-08-02T11:00:00.000Z",
    payload: {
      ruleId,
      kind: "resource",
      resourceKey: key,
      updatedAt: "2026-08-02T11:00:00.000Z",
      deleted: false
    },
    deleted: false
  });
  assert.equal((await sync.bootstrapResources(owner.account, 0, 100)).resources.length, 0);
  await assert.rejects(() => sync.upsertResource(owner.account, key, {
    operationId: randomUUID(),
    clientRevision: randomUUID(),
    payload: resourcePayload(),
    fieldUpdatedAt: {},
    deleted: false
  }), /Protected/);
  assert.deepEqual(await assets.processDeleteJobs(), { processed: 1, failed: 0 });
  assert.deepEqual(objectStore.deleted, [objectKey, replacementObjectKey]);
  assert.deepEqual(objectStore.deletedBackup, [objectKey, replacementObjectKey]);
});

test("folder protection purges descendant metadata and blocks resource, bookmark, and asset uploads", async () => {
  const owner = await signedInAccount();
  const key = "9".repeat(64);
  const bookmarkItemId = randomUUID();
  await sync.upsertResource(owner.account, key, {
    operationId: randomUUID(),
    clientRevision: randomUUID(),
    payload: resourcePayload(),
    fieldUpdatedAt: {},
    deleted: false
  });
  await sync.upsertEntity(owner.account, {
    operationId: randomUUID(),
    entityType: "bookmark-item",
    entityId: bookmarkItemId,
    updatedAt: "2026-08-02T10:10:00.000Z",
    payload: {
      bookmarkItemId,
      resourceKey: key,
      userNote: "private folder note",
      tags: ["private"],
      bindingHint: {
        title: "Protected page",
        url: "https://example.test/library",
        folderPath: ["Toolbar", "Private"]
      },
      createdAt: "2026-08-02T09:00:00.000Z",
      updatedAt: "2026-08-02T10:10:00.000Z"
    },
    deleted: false
  });

  const ruleId = randomUUID();
  const rulePayload = {
    ruleId,
    kind: "folder" as const,
    path: ["Toolbar", "Private"],
    parentPath: ["Toolbar"],
    title: "Private",
    resourceKeys: [key],
    createdAt: "2026-08-02T11:00:00.000Z",
    updatedAt: "2026-08-02T11:00:00.000Z",
    deleted: false
  };
  await sync.upsertEntity(owner.account, {
    operationId: randomUUID(),
    entityType: "protection-rule",
    entityId: ruleId,
    updatedAt: rulePayload.updatedAt,
    payload: rulePayload,
    deleted: false
  });

  assert.equal((await sync.bootstrapResources(owner.account, 0, 100)).resources.length, 0);
  const entities = await sync.bootstrapEntities(owner.account);
  assert.equal(
    entities.entities.some((entity) => entity.entityType === "bookmark-item" && !entity.deleted),
    false
  );
  assert.equal(
    Number((await database.query(
      "SELECT count(*) AS count FROM protection_rule_resources WHERE user_id = $1 AND resource_key = $2",
      [owner.userId, key]
    )).rows[0].count),
    1
  );
  await assert.rejects(() => sync.upsertResource(owner.account, key, {
    operationId: randomUUID(),
    clientRevision: randomUUID(),
    payload: resourcePayload("2026-08-02T12:00:00.000Z"),
    fieldUpdatedAt: {},
    deleted: false
  }), /Protected/);
  await assert.rejects(() => sync.upsertEntity(owner.account, {
    operationId: randomUUID(),
    entityType: "bookmark-item",
    entityId: randomUUID(),
    updatedAt: "2026-08-02T12:00:00.000Z",
    payload: {
      bookmarkItemId: randomUUID(),
      resourceKey: key,
      userNote: "must not return",
      tags: [],
      bindingHint: {
        title: "Protected page",
        url: "https://example.test/library",
        folderPath: ["Toolbar", "Private"]
      },
      createdAt: "2026-08-02T09:00:00.000Z",
      updatedAt: "2026-08-02T12:00:00.000Z"
    },
    deleted: false
  }), /Protected/);
  await assert.rejects(() => assets.createUpload(owner.account, {
    assetId: randomUUID(),
    operationId: randomUUID(),
    resourceKey: key,
    kind: "cover",
    sha256: "8".repeat(64),
    byteSize: 32,
    mimeType: "image/webp"
  }), /Protected/);

  await sync.upsertEntity(owner.account, {
    operationId: randomUUID(),
    entityType: "protection-rule",
    entityId: ruleId,
    updatedAt: "2026-08-02T13:00:00.000Z",
    payload: {
      ...rulePayload,
      updatedAt: "2026-08-02T13:00:00.000Z",
      deleted: true
    },
    deleted: true
  });
  assert.equal(
    Number((await database.query(
      "SELECT count(*) AS count FROM protection_rule_resources WHERE user_id = $1 AND resource_key = $2",
      [owner.userId, key]
    )).rows[0].count),
    0
  );
  await sync.upsertResource(owner.account, key, {
    operationId: randomUUID(),
    clientRevision: randomUUID(),
    payload: resourcePayload("2026-08-02T14:00:00.000Z"),
    fieldUpdatedAt: {},
    deleted: false
  });
});

test("metadata quota is enforced transactionally and forbidden secret fields are rejected", async () => {
  const owner = await signedInAccount();
  await database.query("UPDATE users SET quota_bytes = 128 WHERE id = $1", [owner.userId]);
  await assert.rejects(() => sync.upsertResource(owner.account, "d".repeat(64), {
    operationId: randomUUID(),
    clientRevision: randomUUID(),
    payload: resourcePayload(),
    fieldUpdatedAt: {},
    deleted: false
  }), /quota/i);
  const usage = await database.query<{ metadata_bytes: string }>(
    "SELECT metadata_bytes FROM account_usage WHERE user_id = $1",
    [owner.userId]
  );
  assert.equal(Number(usage.rows[0].metadata_bytes), 0);
  await assert.rejects(() => sync.upsertEntity(owner.account, {
    operationId: randomUUID(),
    entityType: "setting-ai-models",
    entityId: "ai-models",
    updatedAt: "2026-08-02T12:00:00.000Z",
    payload: {
      provider: "deepseek",
      models: { deepseek: "deepseek-chat" },
      apiKey: "must-never-enter-the-cloud"
    },
    deleted: false
  }), /forbidden field/i);
});

test("usage sync preserves pricing provenance while rejecting unknown fields", async () => {
  const owner = await signedInAccount();
  const payload = {
    period: "2026-08",
    provider: "deepseek" as const,
    model: "deepseek-chat",
    inputTokens: 128_249,
    outputTokens: 157_976,
    cachedInputTokens: 0,
    estimatedTokens: 0,
    estimatedCostCny: 2.5,
    scanCount: 4,
    priceUpdatedAt: "2026-07-30",
    updatedAt: "2026-08-03T00:00:00.000Z"
  };
  await sync.upsertEntity(owner.account, {
    operationId: randomUUID(),
    entityType: "usage-period",
    entityId: "2026-08:deepseek:deepseek-chat",
    updatedAt: payload.updatedAt,
    payload,
    deleted: false
  });
  const entities = await sync.bootstrapEntities(owner.account);
  assert.deepEqual(
    entities.entities.find((item) => item.entityType === "usage-period")?.payload,
    payload
  );
  await assert.rejects(() => sync.upsertEntity(owner.account, {
    operationId: randomUUID(),
    entityType: "usage-period",
    entityId: "2026-08:deepseek:deepseek-chat",
    updatedAt: payload.updatedAt,
    payload: { ...payload, accidentalLocalField: true },
    deleted: false
  }), /unrecognized/i);
});

test("protection bootstrap preserves the stored update clock instead of manufacturing changes", async () => {
  const owner = await signedInAccount();
  const ruleId = randomUUID();
  const updatedAt = "2026-08-02T13:45:00.000Z";
  await sync.upsertEntity(owner.account, {
    operationId: randomUUID(),
    entityType: "protection-rule",
    entityId: ruleId,
    updatedAt,
    payload: {
      ruleId,
      kind: "resource",
      resourceKey: "e".repeat(64),
      updatedAt,
      deleted: false
    },
    deleted: false
  });
  const first = await sync.bootstrapEntities(owner.account);
  const second = await sync.bootstrapEntities(owner.account);
  assert.ok(Number.isFinite(Date.parse((first.entities[0].payload as { updatedAt: string }).updatedAt)));
  assert.deepEqual(second, first);
});

test("bookmark positions and theme are encrypted durable entities scoped to one account", async () => {
  const owner = await signedInAccount();
  const bookmarkItemId = randomUUID();
  const resourceKey = "f".repeat(64);
  await sync.upsertEntity(owner.account, {
    operationId: randomUUID(),
    entityType: "bookmark-item",
    entityId: bookmarkItemId,
    updatedAt: "2026-08-02T14:00:00.000Z",
    payload: {
      bookmarkItemId,
      resourceKey,
      userNote: "position-specific private note",
      tags: ["reference"],
      bindingHint: {
        title: "Example",
        url: "https://example.test/library",
        folderPath: ["Toolbar", "Reference"]
      },
      createdAt: "2026-08-02T13:00:00.000Z",
      updatedAt: "2026-08-02T14:00:00.000Z"
    },
    deleted: false
  });
  await sync.upsertEntity(owner.account, {
    operationId: randomUUID(),
    entityType: "setting-theme",
    entityId: "theme",
    updatedAt: "2026-08-02T14:00:00.000Z",
    payload: { mode: "dark" },
    deleted: false
  });
  const raw = await database.query<{ payload: Buffer }>(
    "SELECT payload FROM bookmark_items WHERE user_id = $1 AND bookmark_item_id = $2",
    [owner.userId, bookmarkItemId]
  );
  assert.equal(raw.rows[0].payload.includes(Buffer.from("position-specific private note")), false);
  const entities = await sync.bootstrapEntities(owner.account);
  assert.equal(entities.entities.find((item) => item.entityType === "bookmark-item")?.entityId, bookmarkItemId);
  assert.deepEqual(
    entities.entities.find((item) => item.entityType === "setting-theme")?.payload,
    { mode: "dark" }
  );
  const other = await signedInAccount("isolated@example.test");
  assert.deepEqual((await sync.bootstrapEntities(other.account)).entities, []);
});

test("account deletion revokes tokens and physically removes the user after asset cleanup", async () => {
  const owner = await signedInAccount();
  await accounts.requestDeletion(owner.account);
  assert.equal(await auth.authenticateAccessToken(owner.issued.accessToken), null);
  assert.equal(await accounts.finalizeDeletions(), 1);
  const users = await database.query("SELECT 1 FROM users WHERE id = $1", [owner.userId]);
  assert.equal(users.rowCount, 0);
});

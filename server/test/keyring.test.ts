import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { loadConfig } from "../src/config.js";
import { RootFileKeyWrapper } from "../src/encryption.js";

function encodedKey(): string {
  return randomBytes(32).toString("base64");
}

test("production accepts a versioned root-file KEK keyring and rejects test-only fallback", () => {
  const keyring = JSON.stringify({ currentVersion: "v1", keys: { v1: encodedKey() } });
  const config = loadConfig({
    NODE_ENV: "production",
    DATABASE_URL: "postgres://example.test/aarre",
    PUBLIC_BASE_URL: "https://sync.example.test",
    ALLOWED_EXTENSION_IDS: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    TOKEN_PEPPER: "test-token-pepper-that-is-longer-than-thirty-two-characters",
    GOOGLE_CLIENT_ID: "google-client-id-for-tests",
    GOOGLE_CLIENT_SECRET: "google-client-secret-for-tests",
    GOOGLE_REDIRECT_URI: "https://sync.example.test/v1/auth/google/callback",
    TENCENT_CLOUD_SECRET_ID: "test-secret-id",
    TENCENT_CLOUD_SECRET_KEY: "test-secret-key",
    COS_BUCKET: "primary-123",
    COS_BACKUP_BUCKET: "backup-123",
    AARRE_KEK_KEYRING_JSON: keyring
  });
  assert.equal(config.kekKeyring?.currentVersion, "v1");

  assert.throws(() => loadConfig({
    ...process.env,
    NODE_ENV: "production",
    DATABASE_URL: "postgres://example.test/aarre",
    PUBLIC_BASE_URL: "https://sync.example.test",
    ALLOWED_EXTENSION_IDS: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    TOKEN_PEPPER: "test-token-pepper-that-is-longer-than-thirty-two-characters",
    GOOGLE_CLIENT_ID: "google-client-id-for-tests",
    GOOGLE_CLIENT_SECRET: "google-client-secret-for-tests",
    GOOGLE_REDIRECT_URI: "https://sync.example.test/v1/auth/google/callback",
    TENCENT_CLOUD_SECRET_ID: "test-secret-id",
    TENCENT_CLOUD_SECRET_KEY: "test-secret-key",
    COS_BUCKET: "primary-123",
    COS_BACKUP_BUCKET: "backup-123",
    AARRE_KEK_KEYRING_JSON: "",
    TENCENT_KMS_KEY_ID: "",
    TENCENT_SSM_SECRET_NAME: "",
    LOCAL_KEK_BASE64: encodedKey()
  }), /root-file KEK keyring/i);
});

test("root-file wrapper keeps old DEKs readable after forward key rotation", async () => {
  const v1 = encodedKey();
  const v2 = encodedKey();
  const original = new RootFileKeyWrapper({ currentVersion: "v1", keys: { v1 } });
  const dek = randomBytes(32);
  const wrappedWithV1 = await original.wrap(dek);

  const rotated = new RootFileKeyWrapper({ currentVersion: "v2", keys: { v1, v2 } });
  assert.deepEqual(await rotated.unwrap(wrappedWithV1), dek);
  const wrappedWithV2 = await rotated.wrap(dek);
  assert.match(wrappedWithV2, /^root1\./);
  assert.deepEqual(await rotated.unwrap(wrappedWithV2), dek);

  const missingOldKey = new RootFileKeyWrapper({ currentVersion: "v2", keys: { v2 } });
  await assert.rejects(() => missingOldKey.unwrap(wrappedWithV1), /v1 is unavailable/);
});

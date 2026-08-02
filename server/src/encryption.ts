import {
  createCipheriv,
  createDecipheriv,
  randomBytes
} from "node:crypto";
import { kms } from "tencentcloud-sdk-nodejs-kms";
import { ssm } from "tencentcloud-sdk-nodejs-ssm";
import type { Database } from "./db.js";

export interface KeyWrapper {
  readonly provider: "tencent-kms" | "tencent-ssm" | "root-file" | "local-test";
  wrap(key: Buffer): Promise<string>;
  unwrap(wrapped: string): Promise<Buffer>;
}

type RootFileWrappedKey = {
  versionId: string;
  ciphertext: string;
};

/**
 * Production fallback for accounts where Tencent SSM requires the separately
 * billed KMS product. The versioned keyring is loaded from a root-owned mode
 * 0600 environment file. Keeping previous versions in the keyring allows a
 * controlled forward rotation without making existing account DEKs unreadable.
 */
export class RootFileKeyWrapper implements KeyWrapper {
  readonly provider = "root-file" as const;
  private readonly currentVersion: string;
  private readonly keys = new Map<string, Buffer>();

  constructor(input: { currentVersion: string; keys: Record<string, string> }) {
    this.currentVersion = input.currentVersion;
    for (const [version, encoded] of Object.entries(input.keys)) {
      const key = Buffer.from(encoded, "base64");
      if (key.length !== 32) throw new Error(`The root-file KEK ${version} must contain 32 bytes.`);
      this.keys.set(version, Buffer.from(key));
    }
    if (!this.keys.has(this.currentVersion)) {
      throw new Error("The root-file KEK keyring does not contain its current version.");
    }
  }

  async wrap(key: Buffer): Promise<string> {
    const kek = this.keys.get(this.currentVersion);
    if (!kek) throw new Error("The current root-file KEK is unavailable.");
    const envelope: RootFileWrappedKey = {
      versionId: this.currentVersion,
      ciphertext: seal(kek, key, `aarre-root-file-dek:${this.currentVersion}`).toString("base64")
    };
    return `root1.${Buffer.from(JSON.stringify(envelope), "utf8").toString("base64url")}`;
  }

  async unwrap(wrapped: string): Promise<Buffer> {
    if (!wrapped.startsWith("root1.")) {
      throw new Error("Root-file wrapped key uses an unsupported format.");
    }
    const envelope = JSON.parse(
      Buffer.from(wrapped.slice(6), "base64url").toString("utf8")
    ) as RootFileWrappedKey;
    if (!envelope.versionId || !envelope.ciphertext) {
      throw new Error("Root-file wrapped key is incomplete.");
    }
    const kek = this.keys.get(envelope.versionId);
    if (!kek) {
      throw new Error(`Root-file KEK version ${envelope.versionId} is unavailable.`);
    }
    return open(
      kek,
      Buffer.from(envelope.ciphertext, "base64"),
      `aarre-root-file-dek:${envelope.versionId}`
    );
  }
}

type SsmWrappedKey = {
  versionId: string;
  ciphertext: string;
};

/**
 * Cost-aware production wrapper: one application KEK is stored as a Tencent
 * SSM software-key secret. Per-account DEKs remain individually wrapped in
 * PostgreSQL, and every wrapped value records the SSM secret version so a
 * controlled SSM rotation never makes older accounts unreadable.
 */
export class TencentSsmKeyWrapper implements KeyWrapper {
  readonly provider = "tencent-ssm" as const;
  private readonly client: InstanceType<typeof ssm.v20190923.Client>;
  private readonly secretName: string;
  private readonly cache = new Map<string, {
    key: Buffer;
    versionId: string;
    expiresAt: number;
  }>();

  constructor(options: {
    secretId: string;
    secretKey: string;
    region: string;
    secretName: string;
  }) {
    const Client = ssm.v20190923.Client;
    this.client = new Client({
      credential: {
        secretId: options.secretId,
        secretKey: options.secretKey
      },
      region: options.region,
      profile: {
        signMethod: "TC3-HMAC-SHA256",
        httpProfile: {
          reqMethod: "POST",
          reqTimeout: 10,
          endpoint: "ssm.tencentcloudapi.com"
        }
      }
    });
    this.secretName = options.secretName;
  }

  private async keyForVersion(versionId: string): Promise<{ key: Buffer; versionId: string }> {
    const cached = this.cache.get(versionId);
    if (cached && cached.expiresAt > Date.now()) {
      return { key: cached.key, versionId: cached.versionId };
    }
    const result = await this.client.GetSecretValue({
      SecretName: this.secretName,
      VersionId: versionId
    });
    const resolvedVersion = result.VersionId || versionId;
    const raw = result.SecretString || (result.SecretBinary
      ? Buffer.from(result.SecretBinary, "base64").toString("utf8")
      : "");
    let encoded = raw;
    if (raw.trim().startsWith("{")) {
      const parsed = JSON.parse(raw) as { kekBase64?: unknown };
      encoded = typeof parsed.kekBase64 === "string" ? parsed.kekBase64 : "";
    }
    const key = Buffer.from(encoded, "base64");
    if (key.length !== 32) {
      throw new Error("Tencent SSM application KEK must decode to exactly 32 bytes.");
    }
    const resolvedEntry = {
      key,
      versionId: resolvedVersion,
      expiresAt: Date.now() + 60 * 60_000
    };
    this.cache.set(resolvedVersion, resolvedEntry);
    if (versionId === "SSM_Current") {
      this.cache.set(versionId, {
        ...resolvedEntry,
        expiresAt: Date.now() + 5 * 60_000
      });
    }
    return { key, versionId: resolvedVersion };
  }

  async wrap(key: Buffer): Promise<string> {
    const current = await this.keyForVersion("SSM_Current");
    const envelope: SsmWrappedKey = {
      versionId: current.versionId,
      ciphertext: seal(current.key, key, "aarre-ssm-dek").toString("base64")
    };
    return `ssm1.${Buffer.from(JSON.stringify(envelope), "utf8").toString("base64url")}`;
  }

  async unwrap(wrapped: string): Promise<Buffer> {
    if (!wrapped.startsWith("ssm1.")) {
      throw new Error("Tencent SSM wrapped key uses an unsupported format.");
    }
    const envelope = JSON.parse(
      Buffer.from(wrapped.slice(5), "base64url").toString("utf8")
    ) as SsmWrappedKey;
    if (!envelope.versionId || !envelope.ciphertext) {
      throw new Error("Tencent SSM wrapped key is incomplete.");
    }
    const resolved = await this.keyForVersion(envelope.versionId);
    return open(
      resolved.key,
      Buffer.from(envelope.ciphertext, "base64"),
      "aarre-ssm-dek"
    );
  }
}

export class TencentKmsKeyWrapper implements KeyWrapper {
  readonly provider = "tencent-kms" as const;
  private readonly client: InstanceType<typeof kms.v20190118.Client>;
  private readonly keyId: string;

  constructor(options: {
    secretId: string;
    secretKey: string;
    region: string;
    keyId: string;
  }) {
    const Client = kms.v20190118.Client;
    this.client = new Client({
      credential: {
        secretId: options.secretId,
        secretKey: options.secretKey
      },
      region: options.region,
      profile: {
        signMethod: "TC3-HMAC-SHA256",
        httpProfile: {
          reqMethod: "POST",
          reqTimeout: 10,
          endpoint: "kms.tencentcloudapi.com"
        }
      }
    });
    this.keyId = options.keyId;
  }

  async wrap(key: Buffer): Promise<string> {
    const result = await this.client.Encrypt({
      KeyId: this.keyId,
      Plaintext: key.toString("base64")
    });
    if (!result.CiphertextBlob) {
      throw new Error("Tencent KMS did not return an encrypted data key.");
    }
    return result.CiphertextBlob;
  }

  async unwrap(wrapped: string): Promise<Buffer> {
    const result = await this.client.Decrypt({ CiphertextBlob: wrapped });
    if (!result.Plaintext) {
      throw new Error("Tencent KMS did not return a decrypted data key.");
    }
    const key = Buffer.from(result.Plaintext, "base64");
    if (key.length !== 32) {
      throw new Error("Tencent KMS returned a data key with an invalid length.");
    }
    return key;
  }
}

export class LocalTestKeyWrapper implements KeyWrapper {
  readonly provider = "local-test" as const;
  private readonly key: Buffer;

  constructor(key: Buffer) {
    if (key.length !== 32) throw new Error("The local KEK must contain 32 bytes.");
    this.key = key;
  }

  async wrap(key: Buffer): Promise<string> {
    return seal(this.key, key, "aarre-local-dek").toString("base64");
  }

  async unwrap(wrapped: string): Promise<Buffer> {
    return open(this.key, Buffer.from(wrapped, "base64"), "aarre-local-dek");
  }
}

function seal(key: Buffer, plaintext: Buffer, aad: string): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from([1]), iv, tag, ciphertext]);
}

function open(key: Buffer, sealed: Buffer, aad: string): Buffer {
  if (sealed.length < 30 || sealed[0] !== 1) {
    throw new Error("Encrypted payload uses an unsupported format.");
  }
  const iv = sealed.subarray(1, 13);
  const tag = sealed.subarray(13, 29);
  const ciphertext = sealed.subarray(29);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

type CachedKey = { key: Buffer; expiresAt: number };

export class EnvelopeEncryption {
  private readonly database: Database;
  private readonly wrapper: KeyWrapper;
  private readonly cache = new Map<string, CachedKey>();

  constructor(database: Database, wrapper: KeyWrapper) {
    this.database = database;
    this.wrapper = wrapper;
  }

  private async dataKey(userId: string): Promise<Buffer> {
    const cached = this.cache.get(userId);
    if (cached && cached.expiresAt > Date.now()) return cached.key;

    const existing = await this.database.query<{
      wrapped_dek: string;
      provider: KeyWrapper["provider"];
    }>("SELECT wrapped_dek, provider FROM user_keys WHERE user_id = $1", [userId]);

    let key: Buffer;
    if (existing.rowCount) {
      const row = existing.rows[0];
      if (row.provider !== this.wrapper.provider) {
        throw new Error(`The account data key requires ${row.provider}, not ${this.wrapper.provider}.`);
      }
      key = await this.wrapper.unwrap(row.wrapped_dek);
    } else {
      const candidate = randomBytes(32);
      const wrapped = await this.wrapper.wrap(candidate);
      const inserted = await this.database.query(
        `INSERT INTO user_keys (user_id, wrapped_dek, provider)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id) DO NOTHING`,
        [userId, wrapped, this.wrapper.provider]
      );
      if (inserted.rowCount) {
        key = candidate;
      } else {
        const raced = await this.database.query<{
          wrapped_dek: string;
          provider: KeyWrapper["provider"];
        }>("SELECT wrapped_dek, provider FROM user_keys WHERE user_id = $1", [userId]);
        const row = raced.rows[0];
        if (!row || row.provider !== this.wrapper.provider) {
          throw new Error("Unable to establish the account data key.");
        }
        key = await this.wrapper.unwrap(row.wrapped_dek);
      }
    }
    this.cache.set(userId, { key, expiresAt: Date.now() + 5 * 60_000 });
    return key;
  }

  async encryptJson(userId: string, purpose: string, value: unknown): Promise<Buffer> {
    const plaintext = Buffer.from(JSON.stringify(value), "utf8");
    return seal(await this.dataKey(userId), plaintext, `${userId}:${purpose}`);
  }

  async decryptJson<T>(userId: string, purpose: string, payload: Buffer): Promise<T> {
    const plaintext = open(await this.dataKey(userId), payload, `${userId}:${purpose}`);
    return JSON.parse(plaintext.toString("utf8")) as T;
  }

  clearUser(userId: string): void {
    const cached = this.cache.get(userId);
    cached?.key.fill(0);
    this.cache.delete(userId);
  }
}

import { z } from "zod";

export type KekKeyring = {
  currentVersion: string;
  keys: Record<string, string>;
};

function decodeKek(value: string): Buffer | null {
  if (!/^[A-Za-z0-9+/]{43}=$/.test(value)) return null;
  const decoded = Buffer.from(value, "base64");
  return decoded.length === 32 && decoded.toString("base64") === value ? decoded : null;
}

function parseKekKeyring(value: string): KekKeyring | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<KekKeyring>;
    if (
      typeof parsed.currentVersion !== "string" ||
      !/^[A-Za-z0-9._-]{1,64}$/.test(parsed.currentVersion) ||
      !parsed.keys ||
      typeof parsed.keys !== "object" ||
      Array.isArray(parsed.keys)
    ) {
      return null;
    }
    const entries = Object.entries(parsed.keys);
    if (entries.length === 0 || entries.length > 8) return null;
    if (!entries.every(([version, key]) => (
      /^[A-Za-z0-9._-]{1,64}$/.test(version) &&
      typeof key === "string" &&
      decodeKek(key) !== null
    ))) {
      return null;
    }
    if (!Object.hasOwn(parsed.keys, parsed.currentVersion)) return null;
    return {
      currentVersion: parsed.currentVersion,
      keys: parsed.keys as Record<string, string>
    };
  } catch {
    return null;
  }
}

const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(8788),
  DATABASE_URL: z.string().min(1),
  PUBLIC_BASE_URL: z.string().url(),
  ALLOWED_EXTENSION_IDS: z.string().min(1),
  TOKEN_PEPPER: z.string().min(32),
  GOOGLE_CLIENT_ID: z.string().min(8),
  GOOGLE_CLIENT_SECRET: z.string().min(16),
  GOOGLE_REDIRECT_URI: z.string().url(),
  SENTRY_DSN: z.union([z.literal(""), z.string().url()]).default(""),
  SENTRY_ENVIRONMENT: z.string().min(1).max(64).default("production"),
  SENTRY_RELEASE: z.string().min(1).max(128).default("aarre-sync-api@0.1.9"),
  TENCENT_CLOUD_SECRET_ID: z.string().default(""),
  TENCENT_CLOUD_SECRET_KEY: z.string().default(""),
  TENCENT_BACKUP_SECRET_ID: z.string().default(""),
  TENCENT_BACKUP_SECRET_KEY: z.string().default(""),
  TENCENT_CLOUD_REGION: z.string().default("ap-hongkong"),
  TENCENT_KMS_KEY_ID: z.string().default(""),
  TENCENT_SSM_SECRET_NAME: z.string().default(""),
  COS_BUCKET: z.string().default(""),
  COS_REGION: z.string().default("ap-hongkong"),
  COS_BACKUP_BUCKET: z.string().default(""),
  COS_BACKUP_REGION: z.string().default("ap-singapore"),
  ASSET_URL_TTL_SECONDS: z.coerce.number().int().min(60).max(900).default(300),
  DEFAULT_QUOTA_BYTES: z.coerce.number().int().min(1_048_576).default(262_144_000),
  AARRE_KEK_KEYRING_JSON: z.string().default(""),
  LOCAL_KEK_BASE64: z.string().default("")
}).superRefine((value, context) => {
  const allowedIds = value.ALLOWED_EXTENSION_IDS.split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (allowedIds.some((id) => !/^[a-p]{32}$/.test(id))) {
    context.addIssue({
      code: "custom",
      path: ["ALLOWED_EXTENSION_IDS"],
      message: "Every extension ID must contain 32 characters in the a-p alphabet."
    });
  }
  if (value.NODE_ENV === "production") {
    for (const field of [
      "TENCENT_CLOUD_SECRET_ID",
      "TENCENT_CLOUD_SECRET_KEY",
      "COS_BUCKET",
      "COS_BACKUP_BUCKET"
    ] as const) {
      if (!value[field]) {
        context.addIssue({
          code: "custom",
          path: [field],
          message: `${field} is required in production.`
        });
      }
    }
    if (
      !value.TENCENT_KMS_KEY_ID &&
      !value.TENCENT_SSM_SECRET_NAME &&
      !value.AARRE_KEK_KEYRING_JSON
    ) {
      context.addIssue({
        code: "custom",
        path: ["AARRE_KEK_KEYRING_JSON"],
        message: "Production requires a root-file KEK keyring, Tencent SSM, or Tencent KMS."
      });
    }
  }
  if (value.AARRE_KEK_KEYRING_JSON && !parseKekKeyring(value.AARRE_KEK_KEYRING_JSON)) {
    context.addIssue({
      code: "custom",
      path: ["AARRE_KEK_KEYRING_JSON"],
      message: "AARRE_KEK_KEYRING_JSON must contain a current version and one to eight 32-byte base64 keys."
    });
  }
  if (value.LOCAL_KEK_BASE64) {
    if (!decodeKek(value.LOCAL_KEK_BASE64)) {
      context.addIssue({
        code: "custom",
        path: ["LOCAL_KEK_BASE64"],
        message: "LOCAL_KEK_BASE64 must decode to exactly 32 bytes."
      });
    }
  }
});

export type Config = z.infer<typeof environmentSchema> & {
  allowedExtensionIds: ReadonlySet<string>;
  kekKeyring: KekKeyring | null;
};

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): Config {
  const parsed = environmentSchema.parse(environment);
  return {
    ...parsed,
    kekKeyring: parseKekKeyring(parsed.AARRE_KEK_KEYRING_JSON),
    allowedExtensionIds: new Set(
      parsed.ALLOWED_EXTENSION_IDS.split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    )
  };
}

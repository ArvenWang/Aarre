import type { Config } from "./config.js";
import type { Database } from "./db.js";
import {
  EnvelopeEncryption,
  LocalTestKeyWrapper,
  RootFileKeyWrapper,
  TencentKmsKeyWrapper,
  TencentSsmKeyWrapper,
  type KeyWrapper
} from "./encryption.js";
import { TencentCosObjectStore } from "./object-store.js";

export function createRuntime(config: Config, database: Database) {
  let wrapper: KeyWrapper;
  if (
    config.TENCENT_CLOUD_SECRET_ID &&
    config.TENCENT_CLOUD_SECRET_KEY &&
    config.TENCENT_KMS_KEY_ID
  ) {
    wrapper = new TencentKmsKeyWrapper({
      secretId: config.TENCENT_CLOUD_SECRET_ID,
      secretKey: config.TENCENT_CLOUD_SECRET_KEY,
      region: config.TENCENT_CLOUD_REGION,
      keyId: config.TENCENT_KMS_KEY_ID
    });
  } else if (
    config.TENCENT_CLOUD_SECRET_ID &&
    config.TENCENT_CLOUD_SECRET_KEY &&
    config.TENCENT_SSM_SECRET_NAME
  ) {
    wrapper = new TencentSsmKeyWrapper({
      secretId: config.TENCENT_CLOUD_SECRET_ID,
      secretKey: config.TENCENT_CLOUD_SECRET_KEY,
      region: config.TENCENT_CLOUD_REGION,
      secretName: config.TENCENT_SSM_SECRET_NAME
    });
  } else if (config.kekKeyring) {
    wrapper = new RootFileKeyWrapper(config.kekKeyring);
  } else {
    if (config.NODE_ENV === "production") {
      throw new Error("A root-file, Tencent SSM, or Tencent KMS key wrapper is mandatory in production.");
    }
    if (!config.LOCAL_KEK_BASE64) {
      throw new Error(
        "LOCAL_KEK_BASE64 is required outside Tencent KMS so development data remains decryptable after restart."
      );
    }
    const key = Buffer.from(config.LOCAL_KEK_BASE64, "base64");
    wrapper = new LocalTestKeyWrapper(key);
  }
  const encryption = new EnvelopeEncryption(database, wrapper);
  const objectStore = new TencentCosObjectStore({
    secretId: config.TENCENT_CLOUD_SECRET_ID,
    secretKey: config.TENCENT_CLOUD_SECRET_KEY,
    backupSecretId: config.TENCENT_BACKUP_SECRET_ID,
    backupSecretKey: config.TENCENT_BACKUP_SECRET_KEY,
    bucket: config.COS_BUCKET,
    backupBucket: config.COS_BACKUP_BUCKET,
    backupRegion: config.COS_BACKUP_REGION,
    region: config.COS_REGION
  });
  return { encryption, objectStore };
}

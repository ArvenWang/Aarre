export const CLOUD_SYNC_SETTINGS_KEY = "aarre:cloud-sync-settings:v1";

export type CloudSyncScope = "text" | "complete";

export interface CloudSyncSettings {
  enabled: boolean;
  scope: CloudSyncScope;
  updatedAt: string;
}

export interface CloudStorageUsage {
  quotaBytes: number;
  usedBytes: number;
  metadataBytes: number;
  assetBytes: number;
  assetCount: number;
  resourceCount: number;
  usageRatio: number;
}

export interface CloudSyncEstimate {
  scope: CloudSyncScope;
  localTotalBytes: number;
  localMetadataBytes: number;
  localAssetBytes: number;
  resourceCount: number;
  assetCount: number;
  calculatedAt: string;
}

const DEFAULT_SETTINGS: CloudSyncSettings = {
  enabled: false,
  scope: "complete",
  updatedAt: ""
};

interface StoredConsent extends CloudSyncSettings { consentVersion?: number; consentedUserId?: string }
const SESSION_KEY = "aarre:cloud-session:v1";

export async function getCloudSyncSettings(): Promise<CloudSyncSettings> {
  const values = await chrome.storage.local.get([CLOUD_SYNC_SETTINGS_KEY, SESSION_KEY]);
  const stored = values[CLOUD_SYNC_SETTINGS_KEY] as StoredConsent | undefined;
  const session = values[SESSION_KEY] as { userId?: string } | undefined;
  return {
    enabled: stored?.enabled === true && stored.scope === "complete" && stored.consentVersion === 1 &&
      Boolean(session?.userId) && stored.consentedUserId === session?.userId,
    scope: "complete",
    updatedAt: typeof stored?.updatedAt === "string" ? stored.updatedAt : "",
  };
}

export async function saveCloudSyncSettings(input: Pick<CloudSyncSettings, "enabled">): Promise<CloudSyncSettings> {
  const values = await chrome.storage.local.get([CLOUD_SYNC_SETTINGS_KEY, SESSION_KEY]);
  const session = values[SESSION_KEY] as { userId?: string } | undefined;
  if (input.enabled && !session?.userId) throw new Error("请先登录，再开启完整备份。");
  const next: StoredConsent = {
    enabled: input.enabled, scope: "complete", updatedAt: new Date().toISOString(),
    consentVersion: 1, consentedUserId: session?.userId,
  };
  await chrome.storage.local.set({ [CLOUD_SYNC_SETTINGS_KEY]: next });
  return { enabled: next.enabled, scope: next.scope, updatedAt: next.updatedAt };
}

export function defaultCloudSyncSettings(): CloudSyncSettings {
  return { ...DEFAULT_SETTINGS };
}

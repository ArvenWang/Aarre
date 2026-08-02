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
  scope: "text",
  updatedAt: ""
};

export async function getCloudSyncSettings(): Promise<CloudSyncSettings> {
  const stored = (await chrome.storage.local.get(CLOUD_SYNC_SETTINGS_KEY))[
    CLOUD_SYNC_SETTINGS_KEY
  ] as Partial<CloudSyncSettings> | undefined;
  return {
    enabled: stored?.enabled === true,
    scope: stored?.scope === "complete" ? "complete" : "text",
    updatedAt: typeof stored?.updatedAt === "string" ? stored.updatedAt : ""
  };
}

export async function saveCloudSyncSettings(
  input: Pick<CloudSyncSettings, "enabled" | "scope">
): Promise<CloudSyncSettings> {
  const next: CloudSyncSettings = {
    enabled: input.enabled,
    scope: input.scope === "complete" ? "complete" : "text",
    updatedAt: new Date().toISOString()
  };
  await chrome.storage.local.set({ [CLOUD_SYNC_SETTINGS_KEY]: next });
  return next;
}

export function defaultCloudSyncSettings(): CloudSyncSettings {
  return { ...DEFAULT_SETTINGS };
}

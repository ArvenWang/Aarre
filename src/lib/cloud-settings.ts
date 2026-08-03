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
  enabled: true,
  scope: "complete",
  updatedAt: ""
};

export async function getCloudSyncSettings(): Promise<CloudSyncSettings> {
  const stored = (await chrome.storage.local.get(CLOUD_SYNC_SETTINGS_KEY))[
    CLOUD_SYNC_SETTINGS_KEY
  ] as Partial<CloudSyncSettings> | undefined;
  const next: CloudSyncSettings = {
    // Compatibility-only field. Account connection now owns sync lifecycle,
    // so every migrated record is enabled and callers must not use this as a
    // product switch.
    enabled: true,
    // 产品只保留完整备份：读取时一律按 complete 处理，并把旧的 text
    // 存储迁移为 complete，避免旧账号继续停留在仅文字同步。
    scope: "complete",
    updatedAt: typeof stored?.updatedAt === "string" ? stored.updatedAt : ""
  };
  if (stored && (stored.scope !== "complete" || stored.enabled !== next.enabled)) {
    await chrome.storage.local.set({ [CLOUD_SYNC_SETTINGS_KEY]: next });
  }
  return next;
}

export async function saveCloudSyncSettings(
  _input: Pick<CloudSyncSettings, "enabled">
): Promise<CloudSyncSettings> {
  const next: CloudSyncSettings = {
    enabled: true,
    scope: "complete",
    updatedAt: new Date().toISOString()
  };
  await chrome.storage.local.set({ [CLOUD_SYNC_SETTINGS_KEY]: next });
  return next;
}

export function defaultCloudSyncSettings(): CloudSyncSettings {
  return { ...DEFAULT_SETTINGS };
}

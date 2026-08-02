export type ListCoverStyle = "site" | "page";

const DISPLAY_SETTINGS_KEY = "aarre:display-settings";
export const PAGE_SNAPSHOT_ORIGINS = ["<all_urls>"] as const;

export interface DisplaySettings {
  listCoverStyle: ListCoverStyle;
  /**
   * 仅为兼容旧存储结构保留。完整增强层要求截图始终开启；
   * 用户仍可通过 snapshotExcludedHosts 排除不应截图的网站。
   */
  pageSnapshotsEnabled: boolean;
  snapshotExcludedHosts: string[];
  scanCostLimitCny: number;
}

const DEFAULT_DISPLAY_SETTINGS: DisplaySettings = {
  listCoverStyle: "site",
  pageSnapshotsEnabled: true,
  snapshotExcludedHosts: [],
  scanCostLimitCny: 10
};

export function normalizeSnapshotExcludedHost(input: string): string {
  const candidate = input
    .trim()
    .toLocaleLowerCase()
    .replace(/^\*\./, "")
    .replace(/^\.+|\.+$/g, "");
  if (!candidate) return "";
  try {
    const parsed = new URL(
      candidate.includes("://") ? candidate : `https://${candidate}`
    );
    return parsed.hostname
      .toLocaleLowerCase()
      .replace(/^\.+|\.+$/g, "");
  } catch {
    return "";
  }
}

export async function getDisplaySettings(): Promise<DisplaySettings> {
  const stored = (await chrome.storage.local.get(DISPLAY_SETTINGS_KEY))[
    DISPLAY_SETTINGS_KEY
  ] as Partial<DisplaySettings> | undefined;
  if (stored?.pageSnapshotsEnabled === false) {
    await chrome.storage.local.set({
      [DISPLAY_SETTINGS_KEY]: {
        ...stored,
        pageSnapshotsEnabled: true
      }
    });
  }
  return {
    listCoverStyle:
      stored?.listCoverStyle === "page" ? "page" : "site",
    // 0.4.0 以前可能持久化过 false，但新版界面已经没有关闭入口。
    // 若继续尊重该隐藏值，原生收藏和旧收藏补拍会被永久静默禁用。
    pageSnapshotsEnabled: true,
    scanCostLimitCny:
      typeof stored?.scanCostLimitCny === "number" &&
      Number.isFinite(stored.scanCostLimitCny) &&
      stored.scanCostLimitCny >= 0.01
        ? Math.min(10_000, stored.scanCostLimitCny)
        : DEFAULT_DISPLAY_SETTINGS.scanCostLimitCny,
    snapshotExcludedHosts: Array.isArray(stored?.snapshotExcludedHosts)
      ? stored.snapshotExcludedHosts
          .filter((host): host is string => typeof host === "string")
          .map(normalizeSnapshotExcludedHost)
          .filter(Boolean)
          .slice(0, 100)
      : []
  };
}

export async function saveDisplaySettings(
  settings: Partial<DisplaySettings>
): Promise<DisplaySettings> {
  const current = await getDisplaySettings();
  const merged = { ...current, ...settings };
  const normalized: DisplaySettings = {
    ...DEFAULT_DISPLAY_SETTINGS,
    listCoverStyle:
      merged.listCoverStyle === "page" ? "page" : "site",
    pageSnapshotsEnabled: true,
    scanCostLimitCny:
      typeof merged.scanCostLimitCny === "number" &&
      Number.isFinite(merged.scanCostLimitCny)
        ? Math.min(10_000, Math.max(0.01, merged.scanCostLimitCny))
        : DEFAULT_DISPLAY_SETTINGS.scanCostLimitCny,
    snapshotExcludedHosts: [
      ...new Set(
        merged.snapshotExcludedHosts
          .map(normalizeSnapshotExcludedHost)
          .filter(Boolean)
      )
    ].slice(0, 100)
  };
  await chrome.storage.local.set({
    [DISPLAY_SETTINGS_KEY]: normalized
  });
  return normalized;
}

/**
 * 网页访问权限是完整增强层的必需权限。先检查权限可让旧版
 * optional_host_permissions 构建继续工作，也避免已授权用户收到重复请求。
 */
export async function requestPageSnapshotPermission(): Promise<boolean> {
  if (!chrome.permissions) return true;
  // Design preview and some hosts only stub request(); calling a missing
  // contains() throws before any Promise.catch can run.
  if (typeof chrome.permissions.contains === "function") {
    try {
      if (
        await chrome.permissions.contains({
          origins: [...PAGE_SNAPSHOT_ORIGINS]
        })
      ) {
        return true;
      }
    } catch {
      // Fall through to request when the check itself is unavailable.
    }
  }
  if (typeof chrome.permissions.request !== "function") return true;
  return chrome.permissions.request({
    origins: [...PAGE_SNAPSHOT_ORIGINS]
  });
}

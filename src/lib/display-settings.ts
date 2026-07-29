export type ListCoverStyle = "site" | "page";

const DISPLAY_SETTINGS_KEY = "aarre:display-settings";

export interface DisplaySettings {
  listCoverStyle: ListCoverStyle;
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
  return {
    listCoverStyle:
      stored?.listCoverStyle === "page" ? "page" : "site",
    pageSnapshotsEnabled: stored?.pageSnapshotsEnabled !== false,
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
    pageSnapshotsEnabled: merged.pageSnapshotsEnabled !== false,
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

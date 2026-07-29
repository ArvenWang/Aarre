export type ListCoverStyle = "site" | "page";

const DISPLAY_SETTINGS_KEY = "aarre:display-settings";

export interface DisplaySettings {
  listCoverStyle: ListCoverStyle;
  pageSnapshotsEnabled: boolean;
  snapshotExcludedHosts: string[];
}

const DEFAULT_DISPLAY_SETTINGS: DisplaySettings = {
  listCoverStyle: "site",
  pageSnapshotsEnabled: true,
  snapshotExcludedHosts: []
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

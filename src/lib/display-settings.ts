export type ListCoverStyle = "site" | "page";

const DISPLAY_SETTINGS_KEY = "aarre:display-settings";

export interface DisplaySettings {
  listCoverStyle: ListCoverStyle;
}

const DEFAULT_DISPLAY_SETTINGS: DisplaySettings = {
  listCoverStyle: "site"
};

export async function getDisplaySettings(): Promise<DisplaySettings> {
  const stored = (await chrome.storage.local.get(DISPLAY_SETTINGS_KEY))[
    DISPLAY_SETTINGS_KEY
  ] as Partial<DisplaySettings> | undefined;
  return {
    listCoverStyle:
      stored?.listCoverStyle === "page" ? "page" : "site"
  };
}

export async function saveDisplaySettings(
  settings: DisplaySettings
): Promise<DisplaySettings> {
  const normalized: DisplaySettings = {
    ...DEFAULT_DISPLAY_SETTINGS,
    listCoverStyle:
      settings.listCoverStyle === "page" ? "page" : "site"
  };
  await chrome.storage.local.set({
    [DISPLAY_SETTINGS_KEY]: normalized
  });
  return normalized;
}

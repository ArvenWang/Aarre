export type ThemeMode = "light" | "dark";

const THEME_STORAGE_KEY = "aarre:theme";
export const THEME_SYNC_STORAGE_KEY = "aarre:theme-sync:v1";
export const THEME_CHANGE_EVENT = "aarre-theme-change";

function systemTheme(): ThemeMode {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function renderTheme(mode: ThemeMode): void {
  document.documentElement.dataset.theme = mode;
  document.documentElement.style.colorScheme = mode;
}

export function applyTheme(mode: ThemeMode): void {
  renderTheme(mode);
  window.localStorage.setItem(THEME_STORAGE_KEY, mode);
  window.dispatchEvent(new CustomEvent<ThemeMode>(THEME_CHANGE_EVENT, { detail: mode }));
  if (typeof chrome !== "undefined" && chrome.storage?.local) {
    void chrome.storage.local.set({ [THEME_SYNC_STORAGE_KEY]: mode });
  }
}

export function initializeTheme(): ThemeMode {
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  const mode: ThemeMode =
    stored === "dark" || stored === "light" ? stored : systemTheme();
  renderTheme(mode);
  window.localStorage.setItem(THEME_STORAGE_KEY, mode);
  if (typeof chrome !== "undefined" && chrome.storage?.local) {
    void chrome.storage.local.get(THEME_SYNC_STORAGE_KEY).then((stored) => {
      const cloudMode = stored[THEME_SYNC_STORAGE_KEY];
      if (cloudMode === "light" || cloudMode === "dark") {
        applyTheme(cloudMode);
      } else {
        void chrome.storage.local.set({ [THEME_SYNC_STORAGE_KEY]: mode });
      }
    });
  }
  return mode;
}

export async function getSyncedThemeMode(): Promise<ThemeMode | null> {
  const stored = (await chrome.storage.local.get(THEME_SYNC_STORAGE_KEY))[THEME_SYNC_STORAGE_KEY];
  return stored === "light" || stored === "dark" ? stored : null;
}

export async function saveSyncedThemeMode(mode: ThemeMode): Promise<void> {
  await chrome.storage.local.set({ [THEME_SYNC_STORAGE_KEY]: mode });
}

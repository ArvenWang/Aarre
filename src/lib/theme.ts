import { compareTheme, isTheme, resolvedTheme, SUITE_THEME_KEY, type SuiteTheme } from "../shared/suite-dock/contract";
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

function receiveTheme(mode: ThemeMode): void {
  renderTheme(mode);
  window.localStorage.setItem(THEME_STORAGE_KEY, mode);
  window.dispatchEvent(new CustomEvent<ThemeMode>(THEME_CHANGE_EVENT, { detail: mode }));
}

export function applyTheme(mode: ThemeMode): void {
  receiveTheme(mode);
  if (typeof chrome !== "undefined" && chrome.storage?.local) {
    void chrome.storage.local.set({ [THEME_SYNC_STORAGE_KEY]: mode });
    void chrome.runtime?.sendMessage({ type: "SUITE_THEME_SET", mode }).catch(() => undefined);
  }
}

let listening = false;
let sharedTheme: SuiteTheme | undefined;
function receiveSharedTheme(next: SuiteTheme): void {
  if (sharedTheme && compareTheme(next, sharedTheme) < 0) return;
  sharedTheme = next;
  receiveTheme(resolvedTheme(next.mode));
}
export function initializeTheme(): ThemeMode {
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  const mode: ThemeMode =
    stored === "dark" || stored === "light" ? stored : systemTheme();
  renderTheme(mode);
  window.localStorage.setItem(THEME_STORAGE_KEY, mode);
  if (typeof chrome !== "undefined" && chrome.storage?.local) {
    void chrome.storage.local.get([THEME_SYNC_STORAGE_KEY, SUITE_THEME_KEY]).then((stored) => {
      const shared = stored[SUITE_THEME_KEY];
      if (isTheme(shared)) { receiveSharedTheme(shared); return; }
      if (sharedTheme) return;
      const cloudMode = stored[THEME_SYNC_STORAGE_KEY];
      if (cloudMode === "light" || cloudMode === "dark") {
        receiveTheme(cloudMode);
      } else {
        void chrome.storage.local.set({ [THEME_SYNC_STORAGE_KEY]: mode });
      }
    });
    if (!listening && chrome.storage.onChanged) {
      listening = true;
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== "local") return;
        const shared = changes[SUITE_THEME_KEY]?.newValue;
        if (isTheme(shared)) receiveSharedTheme(shared);
        else if (!sharedTheme && changes[THEME_SYNC_STORAGE_KEY]) {
          const mode = changes[THEME_SYNC_STORAGE_KEY].newValue;
          if (mode === "light" || mode === "dark") receiveTheme(mode);
        }
      });
      window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
        void chrome.storage.local.get(SUITE_THEME_KEY).then(stored => {
          const shared = stored[SUITE_THEME_KEY];
          if (isTheme(shared) && shared.mode === "system") receiveTheme(resolvedTheme("system"));
        });
      });
    }
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

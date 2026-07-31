export type ThemeMode = "light" | "dark";

const THEME_STORAGE_KEY = "aarre:theme";

function systemTheme(): ThemeMode {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function applyTheme(mode: ThemeMode): void {
  document.documentElement.dataset.theme = mode;
  document.documentElement.style.colorScheme = mode;
  window.localStorage.setItem(THEME_STORAGE_KEY, mode);
}

export function initializeTheme(): ThemeMode {
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  const mode: ThemeMode =
    stored === "dark" || stored === "light" ? stored : systemTheme();
  applyTheme(mode);
  return mode;
}

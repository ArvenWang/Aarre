// Vendored identically by NexAlign and Aarre. Protocol v1 carries no page/business data.
export type SuiteApp = "aarre" | "nexalign";
export type SuiteMode = "light" | "dark" | "system";
export interface SuiteTheme { mode: SuiteMode; clock: number; writer: SuiteApp; id: string }
export interface SuiteState { paired: boolean; active: SuiteApp | null }
export const SUITE_THEME_KEY = "nex-suite:theme:v1";
export const SUITE_THEME_PORT = "nex-suite-theme-v1";
export const SUITE_DOCK_PORT = "nex-suite-dock-v1";
export const AARRE_ID = "ppjmhonejgpcdmjmcbbdjookgiagambm";
// Store identity and the existing development installation; never migrate user IDs silently.
export const NEXALIGN_IDS = ["aaepppdlfiikfmomfllpghojedjkmopf", "obnemfdgnkklhbdngemomokiklpaenmj"];
export const isApp = (value: unknown): value is SuiteApp => value === "aarre" || value === "nexalign";
export const isMode = (value: unknown): value is SuiteMode => value === "light" || value === "dark" || value === "system";
export function isTheme(value: unknown): value is SuiteTheme {
  const theme = value as SuiteTheme | null;
  return !!theme && isMode(theme.mode) && isApp(theme.writer) && Number.isSafeInteger(theme.clock)
    && theme.clock >= 0 && typeof theme.id === "string" && theme.id.length <= 80;
}
export const canonicalTheme = ({ mode, clock, writer, id }: SuiteTheme): SuiteTheme => ({ mode, clock, writer, id });
export function compareTheme(a: SuiteTheme, b: SuiteTheme) {
  return a.clock - b.clock || a.writer.localeCompare(b.writer) || a.id.localeCompare(b.id);
}
export const resolvedTheme = (mode: SuiteMode): "light" | "dark" => mode === "system"
  ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : mode;

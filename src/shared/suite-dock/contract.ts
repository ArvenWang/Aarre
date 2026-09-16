// Vendored identically by NexAlign and Aarre. Protocol v1 carries no page/business data.
export type SuiteApp = "aarre" | "nexalign";
export type DockSide = "left" | "right";
export const isDockSide = (value: unknown): value is DockSide => value === "left" || value === "right";
export type SuiteMode = "light" | "dark" | "system";
export interface SuiteTheme { mode: SuiteMode; clock: number; writer: SuiteApp; id: string }
export interface SuiteState { paired: boolean; active: SuiteApp | null; suppressed?: boolean; ratio?: number; side?: DockSide }
export const isRatio = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
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
/**
 * Content scripts inherit their page's security context, and `randomUUID` only
 * exists in a secure one. Plain-http pages, including internal test hosts, must
 * still get an id instead of a thrown call. `getRandomValues` is always there.
 */
export function randomId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map(byte => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

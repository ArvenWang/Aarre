import { getFloatingContext } from "../floating/bridge";
const MAX_AGE = 7 * 24 * 60 * 60 * 1000;
function key(kind: string) { return `aarre:draft:v1:${getFloatingContext()?.tabId || "sidebar"}:${kind}`; }
export function readDraft<T>(kind: string): T | null {
  try { const stored = JSON.parse(localStorage.getItem(key(kind)) || "null"); return stored && Date.now() - stored.savedAt < MAX_AGE ? stored.value as T : null; } catch { return null; }
}
export function writeDraft(kind: string, value: unknown): void {
  try { if (value === null) localStorage.removeItem(key(kind)); else localStorage.setItem(key(kind), JSON.stringify({ savedAt: Date.now(), value })); } catch { /* Memory state remains usable if storage is unavailable. */ }
}

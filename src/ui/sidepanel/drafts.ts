import { getFloatingContext } from "../floating/bridge";
const MAX_AGE = 7 * 24 * 60 * 60 * 1000;
function key(kind: string) { return `aarre:draft:v1:${getFloatingContext()?.tabId || "sidebar"}:${kind}`; }
export function readDraft<T>(kind: string): T | null {
  try { const stored = JSON.parse(localStorage.getItem(key(kind)) || "null"); return stored && Date.now() - stored.savedAt < MAX_AGE ? stored.value as T : null; } catch { return null; }
}
export function writeDraft(kind: string, value: unknown, strict = false): void {
  try { if (value === null) localStorage.removeItem(key(kind)); else localStorage.setItem(key(kind), JSON.stringify({ savedAt: Date.now(), value })); } catch { if (strict) throw new Error("草稿暂时未能保存，请重试。"); /* Keep the current UI alive on failure. */ }
}

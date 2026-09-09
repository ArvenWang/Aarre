import type { ActiveTabSummary } from "../../lib/types";
export interface FloatingContext { tabId: number; nonce: string; source: ActiveTabSummary; parentOrigin: string }
let context: FloatingContext | null = null;
export const getFloatingContext = () => context;
export function setFloatingContext(next: FloatingContext) { context = next; }
export function postToFloatingHost(message: Record<string, unknown>) {
  if (context) window.parent.postMessage({ ...message, session: context.nonce }, context.parentOrigin);
}
export const FLOATING_VIEW_EVENT = "aarre-floating-view";

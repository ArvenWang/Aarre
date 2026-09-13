import type { ActiveTabSummary } from "../../lib/types";
export interface FloatingContext { tabId: number; nonce: string; source: ActiveTabSummary; parentOrigin: string }
let context: FloatingContext | null = null;
export const getFloatingContext = () => context;
export function setFloatingContext(next: FloatingContext) { context = next; }
export function postToFloatingHost(message: Record<string, unknown>) {
  if (context) window.parent.postMessage({ ...message, session: context.nonce }, context.parentOrigin);
}
export const FLOATING_VIEW_EVENT = "aarre-floating-view";
export const FLOATING_SAVE_EVENT = "aarre-floating-save";
let pendingClose: { id: string; finish: () => void } | null = null;
// Keep the form rendered through the shared close motion; reopening cancels
// this dismissal so a delayed host acknowledgement cannot erase its draft.
export function requestFloatingClose(finish: () => void) {
  if (pendingClose) return;
  pendingClose = { id: crypto.randomUUID(), finish };
  postToFloatingHost({ type: "FLOAT_CLOSE", resetSave: true, requestId: pendingClose.id });
}
export function cancelFloatingClose() { pendingClose = null; }
export function completeFloatingClose(requestId?: string) {
  if (!pendingClose || (requestId !== undefined && requestId !== pendingClose.id)) return;
  const { finish } = pendingClose; pendingClose = null; finish();
}
let pendingSaveRequest: string | null = null;
let acceptedSaveRequest: string | null = null;
export const getFloatingSaveRequest = () => pendingSaveRequest;
export const getFloatingSaveLayoutRequest = () => pendingSaveRequest || acceptedSaveRequest;
// Keep the intent until the app has its source tab, even if it arrives before
// React subscribes or before the first bootstrap request completes.
export function requestFloatingSave(requestId: string) {
  if (requestId === acceptedSaveRequest) return;
  pendingSaveRequest = requestId;
  window.dispatchEvent(new Event(FLOATING_SAVE_EVENT));
}
export function acceptFloatingSave(requestId: string) {
  if (pendingSaveRequest !== requestId) return;
  pendingSaveRequest = null;
  acceptedSaveRequest = requestId;
  postToFloatingHost({ type: "FLOAT_SAVE_ACCEPTED", requestId });
}

export function deferFloatingSave(requestId: string) {
  if (pendingSaveRequest !== requestId) return;
  pendingSaveRequest = null; acceptedSaveRequest = requestId;
  postToFloatingHost({ type: "FLOAT_SAVE_DEFERRED", requestId });
}

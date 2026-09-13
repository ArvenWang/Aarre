import { prepareToPark } from "../../shared/suite-dock/parking";
import { createRoot } from "react-dom/client";
import { StrictMode } from "react";
import { initializeTheme, THEME_CHANGE_EVENT } from "../../lib/theme";
import { FLOATING_VIEW_EVENT, getFloatingContext, postToFloatingHost, setFloatingContext, requestFloatingSave, cancelFloatingClose, completeFloatingClose } from "./bridge";
import { listenForFrameChallenge, reportFloatingStartupError } from "./startup";
import { readDraft, writeDraft } from "../sidepanel/drafts";
import "../styles-sidepanel.css";
import "./floating.css";

async function start() {
  const params = new URLSearchParams(location.search);
  const preview = import.meta.env.DEV && params.get("preview") === "1";
  if (preview) {
    const { installSidePanelPreview } = await import("../sidepanel/preview"); installSidePanelPreview();
    document.documentElement.dataset.sidepanelPreview = "true";
    if (params.get("harness") === "1" && window.parent !== window && params.get("session")) {
      const source = { id: Number(params.get("tab")), url: location.origin + "/docs/verification/2026-09-09/host-harness.html", title: "开发验收场景", faviconUrl: "", supported: true };
      setFloatingContext({ tabId: source.id, nonce: params.get("session")!, source, parentOrigin: location.origin });
    }
  } else {
    if (window.parent === window) throw new Error("请通过网页右侧的 Aarre 快捷栏打开菜单。");
    const stopListening = listenForFrameChallenge(params.get("session") || "");
    const response = await chrome.runtime.sendMessage({ type: "FLOAT_CONNECT", nonce: params.get("session") }).finally(stopListening);
    if (!response?.ok || !response.data?.source?.id) throw new Error(response?.error || "此菜单已失效，请重新打开。");
    const source = response.data.source;
    const nonce = params.get("session")!;
    const parentOrigin = new URL(source.url).origin;
    setFloatingContext({ tabId: source.id, nonce, source, parentOrigin });
  }
  const verifiedContext = getFloatingContext();
  // A loading form can be cancelled before its React tree receives a close.
  // Clear only that cancelled save draft after authenticating the replacement.
  if (verifiedContext && params.get("discardSave") === "1" && readDraft<{ editor?: { kind: string } }>("bookmark-editor")?.editor?.kind === "save") {
    writeDraft("bookmark-editor", null);
  }
  if (verifiedContext && params.get("save")) requestFloatingSave(params.get("save")!);
  if (verifiedContext) {
    const { parentOrigin, nonce } = verifiedContext;
    window.addEventListener("message", (event) => {
      if (event.source !== parent || event.origin !== parentOrigin || event.data?.session !== nonce) return;
      if (event.data.type === "SUITE_PREPARE_PARK" && typeof event.data.id === "string") {
        completeFloatingClose();
        const reply = (ok: boolean, error?: string) => postToFloatingHost({ type: "SUITE_PARK_READY", id: event.data.id, ok, error });
        void prepareToPark().then(() => reply(true), error => reply(false, error instanceof Error ? error.message : String(error)));
      }
      if (event.data.type === "FLOAT_VIEW") {
        cancelFloatingClose();
        window.dispatchEvent(new CustomEvent(FLOATING_VIEW_EVENT, { detail: event.data.view }));
        if (typeof event.data.saveRequestId === "string") requestFloatingSave(event.data.saveRequestId);
        if (event.data.focus) requestAnimationFrame(() => (document.querySelector<HTMLElement>('[role="dialog"] input, [role="dialog"] textarea') || document.querySelector<HTMLElement>('#bookmark-agent-prompt'))?.focus({ preventScroll: true }));
      }
      if (event.data.type === "FLOAT_CLOSED" && typeof event.data.requestId === "string") completeFloatingClose(event.data.requestId);
    });
    window.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || event.isComposing || event.defaultPrevented) return;
      // Overlay components get the first opportunity to close their own layer.
      if (document.querySelector('[role="dialog"], [role="listbox"], [role="menu"]')) return;
      event.preventDefault(); postToFloatingHost({ type: "FLOAT_CLOSE" });
    });
    window.addEventListener(THEME_CHANGE_EVENT, () => postToFloatingHost({ type: "FLOAT_THEME", theme: document.documentElement.dataset.theme }));
  }
  initializeTheme();
  document.documentElement.dataset.density = "compact";
  const [{ SidePanelApp }, { SidePanelErrorBoundary }] = await Promise.all([import("../sidepanel/SidePanelApp"), import("../sidepanel/error-boundary")]);
  const root = createRoot(document.getElementById("root")!);
  root.render(<StrictMode><SidePanelErrorBoundary><SidePanelApp surface="floating" /></SidePanelErrorBoundary></StrictMode>);
  requestAnimationFrame(() => requestAnimationFrame(() => { postToFloatingHost({ type: "FLOAT_READY" }); document.documentElement.dataset.aarreReactCommitted = "true"; }));
}
void start().catch((error) => {
  const root = document.getElementById("root")!;
  const title = document.createElement("strong"); title.textContent = "Aarre 菜单未能打开";
  const message = document.createElement("p"); message.textContent = error instanceof Error ? error.message : "请重新打开菜单。";
  root.className = "floating-recovery"; root.replaceChildren(title, message);
  reportFloatingStartupError(message.textContent);
});

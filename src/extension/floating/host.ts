import { defaultFloatingPosition, floatingRects, floatingSaveRect, floatingWidth, SAVE_PANEL_INITIAL_HEIGHT, type FloatingPosition, type Viewport } from "../../lib/floating-geometry";
import { hostStyles } from "./host-styles";

interface HostInfo { tabId: number; documentId: string; nonce: string; enabled: boolean; position: FloatingPosition; theme?: string; saved?: boolean }
declare global { interface Window { __aarreFloatingHost?: { version: string; destroy(): void } } }
const version = chrome.runtime.getManifest().version;
if (window.top === window) {
  // The background injects only after a failed health check. Version equality
  // does not prove liveness after reloading an unpacked extension.
  try { window.__aarreFloatingHost?.destroy(); } catch { /* Old runtime is invalidated. */ }
  document.querySelectorAll<HTMLElement>('aarre-floating-host[data-aarre-ui="floating-host"]').forEach(node => {
    // DOM events cross the old/new isolated-world boundary; window globals do
    // not. Retire the old observer before it can reattach its disconnected UI.
    node.dispatchEvent(new Event("aarre-floating-retire"));
    if (!node.isConnected) return;
    // Compatibility with <=0.6.7, which has no retirement listener. Keep the
    // inert node connected so its legacy observer cannot resurrect the bar.
    node.dataset.aarreUi = "retired-floating-host";
    node.dataset.hidden = "true"; node.inert = true; node.setAttribute("aria-hidden", "true");
    try { if (node.matches(":popover-open")) node.hidePopover(); } catch { /* Old top layer may already be gone. */ }
    node.removeAttribute("popover");
  });
  startHost();
}
function startHost() {
  const host = document.createElement("aarre-floating-host");
  host.dataset.aarreUi = "floating-host"; host.dataset.hidden = "true"; host.setAttribute("popover", "manual");
  const shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style"); style.textContent = hostStyles;
  const surface = document.createElement("div"); surface.className = "dock-surface"; surface.setAttribute("aria-hidden", "true");
  const bar = document.createElement("div"); bar.className = "bar"; bar.setAttribute("role", "group"); bar.setAttribute("aria-label", "Aarre 快捷栏");
  const toggle = document.createElement("button"); toggle.type = "button"; toggle.className = "bar-toggle";
  toggle.setAttribute("aria-label", "展开 Aarre 菜单"); toggle.setAttribute("aria-expanded", "false"); toggle.setAttribute("aria-haspopup", "dialog"); toggle.title = "展开 Aarre 菜单";
  toggle.innerHTML = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="3" stroke="currentColor" stroke-width="1.7"/><path d="M14 4v16m-4-12-3 4 3 4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const quickSave = document.createElement("button"); quickSave.type = "button"; quickSave.className = "bar-save";
  quickSave.setAttribute("aria-label", "添加当前网页到收藏"); quickSave.setAttribute("aria-haspopup", "dialog"); quickSave.title = "添加到收藏";
  quickSave.innerHTML = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m12 3 2.8 5.7 6.3.9-4.5 4.4 1 6.2-5.6-3-5.6 3 1-6.2L2.9 9.6l6.3-.9L12 3Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>';
  bar.append(toggle, quickSave);
  const feedback = document.createElement("div"); feedback.className = "quick-feedback"; feedback.setAttribute("role", "status"); feedback.hidden = true;
  const panel = document.createElement("div"); panel.className = "panel"; panel.hidden = true; panel.inert = true;
  const loading = document.createElement("div"); loading.className = "loading"; loading.setAttribute("role", "status");
  const resize = document.createElement("div"); resize.className = "resize"; resize.tabIndex = 0;
  resize.setAttribute("role", "separator"); resize.setAttribute("aria-orientation", "vertical"); resize.setAttribute("aria-label", "调整菜单宽度");
  resize.setAttribute("aria-valuemin", "320"); resize.setAttribute("aria-valuemax", "640"); resize.title = "拖动左边调整宽度，或使用左右方向键";
  panel.append(loading, resize); shadow.append(style, surface, bar, panel, feedback);
  let info: HostInfo | null = null, iframe: HTMLIFrameElement | null = null;
  let position = { ...defaultFloatingPosition }, opened = false, opening = false, forced = false, disposed = false, ready = false, needsRetry = false;
  let view = "library", generation = 0;
  let pendingSaveRequest: string | null = null;
  let saveHeight: number | null = null;
  let watchdog: ReturnType<typeof setTimeout> | undefined, loadTimeout: ReturnType<typeof setTimeout> | undefined, closeTimer: ReturnType<typeof setTimeout> | undefined, feedbackTimer: ReturnType<typeof setTimeout> | undefined;
  let surfaceAnimation: Animation | undefined, panelAnimation: Animation | undefined;
  const captureLeases = new Set<string>();
  let previousFocus: HTMLElement | null = null, initPromise: Promise<void> | null = null;
  const viewport = (): Viewport => ({ width: window.visualViewport?.width || innerWidth, height: window.visualViewport?.height || innerHeight, left: window.visualViewport?.offsetLeft || 0, top: window.visualViewport?.offsetTop || 0 });
  type Rect = { x: number; y: number; width: number; height: number };
  const rectStyle = (element: HTMLElement, rect: Rect) => Object.assign(element.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px` });
  let surfaceRect: Rect | undefined;
  function layout(animate = false) {
    const rects = floatingRects(position, viewport());
    const menu = saveHeight === null ? rects.menu : floatingSaveRect(viewport(), saveHeight);
    const target = opened ? menu : rects.bar;
    const measured = surface.getBoundingClientRect();
    const from = measured.width ? measured : surfaceRect;
    surfaceAnimation?.cancel(); surfaceAnimation = undefined;
    rectStyle(surface, target); rectStyle(bar, rects.bar);
    // Keep the outgoing compact form at its current size during collapse.
    if (opened || panel.hidden) rectStyle(panel, menu);
    resize.hidden = saveHeight !== null;
    feedback.style.right = `${rects.bar.width + 12}px`; feedback.style.top = `${rects.bar.y}px`;
    resize.setAttribute("aria-valuenow", String(Math.round(rects.menu.width)));
    resize.setAttribute("aria-valuemin", String(Math.min(320, viewport().width)));
    resize.setAttribute("aria-valuemax", String(Math.min(640, viewport().width)));
    surfaceRect = target;
    if (animate && from && surface.animate && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
      surfaceAnimation = surface.animate([
        { transform: `translate(${from.x-target.x}px, ${from.y-target.y}px) scale(${from.width/target.width}, ${from.height/target.height})` },
        { transform: "none" },
      ], { duration: opened ? 280 : 210, easing: "cubic-bezier(.22,1,.36,1)" });
    }
  }
  const mountHost = () => {
    const parent = document.fullscreenElement || document.documentElement;
    if (host.parentElement !== parent) parent.append(host);
    try { if (!host.matches(":popover-open")) host.showPopover(); } catch { /* Fixed positioning also works without the top layer. */ }
  };
  const attach = () => { mountHost(); layout(); };
  const send = (message: Record<string, unknown>) => { if (iframe && info) iframe.contentWindow?.postMessage({ ...message, session: info.nonce }, chrome.runtime.getURL("").replace(/\/$/, "")); };
  const persist = () => { void chrome.runtime.sendMessage({ type: "FLOAT_POSITION", position }).catch(() => undefined); };
  async function initialize() {
    const response = await chrome.runtime.sendMessage({ type: "FLOAT_HOST_INIT", freshHost: !info });
    if (!response?.ok) throw new Error(response?.error || "菜单连接失败");
    if (disposed) return;
    const next = response.data as HostInfo;
    if (info && info.nonce !== next.nonce) { iframe?.remove(); iframe = null; ready = false; }
    info = next; position = next.position;
    if (typeof next.saved === "boolean") {
      quickSave.dataset.saved = String(next.saved);
      quickSave.title = next.saved ? "管理此收藏" : "添加到收藏";
      quickSave.setAttribute("aria-label", next.saved ? "管理当前网页收藏" : "添加当前网页到收藏");
    }
    host.dataset.theme = next.theme === "dark" || (!next.theme && matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light";
    host.dataset.hidden = String(!next.enabled && !forced); mountHost();
    if (surfaceAnimation?.playState !== "running") layout();
  }
  const init = () => initPromise ||= initialize().finally(() => { initPromise = null; });
  function showLoadError(message: string) {
    clearTimeout(loadTimeout); needsRetry = true; ready = false; loading.hidden = false;
    if (iframe) { iframe.inert = true; iframe.style.visibility = "visible"; }
    const title = document.createElement("strong"); title.textContent = "菜单未能打开";
    const detail = document.createElement("span"); detail.textContent = message;
    const retry = document.createElement("button"); retry.type = "button"; retry.textContent = "重新打开";
    retry.addEventListener("click", () => { void open(view).catch(() => showLoadError("连接暂时中断，请重新打开 Aarre。")); });
    loading.replaceChildren(title, detail, retry);
  }
  function revealPanel(show: boolean) {
    const opacity = panel.hidden ? 0 : Number(getComputedStyle(panel).opacity);
    panelAnimation?.cancel(); panelAnimation = undefined;
    panel.hidden = false; host.dataset.open = String(show);
    if (panel.animate && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
      panelAnimation = panel.animate([
        { opacity, transform: show ? "translateX(12px)" : "none" },
        { opacity: show ? 1 : 0, transform: show ? "none" : "translateX(8px)" },
      ], { duration: show ? 140 : 120, delay: show && opacity === 0 ? 100 : 0, fill: "backwards", easing: "ease-out" });
    }
  }
  const showView = () => send({ type: "FLOAT_VIEW", view, focus: opened, ...(pendingSaveRequest ? { saveRequestId: pendingSaveRequest } : {}) });
  async function open(nextView = "library") {
    const current = ++generation; opening = true; forced = true; view = nextView;
    clearTimeout(closeTimer); feedback.hidden = true;
    if (needsRetry) { iframe?.remove(); iframe = null; info = null; ready = false; needsRetry = false; }
    try { await init(); } finally { if (current === generation) opening = false; }
    if (!info || disposed || current !== generation) return;
    if (!opened) previousFocus = document.activeElement instanceof HTMLElement && document.activeElement !== host ? document.activeElement : null;
    // Opening takes precedence over passive launchers from other extensions.
    // Only reorder our own top-layer surface; never touch their DOM.
    try { if (host.matches(":popover-open")) host.hidePopover(); host.showPopover(); } catch { /* Fixed-position fallback. */ }
    // Keep rendering active beneath the opaque loading surface.
    if (pendingSaveRequest) {
      loading.hidden = false; loading.innerHTML = "<strong>添加到收藏</strong><span>正在读取当前页面…</span>";
      if (iframe) { iframe.inert = true; iframe.style.visibility = "visible"; }
    }
    opened = true; revealPanel(true); panel.inert = false; bar.hidden = true; toggle.setAttribute("aria-expanded", "true");
    if (!iframe) {
      ready = false; loading.hidden = false; loading.innerHTML = pendingSaveRequest ? "<strong>添加到收藏</strong><span>正在读取当前页面…</span>" : "<strong>Aarre</strong><span>正在打开收藏…</span>";
      iframe = document.createElement("iframe"); iframe.title = "Aarre 收藏菜单"; iframe.inert = true;
      const frameUrl = new URL(chrome.runtime.getURL("floating.html")); frameUrl.searchParams.set("tab", String(info.tabId)); frameUrl.searchParams.set("session", info.nonce);
      if (pendingSaveRequest) frameUrl.searchParams.set("save", pendingSaveRequest);
      iframe.style.visibility = "visible";
      iframe.src = frameUrl.href; panel.prepend(iframe);
    }
    if (!ready || pendingSaveRequest) {
      clearTimeout(loadTimeout);
      loadTimeout = setTimeout(() => { if (!ready || pendingSaveRequest) showLoadError("菜单连接超时，请重新打开。"); }, 15_000);
    }
    layout(true);
    if (ready) {
      if (!pendingSaveRequest) { loading.hidden = true; iframe.style.visibility = "visible"; iframe.inert = false; }
      showView(); iframe.focus();
    }
  }
  function close(focus = false) {
    generation++; clearTimeout(loadTimeout); opening = false; opened = false; panel.inert = true; bar.hidden = false; revealPanel(false);
    toggle.setAttribute("aria-expanded", "false"); send({ type: "FLOAT_VISIBILITY", visible: false }); layout(true);
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => { if (!opened) panel.hidden = true; }, matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 210);
    if (info && !info.enabled) { forced = false; host.dataset.hidden = "true"; if (focus) previousFocus?.focus({ preventScroll: true }); }
    else if (focus) toggle.focus({ preventScroll: true });
  }
  function showQuickFeedback(message: string, failed = false) {
    clearTimeout(feedbackTimer); feedback.textContent = message; feedback.dataset.error = String(failed); feedback.hidden = false;
    feedbackTimer = setTimeout(() => { feedback.hidden = true; }, failed ? 6_000 : 3_000);
  }
  quickSave.addEventListener("click", () => {
    pendingSaveRequest ||= crypto.randomUUID();
    saveHeight ??= SAVE_PANEL_INITIAL_HEIGHT;
    void open(view).catch(() => showQuickFeedback("连接暂时中断，请重新打开 Aarre。", true));
  });
  toggle.addEventListener("click", () => { if (opened || opening) close(true); else void open(view).catch(() => showQuickFeedback("连接暂时中断，请重新打开 Aarre。", true)); });
  let drag: { id: number; x: number; width: number } | null = null;
  resize.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || saveHeight !== null) return; event.preventDefault();
    drag = { id: event.pointerId, x: event.clientX, width: floatingRects(position, viewport()).menu.width }; resize.setPointerCapture(event.pointerId);
    host.dataset.resizing = "true";
  });
  resize.addEventListener("pointermove", (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    position = { width: floatingWidth(drag.width + drag.x - event.clientX) }; layout();
  });
  const endResize = () => { if (!drag) return; drag = null; host.dataset.resizing = "false"; persist(); };
  resize.addEventListener("pointerup", endResize); resize.addEventListener("pointercancel", endResize); resize.addEventListener("lostpointercapture", endResize);
  resize.addEventListener("keydown", (event) => {
    if (saveHeight !== null) return;
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return; event.preventDefault();
    position = { width: event.key === "Home" ? 320 : event.key === "End" ? 640 : floatingWidth(position.width + (event.key === "ArrowLeft" ? 1 : -1) * (event.shiftKey ? 40 : 10)) }; layout(); persist();
  });
  const outside = (event: PointerEvent) => { if (opened && !event.composedPath().includes(host)) close(); };
  const escape = (event: KeyboardEvent) => { if ((opened || opening) && event.key === "Escape" && !event.isComposing && !event.defaultPrevented) { close(true); event.preventDefault(); } };
  const receive = (event: MessageEvent) => {
    if (!iframe || !info || event.source !== iframe.contentWindow || event.origin !== chrome.runtime.getURL("").replace(/\/$/, "") || event.data?.session !== info.nonce) return;
    if (event.data.type === "FLOAT_READY") {
      ready = true; needsRetry = false; if (!pendingSaveRequest) clearTimeout(loadTimeout);
      loading.hidden = !pendingSaveRequest; iframe.inert = Boolean(pendingSaveRequest);
      iframe.style.visibility = "visible";
      showView(); if (opened) iframe.focus();
    }
    if (event.data.type === "FLOAT_SAVE_ACCEPTED" && event.data.requestId === pendingSaveRequest) {
      pendingSaveRequest = null; clearTimeout(loadTimeout);
      if (ready) { loading.hidden = true; iframe.inert = false; iframe.style.visibility = "visible"; }
    }
    if (event.data.type === "FLOAT_SAVE_DEFERRED" && event.data.requestId === pendingSaveRequest) {
      pendingSaveRequest = null; saveHeight = null; clearTimeout(loadTimeout);
      loading.hidden = true; iframe.inert = false; layout();
    }
    if (event.data.type === "FLOAT_SAVE_LAYOUT" && typeof event.data.height === "number" && Number.isFinite(event.data.height) && event.data.height > 0) {
      if (saveHeight !== event.data.height) { saveHeight = event.data.height; layout(); }
    }
    if (event.data.type === "FLOAT_WORKSPACE_LAYOUT" && !pendingSaveRequest && saveHeight !== null) {
      saveHeight = null; layout(opened);
    }
    if (event.data.type === "FLOAT_LOAD_ERROR") showLoadError(typeof event.data.message === "string" ? event.data.message : "请重新打开菜单。");
    if (event.data.type === "FLOAT_CURRENT_VIEW" && ["library", "chat", "settings", "history"].includes(event.data.view)) view = event.data.view;
    if (event.data.type === "FLOAT_CLOSE") {
      if (event.data.resetSave) { pendingSaveRequest = null; saveHeight = null; loading.replaceChildren(); loading.hidden = false; }
      close(true);
    }
    if (event.data.type === "FLOAT_HIDE") { close(); forced = false; host.dataset.hidden = "true"; previousFocus?.focus({ preventScroll: true }); }
    if (event.data.type === "FLOAT_THEME" && ["light", "dark"].includes(event.data.theme)) host.dataset.theme = event.data.theme;
  };
  const refresh = async () => { await init(); if (opened && !iframe) await open(view); };
  const runtimeListener = (message: Record<string, any>, sender: chrome.runtime.MessageSender, respond: (response: unknown) => void) => {
    if (message.type === "FLOAT_PING") { void refresh().then(() => respond({ ok: !disposed, version }), () => respond({ ok: false, version })); return true; }
    if (message.type === "FLOAT_VERIFY_FRAME") {
      if (sender.id !== chrome.runtime.id || !iframe || !info || message.session !== info.nonce || typeof message.challenge !== "string") { respond({ ok: false }); return false; }
      send({ type: "FLOAT_IDENTITY_CHALLENGE", challenge: message.challenge }); respond({ ok: true }); return false;
    }
    if (message.type === "FLOAT_OPEN") { void open(message.view).then(() => respond({ ok: true }), () => respond({ ok: false })); return true; }
    if (message.type === "FLOAT_REFRESH") { void refresh().then(() => respond({ ok: true }), () => respond({ ok: false })); return true; }
    if (message.type === "FLOAT_CAPTURE") {
      if (typeof message.lease !== "string") { respond({ ok: false }); return false; }
      clearTimeout(watchdog); if (message.hidden) captureLeases.add(message.lease); else captureLeases.delete(message.lease);
      host.dataset.capturing = String(captureLeases.size > 0);
      if (captureLeases.size) watchdog = setTimeout(() => { captureLeases.clear(); host.dataset.capturing = "false"; }, 60_000);
      requestAnimationFrame(() => requestAnimationFrame(() => respond({ ok: true, lease: message.lease }))); return true;
    }
    return false;
  };
  const observer = new MutationObserver(() => { if (!disposed && !host.isConnected && document.documentElement) { iframe?.remove(); iframe = null; info = null; ready = false; attach(); if (opened) void open(view).catch(() => { host.dataset.hidden = "true"; }); } });
  observer.observe(document, { childList: true, subtree: true });
  document.addEventListener("pointerdown", outside, true); document.addEventListener("keydown", escape); document.addEventListener("fullscreenchange", attach);
  window.addEventListener("message", receive); window.addEventListener("resize", attach);
  window.visualViewport?.addEventListener("resize", attach); window.visualViewport?.addEventListener("scroll", attach);
  const pageshow = () => { void refresh().catch(() => undefined); }; window.addEventListener("pageshow", pageshow);
  chrome.runtime.onMessage.addListener(runtimeListener);
  window.__aarreFloatingHost = { version, destroy() {
    disposed = true; generation++; observer.disconnect(); surfaceAnimation?.cancel(); panelAnimation?.cancel(); clearTimeout(watchdog); clearTimeout(loadTimeout); clearTimeout(closeTimer); clearTimeout(feedbackTimer); host.remove();
    try { chrome.runtime.onMessage.removeListener(runtimeListener); } catch { /* Extension reload invalidates old listeners. */ }
    document.removeEventListener("pointerdown", outside, true); document.removeEventListener("keydown", escape); document.removeEventListener("fullscreenchange", attach);
    window.removeEventListener("message", receive); window.removeEventListener("resize", attach); window.removeEventListener("pageshow", pageshow);
    window.visualViewport?.removeEventListener("resize", attach); window.visualViewport?.removeEventListener("scroll", attach);
  } };
  host.addEventListener("aarre-floating-retire", window.__aarreFloatingHost.destroy, { once: true });
  void init().catch(() => { host.dataset.hidden = "true"; });
}

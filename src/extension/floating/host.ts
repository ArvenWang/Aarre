import { defaultFloatingPosition, floatingPositionAt, floatingRects, type FloatingPosition, type Viewport } from "../../lib/floating-geometry";
import { hostStyles } from "./host-styles";

interface HostInfo { tabId: number; documentId: string; nonce: string; enabled: boolean; position: FloatingPosition; theme?: string }
declare global { interface Window { __aarreFloatingHost?: { version: string; destroy(): void } } }
const version = chrome.runtime.getManifest().version;
if (window.top === window && window.__aarreFloatingHost?.version !== version) {
  window.__aarreFloatingHost?.destroy();
  startHost();
}
function startHost() {
  const host = document.createElement("aarre-floating-host");
  host.dataset.aarreUi = "floating-host";
  host.dataset.hidden = "true";
  host.setAttribute("popover", "manual");
  const shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style"); style.textContent = hostStyles;
  const ball = document.createElement("button");
  ball.type = "button"; ball.className = "ball"; ball.setAttribute("aria-label", "打开 Aarre 菜单"); ball.setAttribute("aria-expanded", "false");
  ball.setAttribute("aria-haspopup", "dialog"); ball.title = "Aarre · 点击打开，拖动调整位置";
  ball.innerHTML = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 3.5h10a1 1 0 0 1 1 1v16l-6-4-6 4v-16a1 1 0 0 1 1-1Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M10 8h4m-4 3h4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
  const panel = document.createElement("div"); panel.className = "panel"; panel.hidden = true;
  const loading = document.createElement("div"); loading.className = "loading"; loading.setAttribute("role", "status");
  loading.innerHTML = "<strong>Aarre</strong><span>正在打开收藏…</span>";
  const resize = document.createElement("button"); resize.type = "button"; resize.className = "resize";
  resize.setAttribute("aria-label", "调整菜单大小，使用方向键"); resize.title = "拖动调整菜单大小";
  resize.innerHTML = '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m5 12 7-7m-3 7 3-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
  panel.append(loading, resize); shadow.append(style, ball, panel);
  let info: HostInfo | null = null, iframe: HTMLIFrameElement | null = null;
  let position = { ...defaultFloatingPosition }, opened = false, forced = false, disposed = false, ready = false;
  let needsRetry = false;
  let view = "library", watchdog: ReturnType<typeof setTimeout> | undefined, loadTimeout: ReturnType<typeof setTimeout> | undefined;
  const captureLeases = new Set<string>();
  let previousFocus: HTMLElement | null = null;
  let initPromise: Promise<void> | null = null;
  const viewport = (): Viewport => ({ width: window.visualViewport?.width || innerWidth, height: window.visualViewport?.height || innerHeight, left: window.visualViewport?.offsetLeft || 0, top: window.visualViewport?.offsetTop || 0 });
  const rectStyle = (element: HTMLElement, rect: { x: number; y: number; width: number; height: number }) => {
    Object.assign(element.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px` });
  };
  const layout = () => { const rects = floatingRects(position, viewport(), opened); rectStyle(ball, rects.ball); rectStyle(panel, rects.menu); host.dataset.edge = position.edge; };
  const attach = () => {
    const parent = document.fullscreenElement || document.documentElement;
    if (host.parentElement !== parent) parent.append(host);
    try { if (!host.matches(":popover-open")) host.showPopover(); } catch { /* Older/fullscreen host still uses fixed positioning. */ }
    layout();
  };
  const send = (message: Record<string, unknown>) => { if (iframe && info) iframe.contentWindow?.postMessage({ ...message, session: info.nonce }, chrome.runtime.getURL("").replace(/\/$/, "")); };
  const persist = () => { void chrome.runtime.sendMessage({ type: "FLOAT_POSITION", position }).catch(() => undefined); };
  async function initialize() {
    const response = await chrome.runtime.sendMessage({ type: "FLOAT_HOST_INIT", freshHost: !info });
    if (!response?.ok) throw new Error(response?.error || "菜单连接失败");
    const next = response.data as HostInfo;
    if (disposed) return;
    if (info && info.nonce !== next.nonce) { iframe?.remove(); iframe = null; ready = false; }
    info = next; position = next.position;
    host.dataset.theme = next.theme === "dark" || (!next.theme && matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light";
    host.dataset.hidden = String(!next.enabled && !forced);
    attach();
  }
  const init = () => initPromise ||= initialize().finally(() => { initPromise = null; });
  async function open(nextView = "library") {
    forced = true; view = nextView;
    if (needsRetry) { iframe?.remove(); iframe = null; info = null; ready = false; needsRetry = false; }
    await init();
    if (!info || disposed) return;
    if (!opened) previousFocus = document.activeElement instanceof HTMLElement && document.activeElement !== host ? document.activeElement : null;
    opened = true; panel.hidden = false; ball.setAttribute("aria-expanded", "true"); ball.setAttribute("aria-label", "收起 Aarre 菜单");
    if (!iframe) {
      ready = false; loading.hidden = false; loading.innerHTML = "<strong>Aarre</strong><span>正在打开收藏…</span>";
      iframe = document.createElement("iframe"); iframe.title = "Aarre 收藏菜单";
      const frameUrl = new URL(chrome.runtime.getURL("floating.html"));
      frameUrl.searchParams.set("tab", String(info.tabId)); frameUrl.searchParams.set("session", info.nonce);
      iframe.src = frameUrl.href;
      panel.prepend(iframe);
      loadTimeout = setTimeout(() => { if (!ready) { needsRetry = true; loading.innerHTML = "<strong>菜单未能打开</strong><span>请检查扩展是否已更新</span>"; const retry = document.createElement("button"); retry.type = "button"; retry.textContent = "重新打开"; retry.addEventListener("click", () => { void open(view).catch(() => { loading.textContent = "连接已失效，请刷新此网页后重试。"; }); }); loading.append(retry); } }, 15_000);
    }
    layout();
    if (ready) { send({ type: "FLOAT_VIEW", view, focus: true }); iframe.focus(); }
  }
  function close(focus = false) {
    opened = false; panel.hidden = true; ball.setAttribute("aria-expanded", "false"); ball.setAttribute("aria-label", "打开 Aarre 菜单");
    send({ type: "FLOAT_VISIBILITY", visible: false });
    if (info && !info.enabled) { forced = false; host.dataset.hidden = "true"; if (focus) previousFocus?.focus({ preventScroll: true }); }
    else if (focus) ball.focus({ preventScroll: true });
  }
  let drag: { id: number; x: number; y: number; bx: number; by: number; moved: boolean; mode: "ball" | "resize"; width: number; height: number } | null = null;
  let suppressClick = false;
  function pointerDown(event: PointerEvent, mode: "ball" | "resize") {
    if (event.button !== 0) return;
    const rect = ball.getBoundingClientRect();
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, bx: rect.x, by: rect.y, moved: false, mode, width: position.width, height: position.height };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }
  const pointerMove = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.id) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 6) return;
    drag.moved = true;
    if (drag.mode === "ball") {
      const vp = viewport();
      const x = Math.max(vp.left || 0, Math.min(drag.bx + dx, (vp.left || 0) + vp.width - 52));
      const y = Math.max(vp.top || 0, Math.min(drag.by + dy, (vp.top || 0) + vp.height - 52));
      position = floatingPositionAt(x, y, vp, position);
      layout(); rectStyle(ball, { x, y, width: 52, height: 52 });
    } else {
      position = { ...position, width: Math.max(320, Math.min(560, drag.width + (position.edge === "right" ? -dx : dx))), height: Math.max(360, Math.min(800, drag.height - dy)) }; layout();
    }
  };
  const pointerEnd = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.id) return;
    suppressClick = drag.moved;
    if (drag.moved) persist(); drag = null; layout();
  };
  for (const [element, mode] of [[ball, "ball"], [resize, "resize"]] as const) {
    element.addEventListener("pointerdown", (event) => pointerDown(event, mode));
    element.addEventListener("pointermove", pointerMove);
    element.addEventListener("pointerup", pointerEnd);
    element.addEventListener("pointercancel", pointerEnd);
  }
  ball.addEventListener("click", () => { if (suppressClick) { suppressClick = false; return; } if (opened) close(true); else void open(view).catch(() => { host.dataset.hidden = "true"; }); });
  ball.addEventListener("keydown", (event) => {
    if (!event.key.startsWith("Arrow")) return;
    event.preventDefault();
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") position.edge = event.key === "ArrowLeft" ? "left" : "right";
    else position.ratio = Math.max(0, Math.min(1, position.ratio + (event.key === "ArrowUp" ? -0.05 : 0.05)));
    layout(); persist();
  });
  resize.addEventListener("keydown", (event) => {
    if (!event.key.startsWith("Arrow")) return; event.preventDefault();
    const amount = event.shiftKey ? 40 : 10;
    position.width = Math.max(320, Math.min(560, position.width + (event.key === "ArrowRight" ? amount : event.key === "ArrowLeft" ? -amount : 0)));
    position.height = Math.max(360, Math.min(800, position.height + (event.key === "ArrowDown" ? amount : event.key === "ArrowUp" ? -amount : 0)));
    layout(); persist();
  });
  const outside = (event: PointerEvent) => { if (opened && !event.composedPath().includes(host)) close(); };
  const escape = (event: KeyboardEvent) => { if (opened && event.key === "Escape" && !event.isComposing && !event.defaultPrevented) { close(true); event.preventDefault(); } };
  const receive = (event: MessageEvent) => {
    if (!iframe || !info || event.source !== iframe.contentWindow || event.origin !== chrome.runtime.getURL("").replace(/\/$/, "") || event.data?.session !== info.nonce) return;
    if (event.data.type === "FLOAT_READY") { ready = true; clearTimeout(loadTimeout); loading.hidden = true; send({ type: "FLOAT_VIEW", view, focus: opened }); if (opened) iframe.focus(); }
    if (event.data.type === "FLOAT_CURRENT_VIEW" && ["library", "chat", "settings", "history"].includes(event.data.view)) view = event.data.view;
    if (event.data.type === "FLOAT_CLOSE") close(true);
    if (event.data.type === "FLOAT_HIDE") { close(); forced = false; host.dataset.hidden = "true"; previousFocus?.focus({ preventScroll: true }); }
    if (event.data.type === "FLOAT_THEME" && ["light", "dark"].includes(event.data.theme)) host.dataset.theme = event.data.theme;
  };
  const runtimeListener = (message: Record<string, any>, _sender: chrome.runtime.MessageSender, respond: (response: unknown) => void) => {
    if (message.type === "FLOAT_OPEN") { void open(message.view).then(() => respond({ ok: true }), () => respond({ ok: false })); return true; }
    if (message.type === "FLOAT_REFRESH") { void init().then(() => respond({ ok: true }), () => respond({ ok: false })); return true; }
    if (message.type === "FLOAT_CAPTURE") {
      if (typeof message.lease !== "string") { respond({ ok: false }); return false; }
      clearTimeout(watchdog);
      if (message.hidden) captureLeases.add(message.lease); else captureLeases.delete(message.lease);
      host.dataset.capturing = String(captureLeases.size > 0);
      if (captureLeases.size) watchdog = setTimeout(() => { captureLeases.clear(); host.dataset.capturing = "false"; }, 60_000);
      requestAnimationFrame(() => requestAnimationFrame(() => respond({ ok: true, lease: message.lease }))); return true;
    }
    return false;
  };
  const observer = new MutationObserver(() => { if (!disposed && !host.isConnected && document.documentElement) { iframe?.remove(); iframe = null; info = null; ready = false; attach(); if (opened) void open(view).catch(() => { host.dataset.hidden = "true"; }); } });
  observer.observe(document, { childList: true, subtree: true });
  document.addEventListener("pointerdown", outside, true);
  document.addEventListener("keydown", escape);
  document.addEventListener("fullscreenchange", attach);
  window.addEventListener("message", receive);
  window.addEventListener("resize", layout);
  window.visualViewport?.addEventListener("resize", layout);
  window.visualViewport?.addEventListener("scroll", layout);
  const pageshow = () => { void init().catch(() => undefined); };
  window.addEventListener("pageshow", pageshow);
  chrome.runtime.onMessage.addListener(runtimeListener);
  window.__aarreFloatingHost = { version, destroy() {
    disposed = true; observer.disconnect(); clearTimeout(watchdog); clearTimeout(loadTimeout); host.remove();
    chrome.runtime.onMessage.removeListener(runtimeListener);
    document.removeEventListener("pointerdown", outside, true); document.removeEventListener("keydown", escape); document.removeEventListener("fullscreenchange", attach);
    window.removeEventListener("message", receive); window.removeEventListener("resize", layout); window.removeEventListener("pageshow", pageshow);
    window.visualViewport?.removeEventListener("resize", layout); window.visualViewport?.removeEventListener("scroll", layout);
  } };
  void init().catch(() => { host.dataset.hidden = "true"; });
}

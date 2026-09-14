import { defaultFloatingPosition, floatingRects, floatingSaveRect, floatingWidth, SAVE_PANEL_INITIAL_HEIGHT, type FloatingPosition, type Viewport } from "../../lib/floating-geometry";
import { createSuiteClient } from "../../shared/suite-dock/client";
import { suiteIcons, suiteStyles, SUITE_BAR_HEIGHT } from "../../shared/suite-dock/ui";
import { createFrameParking } from "../../shared/suite-dock/parking";
import { hostStyles } from "./host-styles";
import { dockViewport } from "../../shared/suite-dock/geometry";
import { createDockMorph, dockDuration } from "../../shared/suite-dock/morph";
import { installDockDrag } from "../../shared/suite-dock/drag";

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
  const style = document.createElement("style"); style.textContent = hostStyles + suiteStyles;
  const surface = document.createElement("div"); surface.className = "dock-surface"; surface.setAttribute("aria-hidden", "true");
  const bar = document.createElement("div"); bar.className = "bar"; bar.setAttribute("role", "group"); bar.setAttribute("aria-label", "Aarre 快捷栏");
  const toggle = document.createElement("button"); toggle.type = "button"; toggle.className = "bar-toggle";
  toggle.setAttribute("aria-label", "展开 Aarre 菜单"); toggle.setAttribute("aria-expanded", "false"); toggle.setAttribute("aria-haspopup", "dialog"); toggle.title = "展开 Aarre；上下拖动或使用方向键调整位置";
  toggle.innerHTML = suiteIcons.aarre;
  const quickSave = document.createElement("button"); quickSave.type = "button"; quickSave.className = "bar-save";
  quickSave.setAttribute("aria-label", "添加当前网页到收藏"); quickSave.setAttribute("aria-haspopup", "dialog"); quickSave.title = "添加到收藏";
  quickSave.innerHTML = suiteIcons.save;
  const product = document.createElement("div"); product.className = "bar-product";
  const quickActions = document.createElement("div"); quickActions.className = "quick-actions";
  quickActions.setAttribute("role", "group"); quickActions.setAttribute("aria-label", "Aarre 快捷操作"); quickActions.inert = true;
  quickActions.append(quickSave); product.append(toggle, quickActions);
  const nexToggle = document.createElement("button"); nexToggle.type = "button"; nexToggle.className = "bar-nexalign"; nexToggle.hidden = true;
  nexToggle.setAttribute("aria-label", "展开 NexAlign 菜单"); nexToggle.setAttribute("aria-haspopup", "dialog"); nexToggle.title = "展开 NexAlign；上下拖动或使用方向键调整位置";
  nexToggle.innerHTML = suiteIcons.nexalign;
  bar.append(product, nexToggle);
  const feedback = document.createElement("div"); feedback.className = "quick-feedback"; feedback.setAttribute("role", "status"); feedback.hidden = true;
  const panel = document.createElement("div"); panel.className = "panel"; panel.hidden = true; panel.inert = true;
  const loading = document.createElement("div"); loading.className = "loading"; loading.setAttribute("role", "status");
  const resize = document.createElement("div"); resize.className = "resize"; resize.tabIndex = 0;
  resize.setAttribute("role", "separator"); resize.setAttribute("aria-orientation", "vertical"); resize.setAttribute("aria-label", "调整菜单宽度");
  resize.setAttribute("aria-valuemin", "320"); resize.setAttribute("aria-valuemax", "640"); resize.title = "拖动左边调整宽度，或使用左右方向键";
  panel.append(loading, resize); shadow.append(style, surface, bar, panel, feedback);
  let suite: ReturnType<typeof createSuiteClient> | undefined;
  let suiteTheme: "light" | "dark" | undefined;
  const dockMorph = createDockMorph(surface, panel, [bar]);
  let info: HostInfo | null = null, iframe: HTMLIFrameElement | null = null;
  let position = { ...defaultFloatingPosition }, opened = false, opening = false, forced = false, disposed = false, ready = false, needsRetry = false;
  let positionRevision = 0, positionWrites = Promise.resolve();
  let view = "library", generation = 0, parkedView = false;
  let pendingSaveRequest: string | null = null;
  let saveHeight: number | null = null;
  let preparingSave = false, saveAccepted = false, saveLayoutReady = false, closingSave = false;
  let saveRevealFrame: number | undefined;
  let watchdog: ReturnType<typeof setTimeout> | undefined, loadTimeout: ReturnType<typeof setTimeout> | undefined, closeTimer: ReturnType<typeof setTimeout> | undefined, feedbackTimer: ReturnType<typeof setTimeout> | undefined;
  const captureLeases = new Set<string>();
  let previousFocus: HTMLElement | null = null, initPromise: Promise<void> | null = null;
  let resetFrameSession = false;
  let discardSaveDraft = false;
  let openingShell = false, cancelledShell = false;
  let quickActionsTimer: ReturnType<typeof setTimeout> | undefined;
  const quickActionsFocused = () => product.contains(shadow.activeElement) && shadow.activeElement?.matches(":focus-visible");
  function setQuickActions(open: boolean) {
    clearTimeout(quickActionsTimer);
    product.dataset.actionsOpen = String(open && !opened && !openingShell && host.dataset.dragging !== "true" && host.dataset.suiteAway !== "true");
    quickActions.inert = product.dataset.actionsOpen !== "true";
  }
  product.addEventListener("pointerenter", event => { if (event.pointerType !== "touch") setQuickActions(true); });
  product.addEventListener("pointerleave", () => {
    quickActionsTimer = setTimeout(() => { if (!quickActionsFocused()) setQuickActions(false); }, 120);
  });
  product.addEventListener("focusin", () => { if (quickActionsFocused()) setQuickActions(true); });
  product.addEventListener("focusout", event => {
    if (!product.contains(event.relatedTarget as Node | null) && !product.matches(":hover")) setQuickActions(false);
  });
  product.addEventListener("keydown", event => {
    if (event.key === "ArrowLeft") { event.preventDefault(); setQuickActions(true); quickSave.focus(); }
    if (event.key === "ArrowRight" && shadow.activeElement === quickSave) { event.preventDefault(); toggle.focus(); }
  });
  const viewport = (): Viewport => dockViewport();
  type Rect = { x: number; y: number; width: number; height: number };
  const rectStyle = (element: HTMLElement, rect: Rect) => Object.assign(element.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px` });
  function layout(animate = false) {
    const vp = viewport();
    const rects = floatingRects(position, vp, suite?.paired ? SUITE_BAR_HEIGHT : undefined);
    const menu = saveHeight === null ? rects.menu : floatingSaveRect(vp, saveHeight, position, suite?.paired ? SUITE_BAR_HEIGHT : undefined);
    const presented = opened || openingShell;
    if (presented || host.dataset.suiteAway === "true") setQuickActions(false);
    const target = presented ? menu : rects.bar;
    host.dataset.open = String(presented);
    host.dataset.savePreparing = String(preparingSave);
    bar.hidden = presented;
    panel.inert = !presented;
    quickSave.setAttribute("aria-busy", String(preparingSave));
    toggle.setAttribute("aria-expanded", String(presented));
    rectStyle(bar, rects.bar);
    // Keep the outgoing compact form at its current size during collapse.
    if (opened || openingShell || panel.hidden) rectStyle(panel, menu);
    else panel.style.left = `${target.x + target.width - panel.offsetWidth}px`;
    resize.hidden = saveHeight !== null;
    feedback.style.left = `${Math.max(vp.left || 0, rects.bar.x - 272)}px`; feedback.style.top = `${rects.bar.y}px`;
    resize.setAttribute("aria-valuenow", String(Math.round(rects.menu.width)));
    resize.setAttribute("aria-valuemin", String(Math.min(320, viewport().width)));
    resize.setAttribute("aria-valuemax", String(Math.min(640, viewport().width)));
    dockMorph.layout(target, presented, animate);
  }
  const mountHost = () => {
    const parent = document.fullscreenElement || document.documentElement;
    if (host.parentElement !== parent) parent.append(host);
    try { if (!host.matches(":popover-open")) host.showPopover(); } catch { /* Fixed positioning also works without the top layer. */ }
  };
  const attach = () => { mountHost(); layout(); };
  const send = (message: Record<string, unknown>) => { if (iframe && info && (ready || message.type === "FLOAT_IDENTITY_CHALLENGE")) iframe.contentWindow?.postMessage({ ...message, session: info.nonce }, chrome.runtime.getURL("").replace(/\/$/, "")); };
  const frameParking = createFrameParking(send);
  const persist = () => {
    positionRevision++;
    const saved = { ...position };
    positionWrites = positionWrites.catch(() => undefined)
      .then(() => chrome.runtime.sendMessage({ type: "FLOAT_POSITION", position: saved })).then(() => undefined, () => undefined);
  };
  const dockDrag = installDockDrag(bar, {
    allowed: event => !opened && !openingShell && host.dataset.suiteAway !== "true" && !event.composedPath().includes(quickActions),
    ratio: () => position.handleRatio ?? .5,
    bounds: () => { const vp = viewport(), height = suite?.paired ? SUITE_BAR_HEIGHT : undefined;
      return { min: floatingRects({ ...position, handleRatio: 0 }, vp, height).bar.y, max: floatingRects({ ...position, handleRatio: 1 }, vp, height).bar.y }; },
    change: ratio => { position.handleRatio = ratio; layout(); },
    commit: () => { persist(); suite?.position(position.handleRatio ?? .5); },
    dragging: active => { host.dataset.dragging = String(active); if (active) setQuickActions(false); },
  });
  async function initialize() {
    const revision = positionRevision;
    await positionWrites;
    const freshHost = !info || resetFrameSession;
    resetFrameSession = false;
    const response = await chrome.runtime.sendMessage({ type: "FLOAT_HOST_INIT", freshHost });
    if (!response?.ok) throw new Error(response?.error || "菜单连接失败");
    if (disposed) return;
    const next = response.data as HostInfo;
    if (info && info.nonce !== next.nonce) { iframe?.remove(); iframe = null; ready = false; }
    info = next; if (!dockDrag.active && revision === positionRevision) position = next.position;
    if (typeof next.saved === "boolean") {
      quickSave.dataset.saved = String(next.saved);
      quickSave.title = next.saved ? "管理此收藏" : "添加到收藏";
      quickSave.setAttribute("aria-label", next.saved ? "管理当前网页收藏" : "添加当前网页到收藏");
    }
    host.dataset.theme = suiteTheme ?? (next.theme === "dark" || (!next.theme && matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light");
    suite?.enabled(next.enabled || forced);
    host.dataset.hidden = String(!next.enabled && !forced); mountHost();
    layout();
  }
  const init = () => initPromise ||= initialize().finally(() => { initPromise = null; });
  function showLoading(save: boolean) {
    loading.hidden = false;
    loading.classList.toggle("save-loading", save);
    loading.innerHTML = save
      ? '<div class="loading-heading"><strong>添加到收藏</strong><button class="loading-close" type="button" aria-label="关闭收藏面板">×</button></div><div class="loading-content"><span role="status">正在准备当前网页的收藏信息…</span><div class="loading-skeleton" aria-hidden="true"><i></i><i></i><i></i><i></i></div></div><div class="loading-actions"><button type="button" class="loading-cancel">取消</button></div>'
      : '<strong>Aarre</strong><span>正在打开收藏…</span><button class="loading-close" type="button" aria-label="关闭菜单">关闭</button>';
    loading.querySelectorAll(".loading-close,.loading-cancel").forEach(button => button.addEventListener("click", () => close(true, save)));
  }
  function showLoadError(message: string) {
    clearTimeout(loadTimeout); needsRetry = true; ready = false; loading.hidden = false;
    preparingSave = false; loading.classList.remove("save-loading");
    if (iframe) { iframe.inert = true; iframe.style.visibility = "visible"; }
    const title = document.createElement("strong"); title.textContent = "菜单未能打开";
    const detail = document.createElement("span"); detail.textContent = message;
    const retry = document.createElement("button"); retry.type = "button"; retry.textContent = "重新打开";
    retry.addEventListener("click", () => { void open(view).catch(() => showLoadError("连接暂时中断，请重新打开 Aarre。")); });
    const dismiss = document.createElement("button"); dismiss.type = "button"; dismiss.textContent = "关闭";
    dismiss.addEventListener("click", () => close(true, saveHeight !== null));
    loading.replaceChildren(title, detail, retry, dismiss); layout();
  }
  const showView = () => send({ type: "FLOAT_VIEW", view, focus: opened, ...(pendingSaveRequest ? { saveRequestId: pendingSaveRequest } : {}) });
  function revealSave() {
    if (!opened || !preparingSave || !ready || !saveAccepted || !saveLayoutReady || saveRevealFrame !== undefined) return;
    // Readiness only replaces the loading content; the host is already open.
    saveRevealFrame = requestAnimationFrame(() => {
      saveRevealFrame = undefined;
      if (!opened || !preparingSave || !ready || !saveAccepted || !saveLayoutReady) return;
      pendingSaveRequest = null; preparingSave = false; clearTimeout(loadTimeout);
      loading.hidden = true; if (iframe) { iframe.inert = false; iframe.style.visibility = "visible"; }
      layout(); showView(); iframe?.focus();
    });
  }
  async function open(nextView = "library", coordinated = false) {
    if (!coordinated) cancelledShell = false;
    view = nextView; forced = true; suite?.enabled(true);
    // Both launcher actions present the host on this click. Frame connection
    // and activation still follow suite ownership, without blocking motion.
    if (!coordinated && !opened && host.dataset.suiteAway !== "true") {
      if (!openingShell) previousFocus = document.activeElement instanceof HTMLElement && document.activeElement !== host ? document.activeElement : null;
      openingShell = true;
      clearTimeout(closeTimer);
      feedback.hidden = true; host.dataset.hidden = "false";
      if (pendingSaveRequest) {
        preparingSave = true;
        if (!(closeTimer && closingSave && ready)) showLoading(true);
      } else if (!ready || needsRetry) showLoading(false);
      if (iframe) iframe.inert = true;
      panel.hidden = false; mountHost(); layout(true);
    }
    if (!coordinated && !opened && suite?.activate("aarre")) return;
    const current = ++generation; opening = true; forced = true; view = nextView;
    const resumingSave = Boolean(closeTimer && closingSave && ready);
    clearTimeout(closeTimer); closeTimer = undefined; feedback.hidden = true;
    if (needsRetry) { iframe?.remove(); iframe = null; info = null; ready = false; needsRetry = false; }
    if (!opened && !openingShell) previousFocus = document.activeElement instanceof HTMLElement && document.activeElement !== host ? document.activeElement : null;
    // Opening takes precedence over passive launchers from other extensions.
    // Only reorder our own top-layer surface; never touch their DOM.
    try { if (host.matches(":popover-open")) host.hidePopover(); host.showPopover(); } catch { /* Fixed-position fallback. */ }
    // Keep rendering active beneath the opaque loading surface.
    if (pendingSaveRequest) {
      preparingSave = true;
      // Keep the outgoing form visible if this reverses an in-flight close.
      if (!resumingSave) showLoading(true);
      if (iframe) { iframe.inert = true; iframe.style.visibility = "visible"; }
    }
    opened = true; openingShell = false; suite?.changed(true); panel.hidden = false;
    if (!ready && !pendingSaveRequest) showLoading(false);
    // Begin the shared motion before any background/page reads. Even a cold
    // worker or slow capture leaves a visible, immediately dismissible panel.
    layout(true);
    try {
      await init();
      // Cancelling a loading frame can outlive an earlier initialization.
      // Claim a new frame session before mounting, even if that old reply won.
      if (resetFrameSession && current === generation && !disposed) await init();
    }
    catch (error) { if (disposed || current !== generation) return; throw error; }
    finally { if (current === generation) opening = false; }
    if (!info || disposed || current !== generation) return;
    if (!iframe) {
      ready = false; showLoading(Boolean(pendingSaveRequest));
      iframe = document.createElement("iframe"); iframe.title = "Aarre 收藏菜单"; iframe.inert = true;
      const frameUrl = new URL(chrome.runtime.getURL("floating.html")); frameUrl.searchParams.set("tab", String(info.tabId)); frameUrl.searchParams.set("session", info.nonce);
      if (pendingSaveRequest) frameUrl.searchParams.set("save", pendingSaveRequest);
      if (discardSaveDraft) frameUrl.searchParams.set("discardSave", "1");
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
      showView(); if (!preparingSave) iframe.focus();
    }
  }
  function close(focus = false, resetSave = false, requestId?: string) {
    if (openingShell) cancelledShell = true;
    openingShell = false;
    const discardLoadingFrame = preparingSave;
    closingSave = saveHeight !== null && !preparingSave;
    if (saveRevealFrame !== undefined) cancelAnimationFrame(saveRevealFrame);
    saveRevealFrame = undefined; preparingSave = false; saveAccepted = false; saveLayoutReady = false; pendingSaveRequest = null;
    generation++; clearTimeout(loadTimeout); opening = false; opened = false; suite?.changed(false); panel.inert = true; bar.hidden = false; panel.hidden = false; host.dataset.open = "false";
    toggle.setAttribute("aria-expanded", "false"); send({ type: "FLOAT_VISIBILITY", visible: false }); layout(true);
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => {
      closeTimer = undefined;
      if (opened) return;
      panel.hidden = true;
      if (discardLoadingFrame) { iframe?.remove(); iframe = null; ready = false; info = null; resetFrameSession = true; discardSaveDraft = true; }
      if (resetSave) {
        saveHeight = null; loading.replaceChildren(); loading.hidden = false;
        send({ type: "FLOAT_CLOSED", requestId });
      }
    }, dockDuration(false));
    if (info && !info.enabled) { forced = false; suite?.enabled(false); host.dataset.hidden = "true"; if (focus) previousFocus?.focus({ preventScroll: true }); }
    else if (focus) toggle.focus({ preventScroll: true });
  }
  function showQuickFeedback(message: string, failed = false) {
    clearTimeout(feedbackTimer); feedback.textContent = message; feedback.dataset.error = String(failed); feedback.hidden = false;
    feedbackTimer = setTimeout(() => { feedback.hidden = true; }, failed ? 6_000 : 3_000);
  }
  quickSave.addEventListener("click", () => {
    if (preparingSave) return;
    pendingSaveRequest ||= crypto.randomUUID();
    saveAccepted = false; saveLayoutReady = false;
    saveHeight ??= SAVE_PANEL_INITIAL_HEIGHT;
    void open(view).catch(() => showLoadError("连接暂时中断，请重新打开 Aarre。"));
  });
  nexToggle.addEventListener("click", () => { suite?.activate("nexalign"); });
  toggle.addEventListener("click", () => { if (opened || opening || openingShell) close(true); else void open(view).catch(() => showLoadError("连接暂时中断，请重新打开 Aarre。")); });
  let drag: { id: number; x: number; width: number } | null = null;
  resize.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || saveHeight !== null) return; event.preventDefault();
    drag = { id: event.pointerId, x: event.clientX, width: floatingRects(position, viewport()).menu.width }; resize.setPointerCapture(event.pointerId);
    host.dataset.resizing = "true";
  });
  resize.addEventListener("pointermove", (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    position = { ...position, width: floatingWidth(drag.width + drag.x - event.clientX) }; layout();
  });
  const endResize = () => { if (!drag) return; drag = null; host.dataset.resizing = "false"; persist(); };
  resize.addEventListener("pointerup", endResize); resize.addEventListener("pointercancel", endResize); resize.addEventListener("lostpointercapture", endResize);
  resize.addEventListener("keydown", (event) => {
    if (saveHeight !== null) return;
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return; event.preventDefault();
    position = { ...position, width: event.key === "Home" ? 320 : event.key === "End" ? 640 : floatingWidth(position.width + (event.key === "ArrowLeft" ? 1 : -1) * (event.shiftKey ? 40 : 10)) }; layout(); persist();
  });
  const outside = (event: PointerEvent) => { if (!event.composedPath().includes(host)) { setQuickActions(false); if (opened || openingShell) close(); } };
  const escape = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || event.isComposing || event.defaultPrevented) return;
    if (opened || opening || openingShell) { close(true); event.preventDefault(); }
    else if (product.dataset.actionsOpen === "true") { toggle.focus({ preventScroll: true }); setQuickActions(false); event.preventDefault(); }
  };
  const receive = (event: MessageEvent) => {
    if (!iframe || !info || event.source !== iframe.contentWindow || event.origin !== chrome.runtime.getURL("").replace(/\/$/, "") || event.data?.session !== info.nonce) return;
    if (event.data.type === "SUITE_PARK_READY") { frameParking.receive(event.data); return; }
    if (event.data.type === "FLOAT_READY") {
      ready = true; needsRetry = false; if (!pendingSaveRequest) clearTimeout(loadTimeout);
      if (!opened) return;
      discardSaveDraft = false;
      loading.hidden = !pendingSaveRequest; iframe.inert = Boolean(pendingSaveRequest);
      iframe.style.visibility = "visible";
      showView(); parkedView = false; if (opened && !preparingSave) iframe.focus();
      revealSave();
    }
    if (event.data.type === "FLOAT_SAVE_ACCEPTED" && event.data.requestId === pendingSaveRequest) {
      saveAccepted = true; revealSave();
    }
    if (event.data.type === "FLOAT_SAVE_DEFERRED" && event.data.requestId === pendingSaveRequest) {
      pendingSaveRequest = null; preparingSave = false; saveHeight = null; clearTimeout(loadTimeout);
      loading.hidden = true; iframe.inert = false; layout(opened);
    }
    if (opened && event.data.type === "FLOAT_SAVE_LAYOUT" && (!pendingSaveRequest || event.data.requestId === pendingSaveRequest) && typeof event.data.height === "number" && Number.isFinite(event.data.height) && event.data.height > 0) {
      if (saveHeight === null) { saveHeight = SAVE_PANEL_INITIAL_HEIGHT; layout(true); }
      saveLayoutReady = event.data.ready === true; revealSave();
    }
    if (event.data.type === "FLOAT_WORKSPACE_LAYOUT" && !pendingSaveRequest && saveHeight !== null) {
      saveHeight = null; layout(opened);
    }
    if (event.data.type === "FLOAT_LOAD_ERROR") showLoadError(typeof event.data.message === "string" ? event.data.message : "请重新打开菜单。");
    if (!parkedView && event.data.type === "FLOAT_CURRENT_VIEW" && ["library", "chat", "settings", "history"].includes(event.data.view)) view = event.data.view;
    if (event.data.type === "FLOAT_CLOSE") {
      close(true, event.data.resetSave === true, event.data.requestId);
    }
    if (event.data.type === "FLOAT_HIDE") { close(); forced = false; suite?.enabled(false); host.dataset.hidden = "true"; previousFocus?.focus({ preventScroll: true }); }
    if (event.data.type === "FLOAT_THEME" && ["light", "dark"].includes(event.data.theme)) host.dataset.theme = suiteTheme ?? event.data.theme;
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
    disposed = true; dockDrag.destroy(); frameParking.destroy(); suite?.destroy(); generation++; observer.disconnect(); dockMorph.destroy(); if (saveRevealFrame !== undefined) cancelAnimationFrame(saveRevealFrame); clearTimeout(watchdog); clearTimeout(loadTimeout); clearTimeout(closeTimer); clearTimeout(feedbackTimer); clearTimeout(quickActionsTimer); host.remove();
    try { chrome.runtime.onMessage.removeListener(runtimeListener); } catch { /* Extension reload invalidates old listeners. */ }
    document.removeEventListener("pointerdown", outside, true); document.removeEventListener("keydown", escape); document.removeEventListener("fullscreenchange", attach);
    window.removeEventListener("message", receive); window.removeEventListener("resize", attach); window.removeEventListener("pageshow", pageshow);
    window.visualViewport?.removeEventListener("resize", attach); window.visualViewport?.removeEventListener("scroll", attach);
  } };
  host.addEventListener("aarre-floating-retire", window.__aarreFloatingHost.destroy, { once: true });
  suite = createSuiteClient("aarre", {
    retire: () => window.__aarreFloatingHost?.destroy(),
    state: state => {
      host.dataset.suitePaired = String(state.paired);
      host.dataset.suiteAway = String(state.paired && state.active === "nexalign");
      nexToggle.hidden = !state.paired;
      bar.setAttribute("aria-label", state.paired ? "Aarre 与 NexAlign 快捷栏" : "Aarre 快捷栏");
      if (!state.paired && !opened) bar.hidden = false;
      if (info && !dockDrag.active && state.active === null && state.ratio !== (position.handleRatio ?? .5)) suite?.position(position.handleRatio ?? .5);
      // The common controller ignores unchanged geometry during a transition.
      layout();
    },
    theme: theme => { suiteTheme = theme; host.dataset.theme = theme; host.dataset.suiteTheme = theme; },
    open: () => {
      if (cancelledShell) { cancelledShell = false; return false; }
      // Ownership acknowledges the visible host, not completion of page reads.
      // This also lets a close/new open update suite state while loading.
      void open(view, true).catch(() => showLoadError("连接暂时中断，请重新打开 Aarre。"));
      return opened;
    },
    close: async () => {
      if (ready) await frameParking.prepare();
      close(); parkedView = true; iframe?.remove(); iframe = null; ready = false; info = null;
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    },
    error: message => { if (openingShell) close(true, true); showQuickFeedback(message, true); },
  });
  void init().catch(() => { host.dataset.hidden = "true"; });
}

// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";

let shadow: ShadowRoot;
const nonce = "host-recovery-test";
const origin = location.origin;

beforeEach(async () => {
  vi.resetModules(); vi.useFakeTimers();
  const original = Element.prototype.attachShadow;
  vi.spyOn(Element.prototype, "attachShadow").mockImplementation(function (this: Element, init) {
    const root = original.call(this, init);
    if (this.tagName.toLowerCase() === "aarre-floating-host") shadow = root;
    return root;
  });
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.stubGlobal("chrome", { runtime: {
    id: "aarre", getManifest: () => ({ version: "0.6.5" }),
    getURL: (path: string) => `${origin}/${path}`,
    sendMessage: vi.fn(async () => ({ ok: true, data: {
      tabId: 7, documentId: "host-document", nonce, enabled: true, theme: "light",
      position: { width: 400 },
    } })),
    onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
  } });
  await import("../src/extension/floating/host");
  await vi.advanceTimersByTimeAsync(0);
});

afterEach(() => {
  window.__aarreFloatingHost?.destroy(); delete window.__aarreFloatingHost;
  vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

async function toggle() {
  shadow.querySelector<HTMLButtonElement>(".bar-toggle")!.click();
  await vi.advanceTimersByTimeAsync(0);
}
function currentFrame() {
  const frame = shadow.querySelector<HTMLIFrameElement>("iframe")!;
  // jsdom does not create a browsing context for an iframe in a closed shadow
  // root. Supply only that browser boundary; the host and DOM are real.
  if (!frame.contentWindow) Object.defineProperty(frame, "contentWindow", { value: { postMessage: vi.fn() }, configurable: true });
  return frame;
}
function ready(frame: HTMLIFrameElement) {
  window.dispatchEvent(new MessageEvent("message", {
    source: frame.contentWindow, origin, data: { type: "FLOAT_READY", session: nonce },
  }));
}

it("reveals the left action on hover, keeps the pointer crossing usable and dismisses it on leave", async () => {
  const product = shadow.querySelector<HTMLElement>(".bar-product")!;
  const actions = shadow.querySelector<HTMLElement>(".quick-actions")!;
  expect(actions.inert).toBe(true);
  product.dispatchEvent(new Event("pointerenter"));
  expect(actions.inert).toBe(false);
  product.dispatchEvent(new Event("pointerleave"));
  await vi.advanceTimersByTimeAsync(60);
  product.dispatchEvent(new Event("pointerenter"));
  await vi.advanceTimersByTimeAsync(120);
  expect(actions.inert).toBe(false);
  product.dispatchEvent(new Event("pointerleave"));
  await vi.advanceTimersByTimeAsync(120);
  expect(actions.inert).toBe(true);
});

it("lets keyboard users reach the secondary action and dismiss it without opening the menu", () => {
  const button = shadow.querySelector<HTMLButtonElement>(".bar-toggle")!;
  const actions = shadow.querySelector<HTMLElement>(".quick-actions")!;
  button.focus();
  button.dispatchEvent(new KeyboardEvent("keydown", {key:"ArrowLeft",bubbles:true,composed:true}));
  expect(shadow.activeElement).toBe(shadow.querySelector(".bar-save"));
  window.document.dispatchEvent(new KeyboardEvent("keydown", {key:"Escape",bubbles:true}));
  expect(actions.inert).toBe(true);
  expect(shadow.activeElement).toBe(button);
  expect(shadow.host.getAttribute("data-open")).toBe("false");
});

it("delivers the identity challenge only to its owned iframe with the current session", async () => {
  await toggle(); const frame = currentFrame();
  const listener = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls[0][0];
  const respond = vi.fn();
  listener({ type: "FLOAT_VERIFY_FRAME", session: "wrong", challenge: "proof" }, { id: "aarre" }, respond);
  expect(respond).toHaveBeenLastCalledWith({ ok: false });
  expect(frame.contentWindow!.postMessage).not.toHaveBeenCalled();
  listener({ type: "FLOAT_VERIFY_FRAME", session: nonce, challenge: "proof" }, { id: "other" }, respond);
  expect(respond).toHaveBeenLastCalledWith({ ok: false });
  listener({ type: "FLOAT_VERIFY_FRAME", session: nonce, challenge: "proof" }, { id: "aarre" }, respond);
  expect(respond).toHaveBeenLastCalledWith({ ok: true });
  expect(frame.contentWindow!.postMessage).toHaveBeenCalledWith({ type: "FLOAT_IDENTITY_CHALLENGE", session: nonce, challenge: "proof" }, origin);
});

it("shows an authenticated startup failure immediately and lets retry replace the failed frame", async () => {
  await toggle(); const frame = currentFrame();
  window.dispatchEvent(new MessageEvent("message", { source: frame.contentWindow, origin, data: { type: "FLOAT_LOAD_ERROR", session: "wrong", message: "forged" } }));
  expect(shadow.querySelector(".loading")?.textContent).toContain("正在打开收藏");
  window.dispatchEvent(new MessageEvent("message", { source: frame.contentWindow, origin, data: { type: "FLOAT_LOAD_ERROR", session: nonce, message: "连接验证失败" } }));
  expect(shadow.querySelector(".loading")?.textContent).toContain("连接验证失败");
  await vi.advanceTimersByTimeAsync(16_000);
  expect(shadow.querySelector(".loading")?.textContent).toContain("连接验证失败");
  shadow.querySelector<HTMLButtonElement>(".loading button")!.click();
  await vi.advanceTimersByTimeAsync(0);
  const replacement = currentFrame(); expect(replacement).not.toBe(frame);
  ready(replacement); expect(shadow.querySelector<HTMLElement>(".loading")!.hidden).toBe(true);
});

it("retains the live iframe after a slow first load recovers, so reopening does not discard the conversation", async () => {
  await toggle();
  const frame = currentFrame();
  await vi.advanceTimersByTimeAsync(16_000);
  expect(shadow.querySelector(".loading")?.textContent).toContain("菜单未能打开");
  ready(frame);
  expect(shadow.querySelector<HTMLElement>(".loading")!.hidden).toBe(true);
  await toggle(); await toggle();
  expect(shadow.querySelector("iframe")).toBe(frame);
});

it("still replaces a failed iframe and ignores a late readiness message from the discarded frame", async () => {
  await toggle();
  const failedFrame = currentFrame();
  const failedWindow = failedFrame.contentWindow;
  await vi.advanceTimersByTimeAsync(16_000);
  await toggle(); await toggle();
  const replacement = currentFrame();
  expect(replacement).not.toBe(failedFrame);
  window.dispatchEvent(new MessageEvent("message", {
    source: failedWindow, origin, data: { type: "FLOAT_READY", session: nonce },
  }));
  expect(shadow.querySelector<HTMLElement>(".loading")!.hidden).toBe(false);
  ready(replacement);
  expect(shadow.querySelector<HTMLElement>(".loading")!.hidden).toBe(true);
});

it("resizes only from the left separator, clamps width, and retains viewport height",async()=>{
  await toggle(); const frame=currentFrame();ready(frame);
  const panel=shadow.querySelector<HTMLElement>('.panel')!, separator=shadow.querySelector<HTMLElement>('[role="separator"][aria-label="调整菜单宽度"]')!;
  const height=panel.style.height;
  separator.dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true}));
  expect(panel.style.width).toBe('640px');expect(panel.style.height).toBe(height);
  separator.dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true}));
  expect(panel.style.width).toBe('320px');expect(panel.style.height).toBe(height);
  expect(shadow.querySelectorAll('[role="separator"][tabindex="0"]')).toHaveLength(1);
  expect(shadow.querySelector('.ball')).toBeNull();
  expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({type:'FLOAT_POSITION',position:{width:320}});
});

it("cancels a delayed close when immediately reopened without replacing the iframe",async()=>{
  await toggle(); const frame=currentFrame(); ready(frame);
  await toggle(); expect(shadow.querySelector<HTMLElement>('.panel')!.inert).toBe(true);
  await toggle(); await vi.advanceTimersByTimeAsync(250);
  expect(shadow.querySelector('iframe')).toBe(frame);
  expect(shadow.querySelector<HTMLElement>('.panel')!.hidden).toBe(false);
  expect(shadow.querySelector<HTMLElement>('.panel')!.inert).toBe(false);
});

function hostMessage(frame: HTMLIFrameElement, data: Record<string, unknown>) {
  window.dispatchEvent(new MessageEvent("message", { source: frame.contentWindow, origin, data: { session: nonce, ...data } }));
}
function latestView(frame: HTMLIFrameElement) {
  return vi.mocked(frame.contentWindow!.postMessage).mock.calls.map(call => call[0] as Record<string, unknown>).filter(message => message.type === "FLOAT_VIEW").at(-1)!;
}
async function clickSave() {
  shadow.querySelector<HTMLButtonElement>(".bar-save")!.click();
  await vi.advanceTimersByTimeAsync(0);
}
async function presentSave(frame: HTMLIFrameElement, height = 545) {
  const requestId = latestView(frame).saveRequestId;
  hostMessage(frame, { type: "FLOAT_SAVE_ACCEPTED", requestId });
  hostMessage(frame, { type: "FLOAT_SAVE_LAYOUT", requestId, ready: true, height });
  await vi.advanceTimersByTimeAsync(20);
}

it("retains a cold save intent across the initial view announcement without writing a bookmark", async () => {
  await clickSave(); const frame = currentFrame();
  hostMessage(frame, { type: "FLOAT_CURRENT_VIEW", view: "chat" });
  ready(frame);
  const message = latestView(frame);
  expect(message.view).toBe("chat");
  expect(message.saveRequestId).toEqual(expect.any(String));
  expect(shadow.querySelector<HTMLElement>(".panel")!.inert).toBe(false);
  expect(frame.inert).toBe(true);
  expect(vi.mocked(chrome.runtime.sendMessage).mock.calls.some(([request]) => ["FLOAT_QUICK_SAVE", "SAVE_BOOKMARK"].includes((request as unknown as {type:string})?.type))).toBe(false);
});

it("coalesces pending clicks, validates the acknowledgement, and issues a fresh intent on warm reopening", async () => {
  await clickSave(); const frame = currentFrame(); ready(frame);
  const requestId = latestView(frame).saveRequestId;
  hostMessage(frame, { type: "FLOAT_SAVE_ACCEPTED", requestId, session: "forged" });
  await clickSave(); expect(latestView(frame).saveRequestId).toBe(requestId);
  hostMessage(frame, { type: "FLOAT_SAVE_ACCEPTED", requestId: "other" });
  await clickSave(); expect(latestView(frame).saveRequestId).toBe(requestId);
  hostMessage(frame, { type: "FLOAT_SAVE_ACCEPTED", requestId });
  await presentSave(frame);
  await toggle(); await clickSave();
  expect(currentFrame()).toBe(frame);
  expect(latestView(frame).saveRequestId).toEqual(expect.any(String));
  expect(latestView(frame).saveRequestId).not.toBe(requestId);
});

it("opens the compact loading surface immediately and keeps its size when fields are ready", async () => {
  await clickSave(); const frame = currentFrame(); const panel = shadow.querySelector<HTMLElement>(".panel")!;
  expect(panel.style.width).toBe("360px"); expect(panel.style.height).toBe("560px");
  expect(shadow.querySelector<HTMLElement>(".resize")!.hidden).toBe(true);
  expect(shadow.host.getAttribute("data-open")).toBe("true");
  expect(shadow.querySelector<HTMLElement>(".loading")!.hidden).toBe(false);
  ready(frame);
  await presentSave(frame, 412);
  expect(shadow.host.getAttribute("data-open")).toBe("true");
  expect(panel.style.height).toBe("560px");
  hostMessage(frame,{type:"FLOAT_WORKSPACE_LAYOUT"});
  expect(panel.style.width).toBe("400px"); expect(panel.style.height).toBe(`${innerHeight-24}px`);
  expect(shadow.querySelector<HTMLElement>(".resize")!.hidden).toBe(false);
  expect(currentFrame()).toBe(frame);
  expect(vi.mocked(chrome.runtime.sendMessage).mock.calls.some(([request])=>(request as any)?.type==="FLOAT_POSITION")).toBe(false);
});

it("rejects untrusted and malformed layout requests, bounds oversized content, and keeps the compact draft on reopen", async () => {
  await clickSave(); const frame = currentFrame(); ready(frame);
  const panel = shadow.querySelector<HTMLElement>(".panel")!;
  const requestId = latestView(frame).saveRequestId;
  for (const height of [Number.NaN,Infinity,-10,0,"400"]) hostMessage(frame,{type:"FLOAT_SAVE_LAYOUT",height,requestId,ready:true});
  hostMessage(frame,{type:"FLOAT_SAVE_LAYOUT",height:500,session:"forged",requestId,ready:true});
  expect(panel.style.height).toBe("560px");
  await presentSave(frame, 2000);
  expect(panel.style.height).toBe("560px");
  await toggle(); await toggle();
  expect(panel.style.width).toBe("360px"); expect(panel.style.height).toBe("560px");
  expect(currentFrame()).toBe(frame);
});

it("covers cold and warm content until the save form has committed without hiding its rendering context", async () => {
  await clickSave(); const frame = currentFrame();
  expect(new URL(frame.src).searchParams.get("save")).toEqual(expect.any(String));
  ready(frame);
  expect(shadow.querySelector<HTMLElement>(".loading")!.hidden).toBe(false);
  expect(shadow.querySelector<HTMLElement>(".bar")!.hidden).toBe(true);
  await presentSave(frame);
  expect(frame.style.visibility).toBe("visible");
  const panelStyle = shadow.querySelector<HTMLElement>(".panel")!.style;
  const geometryBeforeClose = [panelStyle.left, panelStyle.top, panelStyle.width, panelStyle.height];
  hostMessage(frame, { type: "FLOAT_CLOSE", resetSave: true, requestId: "close-save" });
  expect([panelStyle.left, panelStyle.top, panelStyle.width, panelStyle.height]).toEqual(geometryBeforeClose);
  expect(shadow.host.getAttribute("data-open")).toBe("false");
  expect(shadow.querySelector<HTMLElement>(".panel")!.hidden).toBe(false);
  expect(shadow.querySelector<HTMLElement>(".dock-surface")!.style.width).toBe("52px");
  expect(shadow.querySelector<HTMLElement>(".loading")!.hidden).toBe(true);
  await vi.advanceTimersByTimeAsync(209);
  expect(shadow.querySelector<HTMLElement>(".panel")!.hidden).toBe(false);
  expect(frame.contentWindow!.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "FLOAT_CLOSED" }), origin);
  await vi.advanceTimersByTimeAsync(1);
  expect(shadow.querySelector<HTMLElement>(".panel")!.hidden).toBe(true);
  expect(frame.contentWindow!.postMessage).toHaveBeenCalledWith({ type: "FLOAT_CLOSED", requestId: "close-save", session: nonce }, origin);
  expect(shadow.querySelector<HTMLElement>(".loading")!.hidden).toBe(false);
  await clickSave();
  expect(currentFrame()).toBe(frame); expect(shadow.querySelector<HTMLElement>(".loading")!.hidden).toBe(false);
  await presentSave(frame);
  expect(frame.style.visibility).toBe("visible");
});

it("reverses a save close without clearing the outgoing form or sending a stale dismissal", async () => {
  await clickSave(); const frame = currentFrame(); ready(frame); await presentSave(frame);
  hostMessage(frame, { type: "FLOAT_CLOSE", resetSave: true, requestId: "cancelled-close" });
  await vi.advanceTimersByTimeAsync(60);
  await clickSave();
  expect(shadow.querySelector<HTMLElement>(".loading")!.hidden).toBe(true);
  await presentSave(frame);
  await vi.advanceTimersByTimeAsync(300);
  expect(currentFrame()).toBe(frame);
  expect(shadow.host.getAttribute("data-open")).toBe("true");
  expect(shadow.querySelector<HTMLElement>(".panel")!.hidden).toBe(false);
  expect(frame.contentWindow!.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "FLOAT_CLOSED" }), origin);
});
it("replaces an invalidated same-version host and leaves exactly one working launcher", async () => {
  const oldHost = shadow.host;
  vi.mocked(chrome.runtime.onMessage.removeListener).mockImplementationOnce(() => { throw new Error("Extension context invalidated"); });
  vi.resetModules(); await import("../src/extension/floating/host"); await vi.advanceTimersByTimeAsync(0);
  expect(document.querySelectorAll("aarre-floating-host")).toHaveLength(1);
  expect(oldHost.isConnected).toBe(false);
  await toggle(); expect(currentFrame()).toBeTruthy();
});
it("updates the collapsed star label and saved state from actual host metadata", async () => {
  (vi.mocked(chrome.runtime.sendMessage) as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true, data: {
    tabId: 7, documentId: "host-document", nonce, enabled: true, saved: true, position: { width: 400 },
  } });
  const listener = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls[0][0];
  listener({ type: "FLOAT_REFRESH" }, {}, vi.fn()); await vi.advanceTimersByTimeAsync(0);
  expect(shadow.querySelector<HTMLElement>(".bar-save")!.dataset.saved).toBe("true");
  expect(shadow.querySelector(".bar-save")!.getAttribute("aria-label")).toBe("管理当前网页收藏");
});

it("retires a host from an earlier isolated world even when its window global is gone", async () => {
  const previous = shadow.host;
  delete window.__aarreFloatingHost; // Chrome reload creates a new isolated world.
  vi.resetModules(); await import("../src/extension/floating/host"); await vi.advanceTimersByTimeAsync(0);
  expect(previous.isConnected).toBe(false);
  expect(document.querySelectorAll('[data-aarre-ui="floating-host"]')).toHaveLength(1);
});
it("neutralizes a legacy observer without letting it resurrect an interactive bar", async () => {
  const legacy = document.createElement("aarre-floating-host"); legacy.dataset.aarreUi = "floating-host";
  legacy.dataset.hidden = "false"; legacy.setAttribute("popover", "manual"); document.documentElement.append(legacy);
  const observer = new MutationObserver(() => { if (!legacy.isConnected) document.documentElement.append(legacy); });
  observer.observe(document, { childList: true, subtree: true });
  vi.resetModules(); await import("../src/extension/floating/host"); await vi.advanceTimersByTimeAsync(0);
  expect(document.querySelectorAll('[data-aarre-ui="floating-host"]')).toHaveLength(1);
  expect(legacy.dataset.aarreUi).toBe("retired-floating-host");
  expect(legacy.dataset.hidden).toBe("true"); expect(legacy.inert).toBe(true); expect(legacy.hasAttribute("popover")).toBe(false);
  observer.disconnect(); legacy.remove();
});
it("reconnects an open menu when a restored document receives a new session", async () => {
  await toggle(); const previous = currentFrame(); ready(previous);
  (vi.mocked(chrome.runtime.sendMessage) as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: {
    tabId: 7, documentId: "host-document", nonce: "restored-session", enabled: true, position: { width: 400 },
  } });
  window.dispatchEvent(new Event("pageshow")); await vi.advanceTimersByTimeAsync(0);
  expect(currentFrame()).not.toBe(previous);
  expect(new URL(currentFrame().src).searchParams.get("session")).toBe("restored-session");
  expect(shadow.host.getAttribute("data-open")).toBe("true");
});
it("reveals an existing operation when a save intent is deferred instead of trapping it behind loading", async () => {
  await clickSave(); const frame = currentFrame(); ready(frame);
  hostMessage(frame, { type: "FLOAT_SAVE_DEFERRED", requestId: latestView(frame).saveRequestId });
  expect(shadow.querySelector<HTMLElement>(".loading")!.hidden).toBe(true);
  expect(shadow.querySelector<HTMLElement>(".panel")!.style.width).toBe("400px");
  await vi.advanceTimersByTimeAsync(16_000);
  expect(shadow.textContent).not.toContain("菜单未能打开");
});

it("keeps loading over the already expanded surface until the requested form is ready", async () => {
  await clickSave(); const frame = currentFrame(); ready(frame);
  const requestId = latestView(frame).saveRequestId;
  hostMessage(frame, { type: "FLOAT_SAVE_ACCEPTED", requestId });
  hostMessage(frame, { type: "FLOAT_SAVE_LAYOUT", requestId, height: 448, ready: false });
  hostMessage(frame, { type: "FLOAT_SAVE_LAYOUT", requestId: "previous-save", height: 600, ready: true });
  await vi.advanceTimersByTimeAsync(500);
  expect(shadow.host.getAttribute("data-open")).toBe("true");
  expect(shadow.querySelector<HTMLElement>(".dock-surface")!.style.width).toBe("360px");
  expect(shadow.querySelector<HTMLElement>(".loading")!.hidden).toBe(false);
  hostMessage(frame, { type: "FLOAT_SAVE_LAYOUT", requestId, height: 545, ready: true });
  await vi.advanceTimersByTimeAsync(20);
  expect(shadow.host.getAttribute("data-open")).toBe("true");
  expect(shadow.querySelector<HTMLElement>(".dock-surface")!.style.height).toBe("560px");
  expect(shadow.querySelector<HTMLElement>(".loading")!.hidden).toBe(true);
});

it.each([false, true])("does not reopen after cancelling preparation, including a queued reveal (%s)", async queued => {
  await clickSave(); const frame = currentFrame(); ready(frame);
  const requestId = latestView(frame).saveRequestId;
  if (queued) {
    hostMessage(frame, { type: "FLOAT_SAVE_LAYOUT", requestId, height: 545, ready: true });
    hostMessage(frame, { type: "FLOAT_SAVE_ACCEPTED", requestId });
  }
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  hostMessage(frame, { type: "FLOAT_SAVE_LAYOUT", requestId, height: 545, ready: true });
  hostMessage(frame, { type: "FLOAT_SAVE_ACCEPTED", requestId });
  await vi.advanceTimersByTimeAsync(500);
  expect(shadow.host.getAttribute("data-open")).toBe("false");
  expect(shadow.querySelector<HTMLElement>(".panel")!.hidden).toBe(true);
  expect(shadow.querySelector<HTMLElement>(".bar")!.hidden).toBe(false);
  await clickSave();
  const replacement = currentFrame(); ready(replacement);
  expect(replacement).not.toBe(frame);
  expect(latestView(replacement).saveRequestId).not.toBe(requestId);
  await presentSave(replacement);
  expect(shadow.host.getAttribute("data-open")).toBe("true");
});

it("shows retry and close inside the panel after preparation times out", async () => {
  await clickSave(); const frame = currentFrame();
  await vi.advanceTimersByTimeAsync(15_000);
  expect(shadow.host.getAttribute("data-save-preparing")).toBe("false");
  expect(shadow.querySelector<HTMLElement>(".panel")!.hidden).toBe(false);
  expect(shadow.querySelector(".loading")?.textContent).toContain("超时");
  const dismiss = Array.from(shadow.querySelectorAll<HTMLButtonElement>(".loading button")).find(button => button.textContent === "关闭")!;
  dismiss.click(); await vi.advanceTimersByTimeAsync(210);
  ready(frame);
  expect(shadow.host.getAttribute("data-open")).toBe("false");
});

it.each([
  {button: ".bar-save", dismiss: ".loading-cancel", width: "360px"},
  {button: ".bar-toggle", dismiss: ".loading-close", width: "400px"},
])("animates $button before background initialization resolves and lets loading close stop the pending open", async ({button, dismiss, width}) => {
  let release!: (value: unknown) => void;
  vi.mocked(chrome.runtime.sendMessage).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  shadow.querySelector<HTMLButtonElement>(button)!.click();
  expect(shadow.host.getAttribute("data-open")).toBe("true");
  expect(shadow.querySelector<HTMLElement>(".dock-surface")!.style.width).toBe(width);
  expect(shadow.querySelector("iframe")).toBeNull();
  await vi.advanceTimersByTimeAsync(1000);
  expect(shadow.querySelector<HTMLElement>(".loading")!.hidden).toBe(false);
  shadow.querySelector<HTMLButtonElement>(dismiss)!.click();
  expect(shadow.host.getAttribute("data-open")).toBe("false");
  release({ ok: true, data: { tabId: 7, documentId: "host-document", nonce, enabled: true, position: { width: 400 } } });
  await vi.advanceTimersByTimeAsync(500);
  expect(shadow.querySelector("iframe")).toBeNull();
  expect(shadow.querySelector<HTMLElement>(".panel")!.hidden).toBe(true);
});

it("renews frame identity after cancellation even when the old initialization finishes late", async () => {
  await toggle(); const oldFrame = currentFrame(); ready(oldFrame); await toggle();
  let release!: (value: unknown) => void;
  vi.mocked(chrome.runtime.sendMessage).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  shadow.querySelector<HTMLButtonElement>(".bar-save")!.click();
  shadow.querySelector<HTMLButtonElement>(".loading-cancel")!.click();
  await vi.advanceTimersByTimeAsync(210);
  release({ ok: true, data: { tabId: 7, documentId: "host-document", nonce, enabled: true, position: { width: 400 } } });
  await vi.advanceTimersByTimeAsync(0);
  await toggle();
  expect(vi.mocked(chrome.runtime.sendMessage)).toHaveBeenLastCalledWith({type:"FLOAT_HOST_INIT",freshHost:true});
  expect(currentFrame()).not.toBe(oldFrame);
  expect(new URL(currentFrame().src).searchParams.get("discardSave")).toBe("1");
});

it.each([
  {button: ".bar-save", dismiss: ".loading-cancel"},
  {button: ".bar-toggle", dismiss: ".loading-close"},
])("shows $button before suite ownership arrives and rejects a late open after cancellation", async ({button, dismiss}) => {
  const listeners: Array<(message: unknown) => void> = [];
  const post = vi.fn();
  Object.assign(chrome.runtime, { connect: vi.fn(({name}: {name: string}) => ({
    postMessage: post, disconnect: vi.fn(), onDisconnect: {addListener: vi.fn()},
    onMessage: {addListener: (listener: (message: unknown) => void) => { if(name === "nex-suite-dock-v1") listeners.push(listener); }},
  })) });
  vi.resetModules(); await import("../src/extension/floating/host"); await vi.advanceTimersByTimeAsync(0);
  listeners[0]({type:"STATE",paired:true,active:null});
  shadow.querySelector<HTMLButtonElement>(button)!.click();
  expect(post).toHaveBeenCalledWith({type:"REQUEST",app:"aarre"});
  expect(shadow.host.getAttribute("data-open")).toBe("true");
  expect(shadow.querySelector("iframe")).toBeNull();
  shadow.querySelector<HTMLButtonElement>(dismiss)!.click();
  listeners[0]({type:"OPEN",id:"delayed-suite-open"});
  await vi.advanceTimersByTimeAsync(500);
  expect(post).toHaveBeenCalledWith({type:"ACK",id:"delayed-suite-open",ok:false});
  expect(shadow.host.getAttribute("data-open")).toBe("false");
  expect(shadow.querySelector("iframe")).toBeNull();
  shadow.querySelector<HTMLButtonElement>(button)!.click();
  shadow.querySelector<HTMLButtonElement>(dismiss)!.click();
  let release!: (value: unknown) => void;
  vi.mocked(chrome.runtime.sendMessage).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  await toggle(); // A newer main-menu intent supersedes the cancelled save.
  listeners[0]({type:"OPEN",id:"new-menu-intent"});
  await vi.advanceTimersByTimeAsync(0);
  expect(post).toHaveBeenCalledWith({type:"ACK",id:"new-menu-intent",ok:true});
  expect(shadow.host.getAttribute("data-open")).toBe("true");
  expect(shadow.querySelector("iframe")).toBeNull();
  shadow.querySelector<HTMLButtonElement>(".loading-close")!.click();
  expect(post).toHaveBeenCalledWith({type:"CLOSED"});
  release({ ok: true, data: { tabId: 7, documentId: "host-document", nonce, enabled: true, position: { width: 400 } } });
  await vi.advanceTimersByTimeAsync(500);
  expect(shadow.host.getAttribute("data-open")).toBe("false");
  expect(shadow.querySelector("iframe")).toBeNull();
});

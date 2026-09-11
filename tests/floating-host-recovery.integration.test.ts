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
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false })));
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
  const panel=shadow.querySelector<HTMLElement>('.panel')!, separator=shadow.querySelector<HTMLElement>('[role="separator"]')!;
  const height=panel.style.height;
  separator.dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true}));
  expect(panel.style.width).toBe('640px');expect(panel.style.height).toBe(height);
  separator.dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true}));
  expect(panel.style.width).toBe('320px');expect(panel.style.height).toBe(height);
  expect(shadow.querySelectorAll('[role="separator"]')).toHaveLength(1);
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

it("retains a cold save intent across the initial view announcement without writing a bookmark", async () => {
  await clickSave(); const frame = currentFrame();
  hostMessage(frame, { type: "FLOAT_CURRENT_VIEW", view: "chat" });
  ready(frame);
  const message = latestView(frame);
  expect(message.view).toBe("chat");
  expect(message.saveRequestId).toEqual(expect.any(String));
  expect(shadow.querySelector<HTMLElement>(".panel")!.inert).toBe(false);
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
  await toggle(); await clickSave();
  expect(currentFrame()).toBe(frame);
  expect(latestView(frame).saveRequestId).toEqual(expect.any(String));
  expect(latestView(frame).saveRequestId).not.toBe(requestId);
});

it("opens the star at a compact size before readiness and restores the preferred workspace width after returning", async () => {
  await clickSave(); const frame = currentFrame(); const panel = shadow.querySelector<HTMLElement>(".panel")!;
  expect(panel.style.width).toBe("360px"); expect(panel.style.height).toBe("448px");
  expect(shadow.querySelector<HTMLElement>(".resize")!.hidden).toBe(true);
  ready(frame);
  hostMessage(frame,{type:"FLOAT_SAVE_ACCEPTED",requestId:latestView(frame).saveRequestId});
  hostMessage(frame,{type:"FLOAT_SAVE_LAYOUT",height:412});
  expect(panel.style.height).toBe("412px");
  hostMessage(frame,{type:"FLOAT_WORKSPACE_LAYOUT"});
  expect(panel.style.width).toBe("400px"); expect(panel.style.height).toBe(`${innerHeight-24}px`);
  expect(shadow.querySelector<HTMLElement>(".resize")!.hidden).toBe(false);
  expect(currentFrame()).toBe(frame);
  expect(vi.mocked(chrome.runtime.sendMessage).mock.calls.some(([request])=>(request as any)?.type==="FLOAT_POSITION")).toBe(false);
});

it("rejects untrusted and malformed layout requests, bounds oversized content, and keeps the compact draft on reopen", async () => {
  await clickSave(); const frame = currentFrame(); ready(frame);
  const panel = shadow.querySelector<HTMLElement>(".panel")!;
  for (const height of [Number.NaN,Infinity,-10,0,"400"]) hostMessage(frame,{type:"FLOAT_SAVE_LAYOUT",height});
  hostMessage(frame,{type:"FLOAT_SAVE_LAYOUT",height:500,session:"forged"});
  expect(panel.style.height).toBe("448px");
  hostMessage(frame,{type:"FLOAT_SAVE_LAYOUT",height:2000});
  expect(panel.style.height).toBe("640px");
  await toggle(); await toggle();
  expect(panel.style.width).toBe("360px"); expect(panel.style.height).toBe("640px");
  expect(currentFrame()).toBe(frame);
});

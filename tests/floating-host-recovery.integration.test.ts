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
    id: "aarre", getManifest: () => ({ version: "0.6.3" }),
    getURL: (path: string) => `${origin}/${path}`,
    sendMessage: vi.fn(async () => ({ ok: true, data: {
      tabId: 7, documentId: "host-document", nonce, enabled: true, theme: "light",
      position: { edge: "right", ratio: 0.72, width: 400, height: 600 },
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
  shadow.querySelector<HTMLButtonElement>(".ball")!.click();
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

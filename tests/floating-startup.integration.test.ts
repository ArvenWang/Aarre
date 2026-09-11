// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { listenForFrameChallenge, reportFloatingStartupError } from "../src/ui/floating/startup";

const parentWindow = { postMessage: vi.fn() };
let stopListening: (() => void) | undefined;
beforeEach(() => {
  parentWindow.postMessage.mockReset();
  vi.stubGlobal("parent", parentWindow);
  vi.spyOn(document, "referrer", "get").mockReturnValue("https://source.example/article");
  history.replaceState(null, "", "?tab=7&session=startup-proof");
  vi.stubGlobal("chrome", { runtime: { sendMessage: vi.fn(async () => ({ ok: true })) } });
});
afterEach(() => { stopListening?.(); vi.restoreAllMocks(); vi.unstubAllGlobals(); history.replaceState(null, "", "/"); });

function challenge(overrides: MessageEventInit = {}) {
  window.dispatchEvent(new MessageEvent("message", {
    source: parentWindow as unknown as Window, origin: "https://source.example",
    data: { type: "FLOAT_IDENTITY_CHALLENGE", session: "startup-proof", challenge: "random-challenge" }, ...overrides,
  }));
}

it("answers only the actual parent's challenge and removes the temporary listener after connecting", () => {
  stopListening = listenForFrameChallenge("startup-proof");
  challenge({ source: window }); challenge({ origin: "https://other.example" });
  challenge({ data: { type: "FLOAT_IDENTITY_CHALLENGE", session: "wrong", challenge: "random-challenge" } });
  expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
  challenge();
  expect(chrome.runtime.sendMessage).toHaveBeenCalledExactlyOnceWith({ type: "FLOAT_PROVE_FRAME", nonce: "startup-proof", challenge: "random-challenge" });
  stopListening(); challenge(); expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
});

it("reports failure before a privileged context exists, to a specific origin", () => {
  reportFloatingStartupError("连接失败");
  expect(parentWindow.postMessage).toHaveBeenCalledExactlyOnceWith({ type: "FLOAT_LOAD_ERROR", message: "连接失败", session: "startup-proof" }, "https://source.example");
});

it("does not broadcast startup messages to an unknown parent", () => {
  vi.spyOn(document, "referrer", "get").mockReturnValue("");
  reportFloatingStartupError("连接失败"); expect(parentWindow.postMessage).not.toHaveBeenCalled();
});

import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ensureFloatingHost, registerFloatingLifecycle } from "../src/extension/floating/lifecycle";

const events: Record<string, (...args: any[]) => void> = {};
const listener = (name: string) => ({ addListener: (fn: (...args: any[]) => void) => { events[name] = fn; } });
const tab = { id: 8, url: "https://example.com/page", discarded: false } as chrome.tabs.Tab;
let send: ReturnType<typeof vi.fn>;
let inject: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers();
  send = vi.fn(async () => ({ ok: true, version: "0.6.8" })); inject = vi.fn(async () => []);
  vi.stubGlobal("chrome", {
    runtime: { getManifest: () => ({ version: "0.6.8" }), onInstalled: listener("installed"), onStartup: listener("startup") },
    action: { onClicked: listener("action") }, permissions: { onAdded: listener("permissions") },
    scripting: { executeScript: inject },
    tabs: { query: vi.fn(async () => [tab]), get: vi.fn(async () => tab), sendMessage: send,
      onActivated: listener("activated"), onUpdated: listener("updated"), onRemoved: listener("removed") },
    storage: { onChanged: listener("settings"), session: { remove: vi.fn() } },
    bookmarks: { onCreated: listener("created"), onRemoved: listener("deleted"), onChanged: listener("changed") },
  });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it("preserves healthy hosts and drafts across startup, activation and repeated repair requests", async () => {
  registerFloatingLifecycle(); await vi.advanceTimersByTimeAsync(0);
  events.activated({ tabId: 8 }); events.startup(); await vi.advanceTimersByTimeAsync(0);
  await Promise.all([ensureFloatingHost(8), ensureFloatingHost(8)]);
  expect(inject).not.toHaveBeenCalled();
});
it("replaces disconnected hosts even when the installed version has not changed", async () => {
  send.mockRejectedValue(new Error("Extension context invalidated"));
  await Promise.all([ensureFloatingHost(8), ensureFloatingHost(8)]);
  expect(inject).toHaveBeenCalledTimes(1);
  expect(inject).toHaveBeenCalledWith({ target: { tabId: 8, frameIds: [0] }, files: ["floating-host.js"] });
});
it("replaces older live hosts on extension reload and injects missing hosts on navigation", async () => {
  send.mockResolvedValue({ ok: true, version: "0.6.7" });
  registerFloatingLifecycle(); await vi.advanceTimersByTimeAsync(0);
  expect(inject).toHaveBeenCalledTimes(1);
  events.updated(8, { status: "complete" }, tab); await vi.advanceTimersByTimeAsync(0);
  expect(inject).toHaveBeenCalledTimes(2);
});
it("bounds a hung health check and repairs without reloading the page", async () => {
  send.mockImplementation(() => new Promise(() => {}));
  const repair = ensureFloatingHost(8); await vi.advanceTimersByTimeAsync(2_000); await repair;
  expect(inject).toHaveBeenCalledTimes(1);
});
it("leaves restricted/discarded tabs alone and handles denied injection without opening tabs", async () => {
  (vi.mocked(chrome.tabs.query) as ReturnType<typeof vi.fn>).mockResolvedValue([{ ...tab, discarded: true }, { ...tab, id: 9, url: "chrome://settings" }]);
  registerFloatingLifecycle(); await vi.advanceTimersByTimeAsync(0);
  expect(send).not.toHaveBeenCalled(); expect(inject).not.toHaveBeenCalled();
  send.mockRejectedValue(new Error("No receiver")); inject.mockRejectedValue(new Error("Cannot access contents"));
  events.updated(8, { status: "complete" }, tab); await vi.advanceTimersByTimeAsync(0);
  expect(inject).toHaveBeenCalledTimes(1);
});
it("refreshes bookmark indicators after changes and same-document navigation", async () => {
  registerFloatingLifecycle(); await vi.advanceTimersByTimeAsync(0); send.mockClear();
  events.created(); events.deleted(); events.changed(); await vi.advanceTimersByTimeAsync(150);
  expect(send).toHaveBeenCalledTimes(1);
  expect(send).toHaveBeenCalledWith(8, { type: "FLOAT_REFRESH" }, { frameId: 0 });
  events.updated(8, { url: "https://example.com/next" }, tab); await vi.advanceTimersByTimeAsync(0);
  expect(send).toHaveBeenLastCalledWith(8, { type: "FLOAT_REFRESH" }, { frameId: 0 });
});

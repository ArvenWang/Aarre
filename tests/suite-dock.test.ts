import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { installSuiteBackground } from "../src/shared/suite-dock/background";
import { NEXALIGN_IDS, SUITE_DOCK_PORT, SUITE_THEME_KEY } from "../src/shared/suite-dock/contract";

const event = () => { const listeners: Function[] = []; return { addListener: (f: Function) => listeners.push(f), emit: (...args: any[]) => listeners.forEach(f => f(...args)) }; };
let own: ReturnType<typeof event>, external: ReturnType<typeof event>, messages: ReturnType<typeof event>, changes: ReturnType<typeof event>;
let stored: Record<string, unknown>;
const flush = async () => { await vi.advanceTimersByTimeAsync(0); };
beforeEach(() => {
  vi.useFakeTimers(); stored = {}; own = event(); external = event(); messages = event(); changes = event();
  vi.stubGlobal("chrome", { runtime: { id: "aarre", getURL: (path: string) => `chrome-extension://aarre/${path}`,
    getManifest: () => ({externally_connectable:{ids:NEXALIGN_IDS}}),
    onConnect: own, onConnectExternal: external, onMessage: messages },
    storage: { local: { get: async () => ({ ...stored }), set: async (next: Record<string, unknown>) => {
      const diff = Object.fromEntries(Object.entries(next).map(([key, newValue]) => [key, { oldValue: stored[key], newValue }]));
      Object.assign(stored, next); changes.emit(diff, "local");
    } }, onChanged: changes } });
  installSuiteBackground("aarre");
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
function port(app: "aarre" | "nexalign", override: object = {}) {
  const p = { name: SUITE_DOCK_PORT, sender: { id: app === "aarre" ? "aarre" : NEXALIGN_IDS[1], frameId: 0,
    documentId: "current-document", documentLifecycle: "active", tab: { id: 7 }, url: "https://example.com", ...override },
    onMessage: event(), onDisconnect: event(), postMessage: vi.fn(), disconnect: vi.fn(() => p.onDisconnect.emit()) };
  p.postMessage.mockImplementation(message => { if (message.type === "PING") p.onMessage.emit({ type: "PONG", id: message.id }); });
  (app === "aarre" ? own : external).emit(p);
  p.onMessage.emit({ type: "HELLO", version: 1, enabled: true, opened: false });
  return p;
}
const sent = (p: ReturnType<typeof port>, type: string) => p.postMessage.mock.calls.map(([m]) => m).filter(m => m.type === type);
async function openNex(a: ReturnType<typeof port>, n: ReturnType<typeof port>) {
  a.onMessage.emit({ type: "REQUEST", app: "nexalign" }); await flush();
  const close = sent(a, "CLOSE").at(-1); a.onMessage.emit({ type: "ACK", id: close.id, ok: true }); await flush();
  const request = sent(n, "OPEN").at(-1); expect(request).toBeDefined();
  n.onMessage.emit({ type: "ACK", id: request.id, ok: true }); await flush();
}
it("only pairs allowlisted extensions in the same top-level committed document", async () => {
  const a = port("aarre"), wrong = port("nexalign", { id: "untrusted" });
  expect(wrong.disconnect).toHaveBeenCalled();
  const stale = port("nexalign", { documentId: "old-document" });
  expect(sent(a, "STATE").at(-1).paired).toBe(false);
  const frame = port("nexalign", { frameId: 1 }); expect(frame.disconnect).toHaveBeenCalled();
  const web = port("nexalign", { url: "chrome://settings" }); expect(web.disconnect).toHaveBeenCalled();
  const n = port("nexalign"); await flush();
  expect(sent(a, "STATE").at(-1).paired).toBe(true);
  expect(sent(stale, "STATE").at(-1).paired).toBe(false);
  n.onMessage.emit({ type: "HELLO", version: 1, enabled: false });
  expect(sent(a, "STATE").at(-1).paired).toBe(false);
});
it("waits for the exact old panel's cleanup acknowledgement before opening the next", async () => {
  const a = port("aarre"), n = port("nexalign"); await openNex(a, n);
  n.onMessage.emit({ type: "REQUEST", app: "aarre" }); await flush();
  const close = sent(n, "CLOSE").at(-1);
  expect(sent(a, "OPEN")).toHaveLength(0);
  a.onMessage.emit({ type: "ACK", id: close.id, ok: true }); await flush();
  expect(sent(a, "OPEN")).toHaveLength(0);
  n.onMessage.emit({ type: "ACK", id: close.id, ok: true }); await flush();
  expect(sent(a, "OPEN")).toHaveLength(1);
});
it("keeps a reachable entrance if cleanup times out, and immediately recovers after uninstall", async () => {
  const a = port("aarre"), n = port("nexalign"); await openNex(a, n);
  n.onMessage.emit({ type: "REQUEST", app: "aarre" }); await vi.advanceTimersByTimeAsync(4_001);
  expect(sent(a, "OPEN")).toHaveLength(0); expect(sent(a, "ERROR")).toHaveLength(1);
  n.disconnect(); expect(sent(a, "STATE").at(-1)).toMatchObject({ paired: false, active: null });
});
it("does not let a delayed handover override the user's more recent choice", async () => {
  const a = port("aarre"), n = port("nexalign"); await openNex(a, n);
  n.onMessage.emit({ type: "REQUEST", app: "aarre" }); await flush();
  const close = sent(n, "CLOSE").at(-1);
  a.onMessage.emit({ type: "REQUEST", app: "nexalign" }); await flush();
  n.onMessage.emit({ type: "ACK", id: close.id, ok: true }); await flush();
  expect(sent(a, "OPEN")).toHaveLength(0);
  const secondClose = sent(a, "CLOSE").at(-1);
  a.onMessage.emit({ type: "ACK", id: secondClose.id, ok: true }); await flush();
  expect(sent(n, "OPEN")).toHaveLength(2);
  expect(sent(n, "STATE").at(-1).active).toBe("nexalign");
});
it("preserves the newest explicit theme through stale startup and service-worker restart", async () => {
  const n = port("nexalign"); await flush();
  const latest = { mode: "dark", clock: Date.now(), writer: "nexalign", id: "user-edit" };
  n.onMessage.emit({ type: "THEME", theme: latest }); await flush();
  n.onMessage.emit({ type: "THEME", theme: { mode: "light", clock: 0, writer: "aarre", id: "migration" } }); await flush();
  expect(stored[SUITE_THEME_KEY]).toEqual(latest);
  const reply = vi.fn();
  messages.emit({ type: "SUITE_THEME_SET", mode: "light" }, { id: "aarre", url: "chrome-extension://aarre/floating.html" }, reply);
  await flush(); expect(reply).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
  expect(stored[SUITE_THEME_KEY]).toMatchObject({ mode: "light", writer: "aarre", clock: latest.clock + 1 });
  n.onMessage.emit({ type: "THEME", theme: latest }); await flush();
  expect((stored[SUITE_THEME_KEY] as any).mode).toBe("light");
});
it("never lets a web page mint a manual theme revision or send arbitrary actions", async () => {
  const a = port("aarre"), n = port("nexalign"), reply = vi.fn();
  messages.emit({ type: "SUITE_THEME_SET", mode: "dark" }, { id: "aarre", url: "https://example.com" }, reply);
  n.onMessage.emit({ type: "REQUEST", app: "DELETE_BOOKMARKS" }); await flush();
  expect(reply).toHaveBeenCalledWith({ ok: false }); expect(sent(a, "OPEN")).toHaveLength(0);
  expect(stored[SUITE_THEME_KEY]).toBeUndefined();
});
it("recovers from an uninstalled caller even when Chrome leaves its external Port connected", async () => {
  const a = port("aarre"), n = port("nexalign"); await flush();
  expect(sent(a, "STATE").at(-1).paired).toBe(true);
  n.postMessage.mockImplementation(() => undefined);
  await vi.advanceTimersByTimeAsync(4_001);
  expect(n.disconnect).toHaveBeenCalled();
  expect(sent(a, "STATE").at(-1)).toMatchObject({ paired: false, active: null });
});

it("shares both axes only from the visible paired handle", async () => {
  const a=port("aarre"), n=port("nexalign"); await flush();
  a.onMessage.emit({type:"POSITION",ratio:.19,side:"left"}); await flush();
  expect(sent(n,"STATE").at(-1)).toMatchObject({ratio:.19,side:"left"});
  for(const ratio of [NaN,Infinity,-1,2,".5",null]) a.onMessage.emit({type:"POSITION",ratio});
  n.onMessage.emit({type:"POSITION",ratio:.8,side:"right"}); await flush();
  expect(sent(a,"STATE").at(-1)).toMatchObject({ratio:.19,side:"left"});
  await openNex(a,n);
  a.onMessage.emit({type:"POSITION",ratio:.7}); await flush();
  expect(sent(n,"STATE").at(-1)).toMatchObject({ratio:.19,side:"left"});
});

function viewportPort(override: object = {}) {
  const p = { name: "nex-suite-viewport-v1", sender: { id: NEXALIGN_IDS[1], url: `chrome-extension://${NEXALIGN_IDS[1]}/background.js`, ...override },
    onMessage: event(), onDisconnect: event(), postMessage: vi.fn(), disconnect: vi.fn(() => p.onDisconnect.emit()) };
  external.emit(p); return p;
}
it("hides only the mobile tab across navigation and releases it on desktop/disconnect", async () => {
  const a=port("aarre"), other=port("aarre",{tab:{id:8}}), v=viewportPort();
  v.onMessage.emit({type:"VIEWPORT",tabId:7});
  expect(sent(a,"STATE").at(-1).suppressed).toBe(true);
  expect(sent(other,"STATE").at(-1).suppressed).toBe(false);
  const navigated=port("aarre",{documentId:"new-document"});
  expect(sent(navigated,"STATE").at(-1).suppressed).toBe(true);
  v.onMessage.emit({type:"VIEWPORT",tabId:null});
  expect(sent(navigated,"STATE").at(-1).suppressed).toBe(false);
  v.onMessage.emit({type:"VIEWPORT",tabId:7});v.disconnect();
  expect(sent(navigated,"STATE").at(-1).suppressed).toBe(false);
});
it("rejects web/content callers, malformed mobile leases and retires dead publishers", async () => {
  const a=port("aarre");
  for(const sender of [{tab:{id:7}},{id:"untrusted"},{url:"https://example.com"}]) {
    expect(viewportPort(sender).disconnect).toHaveBeenCalled();
  }
  const v=viewportPort();
  for(const tabId of [-1,NaN,Infinity,"7",undefined]) v.onMessage.emit({type:"VIEWPORT",tabId});
  expect(sent(a,"STATE").at(-1).suppressed).toBe(false);
  v.onMessage.emit({type:"VIEWPORT",tabId:7});
  a.onMessage.emit({type:"REQUEST",app:"aarre"}); await flush();
  expect(sent(a,"OPEN")).toHaveLength(0);
  await vi.advanceTimersByTimeAsync(4_001);
  expect(v.disconnect).toHaveBeenCalled();expect(sent(a,"STATE").at(-1).suppressed).toBe(false);
});

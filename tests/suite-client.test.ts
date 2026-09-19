// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { createSuiteClient } from "../src/shared/suite-dock/client";
import { AARRE_ID, SUITE_DOCK_PORT } from "../src/shared/suite-dock/contract";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
it("finishes local teardown even when uninstall has invalidated both runtime ports", async () => {
  vi.useFakeTimers();
  const media = { addEventListener: vi.fn(), removeEventListener: vi.fn(), matches: false };
  vi.stubGlobal("matchMedia", () => media);
  const disconnect = vi.fn(() => { throw new Error("Extension context invalidated."); });
  vi.stubGlobal("chrome", { runtime: { id: "nexalign", getManifest: () => ({}), sendMessage: async () => null, connect: () => ({
    onDisconnect: { addListener: vi.fn() }, onMessage: { addListener: vi.fn() },
    postMessage: vi.fn(), disconnect,
  }) } });
  const client = createSuiteClient("nexalign", {
    state: vi.fn(), theme: vi.fn(), retire: vi.fn(), open: vi.fn(), close: vi.fn(), error: vi.fn(),
  });
  for (let i = 0; i < 20; i++) await Promise.resolve();
  expect(() => client.destroy()).not.toThrow();
  expect(disconnect).toHaveBeenCalledTimes(2);
  expect(media.removeEventListener).toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it("keeps a merged dock during worker reconnection and delivers a queued click once", async () => {
  vi.useFakeTimers();
  const event = () => { const callbacks: ((message?: any) => void)[] = []; return { addListener: (fn: (message?: any) => void) => callbacks.push(fn), emit: (value?: any) => callbacks.forEach(fn => fn(value)) }; };
  const ports: any[] = [];
  vi.stubGlobal('matchMedia', () => ({ addEventListener: vi.fn(), removeEventListener: vi.fn(), matches: false }));
  vi.stubGlobal('chrome', { runtime: { id: AARRE_ID, getManifest: () => ({}), connect: ({ name }: { name: string }) => {
    const port = { name, onMessage: event(), onDisconnect: event(), postMessage: vi.fn(), disconnect: vi.fn() }; ports.push(port); return port;
  } } });
  const state = vi.fn(), ready = vi.fn();
  const client = createSuiteClient('aarre', { state, ready, theme: vi.fn(), retire: vi.fn(), open: vi.fn(), close: vi.fn(), error: vi.fn() });
  client.enabled(true); await vi.advanceTimersByTimeAsync(0);
  const original = ports.find(port => port.name === SUITE_DOCK_PORT);
  const merged = { type: 'STATE', paired: true, members: ['aarre', 'nexalign', 'nexcatcher'], active: null };
  original.onMessage.emit(merged); await vi.advanceTimersByTimeAsync(301);
  expect(state).toHaveBeenCalledTimes(1); expect(ready.mock.calls).toEqual([[false], [true]]);
  original.onDisconnect.emit();
  expect(client.activate('nexcatcher')).toBe(true);
  await vi.advanceTimersByTimeAsync(151);
  const renewed = ports.filter(port => port.name === SUITE_DOCK_PORT).at(-1);
  expect(renewed).not.toBe(original);
  renewed.onMessage.emit({ ...merged, paired: false, members: ['aarre'] });
  await vi.advanceTimersByTimeAsync(500); expect(state).toHaveBeenCalledTimes(1);
  renewed.onMessage.emit(merged);
  expect(state.mock.calls.every(([value]) => value.members.length === 3)).toBe(true);
  expect(renewed.postMessage.mock.calls.filter(([value]: any[]) => value.type === 'REQUEST')).toEqual([[{ type: 'REQUEST', app: 'nexcatcher' }]]);
  client.destroy(); expect(vi.getTimerCount()).toBe(0);
});

// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { createSuiteClient } from "../src/shared/suite-dock/client";

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

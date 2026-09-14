// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it("keeps the shared preference when a stale cloud theme arrives after startup", async () => {
  vi.resetModules();
  let change!: (changes: object, area: string) => void;
  const latest = { mode: "dark", clock: 100, writer: "nexalign", id: "latest-choice" };
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: vi.fn() }));
  vi.stubGlobal("chrome", { storage: {
    local: { get: async () => ({ "nex-suite:theme:v1": latest }), set: vi.fn() },
    onChanged: { addListener: (listener: typeof change) => { change = listener; } },
  } });
  const { initializeTheme } = await import("../src/lib/theme");
  initializeTheme(); await Promise.resolve();
  expect(document.documentElement.dataset.theme).toBe("dark");
  change({ "aarre:theme-sync:v1": { newValue: "light" } }, "local");
  expect(document.documentElement.dataset.theme).toBe("dark");
  change({ "nex-suite:theme:v1": { newValue: { ...latest, mode: "light", clock: 101, writer: "aarre" } } }, "local");
  expect(document.documentElement.dataset.theme).toBe("light");
  change({ "nex-suite:theme:v1": { newValue: latest } }, "local");
  expect(document.documentElement.dataset.theme).toBe("light");
});

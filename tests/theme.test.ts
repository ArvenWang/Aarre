// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyTheme,
  initializeTheme,
  THEME_SYNC_STORAGE_KEY
} from "../src/lib/theme";

let values: Record<string, unknown>;

beforeEach(() => {
  values = {};
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
  vi.stubGlobal("chrome", {
    storage: {
      local: {
        get: async (key: string) => ({ [key]: values[key] }),
        set: async (next: Record<string, unknown>) => Object.assign(values, next)
      }
    }
  });
});

describe("cloud-restorable theme", () => {
  it("does not overwrite a restored cloud theme with the stale local value during startup", async () => {
    window.localStorage.setItem("aarre:theme", "light");
    values[THEME_SYNC_STORAGE_KEY] = "dark";
    expect(initializeTheme()).toBe("light");
    await Promise.resolve();
    await Promise.resolve();
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(values[THEME_SYNC_STORAGE_KEY]).toBe("dark");
  });

  it("persists an explicit user theme in both UI-local and cloud-sync storage", async () => {
    applyTheme("dark");
    await Promise.resolve();
    expect(window.localStorage.getItem("aarre:theme")).toBe("dark");
    expect(values[THEME_SYNC_STORAGE_KEY]).toBe("dark");
  });
});

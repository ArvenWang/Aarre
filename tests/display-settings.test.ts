import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getDisplaySettings,
  saveDisplaySettings
} from "../src/lib/display-settings";

let values: Record<string, unknown>;

beforeEach(() => {
  values = {};
  vi.stubGlobal("chrome", {
    storage: {
      local: {
        get: async (key: string) => ({ [key]: values[key] }),
        set: async (next: Record<string, unknown>) => {
          Object.assign(values, next);
        }
      }
    }
  });
});

describe("display settings", () => {
  it("为单次扫描提供真实可持久化的费用上限", async () => {
    expect((await getDisplaySettings()).scanCostLimitCny).toBe(10);
    expect(
      (await saveDisplaySettings({ scanCostLimitCny: 0 })).scanCostLimitCny
    ).toBe(0.01);
    expect((await getDisplaySettings()).scanCostLimitCny).toBe(0.01);
    expect(
      (await saveDisplaySettings({ scanCostLimitCny: 20_000 }))
        .scanCostLimitCny
    ).toBe(10_000);
  });
});

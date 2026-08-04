import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getDisplaySettings,
  PAGE_SNAPSHOT_ORIGINS,
  requestPageSnapshotPermission,
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
  it("默认开启公共图标补全，并允许用户持久关闭", async () => {
    expect((await getDisplaySettings()).publicFaviconFallback).toBe(true);
    const saved = await saveDisplaySettings({ publicFaviconFallback: false });
    expect(saved.publicFaviconFallback).toBe(false);
    expect((await getDisplaySettings()).publicFaviconFallback).toBe(false);
  });

  it("恢复旧版云端显示字段时保留本机公共图标隐私选择", async () => {
    await saveDisplaySettings({ publicFaviconFallback: false });
    const restored = await saveDisplaySettings({
      listCoverStyle: "page",
      pageSnapshotsEnabled: true,
      snapshotExcludedHosts: ["private.example.com"],
      scanCostLimitCny: 8
    });
    expect(restored.publicFaviconFallback).toBe(false);
  });

  it("迁移旧版隐藏的截图关闭值，完整增强层始终启用截图", async () => {
    values["aarre:display-settings"] = {
      pageSnapshotsEnabled: false,
      snapshotExcludedHosts: ["private.example.com"]
    };
    const settings = await getDisplaySettings();
    expect(settings.pageSnapshotsEnabled).toBe(true);
    expect(settings.snapshotExcludedHosts).toEqual(["private.example.com"]);
    expect(
      (
        values["aarre:display-settings"] as {
          pageSnapshotsEnabled: boolean;
        }
      ).pageSnapshotsEnabled
    ).toBe(true);

    const saved = await saveDisplaySettings({
      pageSnapshotsEnabled: false
    });
    expect(saved.pageSnapshotsEnabled).toBe(true);
  });

  it("已有必需网页权限时不再发起运行时权限请求", async () => {
    const request = vi.fn(async () => true);
    vi.stubGlobal("chrome", {
      storage: {
        local: {
          get: async (key: string) => ({ [key]: values[key] }),
          set: async (next: Record<string, unknown>) => {
            Object.assign(values, next);
          }
        }
      },
      permissions: {
        contains: vi.fn(async () => true),
        request
      }
    });
    await expect(requestPageSnapshotPermission()).resolves.toBe(true);
    expect(request).not.toHaveBeenCalled();
  });

  it("兼容升级时只请求 captureVisibleTab 认可的 all_urls 权限", async () => {
    const request = vi.fn(async () => true);
    vi.stubGlobal("chrome", {
      storage: {
        local: {
          get: async (key: string) => ({ [key]: values[key] }),
          set: async (next: Record<string, unknown>) => {
            Object.assign(values, next);
          }
        }
      },
      permissions: {
        contains: vi.fn(async () => false),
        request
      }
    });

    await expect(requestPageSnapshotPermission()).resolves.toBe(true);
    expect(PAGE_SNAPSHOT_ORIGINS).toEqual(["<all_urls>"]);
    expect(request).toHaveBeenCalledWith({
      origins: ["<all_urls>"]
    });
  });

  it("在设计预览缺少 contains 时不把 TypeError 抛给界面", async () => {
    const request = vi.fn(async () => true);
    vi.stubGlobal("chrome", {
      storage: {
        local: {
          get: async (key: string) => ({ [key]: values[key] }),
          set: async (next: Record<string, unknown>) => {
            Object.assign(values, next);
          }
        }
      },
      permissions: {
        request
      }
    });

    await expect(requestPageSnapshotPermission()).resolves.toBe(true);
    expect(request).toHaveBeenCalledWith({
      origins: ["<all_urls>"]
    });
  });

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

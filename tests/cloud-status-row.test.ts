import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { statusText } from "../src/ui/sidepanel/components/CloudStatusRow";
import type { SyncStatus } from "../src/lib/sync-engine";
import { readAllSources } from "./source-test-utils";

const base: SyncStatus = {
  phase: "idle",
  current: 0,
  total: 0,
  lastSyncedAt: null,
  error: null,
  nextRetryAt: null,
};

describe("cloud status row", () => {
  it("renders user-facing text for every sync phase", () => {
    expect(statusText({ ...base, phase: "paused" })).toBe("未登录");
    expect(statusText({ ...base, phase: "pulling", current: 12, total: 48 })).toBe("正在同步 · 12/48");
    expect(statusText({ ...base, phase: "assets-up", current: 3, total: 20 })).toBe("正在上传封面 · 3/20");
    expect(statusText({ ...base, phase: "assets-down", current: 4, total: 20 })).toBe("正在下载封面 · 4/20");
    expect(statusText({ ...base, phase: "error", error: "网络超时" })).toContain("同步失败 · 网络超时");
  });

  it("uses message subscription, never one-second polling", async () => {
    const [hook, allSidepanelSources, row] = await Promise.all([
      readFile(new URL("../src/ui/sidepanel/hooks/use-sync-status.ts", import.meta.url), "utf8"),
      readAllSources(new URL("../src/ui/sidepanel/", import.meta.url)),
      readFile(new URL("../src/ui/sidepanel/components/CloudStatusRow.tsx", import.meta.url), "utf8"),
    ]);
    expect(hook).toContain('event.type === "SYNC_STATUS"');
    expect(hook).toContain("chrome.runtime.onMessage.addListener");
    expect(allSidepanelSources).not.toContain("setInterval(refreshCloudState");
    expect(row).toContain("usage.usageRatio >= 0.8");
    expect(row).not.toContain("scope");
  });
});

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  statusText,
  syncIsActive,
} from "../src/ui/sidepanel/components/CloudStatusRow";
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
    expect(statusText({ ...base, phase: "paused" })).toBe("同步已暂停");
    expect(statusText({ ...base, phase: "pulling", current: 12, total: 48 })).toBe("正在同步数据 · 12/48");
    expect(statusText({ ...base, phase: "assets-up", current: 3, total: 20 })).toBe("正在同步数据 · 3/20");
    expect(statusText({ ...base, phase: "assets-down", current: 4, total: 20 })).toBe("正在同步数据 · 4/20");
    expect(statusText({ ...base, phase: "error", error: "网络超时" })).toBe("同步失败");
    expect(statusText({
      ...base,
      phase: "error",
      error: "网络超时",
      nextRetryAt: new Date(Date.now() + 60_000).toISOString(),
    })).toContain("同步失败 ·");
  });

  it("only treats transfer phases as active", () => {
    for (const phase of ["pulling", "pushing", "assets-up", "assets-down"] as const) {
      expect(syncIsActive({ ...base, phase })).toBe(true);
    }
    expect(syncIsActive({ ...base, phase: "idle" })).toBe(false);
    expect(syncIsActive({ ...base, phase: "error" })).toBe(false);
    expect(syncIsActive({ ...base, phase: "paused" })).toBe(false);
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
    expect(row).toContain('className="cloud-status-actions"');
    expect(row).toContain('variant="danger-quiet"');
    expect(row).toContain('aria-live="polite"');
    expect(row).toContain('className="cloud-status-progress"');
    expect(row).not.toContain("aria-expanded");
    expect(row).not.toContain("setExpanded");
    expect(row).not.toContain("scope");
  });
});

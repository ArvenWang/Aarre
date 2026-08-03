import type { ResourceRecord } from "../../lib/types";
import { readImmediateSnapshotTarget, removeImmediateSnapshotTarget } from "../snapshots/target-store";
import type { PageSnapshotScheduleOptions } from "../snapshots/capture";

export function createManualSnapshotHelpers(dependencies: {
  clearPageSnapshotTimer(tabId: number): void;
  schedulePageSnapshotForTab(tab: chrome.tabs.Tab, options: PageSnapshotScheduleOptions): boolean;
}) {
  async function prepareManualSnapshotTarget(tabId: number): Promise<void> {
    const existingTarget = await readImmediateSnapshotTarget(tabId);
    if (existingTarget?.trigger === "batch_backfill") {
      throw new Error("当前标签页正在执行批量补拍，请等待该任务完成。");
    }
    if (existingTarget) {
      dependencies.clearPageSnapshotTimer(tabId);
      await removeImmediateSnapshotTarget(tabId, existingTarget);
    }
  }
  function scheduleManualSnapshot(tab: chrome.tabs.Tab, resource: ResourceRecord): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const scheduled = dependencies.schedulePageSnapshotForTab(tab, {
        delayMs: 0, snapshotUrl: resource.canonicalUrl,
        resourceKey: resource.resourceKey, showToast: true,
        refreshExisting: true, trigger: "manual_refresh", onSettled: resolve,
      });
      if (!scheduled) resolve(false);
    });
  }
  return { prepareManualSnapshotTarget, scheduleManualSnapshot };
}

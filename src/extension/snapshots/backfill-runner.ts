import {
  SNAPSHOT_BACKFILL_CONCURRENCY,
  recordSnapshotBackfillOutcome,
  type SnapshotBackfillLease,
  type SnapshotBackfillOutcome
} from "../../lib/snapshot-backfill";
import { DomainRateLimiter } from "../../lib/scan-scheduler";
import { getLocalResource, getPageSnapshot } from "../../lib/storage";
import type { ResourceRecord } from "../../lib/types";
import {
  clearSnapshotBackfillTimeout,
  scheduleSnapshotBackfillTimeout
} from "../lifecycle/alarms";
import type { BackfillRuntime } from "./backfill-runtime";
import {
  getStoredSnapshotBackfill,
  mutateStoredSnapshotBackfill,
  publicSnapshotBackfill,
  snapshotBackfillLeaseFromWorker,
  snapshotBackfillWorkerForId,
  type StoredSnapshotBackfillJob,
  type StoredSnapshotBackfillWorker
} from "./backfill-store";
import {
  removeImmediateSnapshotTarget,
  type ImmediatePageSnapshotTarget
} from "./target-store";

const BATCH_PAGE_SNAPSHOT_DELAY_MS = 300;
const SNAPSHOT_BACKFILL_HOST_INTERVAL_MS = 1_000;

interface BackfillProtectionContext {
  pageSnapshotsEnabled: boolean;
  excludedHosts: string[];
}

interface BackfillRunnerDependencies<
  TProtectionContext extends BackfillProtectionContext
> {
  runtime: BackfillRuntime;
  clearPageSnapshotTimer(tabId: number): void;
  prepareImmediateSnapshotTargetForNavigation(
    tabId: number,
    resource: ResourceRecord,
    targetUrl: string,
    trigger: "batch_backfill",
    showToast: boolean,
    lease: SnapshotBackfillLease
  ): Promise<ImmediatePageSnapshotTarget | undefined>;
  rememberImmediateSnapshotTarget(
    tab: chrome.tabs.Tab,
    snapshotUrl: string,
    delayMs: number,
    showToast: boolean,
    resourceKey: string,
    documentId: string | undefined,
    trigger: "batch_backfill",
    lease: SnapshotBackfillLease
  ): Promise<unknown>;
  resourceMatchesLoadedUrl(resource: ResourceRecord, loadedUrl: string): boolean;
  scheduleImmediateSnapshotIfReady(tab: chrome.tabs.Tab): Promise<boolean>;
  getPrivacyProtectionContext(): Promise<TProtectionContext>;
  resourceProtectionState(
    resource: Pick<
      ResourceRecord,
      "resourceKey" | "nativeBookmarkIds" | "url"
    >,
    context: TProtectionContext,
    loadedUrl?: string
  ): { protected: boolean; userProtected: boolean };
  errorMessage(error: unknown): string;
}

export interface BackfillRunner {
  cleanupSnapshotBackfillRuntime(
    job: StoredSnapshotBackfillJob,
    closeTab: boolean
  ): Promise<void>;
  recordSnapshotBackfillItem(
    workerId: number,
    outcome: SnapshotBackfillOutcome,
    message?: string,
    expected?: {
      jobId: string;
      resourceKey: string;
      leaseToken?: string;
    }
  ): Promise<StoredSnapshotBackfillJob>;
  navigateSnapshotBackfillWorker(
    workerId: number,
    job: StoredSnapshotBackfillJob,
    resource: ResourceRecord,
    retry: boolean
  ): Promise<"scheduled" | "waiting" | "settled">;
  ensureSnapshotBackfillWorkerTabs(): Promise<StoredSnapshotBackfillJob>;
  driveSnapshotBackfill(): Promise<void>;
}

export function createBackfillRunner<
  TProtectionContext extends BackfillProtectionContext
>(
  dependencies: BackfillRunnerDependencies<TProtectionContext>
): BackfillRunner {
  const rateLimiter = new DomainRateLimiter(
    SNAPSHOT_BACKFILL_HOST_INTERVAL_MS
  );
  let driving = false;
  const workerDriving = new Set<number>();
  let tabProvisioning: Promise<void> | null = null;

  async function cleanupSnapshotBackfillRuntime(
    job: StoredSnapshotBackfillJob,
    closeTab: boolean
  ): Promise<void> {
    await dependencies.runtime.invalidateSnapshotBackfillCapture(job);
    if (closeTab) {
      await Promise.all(
        job.workers
          .filter((worker) => typeof worker.tabId === "number")
          .map((worker) =>
            chrome.tabs.remove(worker.tabId!).catch(() => undefined)
          )
      );
      await mutateStoredSnapshotBackfill((current) => {
        if (
          current.id !== job.id ||
          !["completed", "cancelled", "failed"].includes(current.state)
        ) {
          return;
        }
        current.workers.forEach((worker) => {
          worker.tabId = undefined;
          worker.windowId = undefined;
        });
        current.updatedAt = new Date().toISOString();
      });
    }
  }

  async function recordSnapshotBackfillItem(
    workerId: number,
    outcome: SnapshotBackfillOutcome,
    message?: string,
    expected?: {
      jobId: string;
      resourceKey: string;
      leaseToken?: string;
    }
  ): Promise<StoredSnapshotBackfillJob> {
    let recorded = false;
    let recordedLease: SnapshotBackfillLease | undefined;
    const next = await mutateStoredSnapshotBackfill((job) => {
      const worker = snapshotBackfillWorkerForId(job, workerId);
      const resourceKey = worker?.currentResourceKey;
      if (
        job.state !== "running" ||
        !worker ||
        !resourceKey ||
        (expected &&
          (job.id !== expected.jobId ||
            worker.id !== workerId ||
            resourceKey !== expected.resourceKey ||
            (expected.leaseToken !== undefined &&
              worker.currentLease !== expected.leaseToken)))
      ) {
        return { ...job };
      }
      recordedLease = snapshotBackfillLeaseFromWorker(job.id, worker);
      const status = recordSnapshotBackfillOutcome(
        publicSnapshotBackfill(job),
        outcome,
        outcome === "failed" && message
          ? {
              resourceKey,
              title: worker.currentTitle || "网页封面",
              message
            }
          : undefined,
        new Date().toISOString()
      );
      Object.assign(job, status);
      worker.currentResourceKey = undefined;
      worker.currentTitle = "";
      worker.currentAttempt = 0;
      worker.currentLease = undefined;
      recorded = true;
      return { ...job };
    });
    if (recordedLease) await clearSnapshotBackfillTimeout(recordedLease);
    if (recorded && next.state === "completed") {
      await cleanupSnapshotBackfillRuntime(next, true);
    }
    return next;
  }

  async function navigateSnapshotBackfillWorker(
    workerId: number,
    job: StoredSnapshotBackfillJob,
    resource: ResourceRecord,
    retry: boolean
  ): Promise<"scheduled" | "waiting" | "settled"> {
    const worker = snapshotBackfillWorkerForId(job, workerId);
    if (!worker || typeof worker.tabId !== "number") {
      throw new Error("补拍标签页不存在。");
    }
    const targetTab = await dependencies.runtime.snapshotBackfillTargetTab(
      job,
      workerId
    );
    if (!targetTab) return "waiting";

    return rateLimiter.run(resource.url, async () => {
      const lease = await dependencies.runtime.reserveSnapshotBackfillAttempt(
        workerId,
        job,
        resource,
        retry
      );
      if (!lease) return "waiting";
      let prepared: ImmediatePageSnapshotTarget | undefined;
      try {
        prepared =
          await dependencies.prepareImmediateSnapshotTargetForNavigation(
            worker.tabId!,
            resource,
            resource.url,
            "batch_backfill",
            false,
            lease
          );
        if (!prepared) {
          await recordSnapshotBackfillItem(workerId, "skipped", undefined, {
            jobId: lease.jobId,
            resourceKey: lease.resourceKey,
            leaseToken: lease.token
          });
          return "settled";
        }
        if (!(await dependencies.runtime.snapshotBackfillAllowsCapture(lease))) {
          await removeImmediateSnapshotTarget(worker.tabId!, prepared).catch(
            () => undefined
          );
          return "waiting";
        }
        await scheduleSnapshotBackfillTimeout(lease);
        let navigated: chrome.tabs.Tab;
        if (
          retry &&
          targetTab.url &&
          dependencies.resourceMatchesLoadedUrl(resource, targetTab.url)
        ) {
          await chrome.tabs.reload(worker.tabId!);
          navigated = await chrome.tabs.get(worker.tabId!);
        } else {
          const updated = await chrome.tabs.update(worker.tabId!, {
            url: resource.url
          });
          if (!updated) throw new Error("Chrome 未能打开待补拍网页。");
          navigated = updated;
        }
        await dependencies.rememberImmediateSnapshotTarget(
          navigated,
          resource.canonicalUrl,
          BATCH_PAGE_SNAPSHOT_DELAY_MS,
          false,
          resource.resourceKey,
          undefined,
          "batch_backfill",
          lease
        );
        return "scheduled";
      } catch (error) {
        if (prepared) {
          await removeImmediateSnapshotTarget(worker.tabId!, prepared).catch(
            () => undefined
          );
        }
        await recordSnapshotBackfillItem(
          workerId,
          "failed",
          dependencies.errorMessage(error),
          {
            jobId: lease.jobId,
            resourceKey: lease.resourceKey,
            leaseToken: lease.token
          }
        );
        return "settled";
      }
    });
  }

  async function claimSnapshotBackfillWorker(
    workerId: number
  ): Promise<StoredSnapshotBackfillWorker | undefined> {
    return mutateStoredSnapshotBackfill((job) => {
      if (job.state !== "running") return undefined;
      const worker = snapshotBackfillWorkerForId(job, workerId);
      if (
        !worker ||
        worker.currentResourceKey ||
        job.nextIndex >= job.resourceKeys.length
      ) {
        return undefined;
      }
      const resourceKey = job.resourceKeys[job.nextIndex]!;
      job.nextIndex += 1;
      worker.currentResourceKey = resourceKey;
      worker.currentTitle = "检查网页";
      worker.currentAttempt = 0;
      worker.currentLease = undefined;
      job.updatedAt = new Date().toISOString();
      return { ...worker };
    });
  }

  async function ensureSnapshotBackfillWorkerTabs(): Promise<StoredSnapshotBackfillJob> {
    if (tabProvisioning) {
      await tabProvisioning;
      return getStoredSnapshotBackfill();
    }
    const provision = (async () => {
      const initial = await getStoredSnapshotBackfill();
      if (!["running", "waiting_focus"].includes(initial.state)) return;
      const missing: Array<{
        workerId: number;
        previousTabId?: number;
        previousLease?: SnapshotBackfillLease;
      }> = [];
      for (const worker of initial.workers) {
        if (
          await dependencies.runtime.snapshotBackfillTargetTab(
            initial,
            worker.id
          )
        ) {
          continue;
        }
        missing.push({
          workerId: worker.id,
          previousTabId: worker.tabId,
          previousLease: snapshotBackfillLeaseFromWorker(initial.id, worker)
        });
      }
      if (!missing.length) return;

      const created: chrome.tabs.Tab[] = [];
      try {
        for (const item of missing) {
          const tab = await chrome.tabs.create({ active: false });
          if (typeof tab.id !== "number" || typeof tab.windowId !== "number") {
            throw new Error("Chrome 未能创建补拍标签页。");
          }
          created.push((await chrome.tabs.update(tab.id, { muted: true })) || tab);
        }
        let applied = false;
        await mutateStoredSnapshotBackfill((current) => {
          if (
            current.id !== initial.id ||
            !["running", "waiting_focus"].includes(current.state)
          ) {
            return;
          }
          for (const [index, item] of missing.entries()) {
            const worker = snapshotBackfillWorkerForId(current, item.workerId);
            const tab = created[index];
            if (!worker || !tab || typeof tab.id !== "number") continue;
            worker.tabId = tab.id;
            worker.windowId = tab.windowId;
            worker.currentLease = undefined;
            applied = true;
          }
          current.updatedAt = new Date().toISOString();
        });
        if (!applied) {
          await Promise.all(
            created.map((tab) =>
              typeof tab.id === "number"
                ? chrome.tabs.remove(tab.id).catch(() => undefined)
                : Promise.resolve()
            )
          );
          return;
        }
        await Promise.all(
          missing.map(async (item) => {
            if (item.previousTabId !== undefined) {
              dependencies.clearPageSnapshotTimer(item.previousTabId);
              await removeImmediateSnapshotTarget(item.previousTabId).catch(
                () => undefined
              );
            }
            if (item.previousLease) {
              await clearSnapshotBackfillTimeout(item.previousLease);
            }
          })
        );
      } catch (error) {
        await Promise.all(
          created.map((tab) =>
            typeof tab.id === "number"
              ? chrome.tabs.remove(tab.id).catch(() => undefined)
              : Promise.resolve()
          )
        );
        throw error;
      }
    })();
    tabProvisioning = provision;
    try {
      await provision;
    } finally {
      tabProvisioning = null;
    }
    return getStoredSnapshotBackfill();
  }

  async function processSnapshotBackfillWorker(
    workerId: number
  ): Promise<"scheduled" | "waiting" | "settled"> {
    let job = await getStoredSnapshotBackfill();
    if (job.state !== "running") return "waiting";
    let worker = snapshotBackfillWorkerForId(job, workerId);
    if (!worker) return "waiting";
    if (!worker.currentResourceKey) {
      await claimSnapshotBackfillWorker(workerId);
      job = await getStoredSnapshotBackfill();
      worker = snapshotBackfillWorkerForId(job, workerId);
      if (!worker?.currentResourceKey) return "waiting";
    }
    const resourceKey = worker.currentResourceKey;
    const resource = await getLocalResource(resourceKey);
    if (!resource?.nativeBookmarkIds.length) {
      await recordSnapshotBackfillItem(workerId, "skipped", "书签已被移除。", {
        jobId: job.id,
        resourceKey
      });
      return "settled";
    }
    const context = await dependencies.getPrivacyProtectionContext();
    if (
      !context.pageSnapshotsEnabled ||
      dependencies.resourceProtectionState(resource, context).protected
    ) {
      await recordSnapshotBackfillItem(
        workerId,
        "skipped",
        "内部、隐私保护或用户排除页面不会截图。",
        { jobId: job.id, resourceKey }
      );
      return "settled";
    }
    if (await getPageSnapshot(resource.canonicalUrl)) {
      await recordSnapshotBackfillItem(workerId, "skipped", undefined, {
        jobId: job.id,
        resourceKey
      });
      return "settled";
    }

    if (worker.currentLease) {
      const targetTab = await dependencies.runtime.snapshotBackfillTargetTab(
        job,
        workerId
      );
      if (
        targetTab?.status === "complete" &&
        targetTab.url &&
        dependencies.resourceMatchesLoadedUrl(resource, targetTab.url)
      ) {
        const lease = snapshotBackfillLeaseFromWorker(job.id, worker);
        if (lease) {
          await dependencies.rememberImmediateSnapshotTarget(
            targetTab,
            resource.canonicalUrl,
            BATCH_PAGE_SNAPSHOT_DELAY_MS,
            false,
            resource.resourceKey,
            undefined,
            "batch_backfill",
            lease
          );
          await scheduleSnapshotBackfillTimeout(lease);
          void dependencies.scheduleImmediateSnapshotIfReady(targetTab);
          return "scheduled";
        }
      }
      return "waiting";
    }

    try {
      return await navigateSnapshotBackfillWorker(workerId, job, resource, false);
    } catch (error) {
      await recordSnapshotBackfillItem(
        workerId,
        "failed",
        dependencies.errorMessage(error),
        { jobId: job.id, resourceKey }
      );
      return "settled";
    }
  }

  async function driveSnapshotBackfill(): Promise<void> {
    if (driving) return;
    driving = true;
    try {
      let job = await getStoredSnapshotBackfill();
      if (job.state === "waiting_focus") {
        await mutateStoredSnapshotBackfill((current) => {
          if (current.state === "waiting_focus") {
            current.state = "running";
            current.updatedAt = new Date().toISOString();
          }
        });
        job = await getStoredSnapshotBackfill();
      }
      if (job.state !== "running") return;
      await ensureSnapshotBackfillWorkerTabs();

      for (
        let round = 0;
        round < SNAPSHOT_BACKFILL_CONCURRENCY + 1;
        round += 1
      ) {
        job = await getStoredSnapshotBackfill();
        if (job.state !== "running") return;
        const pending: Array<
          Promise<"scheduled" | "waiting" | "settled">
        > = [];
        for (const worker of job.workers) {
          if (workerDriving.has(worker.id)) continue;
          if (
            !worker.currentResourceKey &&
            job.nextIndex >= job.resourceKeys.length
          ) {
            continue;
          }
          if (worker.currentResourceKey && worker.currentLease) {
            const target = await dependencies.runtime.snapshotBackfillTargetTab(
              job,
              worker.id
            );
            if (target?.status !== "complete") continue;
          }
          workerDriving.add(worker.id);
          pending.push(
            processSnapshotBackfillWorker(worker.id).finally(() => {
              workerDriving.delete(worker.id);
            })
          );
        }
        if (!pending.length) break;
        const results = await Promise.all(pending);
        if (!results.includes("settled")) break;
      }

      job = await getStoredSnapshotBackfill();
      if (
        job.state === "running" &&
        job.nextIndex >= job.resourceKeys.length &&
        job.workers.every((worker) => !worker.currentResourceKey)
      ) {
        await mutateStoredSnapshotBackfill((current) => {
          if (current.id !== job.id || current.state !== "running") return;
          current.state = "completed";
          current.currentTitle = "";
          current.completedAt = new Date().toISOString();
          current.updatedAt = new Date().toISOString();
        });
        const completed = await getStoredSnapshotBackfill();
        await cleanupSnapshotBackfillRuntime(completed, true);
      }
    } catch (error) {
      const failed = await mutateStoredSnapshotBackfill((current) => {
        if (
          current.state !== "running" &&
          current.state !== "waiting_focus"
        ) {
          return { ...current };
        }
        current.state = "failed";
        current.currentTitle = "";
        current.completedAt = new Date().toISOString();
        current.updatedAt = new Date().toISOString();
        current.errors = [
          ...current.errors,
          {
            resourceKey: "",
            title: "批量补拍",
            message: dependencies.errorMessage(error)
          }
        ].slice(-20);
        return { ...current };
      });
      if (failed.state === "failed") {
        await cleanupSnapshotBackfillRuntime(failed, true).catch(
          () => undefined
        );
      }
    } finally {
      driving = false;
    }
  }

  return {
    cleanupSnapshotBackfillRuntime,
    recordSnapshotBackfillItem,
    navigateSnapshotBackfillWorker,
    ensureSnapshotBackfillWorkerTabs,
    driveSnapshotBackfill
  };
}

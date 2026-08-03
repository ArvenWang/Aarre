import {
  snapshotBackfillLeaseAllowsCapture,
  snapshotBackfillStateAfterFocusCheck,
  type SnapshotBackfillLease
} from "../../lib/snapshot-backfill";
import type { ResourceRecord } from "../../lib/types";
import {
  clearSnapshotBackfillTimeouts,
  scheduleSnapshotBackfillTimeout
} from "../lifecycle/alarms";
import {
  getStoredSnapshotBackfill,
  mutateStoredSnapshotBackfill,
  snapshotBackfillLeaseFromWorker,
  snapshotBackfillWorkerForId,
  snapshotBackfillWorkerForTab,
  type StoredSnapshotBackfillJob
} from "./backfill-store";
import { removeImmediateSnapshotTarget } from "./target-store";

const SNAPSHOT_BACKFILL_READY_TIMEOUT_MINUTES = 0.75;

interface BackfillRuntimeDependencies {
  clearPageSnapshotTimer(tabId: number): void;
}

export interface BackfillRuntime {
  snapshotBackfillTargetTab(
    job: StoredSnapshotBackfillJob,
    workerId: number
  ): Promise<chrome.tabs.Tab | null>;
  isBatchBackfillTab(tabId: number): Promise<boolean>;
  resetSnapshotBackfillTimeoutForTab(tabId: number): Promise<void>;
  invalidateSnapshotBackfillCapture(
    job: Pick<StoredSnapshotBackfillJob, "id" | "workers">
  ): Promise<void>;
  reserveSnapshotBackfillAttempt(
    workerId: number,
    expected: StoredSnapshotBackfillJob,
    resource: ResourceRecord,
    forceNewLease: boolean
  ): Promise<SnapshotBackfillLease | undefined>;
  snapshotBackfillAllowsCapture(
    lease: SnapshotBackfillLease
  ): Promise<boolean>;
  setSnapshotBackfillWaitingFocus(): Promise<void>;
}

export function createBackfillRuntime(
  dependencies: BackfillRuntimeDependencies
): BackfillRuntime {
  async function snapshotBackfillTargetTab(
    job: StoredSnapshotBackfillJob,
    workerId: number
  ): Promise<chrome.tabs.Tab | null> {
    const worker = snapshotBackfillWorkerForId(job, workerId);
    if (
      !worker ||
      typeof worker.tabId !== "number" ||
      typeof worker.windowId !== "number"
    ) {
      return null;
    }
    const tab = await chrome.tabs.get(worker.tabId).catch(() => null);
    // 批量补拍使用 chrome.debugger 对后台标签页截图，不再要求窗口聚焦或
    // 标签活动；用户可以在任务运行时正常使用 Chrome。
    if (!tab || tab.windowId !== worker.windowId || tab.incognito) return null;
    return tab;
  }

  async function isBatchBackfillTab(tabId: number): Promise<boolean> {
    const job = await getStoredSnapshotBackfill();
    return (
      Boolean(snapshotBackfillWorkerForTab(job, tabId)) &&
      ["running", "waiting_focus"].includes(job.state)
    );
  }

  async function resetSnapshotBackfillTimeoutForTab(
    tabId: number
  ): Promise<void> {
    const job = await getStoredSnapshotBackfill();
    const worker = snapshotBackfillWorkerForTab(job, tabId);
    if (
      !worker ||
      job.state !== "running" ||
      !worker.currentLease ||
      !worker.currentResourceKey
    ) {
      return;
    }
    const lease = snapshotBackfillLeaseFromWorker(job.id, worker);
    if (lease) {
      await scheduleSnapshotBackfillTimeout(
        lease,
        SNAPSHOT_BACKFILL_READY_TIMEOUT_MINUTES
      );
    }
  }

  async function invalidateSnapshotBackfillCapture(
    job: Pick<StoredSnapshotBackfillJob, "id" | "workers">
  ): Promise<void> {
    await Promise.all(
      job.workers.map(async (worker) => {
        if (typeof worker.tabId === "number") {
          dependencies.clearPageSnapshotTimer(worker.tabId);
          await removeImmediateSnapshotTarget(worker.tabId).catch(
            () => undefined
          );
        }
      })
    );
    if (job.id) await clearSnapshotBackfillTimeouts(job.id);
  }

  async function reserveSnapshotBackfillAttempt(
    workerId: number,
    expected: StoredSnapshotBackfillJob,
    resource: ResourceRecord,
    forceNewLease: boolean
  ): Promise<SnapshotBackfillLease | undefined> {
    const nextToken = crypto.randomUUID();
    return mutateStoredSnapshotBackfill((current) => {
      if (current.id !== expected.id || current.state !== "running") {
        return undefined;
      }
      const worker = snapshotBackfillWorkerForId(current, workerId);
      const expectedWorker = snapshotBackfillWorkerForId(expected, workerId);
      if (
        !worker ||
        !expectedWorker ||
        worker.currentResourceKey !== resource.resourceKey ||
        worker.tabId !== expectedWorker.tabId ||
        typeof worker.tabId !== "number"
      ) {
        return undefined;
      }
      if (!worker.currentLease || forceNewLease) {
        // 失焦/暂停只会撤销 capture lease，不应消耗网络重试次数。
        // 首次真正导航计一次；只有超时/加载失败的 retry 才继续递增。
        if (forceNewLease || worker.currentAttempt === 0) {
          worker.currentAttempt += 1;
        }
        worker.currentLease = nextToken;
      }
      worker.currentTitle = resource.title || resource.url;
      current.updatedAt = new Date().toISOString();
      return snapshotBackfillLeaseFromWorker(current.id, worker);
    });
  }

  async function snapshotBackfillAllowsCapture(
    lease: SnapshotBackfillLease
  ): Promise<boolean> {
    const job = await getStoredSnapshotBackfill();
    const worker = snapshotBackfillWorkerForId(job, lease.workerId);
    if (!worker) return false;
    return snapshotBackfillLeaseAllowsCapture(
      {
        state: job.state,
        jobId: job.id,
        expectedWorkerId: worker.id,
        currentResourceKey: worker.currentResourceKey,
        expectedTabId: worker.tabId,
        currentLease: worker.currentLease
      },
      lease
    );
  }

  async function setSnapshotBackfillWaitingFocus(): Promise<void> {
    await mutateStoredSnapshotBackfill(async (job) => {
      if (!["running", "waiting_focus"].includes(job.state)) return;
      job.state = snapshotBackfillStateAfterFocusCheck(job.state, false);
      // 立即吊销旧截图 promise 的提交资格。用户很快切回时会生成新 lease，
      // 旧 promise 不能因为状态再次变为 running 而恢复写入权限。
      job.workers.forEach((worker) => {
        worker.currentLease = undefined;
      });
      job.updatedAt = new Date().toISOString();
      await invalidateSnapshotBackfillCapture(job);
    });
  }

  return {
    snapshotBackfillTargetTab,
    isBatchBackfillTab,
    resetSnapshotBackfillTimeoutForTab,
    invalidateSnapshotBackfillCapture,
    reserveSnapshotBackfillAttempt,
    snapshotBackfillAllowsCapture,
    setSnapshotBackfillWaitingFocus
  };
}

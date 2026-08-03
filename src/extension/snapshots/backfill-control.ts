import { snapshotBackfillCandidates } from "../../lib/snapshot-backfill";
import {
  getLocalResource,
  getLocalResources,
  getPageSnapshots
} from "../../lib/storage";
import type { ResourceRecord, SnapshotBackfillStatus } from "../../lib/types";
import type { BackfillRuntime } from "./backfill-runtime";
import type { BackfillRunner } from "./backfill-runner";
import {
  emptyStoredSnapshotBackfill,
  getStoredSnapshotBackfill,
  mutateStoredSnapshotBackfill,
  publicSnapshotBackfill,
  setStoredSnapshotBackfill,
  type StoredSnapshotBackfillJob
} from "./backfill-store";

const SNAPSHOT_BACKFILL_MAX_ATTEMPTS = 2;

interface BackfillProtectionContext {
  pageSnapshotsEnabled: boolean;
  excludedHosts: string[];
  policy: Parameters<typeof snapshotBackfillCandidates>[3];
}

interface BackfillControlDependencies<
  TProtectionContext extends BackfillProtectionContext
> {
  runtime: BackfillRuntime;
  runner: BackfillRunner;
  importNativeBookmarks(): Promise<unknown>;
  getPrivacyProtectionContext(): Promise<TProtectionContext>;
  errorMessage(error: unknown): string;
}

export interface BackfillControl {
  startSnapshotBackfill(): Promise<SnapshotBackfillStatus>;
  getSnapshotBackfillStatus(
    includeCandidateCount?: boolean
  ): Promise<SnapshotBackfillStatus>;
  updateSnapshotBackfillState(
    state: "paused" | "running" | "cancelled"
  ): Promise<SnapshotBackfillStatus>;
  retryOrFailSnapshotBackfillCurrent(
    reason: string,
    expectedTimeout: { jobId: string; token: string }
  ): Promise<void>;
  timeoutOrFailSnapshotBackfillCurrent(
    reason: string,
    expectedTimeout: { jobId: string; token: string }
  ): Promise<void>;
  recoverSnapshotBackfill(): Promise<void>;
}

export function createBackfillControl<
  TProtectionContext extends BackfillProtectionContext
>(
  dependencies: BackfillControlDependencies<TProtectionContext>
): BackfillControl {
  async function currentSnapshotBackfillCandidates(): Promise<
    ResourceRecord[]
  > {
    const [resources, snapshots, context] = await Promise.all([
      getLocalResources(),
      getPageSnapshots(),
      dependencies.getPrivacyProtectionContext()
    ]);
    return context.pageSnapshotsEnabled
      ? snapshotBackfillCandidates(
          resources,
          new Set(snapshots.map((snapshot) => snapshot.canonicalUrl)),
          context.excludedHosts,
          context.policy
        )
      : [];
  }

  async function startSnapshotBackfill(): Promise<SnapshotBackfillStatus> {
    const existing = await getStoredSnapshotBackfill();
    if (["running", "waiting_focus", "paused"].includes(existing.state)) {
      return publicSnapshotBackfill(existing);
    }
    await dependencies.importNativeBookmarks();
    const candidates = await currentSnapshotBackfillCandidates();
    const timestamp = new Date().toISOString();
    const job: StoredSnapshotBackfillJob = {
      ...emptyStoredSnapshotBackfill(),
      id: crypto.randomUUID(),
      state: candidates.length ? "running" : "completed",
      total: candidates.length,
      startedAt: timestamp,
      updatedAt: timestamp,
      ...(candidates.length ? {} : { completedAt: timestamp }),
      resourceKeys: candidates.map((resource) => resource.resourceKey)
    };
    await setStoredSnapshotBackfill(job);
    if (!candidates.length) return publicSnapshotBackfill(job);

    try {
      await dependencies.runner.driveSnapshotBackfill();
      return publicSnapshotBackfill(await getStoredSnapshotBackfill());
    } catch (error) {
      const failed = await mutateStoredSnapshotBackfill((current) => {
        if (current.id !== job.id) return { ...current };
        current.state = "failed";
        current.updatedAt = new Date().toISOString();
        current.completedAt = new Date().toISOString();
        current.errors = [
          ...current.errors,
          {
            resourceKey:
              current.workers.find((worker) => worker.currentResourceKey)
                ?.currentResourceKey || "",
            title:
              current.workers.find((worker) => worker.currentTitle)
                ?.currentTitle || "批量补拍",
            message: dependencies.errorMessage(error)
          }
        ].slice(-20);
        return { ...current };
      });
      await dependencies.runner.cleanupSnapshotBackfillRuntime(failed, true);
      return publicSnapshotBackfill(failed);
    }
  }

  async function getSnapshotBackfillStatus(
    includeCandidateCount = false
  ): Promise<SnapshotBackfillStatus> {
    const status = publicSnapshotBackfill(await getStoredSnapshotBackfill());
    if (!includeCandidateCount) return status;
    if (["running", "waiting_focus", "paused"].includes(status.state)) {
      return {
        ...status,
        candidateCount: Math.max(0, status.total - status.processed)
      };
    }
    return {
      ...status,
      candidateCount: (await currentSnapshotBackfillCandidates()).length
    };
  }

  async function updateSnapshotBackfillState(
    state: "paused" | "running" | "cancelled"
  ): Promise<SnapshotBackfillStatus> {
    let job = await getStoredSnapshotBackfill();
    if (!job.id) throw new Error("当前没有封面补拍任务。");
    if (state === "running") {
      if (!["paused", "waiting_focus", "failed"].includes(job.state)) {
        return publicSnapshotBackfill(job);
      }
      const expectedJobId = job.id;
      let resumed = false;
      job = await mutateStoredSnapshotBackfill((current) => {
        if (
          current.id !== expectedJobId ||
          !["paused", "waiting_focus", "failed"].includes(current.state)
        ) {
          return { ...current };
        }
        current.state = "running";
        current.workers.forEach((worker) => {
          worker.currentLease = undefined;
        });
        current.updatedAt = new Date().toISOString();
        current.completedAt = undefined;
        resumed = true;
        return { ...current };
      });
      if (resumed) {
        void dependencies.runner.driveSnapshotBackfill().catch(
          () => undefined
        );
      }
      return publicSnapshotBackfill(job);
    }

    if (!["running", "waiting_focus", "paused"].includes(job.state)) {
      return publicSnapshotBackfill(job);
    }
    const expectedJobId = job.id;
    let changed = false;
    job = await mutateStoredSnapshotBackfill(async (current) => {
      if (
        current.id !== expectedJobId ||
        !["running", "waiting_focus", "paused"].includes(current.state)
      ) {
        return { ...current };
      }
      current.state = state;
      current.workers.forEach((worker) => {
        worker.currentLease = undefined;
      });
      current.currentTitle = "";
      current.updatedAt = new Date().toISOString();
      if (state === "cancelled") {
        current.completedAt = new Date().toISOString();
      }
      await dependencies.runtime.invalidateSnapshotBackfillCapture(current);
      changed = true;
      return { ...current };
    });
    if (changed && state === "cancelled") {
      await dependencies.runner.cleanupSnapshotBackfillRuntime(job, true);
    }
    return publicSnapshotBackfill(job);
  }

  async function retryOrFailSnapshotBackfillCurrent(
    reason: string,
    expectedTimeout: { jobId: string; token: string }
  ): Promise<void> {
    const job = await getStoredSnapshotBackfill();
    const leaseWorker = job.workers.find(
      (worker) => worker.currentLease === expectedTimeout.token
    );
    if (
      job.state !== "running" ||
      job.id !== expectedTimeout.jobId ||
      !leaseWorker?.currentResourceKey
    ) {
      return;
    }
    const targetTab = await dependencies.runtime.snapshotBackfillTargetTab(
      job,
      leaseWorker.id
    );
    if (!targetTab) return;
    const resource = await getLocalResource(leaseWorker.currentResourceKey);
    if (!resource?.nativeBookmarkIds.length) {
      await dependencies.runner.recordSnapshotBackfillItem(
        leaseWorker.id,
        "skipped",
        "书签已被移除。",
        {
          jobId: job.id,
          resourceKey: leaseWorker.currentResourceKey,
          leaseToken: expectedTimeout.token
        }
      );
      void dependencies.runner.driveSnapshotBackfill();
      return;
    }
    if (leaseWorker.currentAttempt >= SNAPSHOT_BACKFILL_MAX_ATTEMPTS) {
      await dependencies.runner.recordSnapshotBackfillItem(
        leaseWorker.id,
        "failed",
        reason,
        {
          jobId: job.id,
          resourceKey: leaseWorker.currentResourceKey,
          leaseToken: expectedTimeout.token
        }
      );
      void dependencies.runner.driveSnapshotBackfill();
      return;
    }
    try {
      const navigation =
        await dependencies.runner.navigateSnapshotBackfillWorker(
          leaseWorker.id,
          job,
          resource,
          true
        );
      if (navigation === "settled") {
        void dependencies.runner.driveSnapshotBackfill();
      }
    } catch (error) {
      await dependencies.runner.recordSnapshotBackfillItem(
        leaseWorker.id,
        "failed",
        dependencies.errorMessage(error),
        {
          jobId: job.id,
          resourceKey: leaseWorker.currentResourceKey,
          leaseToken: expectedTimeout.token
        }
      );
      void dependencies.runner.driveSnapshotBackfill();
    }
  }

  async function timeoutOrFailSnapshotBackfillCurrent(
    reason: string,
    expectedTimeout: { jobId: string; token: string }
  ): Promise<void> {
    const job = await getStoredSnapshotBackfill();
    const leaseWorker = job.workers.find(
      (worker) => worker.currentLease === expectedTimeout.token
    );
    if (
      job.state !== "running" ||
      job.id !== expectedTimeout.jobId ||
      !leaseWorker?.currentResourceKey
    ) {
      return;
    }
    await dependencies.runner.recordSnapshotBackfillItem(
      leaseWorker.id,
      "failed",
      reason,
      {
        jobId: job.id,
        resourceKey: leaseWorker.currentResourceKey,
        leaseToken: expectedTimeout.token
      }
    );
    void dependencies.runner.driveSnapshotBackfill();
  }

  async function recoverSnapshotBackfill(): Promise<void> {
    const job = await getStoredSnapshotBackfill();
    if (!["running", "waiting_focus"].includes(job.state)) return;
    void dependencies.runner.driveSnapshotBackfill().catch(() => undefined);
  }

  return {
    startSnapshotBackfill,
    getSnapshotBackfillStatus,
    updateSnapshotBackfillState,
    retryOrFailSnapshotBackfillCurrent,
    timeoutOrFailSnapshotBackfillCurrent,
    recoverSnapshotBackfill
  };
}

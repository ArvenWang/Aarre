import {
  getLocalResource,
  getPageSnapshot,
  deletePageSnapshot
} from "../../lib/storage";
import { putCoverSnapshot } from "../../lib/visuals";
import {
  mutateStoredSnapshotBackfill,
  getStoredSnapshotBackfill,
  publicSnapshotBackfill,
  snapshotBackfillWorkerForId
} from "./backfill-store";
import {
  recordSnapshotBackfillOutcome,
  snapshotBackfillLeaseAllowsCapture,
  type SnapshotBackfillLease,
  type SnapshotBackfillOutcome
} from "../../lib/snapshot-backfill";
import { isLoadedSnapshotTab } from "../../lib/page-snapshot";
import { clearSnapshotBackfillTimeout } from "../lifecycle/alarms";
import { removeImmediateSnapshotTarget, type ImmediatePageSnapshotTarget } from "./target-store";
import type { PageSnapshotScheduleOptions } from "./capture";
import type { PageSnapshot, ResourceRecord } from "../../lib/types";
import type { StoredSnapshotBackfillJob } from "./backfill-store";

const SNAPSHOT_BACKFILL_CAPTURE_RETRY_DELAY_MS = 2_000;
const SNAPSHOT_BACKFILL_MAX_CAPTURE_ATTEMPTS = 3;

interface BackfillCommitDependencies {
  getPrivacyProtectionContext(): Promise<unknown>;
  resourceProtectionState(resource: ResourceRecord, context: unknown): { protected: boolean };
  upsertLocalResource(resource: ResourceRecord): Promise<void>;
  completeStoredEnhancementPart(resourceKey: string, part: "snapshot"): Promise<void>;
  cleanupSnapshotBackfillRuntime(job: StoredSnapshotBackfillJob, closeTabs: boolean): Promise<void>;
  driveSnapshotBackfill(): Promise<void>;
  recordSnapshotBackfillItem(workerId: number, outcome: SnapshotBackfillOutcome, message?: string, expected?: { jobId: string; resourceKey: string; leaseToken?: string }): Promise<unknown>;
  capturePageSnapshotForTab(tabId: number, loadedUrl: string, snapshotUrl: string | undefined, options: PageSnapshotScheduleOptions): Promise<boolean>;
  errorMessage(error: unknown): string;
}

export function createBackfillCommit(dependencies: BackfillCommitDependencies) {
  const {
    getPrivacyProtectionContext,
    resourceProtectionState,
    upsertLocalResource,
    completeStoredEnhancementPart,
    cleanupSnapshotBackfillRuntime,
    driveSnapshotBackfill,
    recordSnapshotBackfillItem,
    capturePageSnapshotForTab,
    errorMessage
  } = dependencies;
  const now = () => new Date().toISOString();
interface SnapshotBackfillCommitResult {
  accepted: boolean;
  stored: boolean;
  job?: StoredSnapshotBackfillJob;
}

async function commitSnapshotBackfillCapture(input: {
  lease: SnapshotBackfillLease;
  canonicalUrl: string;
  snapshot: PageSnapshot;
  capturedAt: string;
}): Promise<SnapshotBackfillCommitResult> {
  const result = await mutateStoredSnapshotBackfill(async (job) => {
    const worker = snapshotBackfillWorkerForId(
      job,
      input.lease.workerId
    );
    if (
      !worker ||
      !snapshotBackfillLeaseAllowsCapture(
        {
          state: job.state,
          jobId: job.id,
          expectedWorkerId: worker.id,
          currentResourceKey: worker.currentResourceKey,
          expectedTabId: worker.tabId,
          currentLease: worker.currentLease
        },
        input.lease
      )
    ) {
      return {
        accepted: false,
        stored: false
      } satisfies SnapshotBackfillCommitResult;
    }

    let stored = false;
    let outcome: SnapshotBackfillOutcome = "skipped";
    const resource = await getLocalResource(input.lease.resourceKey);
    const existingSnapshot = await getPageSnapshot(input.canonicalUrl);
    const privacyContext = await getPrivacyProtectionContext();
    if (
      resource?.nativeBookmarkIds.length &&
      !resourceProtectionState(resource, privacyContext).protected &&
      !existingSnapshot
    ) {
      stored = await putCoverSnapshot(resource, input.snapshot, "auto", {
        source: "batch-backfill"
      });
      if (stored) try {
        const latestResource = await getLocalResource(
          input.lease.resourceKey
        );
        const latestPrivacyContext = await getPrivacyProtectionContext();
        if (
          !latestResource?.nativeBookmarkIds.length ||
          resourceProtectionState(
            latestResource,
            latestPrivacyContext
          ).protected
        ) {
          await deletePageSnapshot(input.canonicalUrl);
          stored = false;
        } else {
          await upsertLocalResource({
            ...latestResource,
            snapshotAt: input.capturedAt,
            coverOrigin: latestResource.coverOrigin || "auto",
            coverUpdatedAt: input.capturedAt,
            updatedAt: latestResource.updatedAt
          });
          outcome = "succeeded";
        }
      } catch (error) {
        const currentSnapshot = await getPageSnapshot(
          input.canonicalUrl
        ).catch(() => undefined);
        if (currentSnapshot?.capturedAt === input.capturedAt) {
          await deletePageSnapshot(input.canonicalUrl).catch(
            () => undefined
          );
        }
        throw error;
      }
    }

    const status = recordSnapshotBackfillOutcome(
      publicSnapshotBackfill(job),
      outcome,
      undefined,
      now()
    );
    Object.assign(job, status);
    worker.currentResourceKey = undefined;
    worker.currentTitle = "";
    worker.currentAttempt = 0;
    worker.currentLease = undefined;
    return {
      accepted: true,
      stored,
      job: { ...job }
    } satisfies SnapshotBackfillCommitResult;
  });

  if (!result.accepted || !result.job) return result;
  await clearSnapshotBackfillTimeout(input.lease);
  await completeStoredEnhancementPart(
    input.lease.resourceKey,
    "snapshot"
  );
  if (result.stored) {
    void chrome.runtime
      .sendMessage({
        type: "PAGE_SNAPSHOT_UPDATED",
        canonicalUrl: input.canonicalUrl,
        capturedAt: input.capturedAt
      })
      .catch(() => undefined);
  }
  if (result.job.state === "completed") {
    await cleanupSnapshotBackfillRuntime(result.job, true);
  } else {
    void driveSnapshotBackfill();
  }
  return result;
}

/** 批量补拍遇到 Cloudflare 等安全验证页时立即结算失败并推进队列。 */
async function settleBatchChallenge(
  lease: SnapshotBackfillLease
): Promise<void> {
  await recordSnapshotBackfillItem(
    lease.workerId,
    "failed",
    "网站要求安全验证（如 Cloudflare），无法获取真实页面截图。",
    {
      jobId: lease.jobId,
      resourceKey: lease.resourceKey,
      leaseToken: lease.token
    }
  );
  void driveSnapshotBackfill();
}

async function retryBatchSnapshotCapture(
  tabId: number,
  expectedLoadedUrl: string,
  options: PageSnapshotScheduleOptions,
  target: ImmediatePageSnapshotTarget,
  attempt: number
): Promise<void> {
  await new Promise((resolve) =>
    globalThis.setTimeout(
      resolve,
      SNAPSHOT_BACKFILL_CAPTURE_RETRY_DELAY_MS
    )
  );
  if (!options.backfillLease) return;
  const job = await getStoredSnapshotBackfill();
  const worker = options.backfillLease
    ? snapshotBackfillWorkerForId(job, options.backfillLease.workerId)
    : undefined;
  if (
    !worker ||
    job.state !== "running" ||
    job.id !== options.backfillLease.jobId ||
    worker.currentLease !== options.backfillLease.token ||
    worker.currentResourceKey !== options.backfillLease.resourceKey
  ) {
    // 用户暂停、任务已结算或已推进到下一项时，不再重试旧截图。
    return;
  }
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab || !isLoadedSnapshotTab(tab, expectedLoadedUrl, false)) {
    return;
  }
  let succeeded = false;
  let captureError = "";
  try {
    succeeded = await capturePageSnapshotForTab(
      tabId,
      expectedLoadedUrl,
      options.snapshotUrl,
      {
        resourceKey: options.resourceKey,
        showToast: options.showToast,
        documentId: options.documentId,
        trigger: options.trigger,
        refreshExisting: options.refreshExisting,
        backfillLease: options.backfillLease
      }
    );
  } catch (error) {
    // 注入失败、调试协议拒绝或页面上下文异常都必须进入同一条
    // “重试后结算并推进”路径，不能让一个 rejected Promise 把队列悬住。
    captureError = errorMessage(error);
  }
  if (succeeded) {
    await removeImmediateSnapshotTarget(tabId, target).catch(
      () => undefined
    );
    return;
  }
  if (attempt < SNAPSHOT_BACKFILL_MAX_CAPTURE_ATTEMPTS - 1) {
    void retryBatchSnapshotCapture(
      tabId,
      expectedLoadedUrl,
      options,
      target,
      attempt + 1
    );
    return;
  }
  const latest = await getStoredSnapshotBackfill();
  const latestWorker = snapshotBackfillWorkerForId(
    latest,
    options.backfillLease.workerId
  );
  if (
    latestWorker &&
    latest.state === "running" &&
    latest.id === options.backfillLease.jobId &&
    latestWorker.currentLease === options.backfillLease.token &&
    latestWorker.currentResourceKey === options.backfillLease.resourceKey
  ) {
    await recordSnapshotBackfillItem(
      options.backfillLease.workerId,
      "failed",
      captureError ||
        "页面未能在限时内稳定截图（可能是安全验证页、页面持续跳转或调试通道被占用）。",
      {
        jobId: options.backfillLease.jobId,
        resourceKey: options.backfillLease.resourceKey,
        leaseToken: options.backfillLease.token
      }
    );
    void driveSnapshotBackfill();
  }
}

  return {
    commitSnapshotBackfillCapture,
    settleBatchChallenge,
    retryBatchSnapshotCapture
  };
}

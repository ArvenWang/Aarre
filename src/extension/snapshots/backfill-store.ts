import {
  emptySnapshotBackfillStatus,
  SNAPSHOT_BACKFILL_CONCURRENCY,
  type SnapshotBackfillLease
} from "../../lib/snapshot-backfill";
import type { SnapshotBackfillStatus } from "../../lib/types";

const SNAPSHOT_BACKFILL_KEY = "aarre:snapshot-backfill:v1";

export interface StoredSnapshotBackfillJob extends SnapshotBackfillStatus {
  resourceKeys: string[];
  nextIndex: number;
  workers: StoredSnapshotBackfillWorker[];
  // 兼容 0.4.8 之前的单 worker 持久状态；首次写回后会迁移到 workers。
  currentResourceKey?: string;
  currentAttempt: number;
  currentLease?: string;
  windowId?: number;
}

export interface StoredSnapshotBackfillWorker {
  id: number;
  tabId?: number;
  windowId?: number;
  currentResourceKey?: string;
  currentTitle: string;
  currentAttempt: number;
  currentLease?: string;
}

let snapshotBackfillMutation: Promise<void> = Promise.resolve();

export function snapshotBackfillWorkerForId(
  job: StoredSnapshotBackfillJob,
  workerId: number
): StoredSnapshotBackfillWorker | undefined {
  return job.workers.find((worker) => worker.id === workerId);
}

export function snapshotBackfillWorkerForTab(
  job: StoredSnapshotBackfillJob,
  tabId: number
): StoredSnapshotBackfillWorker | undefined {
  return job.workers.find((worker) => worker.tabId === tabId);
}

export function snapshotBackfillLeaseFromWorker(
  jobId: string,
  worker: StoredSnapshotBackfillWorker
): SnapshotBackfillLease | undefined {
  if (
    !jobId ||
    !worker.currentResourceKey ||
    typeof worker.tabId !== "number" ||
    !worker.currentLease
  ) {
    return undefined;
  }
  return {
    workerId: worker.id,
    jobId,
    resourceKey: worker.currentResourceKey,
    tabId: worker.tabId,
    token: worker.currentLease
  };
}

export function emptySnapshotBackfillWorker(
  id: number
): StoredSnapshotBackfillWorker {
  return {
    id,
    currentTitle: "",
    currentAttempt: 0
  };
}

export function snapshotBackfillWorkers(
  value: Partial<StoredSnapshotBackfillWorker>[] | undefined
): StoredSnapshotBackfillWorker[] {
  return Array.from(
    { length: SNAPSHOT_BACKFILL_CONCURRENCY },
    (_, id) => {
      const raw = value?.find((worker) => worker?.id === id) || value?.[id];
      return {
        ...emptySnapshotBackfillWorker(id),
        ...(raw && typeof raw === "object" ? raw : {}),
        id,
        currentTitle:
          typeof raw?.currentTitle === "string" ? raw.currentTitle : "",
        currentAttempt:
          typeof raw?.currentAttempt === "number" && raw.currentAttempt >= 0
            ? Math.floor(raw.currentAttempt)
            : 0,
        ...(typeof raw?.tabId === "number" ? { tabId: raw.tabId } : {}),
        ...(typeof raw?.windowId === "number"
          ? { windowId: raw.windowId }
          : {}),
        ...(typeof raw?.currentResourceKey === "string"
          ? { currentResourceKey: raw.currentResourceKey }
          : {}),
        ...(typeof raw?.currentLease === "string"
          ? { currentLease: raw.currentLease }
          : {})
      };
    }
  );
}

export function emptyStoredSnapshotBackfill(): StoredSnapshotBackfillJob {
  return {
    ...emptySnapshotBackfillStatus(),
    resourceKeys: [],
    nextIndex: 0,
    workers: Array.from(
      { length: SNAPSHOT_BACKFILL_CONCURRENCY },
      (_, id) => emptySnapshotBackfillWorker(id)
    ),
    currentAttempt: 0
  };
}

export function publicSnapshotBackfill(
  job: StoredSnapshotBackfillJob
): SnapshotBackfillStatus {
  const {
    resourceKeys: _resourceKeys,
    nextIndex: _nextIndex,
    workers: _workers,
    currentResourceKey: _currentResourceKey,
    currentAttempt: _currentAttempt,
    currentLease: _currentLease,
    windowId: _windowId,
    ...status
  } = job;
  const activeWorkers = job.workers.filter(
    (worker) => worker.currentResourceKey
  );
  return {
    ...status,
    concurrency: SNAPSHOT_BACKFILL_CONCURRENCY,
    activeCount: activeWorkers.length,
    currentTitle:
      activeWorkers.length > 1
        ? `正在后台并发补拍 ${activeWorkers.length} 个网页`
        : activeWorkers[0]?.currentTitle || ""
  };
}

export async function getStoredSnapshotBackfill(): Promise<StoredSnapshotBackfillJob> {
  const stored = (await chrome.storage.local.get(SNAPSHOT_BACKFILL_KEY))[
    SNAPSHOT_BACKFILL_KEY
  ];
  if (!stored || typeof stored !== "object") {
    return emptyStoredSnapshotBackfill();
  }
  const value = stored as Partial<StoredSnapshotBackfillJob>;
  const hasWorkers = Array.isArray(value.workers);
  const workers = hasWorkers
    ? snapshotBackfillWorkers(value.workers)
    : snapshotBackfillWorkers([
        {
          id: 0,
          tabId: value.tabId,
          windowId: value.windowId,
          currentResourceKey: value.currentResourceKey,
          currentTitle: value.currentTitle || "",
          currentAttempt: value.currentAttempt || 0,
          currentLease: value.currentLease
        }
      ]);
  const legacyCurrentResource =
    !hasWorkers && typeof value.currentResourceKey === "string";
  const storedNextIndex =
    typeof value.nextIndex === "number" && value.nextIndex >= 0
      ? Math.floor(value.nextIndex)
      : 0;
  return {
    ...emptyStoredSnapshotBackfill(),
    ...value,
    concurrency: SNAPSHOT_BACKFILL_CONCURRENCY,
    requiresForeground: false,
    workers,
    errors: Array.isArray(value.errors) ? value.errors.slice(-20) : [],
    resourceKeys: Array.isArray(value.resourceKeys)
      ? value.resourceKeys.filter(
          (item): item is string => typeof item === "string"
        )
      : [],
    nextIndex: legacyCurrentResource
      ? Math.min(
          Array.isArray(value.resourceKeys) ? value.resourceKeys.length : 0,
          storedNextIndex + 1
        )
      : storedNextIndex,
    currentAttempt:
      typeof value.currentAttempt === "number" && value.currentAttempt >= 0
        ? Math.floor(value.currentAttempt)
        : 0,
    currentLease:
      typeof value.currentLease === "string"
        ? value.currentLease
        : undefined
  };
}

export async function setStoredSnapshotBackfill(
  job: StoredSnapshotBackfillJob
): Promise<void> {
  await chrome.storage.local.set({ [SNAPSHOT_BACKFILL_KEY]: job });
  void chrome.runtime
    .sendMessage({
      type: "SNAPSHOT_BACKFILL_UPDATED",
      status: publicSnapshotBackfill(job)
    })
    .catch(() => undefined);
}

export async function mutateStoredSnapshotBackfill<T>(
  mutate: (job: StoredSnapshotBackfillJob) => T | Promise<T>
): Promise<T> {
  let resolveResult!: (value: T | PromiseLike<T>) => void;
  let rejectResult!: (reason?: unknown) => void;
  const result = new Promise<T>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  snapshotBackfillMutation = snapshotBackfillMutation
    .catch(() => undefined)
    .then(async () => {
      try {
        const job = await getStoredSnapshotBackfill();
        const value = await mutate(job);
        await setStoredSnapshotBackfill(job);
        resolveResult(value);
      } catch (error) {
        rejectResult(error);
      }
    });
  return result;
}

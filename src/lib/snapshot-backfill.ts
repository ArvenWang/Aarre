import { isSnapshotSensitiveUrl } from "./page-snapshot";
import {
  isResourceUserProtected,
  type ProtectionPolicy
} from "./protection";
import { interleaveResourcesByHost } from "./scan-scheduler";
import type {
  ResourceRecord,
  SnapshotBackfillError,
  SnapshotBackfillState,
  SnapshotBackfillStatus
} from "./types";
import { isSupportedPageUrl } from "./url";

export type SnapshotBackfillOutcome =
  | "succeeded"
  | "failed"
  | "skipped";

export const SNAPSHOT_BACKFILL_CONCURRENCY = 3;

export interface SnapshotBackfillLease {
  workerId: number;
  jobId: string;
  resourceKey: string;
  tabId: number;
  token: string;
}

export function snapshotBackfillCaptureAllowed(input: {
  state: SnapshotBackfillState;
  currentResourceKey?: string;
  expectedTabId?: number;
  resourceKey: string;
  tabId: number;
}): boolean {
  return (
    input.state === "running" &&
    input.currentResourceKey === input.resourceKey &&
    input.expectedTabId === input.tabId
  );
}

export function snapshotBackfillLeaseAllowsCapture(
  input: {
    state: SnapshotBackfillState;
    jobId: string;
    expectedWorkerId?: number;
    currentResourceKey?: string;
    expectedTabId?: number;
    currentLease?: string;
  },
  lease: SnapshotBackfillLease
): boolean {
  return (
    input.jobId === lease.jobId &&
    (input.expectedWorkerId === undefined ||
      input.expectedWorkerId === lease.workerId) &&
    input.currentLease === lease.token &&
    snapshotBackfillCaptureAllowed({
      state: input.state,
      currentResourceKey: input.currentResourceKey,
      expectedTabId: input.expectedTabId,
      resourceKey: lease.resourceKey,
      tabId: lease.tabId
    })
  );
}

export function snapshotBackfillStateAfterFocusCheck(
  state: SnapshotBackfillState,
  foreground: boolean
): SnapshotBackfillState {
  if (!["running", "waiting_focus"].includes(state)) return state;
  return foreground ? "running" : "waiting_focus";
}

export function snapshotBackfillCandidates(
  resources: ResourceRecord[],
  snapshotCanonicalUrls: ReadonlySet<string>,
  excludedHosts: string[],
  protectionPolicy?: ProtectionPolicy
): ResourceRecord[] {
  return interleaveResourcesByHost(
    resources.filter(
      (resource) =>
        resource.nativeBookmarkIds.length > 0 &&
        isSupportedPageUrl(resource.url) &&
        !snapshotCanonicalUrls.has(resource.canonicalUrl) &&
        !isSnapshotSensitiveUrl(resource.url, excludedHosts) &&
        (!protectionPolicy ||
          !isResourceUserProtected(resource, protectionPolicy))
    )
  );
}

export function emptySnapshotBackfillStatus(): SnapshotBackfillStatus {
  return {
    id: "",
    state: "idle",
    total: 0,
    processed: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    currentTitle: "",
    errors: [],
    concurrency: SNAPSHOT_BACKFILL_CONCURRENCY,
    requiresForeground: false
  };
}

export function recordSnapshotBackfillOutcome(
  status: SnapshotBackfillStatus,
  outcome: SnapshotBackfillOutcome,
  error?: SnapshotBackfillError,
  timestamp = new Date().toISOString()
): SnapshotBackfillStatus {
  const processed = Math.min(status.total, status.processed + 1);
  const completed = processed >= status.total;
  return {
    ...status,
    state: completed ? "completed" : "running",
    processed,
    succeeded: status.succeeded + (outcome === "succeeded" ? 1 : 0),
    failed: status.failed + (outcome === "failed" ? 1 : 0),
    skipped: status.skipped + (outcome === "skipped" ? 1 : 0),
    currentTitle: "",
    updatedAt: timestamp,
    ...(completed ? { completedAt: timestamp } : {}),
    errors: outcome === "failed" && error
      ? [...status.errors, error].slice(-20)
      : status.errors
  };
}

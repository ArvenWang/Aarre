import type { SnapshotEnhancementProgress } from "../../lib/bookmark-enhancement";

const IMMEDIATE_SNAPSHOT_PREFIX = "aarre:immediate-snapshot:";

export interface ImmediatePageSnapshotTarget {
  targetUrl: string;
  delayMs: number;
  completedUrl?: string;
  navigationStartUrl?: string;
  redirectedUrl?: string;
  resourceKey: string;
  showToast: boolean;
  refreshExisting?: boolean;
  documentId?: string;
  trigger: SnapshotEnhancementProgress["trigger"];
  backfillJobId?: string;
  backfillWorkerId?: number;
  backfillLease?: string;
}

const immediatePageSnapshotTargets = new Map<
  number,
  ImmediatePageSnapshotTarget
>();

function immediateSnapshotKey(tabId: number): string {
  return `${IMMEDIATE_SNAPSHOT_PREFIX}${tabId}`;
}

export async function storeImmediateSnapshotTarget(
  tabId: number,
  target: ImmediatePageSnapshotTarget
): Promise<void> {
  immediatePageSnapshotTargets.set(tabId, target);
  await chrome.storage.session.set({
    [immediateSnapshotKey(tabId)]: target
  });
}

export async function readImmediateSnapshotTarget(
  tabId: number
): Promise<ImmediatePageSnapshotTarget | undefined> {
  const memory = immediatePageSnapshotTargets.get(tabId);
  if (memory) return memory;
  const key = immediateSnapshotKey(tabId);
  const stored = (await chrome.storage.session.get(key))[key];
  if (!stored || typeof stored !== "object") return undefined;
  const target = stored as Partial<ImmediatePageSnapshotTarget>;
  if (
    typeof target.targetUrl !== "string" ||
    typeof target.resourceKey !== "string" ||
    typeof target.delayMs !== "number"
  ) {
    await chrome.storage.session.remove(key);
    return undefined;
  }
  const normalized: ImmediatePageSnapshotTarget = {
    targetUrl: target.targetUrl,
    resourceKey: target.resourceKey,
    delayMs: target.delayMs,
    showToast: target.showToast === true,
    trigger:
      target.trigger === "chrome_bookmark" ||
      target.trigger === "aarre_save" ||
      target.trigger === "aarre_open" ||
      target.trigger === "normal_browse" ||
      target.trigger === "manual_refresh" ||
      target.trigger === "batch_backfill"
        ? target.trigger
        : "recovery",
    ...(typeof target.documentId === "string"
      ? { documentId: target.documentId }
      : {}),
    ...(typeof target.completedUrl === "string"
      ? { completedUrl: target.completedUrl }
      : {}),
    ...(typeof target.navigationStartUrl === "string"
      ? { navigationStartUrl: target.navigationStartUrl }
      : {}),
    ...(typeof target.redirectedUrl === "string"
      ? { redirectedUrl: target.redirectedUrl }
      : {}),
    ...(typeof target.backfillJobId === "string"
      ? { backfillJobId: target.backfillJobId }
      : {}),
    ...(typeof target.backfillWorkerId === "number"
      ? { backfillWorkerId: target.backfillWorkerId }
      : {}),
    ...(typeof target.backfillLease === "string"
      ? { backfillLease: target.backfillLease }
      : {}),
    ...(target.refreshExisting === true ? { refreshExisting: true } : {})
  };
  immediatePageSnapshotTargets.set(tabId, normalized);
  return normalized;
}

export async function removeImmediateSnapshotTarget(
  tabId: number,
  expected?: ImmediatePageSnapshotTarget
): Promise<void> {
  if (
    expected &&
    immediatePageSnapshotTargets.get(tabId) &&
    immediatePageSnapshotTargets.get(tabId) !== expected
  ) {
    return;
  }
  immediatePageSnapshotTargets.delete(tabId);
  await chrome.storage.session.remove(immediateSnapshotKey(tabId));
}

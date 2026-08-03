import type { AiProviderId, LibraryScanStatus } from "../../lib/types";

const LIBRARY_SCAN_KEY = "aarre:library-scan";

export interface StoredLibraryScanJob extends LibraryScanStatus {
  resourceKeys: string[];
  nextIndex: number;
  force: boolean;
  provider?: AiProviderId;
  actualUsageEstimated?: boolean;
  usageRecorded?: boolean;
}

function emptyLibraryScan(): StoredLibraryScanJob {
  return {
    id: "", state: "idle", total: 0, processed: 0, succeeded: 0,
    failed: 0, skipped: 0, currentTitle: "", errors: [],
    resourceKeys: [], nextIndex: 0, force: false,
    actualUsageEstimated: false, usageRecorded: false,
  };
}

export function publicLibraryScan(job: StoredLibraryScanJob): LibraryScanStatus {
  const {
    resourceKeys: _resourceKeys, nextIndex: _nextIndex, force: _force,
    provider: _provider, actualUsageEstimated: _actualUsageEstimated,
    usageRecorded: _usageRecorded, ...status
  } = job;
  return status;
}

export async function getStoredLibraryScan(): Promise<StoredLibraryScanJob> {
  const stored = (await chrome.storage.local.get(LIBRARY_SCAN_KEY))[LIBRARY_SCAN_KEY];
  if (!stored || typeof stored !== "object") return emptyLibraryScan();
  const value = stored as Partial<StoredLibraryScanJob>;
  return {
    ...emptyLibraryScan(),
    ...value,
    errors: Array.isArray(value.errors) ? value.errors.slice(-20) : [],
    resourceKeys: Array.isArray(value.resourceKeys)
      ? value.resourceKeys.filter((item): item is string => typeof item === "string")
      : [],
  };
}

export async function setStoredLibraryScan(job: StoredLibraryScanJob): Promise<void> {
  await chrome.storage.local.set({ [LIBRARY_SCAN_KEY]: job });
  void chrome.runtime.sendMessage({
    type: "LIBRARY_SCAN_UPDATED",
    status: publicLibraryScan(job),
  }).catch(() => undefined);
}

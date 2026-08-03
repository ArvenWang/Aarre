import { getPageSnapshot } from "../../lib/storage";
import { needsAiEnrichment } from "../../lib/ai-fields";
import {
  completeEnhancementPart,
  deferEnhancementJob,
  mergeEnhancementJob,
  updateAiProgress,
  updateSnapshotProgress,
  type AiEnhancementProgress,
  type BookmarkEnhancementJob,
  type BookmarkEnhancementPart,
  type SnapshotEnhancementProgress
} from "../../lib/bookmark-enhancement";
import { scheduleBookmarkEnhancements } from "../lifecycle/alarms";
import { readImmediateSnapshotTarget, removeImmediateSnapshotTarget } from "../snapshots/target-store";
import type { ResourceRecord } from "../../lib/types";

const BOOKMARK_ENHANCEMENT_KEY = "aarre:bookmark-enhancements:v1";

interface EnhancementStoreDependencies {
  getPrivacyProtectionContext(): Promise<unknown>;
  resourceProtectionState(resource: ResourceRecord, context: unknown): { protected: boolean };
  clearPageSnapshotTimer(tabId: number): void;
}

export function createEnhancementStore(dependencies: EnhancementStoreDependencies) {
  const { getPrivacyProtectionContext, resourceProtectionState, clearPageSnapshotTimer } = dependencies;
  let bookmarkEnhancementMutation: Promise<void> = Promise.resolve();
  const now = () => new Date().toISOString();
async function getStoredEnhancementJobs(): Promise<
  Record<string, BookmarkEnhancementJob>
> {
  const stored = (await chrome.storage.local.get(
    BOOKMARK_ENHANCEMENT_KEY
  ))[BOOKMARK_ENHANCEMENT_KEY];
  if (!stored || typeof stored !== "object") return {};
  return stored as Record<string, BookmarkEnhancementJob>;
}

async function setStoredEnhancementJobs(
  jobs: Record<string, BookmarkEnhancementJob>
): Promise<void> {
  await chrome.storage.local.set({
    [BOOKMARK_ENHANCEMENT_KEY]: jobs
  });
}

async function mutateStoredEnhancementJobs<T>(
  mutate: (jobs: Record<string, BookmarkEnhancementJob>) => T | Promise<T>
): Promise<T> {
  let resolveResult!: (value: T | PromiseLike<T>) => void;
  let rejectResult!: (reason?: unknown) => void;
  const result = new Promise<T>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  bookmarkEnhancementMutation = bookmarkEnhancementMutation
    .catch(() => undefined)
    .then(async () => {
      try {
        const jobs = await getStoredEnhancementJobs();
        const value = await mutate(jobs);
        await setStoredEnhancementJobs(jobs);
        resolveResult(value);
      } catch (error) {
        rejectResult(error);
      }
    });
  return result;
}

async function enqueueBookmarkEnhancement(
  resource: ResourceRecord,
  pending: BookmarkEnhancementPart[],
  snapshot?: Omit<SnapshotEnhancementProgress, "updatedAt">
): Promise<void> {
  if (!pending.length || !resource.nativeBookmarkIds.length) return;
  const context = await getPrivacyProtectionContext();
  if (resourceProtectionState(resource, context).protected) {
    await cancelEnhancementForResource(resource.resourceKey);
    return;
  }
  const timestamp = now();
  await mutateStoredEnhancementJobs((jobs) => {
    const merged = mergeEnhancementJob(
      jobs[resource.resourceKey],
      {
        resourceKey: resource.resourceKey,
        url: resource.url,
        pending,
        ...(pending.includes("ai")
          ? {
              ai: {
                state: "queued",
                updatedAt: timestamp
              } as const
            }
          : {}),
        ...(snapshot
          ? {
              snapshot: {
                ...snapshot,
                updatedAt: timestamp
              }
            }
          : {})
      },
      timestamp
    );
    jobs[resource.resourceKey] = {
      ...merged,
      nextAttemptAt: timestamp,
      updatedAt: timestamp
    };
  });
  await scheduleBookmarkEnhancements();
}

async function queueEnhancementsUntilVisit(
  resource: ResourceRecord,
  trigger: SnapshotEnhancementProgress["trigger"] = "recovery",
  knownPrivacyContext?: unknown
): Promise<void> {
  if (!resource.nativeBookmarkIds.length) return;
  const context =
    knownPrivacyContext || (await getPrivacyProtectionContext());
  const privacyBlocked = resourceProtectionState(resource, context).protected;
  const pending: BookmarkEnhancementPart[] = [];
  if (!privacyBlocked && needsAiEnrichment(resource)) {
    pending.push("ai");
  }
  if (
    !privacyBlocked &&
    !(await getPageSnapshot(resource.canonicalUrl))
  ) {
    pending.push("snapshot");
  }
  if (!pending.length) return;
  const timestamp = now();
  await mutateStoredEnhancementJobs((jobs) => {
    jobs[resource.resourceKey] = {
      ...mergeEnhancementJob(
        jobs[resource.resourceKey],
        {
          resourceKey: resource.resourceKey,
          url: resource.url,
          pending,
          ...(pending.includes("ai")
            ? {
                ai: {
                  state: "waiting_for_content",
                  updatedAt: timestamp
                } as const
              }
            : {}),
          ...(pending.includes("snapshot")
            ? {
                snapshot: {
                  state: "waiting_page",
                  trigger,
                  updatedAt: timestamp
                }
              }
            : {})
        },
        timestamp
      ),
      // 导入、恢复和 Chrome 同步只登记待访问增强，不在后台批量开页或花 AI。
      nextAttemptAt: "9999-12-31T23:59:59.999Z",
      updatedAt: timestamp
    };
  });
}

async function completeStoredEnhancementPart(
  resourceKey: string,
  part: BookmarkEnhancementPart
): Promise<void> {
  await mutateStoredEnhancementJobs((jobs) => {
    const current = jobs[resourceKey];
    if (!current) return;
    const next = completeEnhancementPart(current, part, now());
    if (next) jobs[resourceKey] = next;
    else delete jobs[resourceKey];
  });
}

async function hasPageAccess(url: string): Promise<boolean> {
  try {
    const origin = `${new URL(url).origin}/*`;
    return chrome.permissions.contains({ origins: [origin] });
  } catch {
    return false;
  }
}

async function deferStoredEnhancementJob(
  resourceKey: string,
  message: string
): Promise<void> {
  await mutateStoredEnhancementJobs((jobs) => {
    const current = jobs[resourceKey];
    if (!current) return;
    jobs[resourceKey] = deferEnhancementJob(
      current,
      message,
      Date.now()
    );
  });
}

async function updateStoredSnapshotProgress(
  resourceKey: string,
  progress: Omit<SnapshotEnhancementProgress, "updatedAt">
): Promise<void> {
  await mutateStoredEnhancementJobs((jobs) => {
    const current = jobs[resourceKey];
    if (!current) return;
    jobs[resourceKey] = updateSnapshotProgress(current, progress, now());
  });
}

async function updateStoredAiProgress(
  resourceKey: string,
  progress: Omit<AiEnhancementProgress, "updatedAt">
): Promise<void> {
  await mutateStoredEnhancementJobs((jobs) => {
    const current = jobs[resourceKey];
    if (!current) return;
    jobs[resourceKey] = updateAiProgress(current, progress, now());
  });
}

async function cancelEnhancementsForResources(
  resourceKeys: ReadonlySet<string>
): Promise<void> {
  if (!resourceKeys.size) return;
  await mutateStoredEnhancementJobs((jobs) => {
    for (const resourceKey of resourceKeys) delete jobs[resourceKey];
  });
  const tabs = await chrome.tabs.query({});
  await Promise.all(
    tabs.map(async (tab) => {
      if (typeof tab.id !== "number") return;
      const target = await readImmediateSnapshotTarget(tab.id);
      if (target && resourceKeys.has(target.resourceKey)) {
        clearPageSnapshotTimer(tab.id);
        await removeImmediateSnapshotTarget(tab.id, target);
      }
    })
  );
}

async function cancelEnhancementForResource(resourceKey: string): Promise<void> {
  return cancelEnhancementsForResources(new Set([resourceKey]));
}

  return {
    getStoredEnhancementJobs,
    enqueueBookmarkEnhancement,
    queueEnhancementsUntilVisit,
    completeStoredEnhancementPart,
    hasPageAccess,
    deferStoredEnhancementJob,
    updateStoredSnapshotProgress,
    updateStoredAiProgress,
    cancelEnhancementsForResources,
    cancelEnhancementForResource
  };
}

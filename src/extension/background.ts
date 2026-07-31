import { getAuthState } from "../lib/auth";
import {
  processOutbox,
  pullCloudResources as pullCloudResourcesFromCloud,
  syncOneResource
} from "../lib/cloud";
import {
  askBookmarkAgent,
  enrichResourceFromEssenceWithUsage,
  enrichResourceLocally
} from "../lib/local-ai";
import {
  buildLibraryInsights,
  suggestFolders
} from "../lib/library-insights";
import {
  buildKnowledgeDashboard,
  resurfaceForContext
} from "../lib/knowledge-insights";
import {
  deleteAgentConversation,
  getAgentConversations,
  saveAgentConversation
} from "../lib/conversations";
import {
  extractPageEssenceFromHtml,
  isInternalOrSensitiveUrl
} from "../lib/page-essence";
import {
  cacheRepresentativeImage,
  cacheSiteBrandIcon
} from "../lib/thumbnail";
import {
  categoryCoverForResource,
  matchCoverRule,
  recordPageImageSample,
  registrableHost,
  resolveRuleAsset
} from "../lib/cover-registry";
import {
  createPageSnapshot,
  detectBotChallengeInDocument,
  isLoadedSnapshotTab,
  isPageSnapshotStale,
  isSnapshotSensitiveUrl,
  matchesSnapshotTargetUrl,
  mergePageSnapshotSchedule,
  showSnapshotUpdatedToastInDocument,
  waitForStablePageInDocument
} from "../lib/page-snapshot";
import {
  bookmarkPageMenuPresentation,
  buildBookmarkSaveState
} from "../lib/bookmark-save-state";
import {
  bookmarkEditTags,
  bookmarkUrlEditPlan,
  rehomeResourceAfterBookmarkUrlChange,
  runBookmarkEditRecoverySteps
} from "../lib/bookmark-edit";
import {
  acceptsSnapshotNavigationCommit,
  completeEnhancementPart,
  deferEnhancementJob,
  enhancementTriggerAllowsRenderedAi,
  isEnhancementJobDue,
  mergeEnhancementJob,
  snapshotCapturePolicy,
  updateAiProgress,
  updateSnapshotProgress,
  type AiEnhancementProgress,
  type BookmarkEnhancementJob,
  type BookmarkEnhancementPart,
  type SnapshotEnhancementProgress
} from "../lib/bookmark-enhancement";
import { getDisplaySettings } from "../lib/display-settings";
import {
  createRemovedNodeUndoBatch,
  createUndoBatch,
  snapshotCreatedMutation,
  snapshotNodeMutation,
  undoBookmarkBatch
} from "../lib/bookmark-undo";
import {
  executeProtectedBookmarkMutation,
  type ProtectedBookmarkMutationInput
} from "../lib/protected-bookmark-mutation";
import type {
  ExtensionRequest,
  ExtensionResponse
} from "../lib/messages";
import { searchLocalResources } from "../lib/search";
import {
  getAiSettingsStatus,
  getAiRuntimeSettings,
  getAiProviderPreset,
  saveAiSettings
} from "../lib/settings";
import {
  addScanAiUsage,
  getAiUsageStats
} from "../lib/usage-stats";
import {
  costCnyForUsage,
  estimateScanCost
} from "../lib/ai-cost";
import { checkLinkHealth } from "../lib/link-health";
import {
  DomainRateLimiter,
  interleaveResourcesByHost,
  runConcurrentTasks
} from "../lib/scan-scheduler";
import {
  emptySnapshotBackfillStatus,
  recordSnapshotBackfillOutcome,
  snapshotBackfillCandidates,
  snapshotBackfillLeaseAllowsCapture,
  snapshotBackfillStateAfterFocusCheck,
  type SnapshotBackfillLease,
  type SnapshotBackfillOutcome
} from "../lib/snapshot-backfill";
import {
  completeOutboxItem,
  cleanupExpiredUndoSnapshots,
  deferOutboxItem,
  deleteLocalResource,
  deletePageSnapshot,
  deleteUndoSnapshot,
  enqueueOutbox,
  getLocalResource,
  getLocalResources,
  getOutbox,
  getPageSnapshot,
  getPageSnapshots,
  getSiteBrand,
  getSiteBrands,
  getUndoSnapshot,
  getUndoSnapshots,
  putUndoSnapshot,
  putPageSnapshot,
  putSiteBrand,
  removeOutboxItem,
  upsertLocalResource as persistLocalResource
} from "../lib/storage";
import {
  matchesNavigationText,
  parseNavigationInput
} from "../lib/navigation";
import { createPendingSaveDraft } from "../lib/pending-save";
import { buildSelectableFolderOptions } from "../lib/folder-options";
import {
  buildLibraryFingerprint,
  dismissStoredOrganizationInsights,
  mergeStoredOrganizationInsights,
  organizationBadgeText,
  organizationNoticeFromStored,
  sameLibraryFingerprint,
  type StoredOrganizationInsights
} from "../lib/organization-notice";
import type {
  ActiveTabSummary,
  AiProviderId,
  AiTokenUsage,
  AppState,
  BookmarkAgentActionExecutionResult,
  BookmarkAgentActionProposal,
  BookmarkAgentCatalog,
  BookmarkBarSnapshot,
  BookmarkSaveState,
  ImportResult,
  LibraryScanStatus,
  LibraryScanEstimate,
  NativeBookmarkNode,
  NativeFolderOption,
  NavigationInput,
  NavigationSuggestion,
  OutboxItem,
  PendingSaveDraft,
  PageCapture,
  PageSnapshot,
  ResourceRecord,
  RestoreResult,
  SaveBookmarkInput,
  SaveBookmarkResult,
  SiteBrandRecord,
  SiteIconCandidate,
  SnapshotBackfillStatus,
  UpdateBookmarkDetailsInput,
  UpdateBookmarkDetailsResult,
  UndoMutation,
  UndoSnapshotBatch
} from "../lib/types";
import {
  canonicalizeUrl,
  hashText,
  isSupportedPageUrl,
  resourceKeyForUrl
} from "../lib/url";

const CONTEXT_MENU_PAGE_ID = "bookmark-layer-save-page";
const CONTEXT_MENU_LINK_ID = "bookmark-layer-save-link";
const PENDING_SAVE_PREFIX = "pending-save:";
const LIBRARY_SCAN_KEY = "aarre:library-scan";
const LIBRARY_SCAN_ALARM = "aarre-library-scan";
const BOOKMARK_ENHANCEMENT_KEY = "aarre:bookmark-enhancements:v1";
const BOOKMARK_ENHANCEMENT_ALARM = "aarre-bookmark-enhancements";
const IMMEDIATE_SNAPSHOT_PREFIX = "aarre:immediate-snapshot:";
const SNAPSHOT_BACKFILL_KEY = "aarre:snapshot-backfill:v1";
const SNAPSHOT_BACKFILL_TIMEOUT_ALARM =
  "aarre-snapshot-backfill-timeout";
const ORGANIZATION_INSIGHTS_KEY = "aarre:organization-insights";
const MAX_SCAN_HTML_BYTES = 600_000;
const internalBookmarkIds = new Set<string>();
const internalBookmarkTargets = new Set<string>();
const pendingSaveDrafts = new Map<number, PendingSaveDraft>();
const pageSnapshotTimers = new Map<number, number>();
const AARRE_OPEN_PAGE_SNAPSHOT_DELAY_MS = 1_500;
const SAVED_PAGE_SNAPSHOT_DELAY_MS = 250;
const BATCH_PAGE_SNAPSHOT_DELAY_MS = 300;
const SNAPSHOT_BACKFILL_PAGE_TIMEOUT_MINUTES = 0.75;
// 页面加载完成后，稳定等待 + 截图 + 落库的总预算。成功页面几秒内就会
// 清除闹钟，因此 45 秒预算不会拖慢正常任务，只限制“卡住”页面的等待上限。
const SNAPSHOT_BACKFILL_READY_TIMEOUT_MINUTES = 0.75;
const SNAPSHOT_BACKFILL_MAX_ATTEMPTS = 2;
// executeScript 本身没有超时；页面无响应时可能长期挂起，必须自行兜底。
const SNAPSHOT_BACKFILL_STABILITY_TIMEOUT_MS = 8_000;
const SNAPSHOT_BACKFILL_CHALLENGE_TIMEOUT_MS = 3_000;
const SNAPSHOT_BACKFILL_CAPTURE_RETRY_DELAY_MS = 2_000;
const SNAPSHOT_BACKFILL_MAX_CAPTURE_ATTEMPTS = 3;
let bookmarkedResourceLookupCache: Map<string, string> | null = null;
let bookmarkedResourceLookupRevision = 0;
interface ImmediatePageSnapshotTarget {
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
  backfillLease?: string;
}
const immediatePageSnapshotTargets = new Map<
  number,
  ImmediatePageSnapshotTarget
>();
let libraryScanRunning = false;
let bookmarkEnhancementRunning = false;
let snapshotBackfillDriving = false;
let snapshotBackfillRetrying = false;
let snapshotBackfillMutation: Promise<void> = Promise.resolve();
let bookmarkEnhancementMutation: Promise<void> = Promise.resolve();
const renderedPageEnhancementRunning = new Set<string>();
let pageContextMenuRevision = 0;
let nativeBookmarkImportInProgress = false;
const libraryScanRateLimiter = new DomainRateLimiter(1_000);
const LIBRARY_SCAN_CONCURRENCY = 4;
const LINK_HEALTH_REFRESH_MS = 7 * 24 * 60 * 60 * 1_000;

interface StoredLibraryScanJob extends LibraryScanStatus {
  resourceKeys: string[];
  nextIndex: number;
  force: boolean;
  provider?: AiProviderId;
  actualUsageEstimated?: boolean;
  usageRecorded?: boolean;
}

interface StoredSnapshotBackfillJob extends SnapshotBackfillStatus {
  resourceKeys: string[];
  nextIndex: number;
  currentResourceKey?: string;
  currentAttempt: number;
  currentLease?: string;
  windowId?: number;
}

function emptyLibraryScan(): StoredLibraryScanJob {
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
    resourceKeys: [],
    nextIndex: 0,
    force: false,
    actualUsageEstimated: false,
    usageRecorded: false
  };
}

function publicLibraryScan(
  job: StoredLibraryScanJob
): LibraryScanStatus {
  const {
    resourceKeys: _resourceKeys,
    nextIndex: _nextIndex,
    force: _force,
    provider: _provider,
    actualUsageEstimated: _actualUsageEstimated,
    usageRecorded: _usageRecorded,
    ...status
  } = job;
  return status;
}

async function getStoredLibraryScan(): Promise<StoredLibraryScanJob> {
  const stored = (await chrome.storage.local.get(LIBRARY_SCAN_KEY))[
    LIBRARY_SCAN_KEY
  ];
  if (!stored || typeof stored !== "object") {
    return emptyLibraryScan();
  }
  const value = stored as Partial<StoredLibraryScanJob>;
  return {
    ...emptyLibraryScan(),
    ...value,
    errors: Array.isArray(value.errors) ? value.errors.slice(-20) : [],
    resourceKeys: Array.isArray(value.resourceKeys)
      ? value.resourceKeys.filter(
          (item): item is string => typeof item === "string"
        )
      : []
  };
}

async function setStoredLibraryScan(
  job: StoredLibraryScanJob
): Promise<void> {
  await chrome.storage.local.set({ [LIBRARY_SCAN_KEY]: job });
  void chrome.runtime
    .sendMessage({
      type: "LIBRARY_SCAN_UPDATED",
      status: publicLibraryScan(job)
    })
    .catch(() => undefined);
}

function emptyStoredSnapshotBackfill(): StoredSnapshotBackfillJob {
  return {
    ...emptySnapshotBackfillStatus(),
    resourceKeys: [],
    nextIndex: 0,
    currentAttempt: 0
  };
}

function publicSnapshotBackfill(
  job: StoredSnapshotBackfillJob
): SnapshotBackfillStatus {
  const {
    resourceKeys: _resourceKeys,
    nextIndex: _nextIndex,
    currentResourceKey: _currentResourceKey,
    currentAttempt: _currentAttempt,
    currentLease: _currentLease,
    windowId: _windowId,
    ...status
  } = job;
  return status;
}

async function getStoredSnapshotBackfill(): Promise<StoredSnapshotBackfillJob> {
  const stored = (await chrome.storage.local.get(SNAPSHOT_BACKFILL_KEY))[
    SNAPSHOT_BACKFILL_KEY
  ];
  if (!stored || typeof stored !== "object") {
    return emptyStoredSnapshotBackfill();
  }
  const value = stored as Partial<StoredSnapshotBackfillJob>;
  return {
    ...emptyStoredSnapshotBackfill(),
    ...value,
    concurrency: 1,
    requiresForeground: false,
    errors: Array.isArray(value.errors) ? value.errors.slice(-20) : [],
    resourceKeys: Array.isArray(value.resourceKeys)
      ? value.resourceKeys.filter(
          (item): item is string => typeof item === "string"
        )
      : [],
    nextIndex:
      typeof value.nextIndex === "number" && value.nextIndex >= 0
        ? Math.floor(value.nextIndex)
        : 0,
    currentAttempt:
      typeof value.currentAttempt === "number" &&
      value.currentAttempt >= 0
        ? Math.floor(value.currentAttempt)
        : 0,
    currentLease:
      typeof value.currentLease === "string"
        ? value.currentLease
        : undefined
  };
}

async function setStoredSnapshotBackfill(
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

async function mutateStoredSnapshotBackfill<T>(
  mutate: (
    job: StoredSnapshotBackfillJob
  ) => T | Promise<T>
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

function bookmarkTarget(parentId: string, url: string): string {
  return `${parentId}\n${url}`;
}

function releaseInternalBookmarkWrite(id: string, target: string) {
  setTimeout(() => {
    internalBookmarkIds.delete(id);
    internalBookmarkTargets.delete(target);
  }, 1_000);
}

function markInternalBookmarkRemoval(id: string) {
  internalBookmarkIds.add(id);
}

function releaseInternalBookmarkRemoval(id: string) {
  setTimeout(() => {
    internalBookmarkIds.delete(id);
  }, 1_000);
}

function now(): string {
  return new Date().toISOString();
}

function hostFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "") || url;
  } catch {
    return url;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "发生未知错误。";
}

function updateBookmarkedResourceLookupEntry(resource: ResourceRecord): void {
  if (!bookmarkedResourceLookupCache) return;
  for (const [canonicalUrl, resourceKey] of bookmarkedResourceLookupCache) {
    if (resourceKey === resource.resourceKey) {
      bookmarkedResourceLookupCache.delete(canonicalUrl);
    }
  }
  if (!resource.nativeBookmarkIds.length) return;
  for (const candidate of [
    resource.url,
    resource.canonicalUrl,
    ...(resource.aliases || [])
  ]) {
    try {
      bookmarkedResourceLookupCache.set(
        canonicalizeUrl(candidate),
        resource.resourceKey
      );
    } catch {
      // Invalid legacy aliases are ignored while the primary resource remains usable.
    }
  }
}

async function upsertLocalResource(resource: ResourceRecord): Promise<void> {
  await persistLocalResource(resource);
  bookmarkedResourceLookupRevision += 1;
  updateBookmarkedResourceLookupEntry(resource);
}

async function pullCloudResources(): Promise<ResourceRecord[]> {
  const resources = await pullCloudResourcesFromCloud();
  bookmarkedResourceLookupRevision += 1;
  bookmarkedResourceLookupCache = null;
  return resources;
}

async function bookmarkedResourceLookup(): Promise<Map<string, string>> {
  if (bookmarkedResourceLookupCache) return bookmarkedResourceLookupCache;
  const startingRevision = bookmarkedResourceLookupRevision;
  const lookup = new Map<string, string>();
  for (const resource of await getLocalResources()) {
    if (!resource.nativeBookmarkIds.length) continue;
    for (const candidate of [
      resource.url,
      resource.canonicalUrl,
      ...(resource.aliases || [])
    ]) {
      try {
        lookup.set(canonicalizeUrl(candidate), resource.resourceKey);
      } catch {
        // Ignore a malformed legacy alias without invalidating the resource.
      }
    }
  }
  if (startingRevision !== bookmarkedResourceLookupRevision) {
    return bookmarkedResourceLookup();
  }
  bookmarkedResourceLookupCache = lookup;
  return lookup;
}

function immediateSnapshotKey(tabId: number): string {
  return `${IMMEDIATE_SNAPSHOT_PREFIX}${tabId}`;
}

async function storeImmediateSnapshotTarget(
  tabId: number,
  target: ImmediatePageSnapshotTarget
): Promise<void> {
  immediatePageSnapshotTargets.set(tabId, target);
  await chrome.storage.session.set({
    [immediateSnapshotKey(tabId)]: target
  });
}

async function readImmediateSnapshotTarget(
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
    ...(typeof target.backfillLease === "string"
      ? { backfillLease: target.backfillLease }
      : {}),
    ...(target.refreshExisting === true ? { refreshExisting: true } : {})
  };
  immediatePageSnapshotTargets.set(tabId, normalized);
  return normalized;
}

async function removeImmediateSnapshotTarget(
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

async function scheduleBookmarkEnhancements(
  delayInMinutes = 1
): Promise<void> {
  await chrome.alarms.create(BOOKMARK_ENHANCEMENT_ALARM, {
    delayInMinutes: Math.max(0.5, delayInMinutes)
  });
}

async function enqueueBookmarkEnhancement(
  resource: ResourceRecord,
  pending: BookmarkEnhancementPart[],
  snapshot?: Omit<SnapshotEnhancementProgress, "updatedAt">
): Promise<void> {
  if (!pending.length || !resource.nativeBookmarkIds.length) return;
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
  trigger: SnapshotEnhancementProgress["trigger"] = "recovery"
): Promise<void> {
  if (!resource.nativeBookmarkIds.length) return;
  const settings = await getDisplaySettings();
  const privacyBlocked = isSnapshotSensitiveUrl(
    resource.url,
    settings.snapshotExcludedHosts
  );
  const pending: BookmarkEnhancementPart[] = [];
  if (
    !privacyBlocked &&
    (resource.aiStatus !== "ready" ||
      !resource.summary.trim() ||
      !resource.tags.length)
  ) {
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

async function cancelEnhancementForResource(resourceKey: string): Promise<void> {
  await mutateStoredEnhancementJobs((jobs) => {
    delete jobs[resourceKey];
  });
  const tabs = await chrome.tabs.query({});
  await Promise.all(
    tabs.map(async (tab) => {
      if (typeof tab.id !== "number") return;
      const target = await readImmediateSnapshotTarget(tab.id);
      if (target?.resourceKey === resourceKey) {
        clearPageSnapshotTimer(tab.id);
        await removeImmediateSnapshotTarget(tab.id, target);
      }
    })
  );
}

async function runProtectedBookmarkMutation<T>(
  input: ProtectedBookmarkMutationInput<T>
): Promise<T> {
  return executeProtectedBookmarkMutation(input, {
    putSnapshot: putUndoSnapshot,
    deleteSnapshot: deleteUndoSnapshot,
    rollback: (batch) =>
      undoBookmarkBatch(batch, defaultFolderId, {
        onBeforeRemove: markInternalBookmarkRemoval,
        onAfterRemove: releaseInternalBookmarkRemoval
      })
  });
}

async function activeTab(): Promise<chrome.tabs.Tab | null> {
  const tabs = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true
  });
  return tabs[0] || null;
}

async function getActiveTabSummary(): Promise<ActiveTabSummary | null> {
  const tab = await activeTab();
  if (!tab) {
    return null;
  }

  const url = tab.url || "";
  return {
    id: tab.id,
    url,
    title: tab.title || "",
    faviconUrl: tab.favIconUrl || "",
    supported: isSupportedPageUrl(url)
  };
}

async function getFolderOptions(): Promise<NativeFolderOption[]> {
  const tree = await chrome.bookmarks.getTree();
  return buildSelectableFolderOptions(tree);
}

async function defaultFolderId(): Promise<string> {
  const tree = await chrome.bookmarks.getTree();
  const stack = [...tree];

  while (stack.length) {
    const node = stack.shift();
    if (!node) continue;
    if (node.folderType === "bookmarks-bar" && node.syncing === true) {
      return node.id;
    }
    stack.push(...(node.children || []));
  }

  for (const node of tree.flatMap((item) => item.children || [])) {
    if (node.folderType === "bookmarks-bar") {
      return node.id;
    }
  }

  const firstWritableFolder = (await getFolderOptions())[0];
  if (!firstWritableFolder) {
    throw new Error("没有找到可写入的 Chrome 书签文件夹。");
  }
  return firstWritableFolder.id;
}

function serializeBookmarkNode(
  node: chrome.bookmarks.BookmarkTreeNode
): NativeBookmarkNode {
  return {
    id: node.id,
    parentId: node.parentId,
    index: node.index,
    title: node.title || "未命名",
    url: node.url,
    dateAdded: node.dateAdded,
    dateLastUsed: node.dateLastUsed,
    folderType: node.folderType,
    syncing: node.syncing,
    unmodifiable: node.unmodifiable === "managed",
    children: node.children?.map(serializeBookmarkNode)
  };
}

function countBookmarkNodes(node: chrome.bookmarks.BookmarkTreeNode): {
  bookmarkCount: number;
  folderCount: number;
} {
  if (node.url) {
    return { bookmarkCount: 1, folderCount: 0 };
  }

  return (node.children || []).reduce(
    (total, child) => {
      const count = countBookmarkNodes(child);
      total.bookmarkCount += count.bookmarkCount;
      total.folderCount += count.folderCount + (child.url ? 0 : 1);
      return total;
    },
    { bookmarkCount: 0, folderCount: 0 }
  );
}

async function getBookmarkBarSnapshot(): Promise<BookmarkBarSnapshot> {
  const tree = await chrome.bookmarks.getTree();
  const root = tree[0];
  const topLevel = root?.children || [];
  const primary =
    topLevel.find(
      (node) =>
        node.folderType === "bookmarks-bar" && node.syncing === true
    ) ||
    topLevel.find((node) => node.folderType === "bookmarks-bar") ||
    topLevel.find((node) => !node.url && node.unmodifiable !== "managed");

  if (!primary) {
    throw new Error("没有找到当前 Chrome 配置文件的书签目录。");
  }

  const roots = topLevel
    .filter((node) => !node.url)
    .sort((left, right) => {
      if (left.id === primary.id) return -1;
      if (right.id === primary.id) return 1;
      if (left.syncing !== right.syncing) return left.syncing ? -1 : 1;
      return (left.index || 0) - (right.index || 0);
    });
  const counts = roots.reduce(
    (total, node) => {
      const count = countBookmarkNodes(node);
      total.bookmarkCount += count.bookmarkCount;
      total.folderCount += count.folderCount;
      return total;
    },
    { bookmarkCount: 0, folderCount: 0 }
  );

  return {
    root: serializeBookmarkNode(primary),
    roots: roots.map(serializeBookmarkNode),
    primaryRootId: primary.id,
    ...counts,
    syncing:
      typeof primary.syncing === "boolean"
        ? primary.syncing
        : null
  };
}

async function getBookmarkSaveState(
  url: string
): Promise<BookmarkSaveState> {
  if (!isSupportedPageUrl(url)) {
    throw new Error("当前地址不是可收藏的普通网页。");
  }
  const tree = await chrome.bookmarks.getTree();
  return buildBookmarkSaveState(
    tree.map(serializeBookmarkNode),
    url
  );
}

async function getNavigationSuggestions(
  rawQuery: string
): Promise<NavigationSuggestion[]> {
  const query = rawQuery.trim();
  if (!query) {
    return [];
  }

  const [bookmarkNodes, historyItems, tabs] = await Promise.all([
    chrome.bookmarks.search(query),
    chrome.history.search({
      text: query,
      startTime: 0,
      maxResults: 8
    }),
    chrome.tabs.query({})
  ]);

  const results: NavigationSuggestion[] = [];
  const seenUrls = new Set<string>();

  for (const tab of tabs) {
    if (
      !tab.url ||
      !matchesNavigationText(query, tab.title, tab.url) ||
      seenUrls.has(tab.url)
    ) {
      continue;
    }
    results.push({
      id: `tab:${tab.id ?? tab.url}`,
      kind: "tab",
      title: tab.title || tab.url,
      url: tab.url,
      subtitle: `已打开 · ${hostFromUrl(tab.url)}`,
      tabId: tab.id,
      windowId: tab.windowId
    });
    seenUrls.add(tab.url);
    if (results.length >= 4) break;
  }

  for (const node of bookmarkNodes) {
    if (!node.url || seenUrls.has(node.url)) {
      continue;
    }
    results.push({
      id: `bookmark:${node.id}`,
      kind: "bookmark",
      title: node.title || node.url,
      url: node.url,
      subtitle: `书签 · ${hostFromUrl(node.url)}`
    });
    seenUrls.add(node.url);
    if (
      results.filter((item) => item.kind === "bookmark").length >= 6
    ) {
      break;
    }
  }

  for (const item of historyItems) {
    if (!item.url || seenUrls.has(item.url)) {
      continue;
    }
    results.push({
      id: `history:${item.id || item.url}`,
      kind: "history",
      title: item.title || item.url,
      url: item.url,
      subtitle: `历史记录 · ${hostFromUrl(item.url)}`
    });
    seenUrls.add(item.url);
    if (results.length >= 14) break;
  }

  return results.slice(0, 14);
}

function resourceMatchesLoadedUrl(
  resource: ResourceRecord,
  loadedUrl: string
): boolean {
  let loadedCanonical: string;
  try {
    loadedCanonical = canonicalizeUrl(loadedUrl);
  } catch {
    return false;
  }
  return [resource.url, resource.canonicalUrl, ...(resource.aliases || [])].some(
    (candidate) => {
      try {
        return canonicalizeUrl(candidate) === loadedCanonical;
      } catch {
        return false;
      }
    }
  );
}

async function bookmarkedResourceForLoadedUrl(
  loadedUrl: string
): Promise<ResourceRecord | undefined> {
  const canonicalLoadedUrl = canonicalizeUrl(loadedUrl);
  const direct = await getLocalResource(
    await resourceKeyForUrl(canonicalLoadedUrl)
  );
  if (
    direct?.nativeBookmarkIds.length &&
    resourceMatchesLoadedUrl(direct, loadedUrl)
  ) {
    return direct;
  }

  // 重定向后的最终 URL 通常不是 Chrome 书签中保存的原始 URL，因此不能先
  // 用 bookmarks.search({ url }) 做门禁。使用本机索引把 aliases 也纳入命中，
  // 同时避免在每次普通导航时全量扫描大型书签库。
  const resourceKey = (await bookmarkedResourceLookup()).get(
    canonicalLoadedUrl
  );
  if (!resourceKey) return undefined;
  const aliased = await getLocalResource(resourceKey);
  if (
    aliased?.nativeBookmarkIds.length &&
    resourceMatchesLoadedUrl(aliased, loadedUrl)
  ) {
    return aliased;
  }
  bookmarkedResourceLookupCache?.delete(canonicalLoadedUrl);
  return undefined;
}

function snapshotTargetAllowsLoadedUrl(
  target: ImmediatePageSnapshotTarget,
  resource: ResourceRecord,
  loadedUrl: string
): boolean {
  if (resourceMatchesLoadedUrl(resource, loadedUrl)) return true;
  if (!target.redirectedUrl) return false;
  try {
    return canonicalizeUrl(target.redirectedUrl) === canonicalizeUrl(loadedUrl);
  } catch {
    return target.redirectedUrl === loadedUrl;
  }
}

async function scheduleImmediateSnapshotIfReady(
  tab: chrome.tabs.Tab
): Promise<boolean> {
  if (typeof tab.id !== "number") return false;
  const target = await readImmediateSnapshotTarget(tab.id);
  if (!target) return false;
  const allowInactive = target.trigger === "batch_backfill";
  if (
    // 批量后台补拍允许非活动标签页；普通路径仍要求前台活动页。
    !isLoadedSnapshotTab(tab, "", !allowInactive)
  ) {
    return false;
  }
  const resource = await getLocalResource(target.resourceKey);
  if (
    !resource?.nativeBookmarkIds.length ||
    !snapshotTargetAllowsLoadedUrl(target, resource, tab.url!)
  ) {
    await removeImmediateSnapshotTarget(tab.id, target);
    return false;
  }
  if (
    target.completedUrl &&
    !matchesSnapshotTargetUrl(target.completedUrl, tab.url!)
  ) {
    await removeImmediateSnapshotTarget(tab.id, target);
    return false;
  }
  target.completedUrl = tab.url;
  await storeImmediateSnapshotTarget(tab.id, target);
  return schedulePageSnapshotForTab(tab, {
    delayMs: target.delayMs,
    snapshotUrl: target.targetUrl,
    resourceKey: target.resourceKey,
    showToast: target.showToast,
    documentId: target.documentId,
    trigger: target.trigger,
    refreshExisting: target.refreshExisting,
    ...(target.backfillJobId && target.backfillLease
      ? {
          backfillLease: {
            jobId: target.backfillJobId,
            resourceKey: target.resourceKey,
            tabId: tab.id,
            token: target.backfillLease
          }
        }
      : {}),
    onSettled: (succeeded) => {
      if (succeeded && typeof tab.id === "number") {
        void removeImmediateSnapshotTarget(tab.id, target);
        return;
      }
      if (
        target.trigger === "batch_backfill" &&
        target.backfillJobId &&
        target.backfillLease &&
        typeof tab.id === "number"
      ) {
        // 批量截图失败（页面在稳定等待期间跳走/无响应）时不要干等闹钟，
        // 2 秒后直接重试；连续失败则快速结算失败并进入下一项。
        void retryBatchSnapshotCapture(
          tab.id,
          tab.url!,
          {
            snapshotUrl: target.targetUrl,
            resourceKey: target.resourceKey,
            showToast: target.showToast,
            documentId: target.documentId,
            trigger: target.trigger,
            refreshExisting: target.refreshExisting,
            backfillLease: {
              jobId: target.backfillJobId,
              resourceKey: target.resourceKey,
              tabId: tab.id,
              token: target.backfillLease
            }
          },
          target,
          1
        );
      }
    }
  });
}

async function discardMismatchedImmediateSnapshotTarget(
  tab: chrome.tabs.Tab
): Promise<void> {
  if (typeof tab.id !== "number") return;
  const target = await readImmediateSnapshotTarget(tab.id);
  if (!target) return;
  const resource = await getLocalResource(target.resourceKey);
  if (
    !tab.url ||
    !resource?.nativeBookmarkIds.length ||
    !snapshotTargetAllowsLoadedUrl(target, resource, tab.url)
  ) {
    clearPageSnapshotTimer(tab.id);
    await removeImmediateSnapshotTarget(tab.id, target);
  }
}

async function rememberImmediateSnapshotTarget(
  tab: chrome.tabs.Tab,
  targetUrl: string,
  delayMs = AARRE_OPEN_PAGE_SNAPSHOT_DELAY_MS,
  showToast = true,
  resourceKeyHint?: string,
  documentId?: string,
  trigger: SnapshotEnhancementProgress["trigger"] = "recovery",
  backfillLease?: SnapshotBackfillLease
): Promise<void> {
  if (typeof tab.id !== "number" || !isSupportedPageUrl(targetUrl)) {
    return;
  }
  const canonicalUrl = canonicalizeUrl(targetUrl);
  const resourceKey =
    resourceKeyHint || (await resourceKeyForUrl(canonicalUrl));
  const resource = await getLocalResource(resourceKey);
  if (!resource?.nativeBookmarkIds.length) return;
  const existingSnapshot = await getPageSnapshot(resource.canonicalUrl);
  const policy = snapshotCapturePolicy({
    hasSnapshot: Boolean(existingSnapshot),
    snapshotIsStale: isPageSnapshotStale(existingSnapshot),
    trigger
  });
  if (!policy.capture) {
    await completeStoredEnhancementPart(resourceKey, "snapshot");
    return;
  }
  const existingTarget = await readImmediateSnapshotTarget(tab.id);
  const sameResourceTarget =
    existingTarget?.resourceKey === resourceKey
      ? existingTarget
      : undefined;
  const mergedSchedule = mergePageSnapshotSchedule(
    sameResourceTarget,
    { delayMs, showToast: showToast && policy.showToast }
  );
  const target: ImmediatePageSnapshotTarget = {
    targetUrl,
    // 后台增强队列也可能为同一标签安排静默截图。不得让它覆盖
    // “从 Aarre 打开旧收藏”所需的成功 toast 或缩短稳定等待。
    delayMs: mergedSchedule.delayMs,
    resourceKey,
    showToast: mergedSchedule.showToast,
    trigger,
    ...(policy.refreshExisting || sameResourceTarget?.refreshExisting
      ? { refreshExisting: true }
      : {}),
    ...(documentId || sameResourceTarget?.documentId
      ? { documentId: documentId || sameResourceTarget?.documentId }
      : {}),
    ...(mergedSchedule.completedUrl
      ? { completedUrl: mergedSchedule.completedUrl }
      : {}),
    ...(sameResourceTarget?.navigationStartUrl
      ? { navigationStartUrl: sameResourceTarget.navigationStartUrl }
      : {}),
    ...(sameResourceTarget?.redirectedUrl
      ? { redirectedUrl: sameResourceTarget.redirectedUrl }
      : {}),
    ...(backfillLease?.jobId || sameResourceTarget?.backfillJobId
      ? {
          backfillJobId:
            backfillLease?.jobId || sameResourceTarget?.backfillJobId
        }
      : {}),
    ...(backfillLease?.token || sameResourceTarget?.backfillLease
      ? {
          backfillLease:
            backfillLease?.token || sameResourceTarget?.backfillLease
        }
      : {})
  };
  await storeImmediateSnapshotTarget(tab.id, target);
  await updateStoredSnapshotProgress(resourceKey, {
    state: tab.status === "complete" ? "queued" : "waiting_page",
    trigger,
    tabId: tab.id,
    ...(documentId ? { documentId } : {}),
    ...(tab.url ? { loadedUrl: tab.url } : {}),
    showToast: target.showToast,
    ...(target.refreshExisting ? { refreshExisting: true } : {})
  });
  // chrome.tabs.update/create 返回的 Tab 可能仍是 loading，但网页可能在
  // storage.session 写入期间已经 complete。重新读取可消除“complete 事件
  // 先到、截图目标后存”导致永久漏拍的竞态。
  const latestTab = await chrome.tabs.get(tab.id).catch(() => tab);
  await scheduleImmediateSnapshotIfReady(latestTab);
}

async function prepareImmediateSnapshotTargetForNavigation(
  tabId: number,
  resource: ResourceRecord,
  targetUrl: string,
  trigger: SnapshotEnhancementProgress["trigger"],
  showToast: boolean,
  backfillLease?: SnapshotBackfillLease
): Promise<ImmediatePageSnapshotTarget | undefined> {
  if (!resource.nativeBookmarkIds.length) {
    return undefined;
  }
  const existingSnapshot = await getPageSnapshot(resource.canonicalUrl);
  const policy = snapshotCapturePolicy({
    hasSnapshot: Boolean(existingSnapshot),
    snapshotIsStale: isPageSnapshotStale(existingSnapshot),
    trigger
  });
  if (!policy.capture) return undefined;
  clearPageSnapshotTimer(tabId);
  const target: ImmediatePageSnapshotTarget = {
    targetUrl,
    navigationStartUrl: targetUrl,
    delayMs:
      trigger === "batch_backfill"
        ? BATCH_PAGE_SNAPSHOT_DELAY_MS
        : trigger === "aarre_open"
          ? AARRE_OPEN_PAGE_SNAPSHOT_DELAY_MS
          : SAVED_PAGE_SNAPSHOT_DELAY_MS,
    resourceKey: resource.resourceKey,
    showToast: showToast && policy.showToast,
    trigger,
    ...(backfillLease
      ? {
          backfillJobId: backfillLease.jobId,
          backfillLease: backfillLease.token
        }
      : {}),
    ...(policy.refreshExisting ? { refreshExisting: true } : {})
  };
  await storeImmediateSnapshotTarget(tabId, target);
  await updateStoredSnapshotProgress(resource.resourceKey, {
    state: "waiting_page",
    trigger,
    tabId,
    loadedUrl: targetUrl,
    ...(target.showToast ? { showToast: true } : {}),
    ...(policy.refreshExisting ? { refreshExisting: true } : {})
  });
  return target;
}

async function createNavigationTab(
  url: string,
  openedFromAarre: boolean
): Promise<chrome.tabs.Tab> {
  if (!openedFromAarre) {
    return chrome.tabs.create({ url });
  }

  const resource = await bookmarkedResourceForLoadedUrl(url);
  // 先创建一个空白标签并持久化目标，再真正导航。这样即使页面命中缓存或
  // 立刻发生跨域重定向，webNavigation 的首个事件也不会跑在目标登记之前。
  const placeholder = await chrome.tabs.create({ active: true });
  const preparedTarget =
    typeof placeholder.id === "number" && resource
      ? await prepareImmediateSnapshotTargetForNavigation(
          placeholder.id,
          resource,
          url,
          "aarre_open",
          true
        )
      : undefined;
  try {
    const updated =
      typeof placeholder.id === "number"
        ? await chrome.tabs.update(placeholder.id, { url })
        : null;
    if (!updated) {
      throw new Error("Chrome 未能创建目标标签页。");
    }
    await rememberImmediateSnapshotTarget(
      updated,
      resource?.canonicalUrl || url,
      AARRE_OPEN_PAGE_SNAPSHOT_DELAY_MS,
      true,
      resource?.resourceKey,
      undefined,
      "aarre_open"
    );
    return updated;
  } catch (error) {
    if (typeof placeholder.id === "number") {
      if (preparedTarget) {
        await removeImmediateSnapshotTarget(
          placeholder.id,
          preparedTarget
        ).catch(() => undefined);
      }
      await chrome.tabs.remove(placeholder.id).catch(() => undefined);
    }
    throw error;
  }
}

async function navigate(
  input: NavigationInput,
  openedFromAarre = false
): Promise<{ opened: true }> {
  const disposition = input.disposition || "current";

  if (typeof input.tabId === "number") {
    if (typeof input.windowId === "number") {
      await chrome.windows.update(input.windowId, { focused: true });
    }
    const tab = await chrome.tabs.update(input.tabId, { active: true });
    if (openedFromAarre && tab?.url) {
      const resource = await bookmarkedResourceForLoadedUrl(
        input.url || tab.url
      );
      await rememberImmediateSnapshotTarget(
        tab,
        resource?.canonicalUrl || input.url || tab.url,
        AARRE_OPEN_PAGE_SNAPSHOT_DELAY_MS,
        true,
        resource?.resourceKey,
        undefined,
        "aarre_open"
      );
    }
    return { opened: true };
  }

  const parsed = input.url
    ? ({ kind: "url", url: input.url } as const)
    : parseNavigationInput(input.text);

  if (parsed.kind === "url") {
    if (disposition === "new") {
      await createNavigationTab(parsed.url, openedFromAarre);
    } else {
      const tab = await activeTab();
      if (tab?.id) {
        const resource = openedFromAarre
          ? await bookmarkedResourceForLoadedUrl(parsed.url)
          : undefined;
        const preparedTarget =
          openedFromAarre && resource
            ? await prepareImmediateSnapshotTargetForNavigation(
                tab.id,
                resource,
                parsed.url,
                "aarre_open",
                true
              )
            : undefined;
        const updated = await chrome.tabs
          .update(tab.id, { url: parsed.url })
          .catch(async (error) => {
            if (preparedTarget) {
              await removeImmediateSnapshotTarget(
                tab.id!,
                preparedTarget
              );
            }
            throw error;
          });
        if (openedFromAarre && updated) {
          await rememberImmediateSnapshotTarget(
            updated,
            resource?.canonicalUrl || parsed.url,
            AARRE_OPEN_PAGE_SNAPSHOT_DELAY_MS,
            true,
            resource?.resourceKey,
            undefined,
            "aarre_open"
          );
        }
      } else {
        await createNavigationTab(parsed.url, openedFromAarre);
      }
    }
    if (openedFromAarre) {
      const resource = await bookmarkedResourceForLoadedUrl(parsed.url);
      if (resource?.nativeBookmarkIds.length) {
        const pending: BookmarkEnhancementPart[] = [];
        if (
          resource.aiStatus !== "ready" ||
          !resource.summary.trim() ||
          !resource.tags.length
        ) {
          pending.push("ai");
        }
        if (!(await getPageSnapshot(resource.canonicalUrl))) {
          pending.push("snapshot");
        }
        await enqueueBookmarkEnhancement(
          resource,
          pending,
          pending.includes("snapshot")
            ? {
                state: "waiting_page",
                trigger: "aarre_open",
                showToast: true
              }
            : undefined
        );
        void processBookmarkEnhancements();
      }
    }
    return { opened: true };
  }

  if (!parsed.query) {
    throw new Error("请输入网址或搜索内容。");
  }

  await chrome.search.query({
    text: parsed.query,
    disposition: disposition === "new" ? "NEW_TAB" : "CURRENT_TAB"
  });
  return { opened: true };
}

async function updateNativeBookmark(input: {
  id: string;
  title: string;
  url?: string;
}, skipUndo = false): Promise<NativeBookmarkNode> {
  const title = input.title.trim();
  if (!title) {
    throw new Error("名称不能为空。");
  }
  const [current] = await chrome.bookmarks.get(input.id);
  if (!current || current.unmodifiable === "managed") {
    throw new Error("这个书签由 Chrome 或组织管理，无法修改。");
  }
  const requestedUrl =
    current.url && input.url !== undefined
      ? validateEditableBookmarkUrl(input.url)
      : undefined;
  if (
    current.url &&
    requestedUrl &&
    canonicalizeUrl(requestedUrl) !== canonicalizeUrl(current.url)
  ) {
    const saveState = await getBookmarkSaveState(requestedUrl);
    if (saveState.matches.some((match) => match.id !== input.id)) {
      throw new Error(
        "这个网址已经存在于 Chrome 收藏中。请直接编辑已有收藏，避免合并时覆盖智能信息。"
      );
    }
  }
  const perform = async () =>
    serializeBookmarkNode(
      await chrome.bookmarks.update(input.id, {
        title,
        ...(current.url && requestedUrl
          ? { url: requestedUrl }
          : {})
      })
    );
  if (skipUndo) return perform();
  const mutation = await snapshotNodeMutation({
    nodeId: input.id,
    kind: "restore_update",
    label: `修改“${current.title || current.url}”`
  });
  return runProtectedBookmarkMutation({
    label: mutation.label,
    destructive: false,
    mutation,
    perform
  });
}

function validateEditableBookmarkUrl(value: string): string {
  const text = value.trim();
  try {
    const parsed = new URL(text);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error("unsupported protocol");
    }
    return parsed.href;
  } catch {
    throw new Error("请输入以 http:// 或 https:// 开头的有效网址。");
  }
}

function normalizeUserTags(tags: string[]): string[] {
  return [
    ...new Set(
      tags
        .map((tag) => tag.trim().replace(/^#+\s*/, ""))
        .filter(Boolean)
        .map((tag) => tag.slice(0, 40))
    )
  ].slice(0, 16);
}

async function updateResourceTags(input: {
  resourceKey: string;
  tags: string[];
}): Promise<ResourceRecord> {
  const resource = await getLocalResource(input.resourceKey);
  if (!resource) {
    throw new Error("没有找到这个书签的智能信息，请刷新后再试。");
  }
  const auth = await getAuthState();
  const next: ResourceRecord = {
    ...resource,
    tags: normalizeUserTags(input.tags),
    tagsSource: "user",
    syncStatus: auth.configured ? "pending" : "local",
    updatedAt: now()
  };
  await upsertLocalResource(next);
  if (auth.configured) {
    await enqueueOutbox(next, "");
    void syncPendingIfReady();
  }
  return next;
}

async function updateBookmarkDetails(
  input: UpdateBookmarkDetailsInput
): Promise<UpdateBookmarkDetailsResult> {
  if (input.userNote.length > 2_000) {
    throw new Error("备注不能超过 2,000 个字符。");
  }

  let sourceResource = await getLocalResource(input.resourceKey);
  if (!sourceResource?.nativeBookmarkIds.includes(input.bookmarkId)) {
    await importNativeBookmarks();
    sourceResource = await getLocalResource(input.resourceKey);
  }
  if (!sourceResource?.nativeBookmarkIds.includes(input.bookmarkId)) {
    throw new Error(
      "这个收藏位置已经变化。请刷新收藏库后重新编辑，Aarre 没有写入任何内容。"
    );
  }

  const current = await chrome.bookmarks
    .get(input.bookmarkId)
    .then(([node]) => node);
  if (!current?.url) {
    throw new Error("这条 Chrome 收藏已经不存在，请刷新后再试。");
  }
  const managed = current.unmodifiable === "managed";
  const requestedTitle = input.title.trim();
  if (!managed && !requestedTitle) {
    throw new Error("名称不能为空。");
  }
  if (!managed && requestedTitle.length > 240) {
    throw new Error("名称不能超过 240 个字符。");
  }
  // 受组织管理的原生字段可能含历史空格或超过当前表单限制。
  // 元数据编辑必须完全忽略这些禁用字段，不能把它误判成 Chrome 修改。
  const title = managed ? current.title : requestedTitle;
  const url = managed
    ? current.url
    : validateEditableBookmarkUrl(input.url);
  const parentId = managed
    ? current.parentId || input.parentId
    : input.parentId;
  const parent = await chrome.bookmarks
    .get(parentId)
    .then(([node]) => node);
  // Chrome 保存的是用户输入的完整地址，不能用去追踪参数/普通 hash
  // 后的 canonical URL 来判断“是否需要写回”。否则用户只修改
  // utm、锚点或尾斜杠时，界面会提示成功，但 Chrome 里的网址没有变化。
  const urlPlan = bookmarkUrlEditPlan({
    source: sourceResource,
    currentUrl: current.url,
    nextUrl: url,
    ...(url !== current.url
      ? { changedUrlResourceKey: await resourceKeyForUrl(url) }
      : {})
  });
  const { bookmarkUrlChanged, targetResourceKey, resourceIdentityChanged } =
    urlPlan;
  const titleChanged = title !== current.title;
  const folderChanged = parentId !== current.parentId;
  if (
    folderChanged &&
    (!parent || parent.url || parent.unmodifiable === "managed")
  ) {
    throw new Error("目标文件夹不可写入，请选择其他文件夹。");
  }
  if (
    managed &&
    (bookmarkUrlChanged || titleChanged || folderChanged)
  ) {
    throw new Error(
      "这条收藏由 Chrome 或组织管理，只能修改 Aarre 标签和备注。"
    );
  }
  if (resourceIdentityChanged) {
    const saveState = await getBookmarkSaveState(url);
    if (
      saveState.matches.some(
        (match) => match.id !== input.bookmarkId
      )
    ) {
      throw new Error(
        "这个网址已经存在于 Chrome 收藏中。请编辑已有收藏，避免覆盖它的智能信息。"
      );
    }
  }

  const auth = await getAuthState();
  const timestamp = now();
  const requestedTags = normalizeUserTags(input.tags);
  const resolvedTags = bookmarkEditTags({
    sourceTags: sourceResource.tags,
    sourceTagsSource: sourceResource.tagsSource,
    requestedTags,
    tagsChanged: input.tagsChanged,
    resourceIdentityChanged
  });
  // 已有资源可能使用页面声明的 canonical URL，不能在仅编辑标题、备注
  // 或同 canonical URL 的细微地址变化时重新计算 key。
  const previousTarget =
    targetResourceKey === sourceResource.resourceKey
      ? undefined
      : await getLocalResource(targetResourceKey);
  const chromeMutations: UndoMutation[] = [];
  if (titleChanged || bookmarkUrlChanged) {
    chromeMutations.push(
      await snapshotNodeMutation({
        nodeId: input.bookmarkId,
        kind: "restore_update",
        label: `恢复“${current.title || current.url}”的名称和网址`
      })
    );
  }
  if (folderChanged) {
    chromeMutations.push(
      await snapshotNodeMutation({
        nodeId: input.bookmarkId,
        kind: "restore_move",
        label: `将“${current.title || current.url}”移回原文件夹`
      })
    );
  }

  let batch = chromeMutations.length
    ? createUndoBatch({
        source: "manual",
        label: `编辑“${current.title || current.url}”`,
        destructive: false,
        mutations: chromeMutations
      })
    : null;
  if (batch) {
    await putUndoSnapshot(batch);
  }

  let updatedNode = current;
  let storageChanged = false;
  internalBookmarkIds.add(input.bookmarkId);
  try {
    if (titleChanged || bookmarkUrlChanged) {
      if (batch) {
        batch = {
          ...batch,
          mutations: batch.mutations.map((mutation) =>
            mutation.kind === "restore_update"
              ? { ...mutation, applied: true }
              : mutation
          )
        };
        await putUndoSnapshot(batch);
      }
      updatedNode = await chrome.bookmarks.update(input.bookmarkId, {
        title,
        url
      });
    }
    if (folderChanged) {
      if (batch) {
        batch = {
          ...batch,
          mutations: batch.mutations.map((mutation) =>
            mutation.kind === "restore_move"
              ? { ...mutation, applied: true }
              : mutation
          )
        };
        await putUndoSnapshot(batch);
      }
      updatedNode = await chrome.bookmarks.move(input.bookmarkId, {
        parentId
      });
    }

    if (resourceIdentityChanged) {
      const { remainingSource, nextResource } =
        rehomeResourceAfterBookmarkUrlChange({
          source: sourceResource,
          ...(previousTarget ? { previousTarget } : {}),
          targetResourceKey,
          bookmarkId: input.bookmarkId,
          url,
          canonicalUrl: canonicalizeUrl(url),
          title,
          userNote: input.userNote.trim(),
          tags: resolvedTags.tags,
          categoryCoverId: categoryCoverForResource({
            url,
            title,
            topics: [],
            tags: resolvedTags.tags,
            summary: ""
          }),
          nativeFolderPath: await folderPathForId(
            updatedNode.parentId || parentId
          ),
          syncStatus: auth.configured ? "pending" : "local",
          timestamp
        });
      await upsertLocalResource(remainingSource);
      storageChanged = true;
      await upsertLocalResource(nextResource);
      if (!remainingSource.nativeBookmarkIds.length) {
        await cancelEnhancementForResource(sourceResource.resourceKey);
      }
    } else {
      await upsertLocalResource({
        ...sourceResource,
        title,
        url,
        userNote: input.userNote.trim(),
        tags: resolvedTags.tags,
        tagsSource: resolvedTags.tagsSource,
        nativeFolderPath: await folderPathForId(
          updatedNode.parentId || parentId
        ),
        syncStatus: auth.configured ? "pending" : "local",
        updatedAt: timestamp
      });
      storageChanged = true;
    }

    await importNativeBookmarks();
    const finalResource = await getLocalResource(targetResourceKey);
    if (!finalResource?.nativeBookmarkIds.includes(input.bookmarkId)) {
      throw new Error(
        "Chrome 已完成修改，但 Aarre 未能确认新的绑定状态。"
      );
    }
    if (auth.configured) {
      await enqueueOutbox(finalResource, "");
      void syncPendingIfReady();
    }
    if (resourceIdentityChanged) {
      await queueEnhancementsUntilVisit(finalResource, "recovery");
    }
    if (batch) {
      batch = { ...batch, status: "ready" };
      await putUndoSnapshot(batch);
    }
    return {
      bookmark: serializeBookmarkNode(updatedNode),
      resource: finalResource,
      // 供界面决定是否提示“重新生成摘要和封面”；仅完整地址的
      // 细微变化已经写入 Chrome，但不会错误触发跨资源增强。
      urlChanged: resourceIdentityChanged
    };
  } catch (error) {
    const storageRecoverySteps: Array<{
      name: string;
      run: () => Promise<unknown>;
    }> = [];
    if (storageChanged) {
      if (targetResourceKey !== sourceResource.resourceKey) {
        storageRecoverySteps.push(
          {
            name: "cancel-target-enhancement",
            run: () => cancelEnhancementForResource(targetResourceKey)
          },
          {
            name: "remove-target-outbox",
            run: () => removeOutboxItem(targetResourceKey)
          }
        );
      }
      storageRecoverySteps.push({
        name: "restore-source-resource",
        run: () => upsertLocalResource(sourceResource)
      });
      if (targetResourceKey !== sourceResource.resourceKey) {
        if (previousTarget) {
          storageRecoverySteps.push({
            name: "restore-previous-target",
            run: () => upsertLocalResource(previousTarget)
          });
        } else {
          storageRecoverySteps.push({
            name: "remove-created-target",
            run: () => deleteLocalResource(targetResourceKey)
          });
        }
      }
      if (auth.configured) {
        storageRecoverySteps.push({
          name: "restore-source-outbox",
          run: () => enqueueOutbox(sourceResource, "")
        });
      }
    }
    const failedRecoverySteps =
      await runBookmarkEditRecoverySteps(storageRecoverySteps);
    let chromeRollbackFailed = false;
    let rolledBackBatch: UndoSnapshotBatch | undefined;
    if (batch) {
      const rolledBack = await undoBookmarkBatch(
        batch,
        defaultFolderId,
        {
          onBeforeRemove: markInternalBookmarkRemoval,
          onAfterRemove: releaseInternalBookmarkRemoval
        }
      ).catch(() => null);
      if (rolledBack) {
        rolledBackBatch = rolledBack.batch;
      }
      chromeRollbackFailed = !rolledBack || rolledBack.failed > 0;
    }
    const finalRecoverySteps: Array<{
      name: string;
      run: () => Promise<unknown>;
    }> = [];
    if (rolledBackBatch) {
      finalRecoverySteps.push({
        name: "persist-undo-result",
        run: () => putUndoSnapshot(rolledBackBatch)
      });
    }
    finalRecoverySteps.push({
      name: "reimport-native-bookmarks",
      run: () => importNativeBookmarks()
    });
    if (sourceResource.nativeBookmarkIds.length) {
      finalRecoverySteps.push({
        name: "restore-source-enhancement",
        run: () => queueEnhancementsUntilVisit(sourceResource)
      });
    }
    failedRecoverySteps.push(
      ...(await runBookmarkEditRecoverySteps(finalRecoverySteps))
    );
    if (failedRecoverySteps.length || chromeRollbackFailed) {
      throw new Error(
        "编辑未完整完成，自动恢复也未能全部完成。请立即刷新并检查这条 Chrome 收藏。"
      );
    }
    const message =
      error instanceof Error ? error.message : "收藏信息更新失败";
    throw new Error(
      batch ? `${message} 本次修改已自动回滚。` : message
    );
  } finally {
    releaseInternalBookmarkRemoval(input.bookmarkId);
  }
}

async function createNativeFolder(input: {
  parentId: string;
  title: string;
}, skipUndo = false): Promise<NativeBookmarkNode> {
  const title = input.title.trim();
  if (!title) {
    throw new Error("文件夹名称不能为空。");
  }
  const [parent] = await chrome.bookmarks.get(input.parentId);
  if (!parent || parent.url || parent.unmodifiable === "managed") {
    throw new Error("目标文件夹不可写入。");
  }
  const perform = async () =>
    serializeBookmarkNode(
      await chrome.bookmarks.create({ parentId: input.parentId, title })
    );
  if (skipUndo) return perform();
  const mutation = await snapshotCreatedMutation({
    parentId: input.parentId,
    label: `创建文件夹“${title}”`,
    title
  });
  return runProtectedBookmarkMutation({
    label: mutation.label,
    destructive: false,
    mutation,
    perform,
    createdNodeId: (node) => node.id
  });
}

async function moveNativeBookmark(input: {
  id: string;
  parentId: string;
  index?: number;
}, skipUndo = false): Promise<NativeBookmarkNode> {
  if (input.id === input.parentId) {
    throw new Error("不能把文件夹移动到自身。");
  }
  const perform = async () =>
    serializeBookmarkNode(
      await chrome.bookmarks.move(input.id, {
        parentId: input.parentId,
        index: input.index
      })
    );
  if (skipUndo) return perform();
  const mutation = await snapshotNodeMutation({
    nodeId: input.id,
    kind: "restore_move",
    label: "移动书签或文件夹"
  });
  mutation.label = `移动“${mutation.node?.title || "书签"}”`;
  return runProtectedBookmarkMutation({
    label: mutation.label,
    destructive: false,
    mutation,
    perform
  });
}

async function deleteNativeBookmark(input: {
  id: string;
  recursive: boolean;
}, skipUndo = false): Promise<{ deleted: true }> {
  const [node] = await chrome.bookmarks.get(input.id);
  if (!node || node.unmodifiable === "managed" || node.folderType) {
    throw new Error("这个项目由 Chrome 管理，无法删除。");
  }
  const perform = async () => {
    markInternalBookmarkRemoval(input.id);
    try {
      if (node.url) {
        await chrome.bookmarks.remove(input.id);
      } else if (input.recursive) {
        await chrome.bookmarks.removeTree(input.id);
      } else {
        await chrome.bookmarks.remove(input.id);
      }
      releaseInternalBookmarkRemoval(input.id);
    } catch (error) {
      internalBookmarkIds.delete(input.id);
      throw error;
    }
    return { deleted: true as const };
  };
  if (skipUndo) return perform();
  const mutation = await snapshotNodeMutation({
    nodeId: input.id,
    kind: "restore_subtree",
    label: `删除“${node.title || node.url}”`,
    destructive: true
  });
  return runProtectedBookmarkMutation({
    label: mutation.label,
    destructive: true,
    mutation,
    perform
  });
}

function validateAgentBookmarkUrl(value: string | undefined): string {
  const text = value?.trim() || "";
  try {
    const parsed = new URL(text);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error("unsupported protocol");
    }
    return parsed.href;
  } catch {
    throw new Error("AI 操作中的书签网址无效，未执行任何写入。");
  }
}

async function createNativeBookmarkFromAgent(input: {
  parentId: string;
  title: string;
  url: string;
}): Promise<NativeBookmarkNode> {
  const title = input.title.trim();
  if (!title) {
    throw new Error("书签名称不能为空。");
  }
  const url = validateAgentBookmarkUrl(input.url);
  const saveState = await getBookmarkSaveState(url);
  if (saveState.status !== "none") {
    throw new Error(
      "这个网址已经存在于 Chrome 收藏中。为避免重复，Aarre 没有再创建一条。"
    );
  }
  const [parent] = await chrome.bookmarks.get(input.parentId);
  if (
    !parent ||
    parent.url ||
    parent.unmodifiable === "managed"
  ) {
    throw new Error("目标文件夹不可写入。");
  }
  const created = await chrome.bookmarks.create({
    parentId: parent.id,
    title: title.slice(0, 200),
    url
  });
  const [verified] = await chrome.bookmarks.get(created.id);
  if (!verified?.url || verified.url !== url) {
    throw new Error("Chrome 没有保存这个书签，请重试。");
  }
  return serializeBookmarkNode(verified);
}

async function getAgentActionTarget(
  id: string | undefined,
  kind: "bookmark" | "folder"
): Promise<chrome.bookmarks.BookmarkTreeNode> {
  if (!id) {
    throw new Error("AI 操作缺少明确目标，未执行。");
  }
  const [node] = await chrome.bookmarks.get(id);
  if (
    !node ||
    node.unmodifiable === "managed" ||
    (kind === "bookmark" ? !node.url : Boolean(node.url)) ||
    (kind === "folder" && Boolean(node.folderType))
  ) {
    throw new Error("目标已不存在或不可修改，请刷新后重新确认。");
  }
  return node;
}

function verifyAgentActionTargetUnchanged(
  action: BookmarkAgentActionProposal,
  node: chrome.bookmarks.BookmarkTreeNode
): void {
  if (
    (action.expectedTitle !== undefined &&
      node.title !== action.expectedTitle) ||
    (action.expectedUrl !== undefined &&
      node.url !== action.expectedUrl) ||
    (action.expectedParentId !== undefined &&
      node.parentId !== action.expectedParentId)
  ) {
    throw new Error(
      "目标在确认前已发生变化。为避免误操作，本次没有执行，请重新发起请求。"
    );
  }
}

async function verifyAgentActionTargetMissing(id: string): Promise<void> {
  let exists = false;
  try {
    exists = Boolean((await chrome.bookmarks.get(id))[0]);
  } catch {
    exists = false;
  }
  if (exists) {
    throw new Error("Chrome 仍返回这个项目，删除未完成。");
  }
}

async function executeBookmarkAgentAction(
  action: BookmarkAgentActionProposal
): Promise<BookmarkAgentActionExecutionResult> {
  if (!action.id || action.status !== "pending") {
    throw new Error("这项操作已经处理或状态无效。");
  }

  switch (action.type) {
    case "create_bookmark": {
      if (!action.parentId || !action.title || !action.url) {
        throw new Error("添加书签所需信息不完整。");
      }
      const created = await createNativeBookmarkFromAgent({
        parentId: action.parentId,
        title: action.title,
        url: action.url
      });
      return {
        actionId: action.id,
        success: true,
        message: `已创建书签「${created.title}」，并从 Chrome 重新读取确认。`,
        createdNodeId: created.id
      };
    }
    case "create_folder": {
      if (!action.parentId || !action.title) {
        throw new Error("新建文件夹所需信息不完整。");
      }
      const created = await createNativeFolder({
        parentId: action.parentId,
        title: action.title
      }, true);
      const [verified] = await chrome.bookmarks.get(created.id);
      if (!verified || verified.url) {
        throw new Error("Chrome 没有保存这个文件夹，请重试。");
      }
      return {
        actionId: action.id,
        success: true,
        message: `已创建文件夹「${verified.title}」，并从 Chrome 重新读取确认。`,
        createdNodeId: verified.id
      };
    }
    case "delete_bookmark": {
      const target = await getAgentActionTarget(
        action.targetId,
        "bookmark"
      );
      verifyAgentActionTargetUnchanged(action, target);
      await deleteNativeBookmark({
        id: target.id,
        recursive: false
      }, true);
      await verifyAgentActionTargetMissing(target.id);
      return {
        actionId: action.id,
        success: true,
        message: `已从 Chrome 删除书签「${target.title || target.url}」。`
      };
    }
    case "delete_folder": {
      const target = await getAgentActionTarget(
        action.targetId,
        "folder"
      );
      verifyAgentActionTargetUnchanged(action, target);
      const count = countBookmarkNodes(target).bookmarkCount;
      await deleteNativeBookmark({
        id: target.id,
        recursive: true
      }, true);
      await verifyAgentActionTargetMissing(target.id);
      return {
        actionId: action.id,
        success: true,
        message: `已从 Chrome 删除文件夹「${target.title}」及其中 ${count} 个书签。`
      };
    }
    case "update_bookmark": {
      const target = await getAgentActionTarget(
        action.targetId,
        "bookmark"
      );
      verifyAgentActionTargetUnchanged(action, target);
      const updated = await updateNativeBookmark({
        id: target.id,
        title: action.title || target.title,
        url: validateAgentBookmarkUrl(action.url || target.url)
      }, true);
      const [verified] = await chrome.bookmarks.get(updated.id);
      if (
        !verified ||
        verified.title !== updated.title ||
        verified.url !== updated.url
      ) {
        throw new Error("Chrome 返回的书签与修改结果不一致。");
      }
      return {
        actionId: action.id,
        success: true,
        message: `已修改书签「${verified.title}」，并从 Chrome 重新读取确认。`
      };
    }
    case "rename_folder": {
      const target = await getAgentActionTarget(
        action.targetId,
        "folder"
      );
      verifyAgentActionTargetUnchanged(action, target);
      const updated = await updateNativeBookmark({
        id: target.id,
        title: action.title || ""
      }, true);
      const [verified] = await chrome.bookmarks.get(updated.id);
      if (!verified || verified.title !== updated.title) {
        throw new Error("Chrome 返回的文件夹名称与修改结果不一致。");
      }
      return {
        actionId: action.id,
        success: true,
        message: `已将文件夹重命名为「${verified.title}」。`
      };
    }
    case "move_bookmark":
    case "move_folder": {
      const target = await getAgentActionTarget(
        action.targetId,
        action.type === "move_bookmark" ? "bookmark" : "folder"
      );
      verifyAgentActionTargetUnchanged(action, target);
      if (!action.destinationId) {
        throw new Error("移动操作缺少目标文件夹。");
      }
      const [destination] = await chrome.bookmarks.get(
        action.destinationId
      );
      if (
        !destination ||
        destination.url ||
        destination.unmodifiable === "managed"
      ) {
        throw new Error("目标文件夹已不存在或不可写入。");
      }
      const moved = await moveNativeBookmark({
        id: target.id,
        parentId: destination.id
      }, true);
      const [verified] = await chrome.bookmarks.get(moved.id);
      if (!verified || verified.parentId !== destination.id) {
        throw new Error("Chrome 返回的位置与移动结果不一致。");
      }
      return {
        actionId: action.id,
        success: true,
        message: `已将「${verified.title}」移动到「${destination.title}」。`
      };
    }
  }
}

async function prepareAgentUndoBatch(
  actions: BookmarkAgentActionProposal[],
  label = `AI 批量操作（${actions.length} 项）`
): Promise<UndoSnapshotBatch> {
  const mutations: UndoMutation[] = [];
  for (const action of actions) {
    if (action.type === "create_bookmark" || action.type === "create_folder") {
      if (!action.parentId || !action.title) {
        throw new Error("AI 操作缺少创建目标，无法建立撤销快照。");
      }
      mutations.push(
        await snapshotCreatedMutation({
          parentId: action.parentId,
          actionId: action.id,
          label: action.label,
          title: action.title,
          url: action.type === "create_bookmark" ? action.url : undefined,
          destructive: action.destructive
        })
      );
      continue;
    }
    if (!action.targetId) {
      throw new Error("AI 操作缺少明确目标，无法建立撤销快照。");
    }
    mutations.push(
      await snapshotNodeMutation({
        nodeId: action.targetId,
        actionId: action.id,
        kind:
          action.type === "delete_bookmark" || action.type === "delete_folder"
            ? "restore_subtree"
            : action.type === "move_bookmark" || action.type === "move_folder"
              ? "restore_move"
              : "restore_update",
        label: action.label,
        destructive: action.destructive
      })
    );
  }
  const batch = createUndoBatch({
    source: "agent",
    label,
    destructive: actions.some((action) => action.destructive),
    mutations
  });
  await putUndoSnapshot(batch);
  return batch;
}

async function executeBookmarkAgentActions(
  actions: BookmarkAgentActionProposal[],
  options: { maxActions?: number; label?: string } = {}
): Promise<{
  results: BookmarkAgentActionExecutionResult[];
  batchId?: string;
}> {
  const maxActions = options.maxActions ?? 8;
  if (
    !Array.isArray(actions) ||
    !actions.length ||
    actions.length > maxActions ||
    actions.some((action) => action.status !== "pending")
  ) {
    throw new Error("没有可执行的已确认操作。");
  }
  let batch = await prepareAgentUndoBatch(actions, options.label);
  const results: BookmarkAgentActionExecutionResult[] = [];
  for (const action of actions) {
    const mutationIndex = batch.mutations.findIndex(
      (mutation) => mutation.actionId === action.id
    );
    let executed = false;
    let executionResult: BookmarkAgentActionExecutionResult | null = null;
    try {
      if (mutationIndex < 0) {
        throw new Error("这项操作没有对应的撤销快照，已拒绝执行。");
      }
      batch.mutations[mutationIndex] = {
        ...batch.mutations[mutationIndex],
        applied: true
      };
      await putUndoSnapshot(batch);
      executionResult = await executeBookmarkAgentAction(action);
      executed = true;
      if (executionResult.createdNodeId) {
        batch.mutations[mutationIndex] = {
          ...batch.mutations[mutationIndex],
          createdNodeId: executionResult.createdNodeId
        };
      }
      await putUndoSnapshot(batch);
      results.push(executionResult);
    } catch (error) {
      if (mutationIndex >= 0 && !executed) {
        batch.mutations[mutationIndex] = {
          ...batch.mutations[mutationIndex],
          applied: false
        };
        await putUndoSnapshot(batch).catch(() => undefined);
      }
      results.push(
        executed && executionResult
          ? {
              ...executionResult,
              message: `${executionResult.message} 撤销记录的状态更新失败，但执行前快照仍保留。`
            }
          : {
              actionId: action?.id || "",
              success: false,
              message: errorMessage(error)
            }
      );
    }
  }
  const succeeded = results.filter((result) => result.success).length;
  if (succeeded) {
    batch = { ...batch, status: "ready" };
    await putUndoSnapshot(batch);
  } else {
    await deleteUndoSnapshot(batch.batchId);
  }
  await importNativeBookmarks();
  return {
    results,
    ...(succeeded ? { batchId: batch.batchId } : {})
  };
}

async function getRecentUndoSnapshots(): Promise<UndoSnapshotBatch[]> {
  await cleanupExpiredUndoSnapshots();
  return (await getUndoSnapshots()).filter(
    (batch) => batch.status !== "undone"
  );
}

async function undoStoredBookmarkBatch(batchId: string) {
  const batch = await getUndoSnapshot(batchId);
  if (!batch) {
    throw new Error("没有找到这批更改，可能已超过 30 天保留期。");
  }
  const result = await undoBookmarkBatch(batch, defaultFolderId, {
    onBeforeRemove: markInternalBookmarkRemoval,
    onAfterRemove: releaseInternalBookmarkRemoval
  });
  await putUndoSnapshot(result.batch);
  await importNativeBookmarks();
  return result;
}

async function folderPathForId(folderId: string): Promise<string[]> {
  const options = await getFolderOptions();
  return options.find((item) => item.id === folderId)?.path || [];
}

async function captureActivePage(tabId?: number): Promise<PageCapture> {
  const tab =
    typeof tabId === "number"
      ? await chrome.tabs.get(tabId).catch(() => null)
      : await activeTab();
  if (!tab?.id || !tab.url || !isSupportedPageUrl(tab.url)) {
    throw new Error("当前页面受 Chrome 保护，无法读取网页内容。");
  }

  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["content-capture.js"]
  });

  const response = (await chrome.tabs.sendMessage(tab.id, {
    type: "BOOKMARK_LAYER_CAPTURE_PAGE"
  })) as
    | { ok: true; data: PageCapture }
    | { ok: false; error: string };

  if (!response?.ok) {
    throw new Error(response?.error || "无法读取当前网页。");
  }

  return {
    ...response.data,
    faviconUrl: response.data.faviconUrl || tab.favIconUrl || ""
  };
}

async function captureRenderedPageForDocument(
  tabId: number,
  expectedDocumentId?: string
): Promise<PageCapture> {
  const [before] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => globalThis.location.href
  });
  if (
    !before?.result ||
    (expectedDocumentId && before.documentId !== expectedDocumentId)
  ) {
    throw new Error("页面文档已经变化，等待下次访问。");
  }
  const [stability] = await chrome.scripting.executeScript({
    target: { tabId },
    func: waitForStablePageInDocument,
    args: [900, 4_000]
  });
  if (
    stability?.result !== true ||
    stability.documentId !== before.documentId
  ) {
    throw new Error("页面尚未稳定，等待下次访问。");
  }
  const capture = await captureActivePage(tabId);
  const [after] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => globalThis.location.href
  });
  if (
    after?.result !== before.result ||
    after.documentId !== before.documentId
  ) {
    throw new Error("读取正文期间页面已变化，等待下次访问。");
  }
  return capture;
}

async function coordinateActiveBookmarkedPage(
  tab: chrome.tabs.Tab,
  documentId?: string,
  trigger: SnapshotEnhancementProgress["trigger"] = "normal_browse"
): Promise<void> {
  if (
    typeof tab.id !== "number" ||
    !tab.url ||
    !isLoadedSnapshotTab(tab)
  ) {
    return;
  }
  // SPA 的 history 路由切换不会触发完整 reload。先丢弃旧路由的目标，
  // 避免在 A 页登记的任务误截成 B 页。
  await discardMismatchedImmediateSnapshotTarget(tab);
  const immediateTarget = await readImmediateSnapshotTarget(tab.id);
  const immediateResource = immediateTarget
    ? await getLocalResource(immediateTarget.resourceKey)
    : undefined;
  const resource =
    immediateTarget &&
    immediateResource &&
    snapshotTargetAllowsLoadedUrl(
      immediateTarget,
      immediateResource,
      tab.url
    )
      ? immediateResource
      : await bookmarkedResourceForLoadedUrl(tab.url);
  if (!resource?.nativeBookmarkIds.length) return;
  const effectiveTrigger = immediateTarget?.trigger || trigger;
  const settings = await getDisplaySettings();
  const privacyBlocked = isSnapshotSensitiveUrl(
    tab.url,
    settings.snapshotExcludedHosts
  );
  const existingSnapshot = await getPageSnapshot(resource.canonicalUrl);
  const snapshotPolicy = snapshotCapturePolicy({
    hasSnapshot: Boolean(existingSnapshot),
    snapshotIsStale: isPageSnapshotStale(existingSnapshot),
    trigger: effectiveTrigger
  });
  const needsAi =
    resource.aiStatus !== "ready" ||
    !resource.summary.trim() ||
    !resource.tags.length;

  if (snapshotPolicy.capture && !privacyBlocked) {
    await enqueueBookmarkEnhancement(resource, ["snapshot"], {
      state: "queued",
      trigger: effectiveTrigger,
      tabId: tab.id,
      ...(documentId ? { documentId } : {}),
      loadedUrl: tab.url,
      ...(snapshotPolicy.showToast ? { showToast: true } : {}),
      ...(snapshotPolicy.refreshExisting ? { refreshExisting: true } : {})
    });
    await rememberImmediateSnapshotTarget(
      tab,
      resource.canonicalUrl,
      effectiveTrigger === "aarre_open" ||
        effectiveTrigger === "batch_backfill"
        ? effectiveTrigger === "batch_backfill"
          ? BATCH_PAGE_SNAPSHOT_DELAY_MS
          : AARRE_OPEN_PAGE_SNAPSHOT_DELAY_MS
        : SAVED_PAGE_SNAPSHOT_DELAY_MS,
      snapshotPolicy.showToast,
      resource.resourceKey,
      documentId,
      effectiveTrigger
    );
  }

  if (!enhancementTriggerAllowsRenderedAi(effectiveTrigger)) return;
  if (!needsAi) return;
  if (privacyBlocked) {
    await upsertLocalResource({
      ...resource,
      aiStatus: "unavailable",
      enhancementBlockReason: "privacy",
      enhancementBlockMessage:
        "Aarre 不会读取或发送内网、银行、支付和医疗页面内容。",
      updatedAt: now()
    });
    await updateStoredAiProgress(resource.resourceKey, {
      state: "privacy_blocked",
      lastError: "隐私保护网站不读取或发送页面内容。"
    });
    await updateStoredSnapshotProgress(resource.resourceKey, {
      state: "privacy_blocked",
      trigger: effectiveTrigger,
      lastError: "隐私保护网站不生成页面截图。"
    });
    await completeStoredEnhancementPart(resource.resourceKey, "ai");
    await completeStoredEnhancementPart(resource.resourceKey, "snapshot");
    return;
  }
  await enqueueBookmarkEnhancement(resource, ["ai"]);
  const runtime = await getAiRuntimeSettings();
  if (!runtime.apiKey) {
    await updateStoredAiProgress(resource.resourceKey, {
      state: "waiting_for_key",
      tabId: tab.id,
      ...(documentId ? { documentId } : {}),
      lastError: `等待配置 ${getAiProviderPreset(runtime.provider).name} API Key。`
    });
    return;
  }
  if (renderedPageEnhancementRunning.has(resource.resourceKey)) {
    return;
  }
  renderedPageEnhancementRunning.add(resource.resourceKey);
  try {
    await updateStoredAiProgress(resource.resourceKey, {
      state: "processing",
      tabId: tab.id,
      ...(documentId ? { documentId } : {})
    });
    const page = await captureRenderedPageForDocument(tab.id, documentId);
    const latest = await getLocalResource(resource.resourceKey);
    if (!latest?.nativeBookmarkIds.length) return;
    const prepared: ResourceRecord = {
      ...latest,
      url: page.url,
      title: latest.title || page.title,
      contentExcerpt: page.excerpt,
      contentHash: await hashText(page.content),
      selectedText: page.selectedText,
      author: page.author,
      siteName: page.siteName,
      language: page.language,
      imageUrl: page.imageUrl,
      faviconUrl: page.faviconUrl || latest.faviconUrl,
      aiStatus: "processing",
      enhancementBlockReason: undefined,
      enhancementBlockMessage: undefined,
      updatedAt: now()
    };
    await upsertLocalResource(prepared);
    const enriched = await enrichResourceLocally(prepared, page);
    await upsertLocalResource(enriched);
    await completeStoredEnhancementPart(resource.resourceKey, "ai");
  } catch (error) {
    await updateStoredAiProgress(resource.resourceKey, {
      state: "retry",
      tabId: tab.id,
      ...(documentId ? { documentId } : {}),
      lastError: errorMessage(error)
    });
    await deferStoredEnhancementJob(
      resource.resourceKey,
      errorMessage(error)
    );
  } finally {
    renderedPageEnhancementRunning.delete(resource.resourceKey);
  }
}

function clearPageSnapshotTimer(tabId: number) {
  const timer = pageSnapshotTimers.get(tabId);
  if (timer !== undefined) globalThis.clearTimeout(timer);
  pageSnapshotTimers.delete(tabId);
}

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
    if (
      !snapshotBackfillLeaseAllowsCapture(
        {
          state: job.state,
          jobId: job.id,
          currentResourceKey: job.currentResourceKey,
          expectedTabId: job.tabId,
          currentLease: job.currentLease
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
    if (resource?.nativeBookmarkIds.length && !existingSnapshot) {
      await putPageSnapshot(input.snapshot);
      stored = true;
      try {
        const latestResource = await getLocalResource(
          input.lease.resourceKey
        );
        if (!latestResource?.nativeBookmarkIds.length) {
          await deletePageSnapshot(input.canonicalUrl);
          stored = false;
        } else {
          await upsertLocalResource({
            ...latestResource,
            snapshotAt: input.capturedAt,
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
    job.nextIndex = Math.min(
      job.resourceKeys.length,
      job.nextIndex + 1
    );
    job.currentResourceKey = undefined;
    job.currentAttempt = 0;
    job.currentLease = undefined;
    return {
      accepted: true,
      stored,
      job: { ...job }
    } satisfies SnapshotBackfillCommitResult;
  });

  if (!result.accepted || !result.job) return result;
  await clearSnapshotBackfillTimeouts(result.job.id);
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

/**
 * executeScript 没有自己的超时；网页主线程被占满或页面无响应时，其
 * Promise 可能长期不返回。这里用 Promise.race 强制兜底，避免批量任务
 * 一直挂在同一个网站上。超时后旧的注入 Promise 可能仍在后台挂起，但
 * 不再阻塞本任务流程。
 */
async function executeScriptWithTimeout(
  injection: {
    target: { tabId: number };
    func: (...args: any[]) => unknown;
    args?: unknown[];
  },
  timeoutMs: number
): Promise<chrome.scripting.InjectionResult<unknown>[] | undefined> {
  return Promise.race([
    chrome.scripting.executeScript({
      target: injection.target,
      func: injection.func as never,
      ...(injection.args
        ? { args: injection.args as never[] }
        : {})
    }),
    new Promise<undefined>((resolve) => {
      globalThis.setTimeout(() => resolve(undefined), timeoutMs);
    })
  ]);
}

/**
 * 通过 chrome.debugger（CDP）对后台标签页截图。captureVisibleTab 只能截
 * 当前窗口的活动标签页，这是“批量补拍不占前台”的唯一可行路径。
 * 页面级截图不读取正文、不上传，仍保持项目既有隐私边界。
 */
async function capturePageSnapshotViaDebugger(
  tabId: number
): Promise<string> {
  await chrome.debugger.attach({ tabId }, "1.3");
  try {
    await chrome.debugger.sendCommand({ tabId }, "Page.enable");
    const result = (await chrome.debugger.sendCommand(
      { tabId },
      "Page.captureScreenshot",
      { format: "png" }
    )) as { data?: string };
    if (!result?.data) {
      throw new Error("调试协议未返回截图数据。");
    }
    return `data:image/png;base64,${result.data}`;
  } finally {
    await chrome.debugger.detach({ tabId }).catch(() => undefined);
  }
}

async function capturePageSnapshotForTab(
  tabId: number,
  expectedLoadedUrl: string,
  snapshotUrl = expectedLoadedUrl,
  options: {
    resourceKey?: string;
    showToast?: boolean;
    refreshExisting?: boolean;
    documentId?: string;
    trigger?: SnapshotEnhancementProgress["trigger"];
    backfillLease?: SnapshotBackfillLease;
  } = {}
): Promise<boolean> {
  const isBatch = options.trigger === "batch_backfill";
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (
    !tab ||
    typeof tab.windowId !== "number" ||
    // 批量后台补拍允许非活动标签页；普通路径仍要求前台活动页。
    !isLoadedSnapshotTab(tab, expectedLoadedUrl, !isBatch)
  ) {
    return false;
  }
  const settings = await getDisplaySettings();
  if (
    !settings.pageSnapshotsEnabled ||
    isSnapshotSensitiveUrl(tab.url!, settings.snapshotExcludedHosts) ||
    isSnapshotSensitiveUrl(snapshotUrl, settings.snapshotExcludedHosts)
  ) {
    return false;
  }
  const fallbackCanonicalUrl = canonicalizeUrl(snapshotUrl);
  const resourceKey =
    options.resourceKey || (await resourceKeyForUrl(fallbackCanonicalUrl));
  const resource = await getLocalResource(resourceKey);
  if (!resource?.nativeBookmarkIds.length) return false;
  if (
    options.trigger === "batch_backfill" &&
    (!options.backfillLease ||
      !(await snapshotBackfillAllowsCapture(options.backfillLease)))
  ) {
    return false;
  }
  const canonicalUrl = resource.canonicalUrl || fallbackCanonicalUrl;

  if (!isBatch) {
    const [targetWindow, focusedWindow] = await Promise.all([
      chrome.windows.get(tab.windowId),
      chrome.windows.getLastFocused()
    ]);
    if (
      targetWindow.focused !== true ||
      focusedWindow.id !== tab.windowId ||
      focusedWindow.focused !== true
    ) {
      return false;
    }
    const [active] = await chrome.tabs.query({
      active: true,
      windowId: tab.windowId
    });
    if (
      active?.id !== tab.id ||
      !isLoadedSnapshotTab(active, expectedLoadedUrl)
    ) {
      return false;
    }
  }

  await updateStoredSnapshotProgress(resourceKey, {
    state: "stabilizing",
    trigger: options.trigger || "recovery",
    tabId,
    ...(options.documentId ? { documentId: options.documentId } : {}),
    loadedUrl: tab.url!,
    ...(options.showToast ? { showToast: true } : {}),
    ...(options.refreshExisting ? { refreshExisting: true } : {})
  });
  const [stabilityResult] =
    (await executeScriptWithTimeout(
      {
        target: { tabId },
        func: waitForStablePageInDocument,
        args: isBatch
          ? [
              500,
              2_000,
              {
                fontTimeoutMs: 1_500,
                imageTimeoutMs: 1_500
              }
            ]
          : [900, 4_000]
      },
      SNAPSHOT_BACKFILL_STABILITY_TIMEOUT_MS
    )) || [];
  if (
    stabilityResult?.result !== true ||
    (options.documentId &&
      stabilityResult.documentId !== options.documentId)
  ) {
    return false;
  }

  if (isBatch && options.backfillLease) {
    // Cloudflare 等“安全验证”页截图没有价值，而且常常自行跳转或持续轮询；
    // 识别后立即结算失败，避免拖住整个队列。
    const [challengeResult] =
      (await executeScriptWithTimeout(
        {
          target: { tabId },
          func: detectBotChallengeInDocument
        },
        SNAPSHOT_BACKFILL_CHALLENGE_TIMEOUT_MS
      )) || [];
    if (challengeResult?.result === true) {
      await recordSnapshotBackfillItem(
        "failed",
        "网站要求安全验证（如 Cloudflare），无法获取真实页面截图。",
        {
          jobId: options.backfillLease.jobId,
          resourceKey: options.backfillLease.resourceKey,
          leaseToken: options.backfillLease.token
        }
      );
      void driveSnapshotBackfill();
      return false;
    }
  }

  // 等待期间用户可能已经切换标签或发起了下一次导航，截图前必须重新核对。
  const stableTab = await chrome.tabs.get(tabId).catch(() => null);
  if (
    !stableTab ||
    stableTab.windowId !== tab.windowId ||
    !isLoadedSnapshotTab(stableTab, expectedLoadedUrl, !isBatch)
  ) {
    return false;
  }
  if (!isBatch) {
    const [stableTargetWindow, stableFocusedWindow] = await Promise.all([
      chrome.windows.get(stableTab.windowId),
      chrome.windows.getLastFocused()
    ]);
    if (
      stableTargetWindow.focused !== true ||
      stableFocusedWindow.id !== stableTab.windowId ||
      stableFocusedWindow.focused !== true
    ) {
      return false;
    }
    const [stableActive] = await chrome.tabs.query({
      active: true,
      windowId: stableTab.windowId
    });
    if (
      stableActive?.id !== tabId ||
      !isLoadedSnapshotTab(stableActive, expectedLoadedUrl)
    ) {
      return false;
    }
  }
  const [documentCheck] =
    (await executeScriptWithTimeout(
      {
        target: { tabId },
        func: () => globalThis.location.href
      },
      SNAPSHOT_BACKFILL_STABILITY_TIMEOUT_MS
    )) || [];
  if (
    !documentCheck?.result ||
    documentCheck.result !== stableTab.url ||
    documentCheck.documentId !== stabilityResult.documentId
  ) {
    return false;
  }
  const resourceBeforeCapture = await getLocalResource(resourceKey);
  if (!resourceBeforeCapture?.nativeBookmarkIds.length) return false;
  if (
    options.trigger === "batch_backfill" &&
    (!options.backfillLease ||
      !(await snapshotBackfillAllowsCapture(options.backfillLease)))
  ) {
    return false;
  }

  await updateStoredSnapshotProgress(resourceKey, {
    state: "capturing",
    trigger: options.trigger || "recovery",
    tabId,
    documentId: stabilityResult.documentId,
    loadedUrl: stableTab.url!,
    ...(options.showToast ? { showToast: true } : {}),
    ...(options.refreshExisting ? { refreshExisting: true } : {})
  });
  const pngDataUrl = isBatch
    ? await capturePageSnapshotViaDebugger(tabId)
    : await chrome.tabs.captureVisibleTab(tab.windowId, {
        format: "png"
      });
  // 截图调用本身是异步的。返回后再次确认同一文档仍是前台页，避免把用户
  // 刚切换到的页面按旧收藏 URL 落库。
  const capturedTab = await chrome.tabs.get(tabId).catch(() => null);
  let capturedDocument:
    | chrome.scripting.InjectionResult<unknown>
    | undefined;
  if (!isBatch) {
    const [capturedTargetWindow, capturedWindow] = await Promise.all([
      chrome.windows.get(tab.windowId),
      chrome.windows.getLastFocused()
    ]);
    const [capturedActive] = await chrome.tabs.query({
      active: true,
      windowId: tab.windowId
    });
    if (
      capturedTargetWindow.focused !== true ||
      capturedWindow.id !== tab.windowId ||
      capturedWindow.focused !== true ||
      capturedActive?.id !== tabId
    ) {
      return false;
    }
  }
  [capturedDocument] =
    (await executeScriptWithTimeout(
      {
        target: { tabId },
        func: () => globalThis.location.href
      },
      SNAPSHOT_BACKFILL_STABILITY_TIMEOUT_MS
    )) || [];
  if (
    !capturedTab ||
    !isLoadedSnapshotTab(capturedTab, expectedLoadedUrl, !isBatch) ||
    capturedDocument?.result !== capturedTab.url ||
    capturedDocument.documentId !== stabilityResult.documentId
  ) {
    return false;
  }
  const capturedAt = now();
  const snapshot = await createPageSnapshot(
    canonicalUrl,
    pngDataUrl,
    capturedAt
  );
  if (options.trigger === "batch_backfill") {
    if (!options.backfillLease) return false;
    const committed = await commitSnapshotBackfillCapture({
      lease: options.backfillLease,
      canonicalUrl,
      snapshot,
      capturedAt
    });
    // accepted=true 也包含“另一路已经先写入截图”的安全跳过；该项已结算，
    // 定时器应停止且目标可以释放。
    return committed.accepted;
  }

  const resourceImmediatelyBeforeStore = await getLocalResource(resourceKey);
  if (!resourceImmediatelyBeforeStore?.nativeBookmarkIds.length) return false;
  await putPageSnapshot(snapshot);
  // AI 富化或原生书签事件可能在稳定等待期间更新同一资源。
  // 必须重新读取后只追加 snapshotAt，不能用等待前的旧对象覆盖新元数据。
  const latestResource = await getLocalResource(resourceKey);
  if (!latestResource?.nativeBookmarkIds.length) {
    await deletePageSnapshot(canonicalUrl);
    return false;
  }
  await upsertLocalResource({
    ...latestResource,
    snapshotAt: capturedAt,
    updatedAt: latestResource.updatedAt
  });
  void chrome.runtime
    .sendMessage({
      type: "PAGE_SNAPSHOT_UPDATED",
      canonicalUrl,
      capturedAt
    })
    .catch(() => undefined);
  await completeStoredEnhancementPart(
    options.resourceKey || resourceKey,
    "snapshot"
  );
  if (options.showToast) {
    await chrome.scripting
      .executeScript({
        target: { tabId },
        func: showSnapshotUpdatedToastInDocument
      })
      .catch(() => undefined);
  }
  return true;
}

interface PageSnapshotScheduleOptions {
  delayMs?: number;
  snapshotUrl?: string;
  resourceKey?: string;
  showToast?: boolean;
  refreshExisting?: boolean;
  documentId?: string;
  trigger?: SnapshotEnhancementProgress["trigger"];
  backfillLease?: SnapshotBackfillLease;
  onSettled?: (succeeded: boolean) => void;
}

function schedulePageSnapshotForTab(
  tab: chrome.tabs.Tab,
  options: PageSnapshotScheduleOptions = {}
): boolean {
  if (
    typeof tab.id !== "number" ||
    !tab.url ||
    !isLoadedSnapshotTab(tab, "", options.trigger !== "batch_backfill")
  ) {
    return false;
  }
  const tabId = tab.id;
  const expectedLoadedUrl = tab.url;
  clearPageSnapshotTimer(tab.id);
  const timer = globalThis.setTimeout(() => {
    pageSnapshotTimers.delete(tabId);
    void capturePageSnapshotForTab(
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
    )
      .catch(async (error) => {
        if (options.resourceKey) {
          await updateStoredSnapshotProgress(options.resourceKey, {
            state: "retry",
            trigger: options.trigger || "recovery",
            tabId,
            loadedUrl: expectedLoadedUrl,
            ...(options.documentId
              ? { documentId: options.documentId }
              : {}),
            ...(options.showToast ? { showToast: true } : {}),
            ...(options.refreshExisting ? { refreshExisting: true } : {}),
            lastError: errorMessage(error)
          }).catch(() => undefined);
          await deferStoredEnhancementJob(
            options.resourceKey,
            errorMessage(error)
          ).catch(() => undefined);
        }
        return false;
      })
      .then(async (succeeded) => {
        if (!succeeded && options.resourceKey) {
          await updateStoredSnapshotProgress(options.resourceKey, {
            state:
              options.trigger === "batch_backfill"
                ? "retry"
                : "waiting_foreground",
            trigger: options.trigger || "recovery",
            tabId,
            loadedUrl: expectedLoadedUrl,
            ...(options.documentId
              ? { documentId: options.documentId }
              : {}),
            ...(options.showToast ? { showToast: true } : {}),
            ...(options.refreshExisting ? { refreshExisting: true } : {}),
            lastError:
              options.trigger === "batch_backfill"
                ? "批量补拍未能稳定截图，任务会快速重试后继续。"
                : "页面在稳定等待或截图期间离开前台，等待下次正常访问。"
          }).catch(() => undefined);
        }
        options.onSettled?.(succeeded);
      });
  }, options.delayMs ?? AARRE_OPEN_PAGE_SNAPSHOT_DELAY_MS) as unknown as number;
  pageSnapshotTimers.set(tab.id, timer);
  return true;
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
  if (
    job.state !== "running" ||
    job.id !== options.backfillLease.jobId ||
    job.currentLease !== options.backfillLease.token ||
    job.currentResourceKey !== options.backfillLease.resourceKey
  ) {
    // 用户暂停、任务已结算或已推进到下一项时，不再重试旧截图。
    return;
  }
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab || !isLoadedSnapshotTab(tab, expectedLoadedUrl, false)) {
    return;
  }
  const succeeded = await capturePageSnapshotForTab(
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
  if (
    latest.state === "running" &&
    latest.id === options.backfillLease.jobId &&
    latest.currentLease === options.backfillLease.token &&
    latest.currentResourceKey === options.backfillLease.resourceKey
  ) {
    await recordSnapshotBackfillItem(
      "failed",
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

async function snapshotBackfillTargetTab(
  job: StoredSnapshotBackfillJob
): Promise<chrome.tabs.Tab | null> {
  if (
    typeof job.tabId !== "number" ||
    typeof job.windowId !== "number"
  ) {
    return null;
  }
  const tab = await chrome.tabs.get(job.tabId).catch(() => null);
  // 批量补拍使用 chrome.debugger 对后台标签页截图，不再要求窗口聚焦或
  // 标签活动；用户可以在任务运行时正常使用 Chrome。
  if (!tab || tab.windowId !== job.windowId || tab.incognito) return null;
  return tab;
}

async function isBatchBackfillTab(tabId: number): Promise<boolean> {
  const job = await getStoredSnapshotBackfill();
  return (
    job.tabId === tabId &&
    ["running", "waiting_focus"].includes(job.state)
  );
}

/**
 * 页面加载完成后把超时重置为“就绪预算”：
 * 45 秒是导航兜底，complete 之后只给稳定等待 + 截图 + 落库 30 秒。
 * 这样慢网站只要加载完成，就不会被导航阶段的计时误杀。
 */
async function resetSnapshotBackfillTimeoutForTab(
  tabId: number
): Promise<void> {
  const job = await getStoredSnapshotBackfill();
  if (
    job.tabId !== tabId ||
    job.state !== "running" ||
    !job.currentLease ||
    !job.currentResourceKey
  ) {
    return;
  }
  const lease = snapshotBackfillLeaseFromJob(job);
  if (lease) {
    await scheduleSnapshotBackfillTimeout(
      lease,
      SNAPSHOT_BACKFILL_READY_TIMEOUT_MINUTES
    );
  }
}

function snapshotBackfillLeaseFromJob(
  job: StoredSnapshotBackfillJob
): SnapshotBackfillLease | undefined {
  if (
    !job.id ||
    !job.currentResourceKey ||
    typeof job.tabId !== "number" ||
    !job.currentLease
  ) {
    return undefined;
  }
  return {
    jobId: job.id,
    resourceKey: job.currentResourceKey,
    tabId: job.tabId,
    token: job.currentLease
  };
}

function snapshotBackfillTimeoutAlarmName(
  lease: SnapshotBackfillLease
): string {
  return `${SNAPSHOT_BACKFILL_TIMEOUT_ALARM}:${lease.jobId}:${lease.token}`;
}

function snapshotBackfillTimeoutIdentity(
  alarmName: string
): { jobId: string; token: string } | undefined {
  const prefix = `${SNAPSHOT_BACKFILL_TIMEOUT_ALARM}:`;
  if (!alarmName.startsWith(prefix)) return undefined;
  const [jobId, token, extra] = alarmName.slice(prefix.length).split(":");
  if (!jobId || !token || extra) return undefined;
  return { jobId, token };
}

async function clearSnapshotBackfillTimeouts(
  jobId: string
): Promise<void> {
  await chrome.alarms.clear(SNAPSHOT_BACKFILL_TIMEOUT_ALARM);
  const prefix = `${SNAPSHOT_BACKFILL_TIMEOUT_ALARM}:${jobId}:`;
  const alarms = await chrome.alarms.getAll().catch(() => []);
  await Promise.all(
    alarms
      .filter((alarm) => alarm.name.startsWith(prefix))
      .map((alarm) => chrome.alarms.clear(alarm.name))
  );
}

async function scheduleSnapshotBackfillTimeout(
  lease: SnapshotBackfillLease,
  delayInMinutes = SNAPSHOT_BACKFILL_PAGE_TIMEOUT_MINUTES
): Promise<void> {
  await clearSnapshotBackfillTimeouts(lease.jobId);
  await chrome.alarms.create(snapshotBackfillTimeoutAlarmName(lease), {
    delayInMinutes
  });
}

async function invalidateSnapshotBackfillCapture(
  job: Pick<StoredSnapshotBackfillJob, "id" | "tabId">
): Promise<void> {
  if (typeof job.tabId === "number") {
    clearPageSnapshotTimer(job.tabId);
    await removeImmediateSnapshotTarget(job.tabId).catch(
      () => undefined
    );
  }
  if (job.id) await clearSnapshotBackfillTimeouts(job.id);
}

async function reserveSnapshotBackfillAttempt(
  expected: StoredSnapshotBackfillJob,
  resource: ResourceRecord,
  forceNewLease: boolean
): Promise<SnapshotBackfillLease | undefined> {
  const nextToken = crypto.randomUUID();
  return mutateStoredSnapshotBackfill((current) => {
    if (
      current.id !== expected.id ||
      current.currentResourceKey !== resource.resourceKey ||
      current.tabId !== expected.tabId ||
      current.state !== "running" ||
      typeof current.tabId !== "number"
    ) {
      return undefined;
    }
    if (!current.currentLease || forceNewLease) {
      // 失焦/暂停只会撤销 capture lease，不应消耗网络重试次数。
      // 首次真正导航计一次；只有超时/加载失败的 retry 才继续递增。
      if (forceNewLease || current.currentAttempt === 0) {
        current.currentAttempt += 1;
      }
      current.currentLease = nextToken;
    }
    current.currentTitle = resource.title || resource.url;
    current.updatedAt = now();
    return snapshotBackfillLeaseFromJob(current);
  });
}

async function snapshotBackfillAllowsCapture(
  lease: SnapshotBackfillLease
): Promise<boolean> {
  const job = await getStoredSnapshotBackfill();
  return snapshotBackfillLeaseAllowsCapture(
    {
      state: job.state,
      jobId: job.id,
      currentResourceKey: job.currentResourceKey,
      expectedTabId: job.tabId,
      currentLease: job.currentLease
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
    job.currentLease = undefined;
    job.updatedAt = now();
    await invalidateSnapshotBackfillCapture(job);
  });
}

async function cleanupSnapshotBackfillRuntime(
  job: StoredSnapshotBackfillJob,
  closeTab: boolean
): Promise<void> {
  await invalidateSnapshotBackfillCapture(job);
  if (typeof job.tabId !== "number") return;
  if (closeTab) {
    await chrome.tabs.remove(job.tabId).catch(() => undefined);
    await mutateStoredSnapshotBackfill((current) => {
      if (
        current.id !== job.id ||
        !["completed", "cancelled", "failed"].includes(current.state)
      ) {
        return;
      }
      current.tabId = undefined;
      current.windowId = undefined;
      current.updatedAt = now();
    });
  }
}

async function recordSnapshotBackfillItem(
  outcome: SnapshotBackfillOutcome,
  message?: string,
  expected?: {
    jobId: string;
    resourceKey: string;
    leaseToken?: string;
  }
): Promise<StoredSnapshotBackfillJob> {
  let recorded = false;
  let recordedJobId = "";
  const next = await mutateStoredSnapshotBackfill((job) => {
    const resourceKey = job.currentResourceKey;
    if (
      job.state !== "running" ||
      !resourceKey ||
      (expected &&
        (job.id !== expected.jobId ||
          resourceKey !== expected.resourceKey ||
          (expected.leaseToken !== undefined &&
            job.currentLease !== expected.leaseToken)))
    ) {
      return { ...job };
    }
    const status = recordSnapshotBackfillOutcome(
      publicSnapshotBackfill(job),
      outcome,
      outcome === "failed" && message
        ? {
            resourceKey,
            title: job.currentTitle || "网页封面",
            message
          }
        : undefined,
      now()
    );
    Object.assign(job, status);
    job.nextIndex = Math.min(
      job.resourceKeys.length,
      job.nextIndex + 1
    );
    job.currentResourceKey = undefined;
    job.currentAttempt = 0;
    job.currentLease = undefined;
    recorded = true;
    recordedJobId = job.id;
    return { ...job };
  });
  if (recordedJobId) {
    await clearSnapshotBackfillTimeouts(recordedJobId);
  }
  if (recorded && next.state === "completed") {
    await cleanupSnapshotBackfillRuntime(next, true);
  }
  return next;
}

async function navigateSnapshotBackfillCurrent(
  job: StoredSnapshotBackfillJob,
  resource: ResourceRecord,
  retry: boolean
): Promise<"scheduled" | "waiting" | "settled"> {
  if (typeof job.tabId !== "number") {
    throw new Error("补拍标签页不存在。");
  }
  const targetTab = await snapshotBackfillTargetTab(job);
  if (!targetTab) return "waiting";
  const lease = await reserveSnapshotBackfillAttempt(
    job,
    resource,
    retry
  );
  if (!lease) return "waiting";
  let prepared: ImmediatePageSnapshotTarget | undefined;
  try {
    prepared = await prepareImmediateSnapshotTargetForNavigation(
      job.tabId,
      resource,
      resource.url,
      "batch_backfill",
      false,
      lease
    );
    if (!prepared) {
      await recordSnapshotBackfillItem("skipped", undefined, {
        jobId: lease.jobId,
        resourceKey: lease.resourceKey,
        leaseToken: lease.token
      });
      return "settled";
    }
    if (!(await snapshotBackfillAllowsCapture(lease))) {
      await removeImmediateSnapshotTarget(job.tabId, prepared).catch(
        () => undefined
      );
      return "waiting";
    }
    await scheduleSnapshotBackfillTimeout(lease);
    let navigated: chrome.tabs.Tab;
    if (
      retry &&
      targetTab.url &&
      resourceMatchesLoadedUrl(resource, targetTab.url)
    ) {
      await chrome.tabs.reload(job.tabId);
      navigated = await chrome.tabs.get(job.tabId);
    } else {
      const updated = await chrome.tabs.update(job.tabId, {
        url: resource.url
      });
      if (!updated) throw new Error("Chrome 未能打开待补拍网页。");
      navigated = updated;
    }
    await rememberImmediateSnapshotTarget(
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
      await removeImmediateSnapshotTarget(job.tabId, prepared).catch(
        () => undefined
      );
    }
    await recordSnapshotBackfillItem("failed", errorMessage(error), {
      jobId: lease.jobId,
      resourceKey: lease.resourceKey,
      leaseToken: lease.token
    });
    return "settled";
  }
}

async function driveSnapshotBackfill(): Promise<void> {
  if (snapshotBackfillDriving) return;
  snapshotBackfillDriving = true;
  try {
    while (true) {
      let job = await getStoredSnapshotBackfill();
      if (!["running", "waiting_focus"].includes(job.state)) return;
      const targetTab = await snapshotBackfillTargetTab(job);
      if (!targetTab) return;
      if (job.state === "waiting_focus") {
        await mutateStoredSnapshotBackfill((current) => {
          if (
            current.id === job.id &&
            current.state === "waiting_focus"
          ) {
            current.state = snapshotBackfillStateAfterFocusCheck(
              current.state,
              true
            );
            current.updatedAt = now();
          }
        });
        job = await getStoredSnapshotBackfill();
      }
      if (!job.currentResourceKey) {
        if (job.nextIndex >= job.resourceKeys.length) {
          await mutateStoredSnapshotBackfill((current) => {
            if (current.id !== job.id) return;
            current.state = "completed";
            current.currentTitle = "";
            current.completedAt = now();
            current.updatedAt = now();
          });
          const completed = await getStoredSnapshotBackfill();
          await cleanupSnapshotBackfillRuntime(completed, true);
          return;
        }
        const resourceKey = job.resourceKeys[job.nextIndex]!;
        const resource = await getLocalResource(resourceKey);
        await mutateStoredSnapshotBackfill((current) => {
          if (
            current.id !== job.id ||
            current.nextIndex !== job.nextIndex ||
            current.currentResourceKey
          ) {
            return;
          }
          current.currentResourceKey = resourceKey;
          current.currentTitle =
            resource?.title || resource?.url || "检查网页";
          current.currentAttempt = 0;
          current.currentLease = undefined;
          current.updatedAt = now();
        });
        continue;
      }

      const resource = await getLocalResource(job.currentResourceKey);
      if (!resource?.nativeBookmarkIds.length) {
        await recordSnapshotBackfillItem(
          "skipped",
          "书签已被移除。",
          {
            jobId: job.id,
            resourceKey: job.currentResourceKey
          }
        );
        continue;
      }
      const settings = await getDisplaySettings();
      if (
        !settings.pageSnapshotsEnabled ||
        isSnapshotSensitiveUrl(
          resource.url,
          settings.snapshotExcludedHosts
        )
      ) {
        await recordSnapshotBackfillItem(
          "skipped",
          "内部、隐私保护或用户排除页面不会截图。",
          {
            jobId: job.id,
            resourceKey: job.currentResourceKey
          }
        );
        continue;
      }
      if (await getPageSnapshot(resource.canonicalUrl)) {
        await recordSnapshotBackfillItem("skipped", undefined, {
          jobId: job.id,
          resourceKey: job.currentResourceKey
        });
        continue;
      }

      if (
        targetTab.status === "complete" &&
        targetTab.url &&
        resourceMatchesLoadedUrl(resource, targetTab.url)
      ) {
        const lease = await reserveSnapshotBackfillAttempt(
          job,
          resource,
          false
        );
        if (!lease) return;
        await rememberImmediateSnapshotTarget(
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
        return;
      }

      try {
        const navigation = await navigateSnapshotBackfillCurrent(
          job,
          resource,
          false
        );
        if (navigation === "waiting") {
          const latest = await getStoredSnapshotBackfill();
          if (latest.state !== "running") return;
          return;
        }
        if (navigation === "settled") continue;
      } catch (error) {
        await recordSnapshotBackfillItem(
          "failed",
          errorMessage(error),
          {
            jobId: job.id,
            resourceKey: job.currentResourceKey
          }
        );
        continue;
      }
      return;
    }
  } finally {
    snapshotBackfillDriving = false;
  }
}

async function startSnapshotBackfill(): Promise<SnapshotBackfillStatus> {
  const existing = await getStoredSnapshotBackfill();
  if (
    ["running", "waiting_focus", "paused"].includes(existing.state)
  ) {
    return publicSnapshotBackfill(existing);
  }
  // 先与真实 Chrome 书签树对齐，避免旧的本地绑定让已删除书签进入任务，
  // 也确保安装前已有的原生收藏全部成为候选。
  await importNativeBookmarks();
  const candidates = await currentSnapshotBackfillCandidates();
  const timestamp = now();
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
    // 只有用户点击“补齐缺失封面”才会新建并激活此专用标签页。
    // 后续状态机不会主动激活标签或聚焦窗口。
    // 后台补拍：创建不抢焦点的专用标签页，用户可继续正常使用 Chrome。
    const tab = await chrome.tabs.create({ active: false });
    if (
      typeof tab.id !== "number" ||
      typeof tab.windowId !== "number"
    ) {
      throw new Error("Chrome 未能创建补拍标签页。");
    }
    const mutedTab =
      (await chrome.tabs.update(tab.id, { muted: true })) || tab;
    const withTab: StoredSnapshotBackfillJob = {
      ...job,
      tabId: mutedTab.id,
      windowId: mutedTab.windowId,
      updatedAt: now()
    };
    await setStoredSnapshotBackfill(withTab);
    await driveSnapshotBackfill();
    return publicSnapshotBackfill(
      await getStoredSnapshotBackfill()
    );
  } catch (error) {
    const failed = await mutateStoredSnapshotBackfill((current) => {
      if (current.id !== job.id) return { ...current };
      current.state = "failed";
      current.updatedAt = now();
      current.completedAt = now();
      current.errors = [
        ...current.errors,
        {
          resourceKey: current.currentResourceKey || "",
          title: current.currentTitle || "批量补拍",
          message: errorMessage(error)
        }
      ].slice(-20);
      return { ...current };
    });
    await cleanupSnapshotBackfillRuntime(failed, true);
    return publicSnapshotBackfill(failed);
  }
}

async function currentSnapshotBackfillCandidates(): Promise<
  ResourceRecord[]
> {
  const [resources, snapshots, settings] = await Promise.all([
    getLocalResources(),
    getPageSnapshots(),
    getDisplaySettings()
  ]);
  return settings.pageSnapshotsEnabled
    ? snapshotBackfillCandidates(
        resources,
        new Set(snapshots.map((snapshot) => snapshot.canonicalUrl)),
        settings.snapshotExcludedHosts
      )
    : [];
}

async function getSnapshotBackfillStatus(
  includeCandidateCount = false
): Promise<SnapshotBackfillStatus> {
  const status = publicSnapshotBackfill(
    await getStoredSnapshotBackfill()
  );
  if (!includeCandidateCount) return status;
  if (
    ["running", "waiting_focus", "paused"].includes(status.state)
  ) {
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
  if (!job.id) {
    throw new Error("当前没有封面补拍任务。");
  }
  if (state === "running") {
    if (!["paused", "waiting_focus", "failed"].includes(job.state)) {
      return publicSnapshotBackfill(job);
    }
    let createdTab = false;
    let tab =
      typeof job.tabId === "number"
        ? await chrome.tabs.get(job.tabId).catch(() => null)
        : null;
    if (!tab) {
      // “继续”是明确用户手势；仅此处可以重新创建任务标签页。
      // 后台补拍不激活、不抢焦点。
      tab = await chrome.tabs.create({ active: false });
      createdTab = true;
    }
    if (
      !tab ||
      typeof tab.id !== "number" ||
      typeof tab.windowId !== "number"
    ) {
      throw new Error("Chrome 未能恢复补拍标签页。");
    }
    tab =
      (await chrome.tabs.update(tab.id, { muted: true })) || tab;
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
      current.currentLease = undefined;
      current.tabId = tab!.id;
      current.windowId = tab!.windowId;
      current.updatedAt = now();
      current.completedAt = undefined;
      resumed = true;
      return { ...current };
    });
    if (resumed) {
      void driveSnapshotBackfill();
    } else if (createdTab && typeof tab.id === "number") {
      await chrome.tabs.remove(tab.id).catch(() => undefined);
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
    current.currentLease = undefined;
    current.currentTitle = state === "paused"
      ? current.currentTitle
      : "";
    current.updatedAt = now();
    if (state === "cancelled") current.completedAt = now();
    await invalidateSnapshotBackfillCapture(current);
    changed = true;
    return { ...current };
  });
  if (changed && state === "cancelled") {
    await cleanupSnapshotBackfillRuntime(job, true);
  }
  return publicSnapshotBackfill(job);
}

async function retryOrFailSnapshotBackfillCurrent(
  reason: string,
  expectedTimeout: { jobId: string; token: string }
): Promise<void> {
  if (snapshotBackfillRetrying) return;
  snapshotBackfillRetrying = true;
  try {
    const job = await getStoredSnapshotBackfill();
    if (
      job.state !== "running" ||
      job.id !== expectedTimeout.jobId ||
      job.currentLease !== expectedTimeout.token ||
      !job.currentResourceKey ||
      typeof job.tabId !== "number"
    ) {
      return;
    }
    const targetTab = await snapshotBackfillTargetTab(job);
    if (!targetTab) return;
    const resource = await getLocalResource(job.currentResourceKey);
    if (!resource?.nativeBookmarkIds.length) {
      await recordSnapshotBackfillItem("skipped", "书签已被移除。", {
        jobId: job.id,
        resourceKey: job.currentResourceKey,
        leaseToken: expectedTimeout.token
      });
      void driveSnapshotBackfill();
      return;
    }
    if (job.currentAttempt >= SNAPSHOT_BACKFILL_MAX_ATTEMPTS) {
      await recordSnapshotBackfillItem("failed", reason, {
        jobId: job.id,
        resourceKey: job.currentResourceKey,
        leaseToken: expectedTimeout.token
      });
      void driveSnapshotBackfill();
      return;
    }
    try {
      const navigation = await navigateSnapshotBackfillCurrent(
        job,
        resource,
        true
      );
      if (navigation === "settled") void driveSnapshotBackfill();
    } catch (error) {
      await recordSnapshotBackfillItem(
        "failed",
        errorMessage(error),
        {
          jobId: job.id,
          resourceKey: job.currentResourceKey,
          leaseToken: expectedTimeout.token
        }
      );
      void driveSnapshotBackfill();
    }
  } finally {
    snapshotBackfillRetrying = false;
  }
}

/**
 * 页面加载/稳定超时后的处理：直接结算失败并进入下一项。
 * 不再强制重载重试——慢站点重载通常还是超时，只会把单页耗时从 45 秒
 * 翻倍到 90 秒；网络错误（onErrorOccurred）仍走 retryOrFail 的重载重试。
 */
async function timeoutOrFailSnapshotBackfillCurrent(
  reason: string,
  expectedTimeout: { jobId: string; token: string }
): Promise<void> {
  const job = await getStoredSnapshotBackfill();
  if (
    job.state !== "running" ||
    job.id !== expectedTimeout.jobId ||
    job.currentLease !== expectedTimeout.token ||
    !job.currentResourceKey
  ) {
    return;
  }
  await recordSnapshotBackfillItem("failed", reason, {
    jobId: job.id,
    resourceKey: job.currentResourceKey,
    leaseToken: expectedTimeout.token
  });
  void driveSnapshotBackfill();
}

async function recoverSnapshotBackfill(): Promise<void> {
  const job = await getStoredSnapshotBackfill();
  if (!["running", "waiting_focus"].includes(job.state)) return;
  const tab =
    typeof job.tabId === "number"
      ? await chrome.tabs.get(job.tabId).catch(() => null)
      : null;
  if (!tab) {
    await mutateStoredSnapshotBackfill((current) => {
      if (!["running", "waiting_focus"].includes(current.state)) {
        return;
      }
      current.state = "paused";
      current.updatedAt = now();
      current.errors = [
        ...current.errors,
        {
          resourceKey: current.currentResourceKey || "",
          title: current.currentTitle || "批量补拍",
          message:
            "补拍标签页已关闭。请在收藏库中点击继续后恢复。"
        }
      ].slice(-20);
    });
    return;
  }
  if (await snapshotBackfillTargetTab(job)) {
    void driveSnapshotBackfill();
  }
}

async function findOrCreateNativeBookmark(
  input: SaveBookmarkInput
): Promise<{ bookmark: chrome.bookmarks.BookmarkTreeNode; created: boolean }> {
  const folderId = input.folderId || (await defaultFolderId());
  const state = await getBookmarkSaveState(input.capture.url);
  let selected = input.existingBookmarkId
    ? state.matches.find((match) => match.id === input.existingBookmarkId)
    : undefined;

  if (input.existingBookmarkId && !selected) {
    throw new Error("收藏状态已变化，请刷新后重新选择。");
  }
  if (!selected && !input.createSeparate) {
    if (state.status === "exact" || state.status === "readonly") {
      selected = state.matches[0];
    } else if (state.status === "canonical") {
      if (!input.confirmedCanonicalReuse) {
        throw new Error("发现规范化后相同的收藏，请先确认复用或另存一份。");
      }
      selected = state.matches[0];
    } else if (state.status === "multiple") {
      throw new Error("发现多条相同收藏，请先选择要更新的记录。");
    }
  }
  if (selected?.matchKind === "canonical" && !input.confirmedCanonicalReuse) {
    throw new Error("请先确认复用规范化后相同的收藏。");
  }

  if (selected) {
    const [existing] = await chrome.bookmarks.get(selected.id);
    if (!existing?.url) {
      throw new Error("选中的收藏已不存在，请刷新后重试。");
    }
    if (existing.unmodifiable === "managed") {
      return { bookmark: existing, created: false };
    }
    if (existing.title !== input.title.trim()) {
      await updateNativeBookmark({
        id: existing.id,
        title: input.title.trim()
      });
    }
    if (existing.parentId !== folderId) {
      const [folder] = await chrome.bookmarks.get(folderId);
      if (!folder || folder.url || folder.unmodifiable === "managed") {
        throw new Error("选择的书签文件夹不可写入。");
      }
      await moveNativeBookmark({
        id: existing.id,
        parentId: folderId
      });
    }
    const [updated] = await chrome.bookmarks.get(existing.id);
    return { bookmark: updated, created: false };
  }

  const [folder] = await chrome.bookmarks.get(folderId);
  if (!folder || folder.url || folder.unmodifiable === "managed") {
    throw new Error("选择的书签文件夹不可写入。");
  }

  const mutation = await snapshotCreatedMutation({
    parentId: folderId,
    label: `收藏“${input.title}”`,
    title: input.title,
    url: input.capture.url
  });
  const created = await runProtectedBookmarkMutation({
    label: mutation.label,
    destructive: false,
    mutation,
    perform: async () => {
      const target = bookmarkTarget(folderId, input.capture.url);
      internalBookmarkTargets.add(target);
      try {
        const result = await chrome.bookmarks.create({
          parentId: folderId,
          title: input.title,
          url: input.capture.url
        });
        internalBookmarkIds.add(result.id);
        releaseInternalBookmarkWrite(result.id, target);
        return result;
      } catch (error) {
        internalBookmarkTargets.delete(target);
        throw error;
      }
    },
    createdNodeId: (node) => node.id
  });
  return {
    bookmark: created,
    created: true
  };
}

async function tryImmediateSync(
  item: OutboxItem
): Promise<ResourceRecord> {
  const auth = await getAuthState();
  if (!auth.configured || !auth.signedIn || auth.accountMatches !== true) {
    return item.resource;
  }

  try {
    const synced = await syncOneResource(item.resource, item.content);
    await completeOutboxItem(item);
    return synced;
  } catch (error) {
    await deferOutboxItem(item, errorMessage(error));
    return (
      (await getLocalResource(item.resource.resourceKey)) || item.resource
    );
  }
}

async function syncPendingIfReady(): Promise<void> {
  const auth = await getAuthState();
  if (
    auth.configured &&
    auth.signedIn &&
    auth.accountMatches === true
  ) {
    const local = await getLocalResources();
    for (const resource of local) {
      if (
        resource.syncStatus !== "local" ||
        !resource.nativeBookmarkIds.length
      ) {
        continue;
      }
      const pending = {
        ...resource,
        syncStatus: "pending" as const
      };
      await upsertLocalResource(pending);
      await enqueueOutbox(pending, "");
    }
    await drainOutbox();
  }
}

async function saveBookmark(
  input: SaveBookmarkInput
): Promise<SaveBookmarkResult> {
  const auth = await getAuthState();
  const display = await getDisplaySettings();
  const sourceTab =
    typeof input.sourceTabId === "number"
      ? await chrome.tabs.get(input.sourceTabId).catch(() => null)
      : null;
  const privacyBlocked =
    sourceTab?.incognito === true ||
    isSnapshotSensitiveUrl(
      input.capture.url,
      display.snapshotExcludedHosts
    );
  const { bookmark, created } = await findOrCreateNativeBookmark(input);
  const canonicalUrl = canonicalizeUrl(
    input.capture.url,
    input.capture.canonicalUrl
  );
  const resourceKey = await resourceKeyForUrl(canonicalUrl);
  const contentHash = await hashText(input.capture.content);
  const existing = await getLocalResource(resourceKey);
  const timestamp = now();
  const contentChanged =
    Boolean(existing?.contentHash) && existing?.contentHash !== contentHash;

  let resource: ResourceRecord = {
    resourceKey,
    canonicalUrl,
    url: input.capture.url,
    title: input.title.trim() || input.capture.title,
    userNote: input.userNote.trim(),
    summary: existing?.summary || "",
    tags: existing?.tags || [],
    tagsSource: existing?.tagsSource,
    topics: existing?.topics || [],
    aliases: existing?.aliases,
    contentExcerpt: input.capture.excerpt,
    contentHash,
    selectedText: input.capture.selectedText,
    author: input.capture.author,
    siteName: input.capture.siteName,
    language: input.capture.language,
    imageUrl: input.capture.imageUrl,
    ...(existing?.thumbnailDataUrl
      ? { thumbnailDataUrl: existing.thumbnailDataUrl }
      : {}),
    coverSource: existing?.coverSource,
    coverUpdatedAt: existing?.coverUpdatedAt,
    categoryCoverId: existing?.categoryCoverId,
    snapshotAt: existing?.snapshotAt,
    enhancementBlockReason: existing?.enhancementBlockReason,
    enhancementBlockMessage: existing?.enhancementBlockMessage,
    faviconUrl: input.capture.faviconUrl,
    nativeBookmarkIds: [
      ...new Set([...(existing?.nativeBookmarkIds || []), bookmark.id])
    ],
    nativeFolderPath: await folderPathForId(bookmark.parentId || input.folderId),
    aiStatus: input.requestAi
      ? existing?.aiStatus === "ready" && !contentChanged
        ? "ready"
        : "pending"
      : existing?.aiStatus || "not_requested",
    syncStatus: auth.configured ? "pending" : "local",
    createdAt: existing?.createdAt || timestamp,
    updatedAt: timestamp,
    lastSyncedAt: existing?.lastSyncedAt
  };

  // 原生书签写入和基础资源落库后立刻启动快照流程，不让可选的 AI
  // 富化网络请求阻塞截图；真正截图仍会等待页面 complete 且稳定。
  await upsertLocalResource(resource);
  void Promise.resolve(
    !privacyBlocked && display.pageSnapshotsEnabled ? sourceTab : null
  )
    .then(async (tab) => {
      if (tab?.url && resourceMatchesLoadedUrl(resource, tab.url)) {
        await rememberImmediateSnapshotTarget(
          tab,
          canonicalUrl,
          SAVED_PAGE_SNAPSHOT_DELAY_MS,
          false,
          resourceKey,
          undefined,
          "aarre_save"
        );
      }
    })
    .catch(() => undefined);

  let aiWarning: string | undefined;
  const hasTrustworthyRenderedContent =
    sourceTab !== null &&
    sourceTab.incognito !== true &&
    Boolean(
      sourceTab.url && resourceMatchesLoadedUrl(resource, sourceTab.url)
    ) &&
    input.capture.content.trim().length >= 80 &&
    input.capture.excerpt.trim().length > 0;
  const needsAi =
    input.requestAi &&
    !(existing?.aiStatus === "ready" && !contentChanged);
  if (needsAi) {
    if (privacyBlocked) {
      aiWarning =
        "收藏已保存。出于隐私保护，Aarre 不会读取或发送无痕、内网、银行、支付和医疗页面内容，也不会生成截图。";
      resource = {
        ...resource,
        aiStatus: "unavailable",
        enhancementBlockReason: "privacy",
        enhancementBlockMessage:
          "Aarre 不会读取或发送无痕、内网、银行、支付和医疗页面内容。",
        updatedAt: now()
      };
    } else {
      const aiSettings = await getAiRuntimeSettings();
      if (aiSettings.apiKey && hasTrustworthyRenderedContent) {
        try {
          resource = await enrichResourceLocally(resource, input.capture);
        } catch (error) {
          aiWarning = errorMessage(error);
          resource = {
            ...resource,
            aiStatus: "failed",
            updatedAt: now()
          };
        }
      } else if (!aiSettings.apiKey) {
        aiWarning = `书签已保存，摘要与标签任务已保留。请在设置中填写 ${aiSettings.provider === "gemini" ? "Gemini" : aiSettings.provider === "openai" ? "OpenAI" : "DeepSeek"} API Key，Aarre 会自动继续。`;
        resource = {
          ...resource,
          aiStatus: "unavailable",
          updatedAt: now()
        };
      } else {
        aiWarning =
          "书签已保存。首次正常打开该网页后，Aarre 会读取真实页面并补全摘要、标签和封面。";
        resource = {
          ...resource,
          aiStatus: "pending",
          updatedAt: now()
        };
      }
    }
  }

  resource = {
    ...resource,
    categoryCoverId: categoryCoverForResource(resource)
  };
  const latestResource = await getLocalResource(resourceKey);
  if (latestResource?.snapshotAt) {
    resource.snapshotAt = latestResource.snapshotAt;
  }
  await upsertLocalResource(resource);
  let synced = resource;
  if (auth.configured) {
    const queued = await enqueueOutbox(
      resource,
      input.requestAi && resource.aiStatus === "pending"
        ? input.capture.content
        : ""
    );
    synced = await tryImmediateSync(queued);
  }

  const pendingEnhancements: BookmarkEnhancementPart[] = [];
  if (
    !privacyBlocked &&
    (synced.aiStatus !== "ready" ||
      !synced.summary.trim() ||
      !synced.tags.length)
  ) {
    pendingEnhancements.push("ai");
  }
  if (
    !privacyBlocked &&
    display.pageSnapshotsEnabled &&
    !isSnapshotSensitiveUrl(
      synced.url,
      display.snapshotExcludedHosts
    ) &&
    !(await getPageSnapshot(synced.canonicalUrl))
  ) {
    pendingEnhancements.push("snapshot");
  }
  if (privacyBlocked) {
    await cancelEnhancementForResource(resourceKey);
  } else if (!hasTrustworthyRenderedContent) {
    await queueEnhancementsUntilVisit(synced, "aarre_save");
  } else {
    await enqueueBookmarkEnhancement(
      synced,
      pendingEnhancements,
      pendingEnhancements.includes("snapshot")
        ? {
            state: "queued",
            trigger: "aarre_save",
            ...(typeof input.sourceTabId === "number"
              ? { tabId: input.sourceTabId }
              : {})
          }
        : undefined
    );
    void processBookmarkEnhancements();
  }

  return {
    resource: synced,
    nativeBookmarkCreated: created,
    cloudSyncAttempted: synced.syncStatus === "synced",
    aiWarning,
    enhancementPending: pendingEnhancements.length > 0
  };
}

function flashActionBadge(
  tabId: number | undefined,
  text: string,
  color: string,
  title: string
) {
  void chrome.action.setBadgeBackgroundColor({ color, tabId });
  void chrome.action.setBadgeText({ text, tabId });
  void chrome.action.setTitle({ title, tabId });
  setTimeout(() => {
    void syncOrganizationBadge(tabId);
  }, 2_000);
}

function pendingSaveKey(tabId: number): string {
  return `${PENDING_SAVE_PREFIX}${tabId}`;
}

function buildPendingSaveDraft(
  info: chrome.contextMenus.OnClickData,
  tab?: chrome.tabs.Tab
): PendingSaveDraft {
  if (typeof tab?.id !== "number") {
    throw new Error("无法确认当前 Chrome 标签页。");
  }
  const linkSave = info.menuItemId === CONTEXT_MENU_LINK_ID;
  const targetUrl = linkSave
    ? info.linkUrl
    : info.pageUrl || tab?.url;

  if (!targetUrl) {
    throw new Error("没有找到可以收藏的页面地址。");
  }

  return createPendingSaveDraft({
    kind: linkSave ? "link" : "page",
    tabId: tab.id,
    url: targetUrl,
    tabTitle: tab.title,
    faviconUrl: linkSave ? "" : tab.favIconUrl || "",
    selectedText: info.selectionText || "",
    createdAt: now()
  });
}

async function consumePendingSaveDraft(
  requestedTabId?: number
): Promise<PendingSaveDraft | null> {
  const tabId =
    requestedTabId ?? (await activeTab())?.id;
  if (typeof tabId !== "number") {
    return null;
  }

  const memoryDraft = pendingSaveDrafts.get(tabId);
  const key = pendingSaveKey(tabId);
  const stored = memoryDraft
    ? null
    : (await chrome.storage.session.get(key))[key];
  const draft =
    memoryDraft ||
    (stored && typeof stored === "object"
      ? (stored as PendingSaveDraft)
      : null);

  pendingSaveDrafts.delete(tabId);
  await chrome.storage.session.remove(key);
  return draft;
}

async function readLimitedText(
  response: Response,
  maxBytes = MAX_SCAN_HTML_BYTES
): Promise<string> {
  if (!response.body) {
    return (await response.text()).slice(0, maxBytes);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let result = "";
  try {
    while (size < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = maxBytes - size;
      const chunk = value.byteLength > remaining
        ? value.slice(0, remaining)
        : value;
      size += chunk.byteLength;
      result += decoder.decode(chunk, { stream: true });
      if (chunk.byteLength < value.byteLength) break;
    }
    result += decoder.decode();
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return result;
}

async function pageEssenceForResource(resource: ResourceRecord) {
  try {
    const response = await fetch(resource.url, {
      credentials: "omit",
      redirect: "follow",
      headers: {
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.2"
      },
      signal: AbortSignal.timeout(15_000)
    });
    const contentType = response.headers.get("content-type") || "";
    if (
      !response.ok ||
      /(?:^|\/)(?:login|signin|sign-in|auth)(?:\/|$)/i.test(
        new URL(response.url || resource.url).pathname
      ) ||
      (!contentType.includes("text/html") &&
        !contentType.includes("application/xhtml+xml"))
    ) {
      return null;
    }
    const essence = extractPageEssenceFromHtml(
      await readLimitedText(response),
      response.url || resource.url
    );
    return essence.description ||
      essence.h1 ||
      essence.firstParagraph ||
      essence.keywords.length
      ? essence
      : null;
  } catch {
    // 登录墙、失效链接或网络失败不能伪装成完整增强。保留任务，等用户
    // 正常访问该网页后再从真实渲染 DOM 读取正文。
    return null;
  }
}

async function processOneBookmarkEnhancement(
  job: BookmarkEnhancementJob
): Promise<void> {
  let resource = await getLocalResource(job.resourceKey);
  if (!resource?.nativeBookmarkIds.length) {
    await cancelEnhancementForResource(job.resourceKey);
    return;
  }

  const privacySettings = await getDisplaySettings();
  const privacyBlocked = isSnapshotSensitiveUrl(
    resource.url,
    privacySettings.snapshotExcludedHosts
  );
  let enhancementDeferred = false;
  if (job.pending.includes("ai")) {
    if (privacyBlocked) {
      resource = {
        ...resource,
        aiStatus: "unavailable",
        enhancementBlockReason: "privacy",
        enhancementBlockMessage:
          "Aarre 不会读取或发送内网、银行、支付和医疗页面内容。",
        updatedAt: now()
      };
      await upsertLocalResource(resource);
      await updateStoredAiProgress(job.resourceKey, {
        state: "privacy_blocked",
        lastError: resource.enhancementBlockMessage
      });
      await completeStoredEnhancementPart(job.resourceKey, "ai");
    } else if (
      resource.aiStatus === "ready" &&
      resource.summary.trim() &&
      resource.tags.length
    ) {
      await completeStoredEnhancementPart(job.resourceKey, "ai");
    } else {
      const runtime = await getAiRuntimeSettings();
      if (!runtime.apiKey) {
        if (resource.aiStatus !== "unavailable") {
          resource = {
            ...resource,
            aiStatus: "unavailable",
            updatedAt: now()
          };
          await upsertLocalResource(resource);
        }
        await deferStoredEnhancementJob(
          job.resourceKey,
          `等待配置 ${getAiProviderPreset(runtime.provider).name} API Key。`
        );
        await updateStoredAiProgress(job.resourceKey, {
          state: "waiting_for_key",
          lastError: `等待配置 ${getAiProviderPreset(runtime.provider).name} API Key。`
        });
        enhancementDeferred = true;
      } else {
        resource = {
          ...resource,
          aiStatus: "pending",
          updatedAt: now()
        };
        await upsertLocalResource(resource);
        await deferStoredEnhancementJob(
          job.resourceKey,
          "等待用户正常访问网页后读取真实渲染正文。"
        );
        await updateStoredAiProgress(job.resourceKey, {
          state: "waiting_for_content",
          lastError: "等待真实网页访问后读取渲染正文。"
        });
        enhancementDeferred = true;
      }
    }
  }

  const latestJobs = await getStoredEnhancementJobs();
  const latestJob = latestJobs[job.resourceKey];
  if (!latestJob?.pending.includes("snapshot")) return;
  resource = (await getLocalResource(job.resourceKey)) || resource;
  const existingSnapshot = await getPageSnapshot(resource.canonicalUrl);
  if (
    existingSnapshot &&
    (!latestJob.snapshot?.refreshExisting ||
      !isPageSnapshotStale(existingSnapshot))
  ) {
    await completeStoredEnhancementPart(job.resourceKey, "snapshot");
    return;
  }
  const display = privacySettings;
  if (
    !display.pageSnapshotsEnabled ||
    isSnapshotSensitiveUrl(resource.url, display.snapshotExcludedHosts)
  ) {
    // 受保护网站按隐私规则永远使用 Aarre 兜底图，不进行后台窥探。
    await updateStoredSnapshotProgress(job.resourceKey, {
      state: "privacy_blocked",
      trigger: job.snapshot?.trigger || "recovery",
      lastError: "隐私保护网站不生成页面截图。"
    });
    await completeStoredEnhancementPart(job.resourceKey, "snapshot");
    return;
  }
  if (!(await hasPageAccess(resource.url))) {
    if (!enhancementDeferred) {
      await deferStoredEnhancementJob(
        job.resourceKey,
        "等待截图权限；从 Aarre 打开该收藏后会继续。"
      );
    }
    return;
  }
  const focusedWindow = await chrome.windows.getLastFocused();
  const tabs = await chrome.tabs.query({
    active: true,
    ...(typeof focusedWindow.id === "number"
      ? { windowId: focusedWindow.id }
      : { lastFocusedWindow: true })
  });
  const matchingTab = tabs.find(
    (tab) => tab.url && resourceMatchesLoadedUrl(resource!, tab.url)
  );
  if (matchingTab) {
    await rememberImmediateSnapshotTarget(
      matchingTab,
      resource.canonicalUrl,
      SAVED_PAGE_SNAPSHOT_DELAY_MS,
      job.snapshot?.showToast === true,
      resource.resourceKey,
      job.snapshot?.documentId,
      job.snapshot?.trigger || "recovery"
    );
  } else {
    await updateStoredSnapshotProgress(job.resourceKey, {
      state: "waiting_foreground",
      trigger: job.snapshot?.trigger || "recovery",
      ...(job.snapshot?.showToast ? { showToast: true } : {}),
      ...(job.snapshot?.refreshExisting ? { refreshExisting: true } : {})
    });
  }
  if (!enhancementDeferred) {
    await deferStoredEnhancementJob(
      job.resourceKey,
      "等待目标网页处于前台并加载稳定。"
    );
  }
}

async function processBookmarkEnhancements(): Promise<void> {
  if (bookmarkEnhancementRunning) return;
  bookmarkEnhancementRunning = true;
  try {
    const jobs = await getStoredEnhancementJobs();
    const due = Object.values(jobs)
      .filter((job) => isEnhancementJobDue(job))
      .sort((left, right) =>
        left.nextAttemptAt.localeCompare(right.nextAttemptAt)
      )
      .slice(0, 4);
    for (const job of due) {
      await processOneBookmarkEnhancement(job).catch((error) =>
        deferStoredEnhancementJob(job.resourceKey, errorMessage(error))
      );
    }
  } finally {
    bookmarkEnhancementRunning = false;
    const remaining = Object.values(
      await getStoredEnhancementJobs()
    );
    if (remaining.length) {
      const nextAttempt = Math.min(
        ...remaining.map((job) => {
          const parsed = Date.parse(job.nextAttemptAt);
          return Number.isFinite(parsed) ? parsed : Date.now();
        })
      );
      await scheduleBookmarkEnhancements(
        Math.max(0.5, (nextAttempt - Date.now()) / 60_000)
      );
    } else {
      await chrome.alarms.clear(BOOKMARK_ENHANCEMENT_ALARM);
    }
  }
}

function iconSize(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const sizes = [...value.matchAll(/(\d+)\s*x\s*(\d+)/gi)]
    .map((match) => Math.min(Number(match[1]), Number(match[2])))
    .filter((size) => Number.isFinite(size) && size > 0);
  return sizes.length ? Math.max(...sizes) : undefined;
}

async function manifestIconCandidates(
  manifestUrl: string
): Promise<SiteIconCandidate[]> {
  if (!manifestUrl) return [];
  try {
    const response = await fetch(manifestUrl, {
      credentials: "omit",
      redirect: "follow",
      headers: { Accept: "application/manifest+json,application/json" },
      signal: AbortSignal.timeout(8_000)
    });
    if (!response.ok) return [];
    const manifest = JSON.parse(
      await readLimitedText(response, 256 * 1024)
    ) as {
      icons?: Array<{
        src?: unknown;
        sizes?: unknown;
        type?: unknown;
      }>;
    };
    if (!Array.isArray(manifest.icons)) return [];
    return manifest.icons
      .flatMap((icon): SiteIconCandidate[] => {
        if (typeof icon.src !== "string" || !icon.src.trim()) return [];
        try {
          const url = new URL(icon.src, response.url || manifestUrl).toString();
          const vector =
            icon.type === "image/svg+xml" || /\.svg(?:[?#]|$)/i.test(url);
          const declaredSize = iconSize(icon.sizes);
          return [
            {
              url,
              source: "manifest",
              ...(declaredSize ? { declaredSize } : {}),
              ...(vector ? { vector: true } : {})
            }
          ];
        } catch {
          return [];
        }
      })
      .sort(
        (left, right) =>
          (right.declaredSize || 0) - (left.declaredSize || 0)
      );
  } catch {
    return [];
  }
}

async function conventionalIconCandidates(
  pageUrl: string
): Promise<SiteIconCandidate[]> {
  try {
    const origin = new URL(pageUrl).origin;
    const candidates: SiteIconCandidate[] = [];
    const paths = [
      "/apple-touch-icon-180x180.png",
      "/apple-touch-icon.png",
      "/apple-touch-icon-precomposed.png",
      "/apple-touch-icon-152x152.png"
    ];
    for (const path of paths) {
      const url = new URL(path, origin).toString();
      try {
        const response = await fetch(url, {
          method: "HEAD",
          credentials: "omit",
          redirect: "follow",
          signal: AbortSignal.timeout(5_000)
        });
        if (response.ok) {
          candidates.push({
            url,
            source: "conventional-apple-touch-icon",
            declaredSize: path.includes("152") ? 152 : 180
          });
          break;
        }
      } catch {
        // Continue to the next conventional path.
      }
    }
    const icoUrl = new URL("/favicon.ico", origin).toString();
    try {
      const response = await fetch(icoUrl, {
        method: "HEAD",
        credentials: "omit",
        redirect: "follow",
        signal: AbortSignal.timeout(5_000)
      });
      if (response.ok) {
        candidates.push({
          url: icoUrl,
          source: "conventional-favicon-ico"
        });
      }
    } catch {
      // Continue to the conventional SVG candidate.
    }
    const svgUrl = new URL("/favicon.svg", origin).toString();
    try {
      const response = await fetch(svgUrl, {
        method: "HEAD",
        credentials: "omit",
        redirect: "follow",
        signal: AbortSignal.timeout(5_000)
      });
      if (response.ok) {
        candidates.push({
          url: svgUrl,
          source: "svg-icon",
          vector: true
        });
      }
    } catch {
      // No conventional SVG icon.
    }
    return candidates;
  } catch {
    // Invalid URLs are filtered before this function.
  }
  return [];
}

function uniqueIconCandidates(
  candidates: SiteIconCandidate[]
): SiteIconCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    if (!candidate.url || seen.has(candidate.url)) return false;
    seen.add(candidate.url);
    return true;
  });
}

async function scanSiteBrand(
  resource: ResourceRecord,
  essence: ReturnType<typeof extractPageEssenceFromHtml>,
  force: boolean
): Promise<SiteBrandRecord | undefined> {
  const pageUrl = new URL(resource.url);
  const host = pageUrl.hostname.toLocaleLowerCase();
  const existing = await getSiteBrand(host);
  const cacheFresh =
    existing &&
    existing.iconDataUrlLight &&
    existing.iconDataUrlDark &&
    Date.now() - Date.parse(existing.updatedAt) <
      30 * 24 * 60 * 60 * 1_000;
  if (cacheFresh && !force) return existing;

  const rule = matchCoverRule(resource.url);
  const registryAsset = resolveRuleAsset(resource.url, "brandAsset");
  const apple = essence.siteIconCandidates.filter(
    (candidate) => candidate.source === "apple-touch-icon"
  );
  const declaredSvg = essence.siteIconCandidates.filter(
    (candidate) => candidate.source === "svg-icon"
  );
  const largeBitmap = essence.siteIconCandidates.filter(
    (candidate) => candidate.source === "large-icon"
  );
  const tile = essence.siteIconCandidates.filter(
    (candidate) => candidate.source === "msapplication-tile"
  );
  const candidates = uniqueIconCandidates([
    ...(registryAsset
      ? [{ url: registryAsset, source: "registry" as const }]
      : []),
    ...apple,
    ...(await conventionalIconCandidates(resource.url)),
    ...(await manifestIconCandidates(essence.manifestUrl)),
    ...declaredSvg,
    ...largeBitmap,
    ...tile
  ]);
  let result = await cacheSiteBrandIcon(candidates);

  const baseHost = registrableHost(host);
  if (
    (!result.iconDataUrlLight || !result.iconDataUrlDark) &&
    baseHost &&
    baseHost !== host
  ) {
    const base = await getSiteBrand(baseHost);
    if (
      base?.iconDataUrlLight &&
      base.iconDataUrlDark &&
      !force
    ) {
      const aliased = { ...base, host, updatedAt: now() };
      await putSiteBrand(aliased);
      return aliased;
    }
    const baseUrl = `${pageUrl.protocol}//${baseHost}/`;
    result = await cacheSiteBrandIcon(
      await conventionalIconCandidates(baseUrl)
    );
    const baseRecord: SiteBrandRecord = {
      host: baseHost,
      ...result,
      ...(rule?.skipPageImage ? { skipPageImage: true } : {}),
      updatedAt: now()
    };
    await putSiteBrand(baseRecord);
    if (result.iconDataUrlLight && result.iconDataUrlDark) {
      const aliased = { ...baseRecord, host, updatedAt: now() };
      await putSiteBrand(aliased);
      return aliased;
    }
  }

  const record: SiteBrandRecord = {
    host,
    ...result,
    ...(rule?.skipPageImage ? { skipPageImage: true } : {}),
    updatedAt: now()
  };
  await putSiteBrand(record);
  return record;
}

async function registerPageImageSample(
  resource: ResourceRecord,
  imageUrl: string
): Promise<boolean> {
  if (!imageUrl) return false;
  const host = new URL(resource.url).hostname.toLocaleLowerCase();
  const existing = await getSiteBrand(host);
  const sampleResult = recordPageImageSample(
    existing?.pageImageSamples || {},
    imageUrl,
    resource.resourceKey
  );
  await putSiteBrand({
    ...(existing || {}),
    host,
    pageImageSamples: sampleResult.samples,
    ...(sampleResult.isCommonBanner ? { skipPageImage: true } : {}),
    updatedAt: now()
  });
  if (!sampleResult.isCommonBanner) return false;

  const resources = await getLocalResources();
  for (const item of resources) {
    let sameHost = false;
    try {
      sameHost =
        new URL(item.url).hostname.toLocaleLowerCase() === host;
    } catch {
      sameHost = false;
    }
    if (!sameHost || item.imageUrl !== imageUrl) continue;
    const { thumbnailDataUrl: _removed, ...withoutThumbnail } = item;
    await upsertLocalResource({
      ...withoutThumbnail,
      imageUrl: "",
      coverSource: "category:common-banner",
      coverUpdatedAt: now()
    });
  }
  return true;
}

async function scheduleLibraryScan(): Promise<void> {
  await chrome.alarms.create(LIBRARY_SCAN_ALARM, {
    delayInMinutes: 0.1,
    periodInMinutes: 0.5
  });
}

function needsRepresentativeImageRefresh(
  resource: ResourceRecord
): boolean {
  if (!resource.thumbnailDataUrl) {
    return !resource.coverSource;
  }
  try {
    const pageUrl = new URL(resource.url);
    const pathParts = pageUrl.pathname.split("/").filter(Boolean);
    const reservedGitHubPaths = new Set([
      "about",
      "apps",
      "collections",
      "codespaces",
      "enterprise",
      "events",
      "explore",
      "features",
      "issues",
      "login",
      "marketplace",
      "new",
      "notifications",
      "orgs",
      "organizations",
      "pricing",
      "search",
      "settings",
      "signup",
      "site",
      "sponsors",
      "topics",
      "users"
    ]);
    const isGitHubRepository =
      (pageUrl.hostname === "github.com" ||
        pageUrl.hostname === "www.github.com") &&
      pathParts.length >= 2 &&
      !reservedGitHubPaths.has(pathParts[0]?.toLowerCase() || "");
    return (
      isGitHubRepository &&
      !resource.imageUrl.includes("opengraph.githubassets.com/")
    );
  } catch {
    return false;
  }
}

function needsLinkHealthRefresh(
  resource: ResourceRecord,
  referenceTime = Date.now()
): boolean {
  if (!resource.linkHealth?.checkedAt) return true;
  const checkedAt = Date.parse(resource.linkHealth.checkedAt);
  return (
    !Number.isFinite(checkedAt) ||
    referenceTime - checkedAt >= LINK_HEALTH_REFRESH_MS
  );
}

async function libraryScanCandidates(force = false) {
  const runtime = await getAiRuntimeSettings();
  const hasAi = Boolean(runtime.apiKey);
  await importNativeBookmarks();
  const resources = interleaveResourcesByHost(
    (await getLocalResources()).filter(
      (resource) =>
        resource.nativeBookmarkIds.length > 0 &&
        (force ||
          needsLinkHealthRefresh(resource) ||
          !resource.coverSource ||
          (hasAi &&
            (resource.aiStatus !== "ready" ||
              !resource.summary.trim() ||
              !resource.tags.length ||
              !resource.aliases?.length)) ||
          needsRepresentativeImageRefresh(resource))
    )
  );
  const aiResourceCount = resources.filter(
    (resource) =>
      hasAi &&
      (force ||
        resource.aiStatus !== "ready" ||
        !resource.summary.trim() ||
        !resource.tags.length ||
        !resource.aliases?.length)
  ).length;
  return { runtime, resources, aiResourceCount };
}

async function getLibraryScanEstimate(
  force = false
): Promise<LibraryScanEstimate> {
  const { runtime, resources, aiResourceCount } =
    await libraryScanCandidates(force);
  const estimate = estimateScanCost(
    aiResourceCount,
    runtime.provider,
    runtime.model,
    LIBRARY_SCAN_CONCURRENCY
  );
  const networkMinutes = resources.length
    ? Math.max(
        1,
        Math.ceil(
          (resources.length * 4) /
            (60 * LIBRARY_SCAN_CONCURRENCY)
        )
      )
    : 0;
  const priceAvailable = estimate.estimatedCostCny !== null;
  return {
    total: resources.length,
    aiResourceCount,
    concurrency: LIBRARY_SCAN_CONCURRENCY,
    estimatedMinutes: Math.max(
      networkMinutes,
      estimate.estimatedMinutes
    ),
    ...(priceAvailable
      ? { estimatedCostCny: estimate.estimatedCostCny! }
      : {}),
    pricingUpdatedAt: estimate.pricingUpdatedAt,
    providerName: getAiProviderPreset(runtime.provider).name,
    model: runtime.model,
    priceAvailable
  };
}

async function startLibraryScan(force = false): Promise<LibraryScanStatus> {
  const { runtime, resources, aiResourceCount } =
    await libraryScanCandidates(force);
  const estimate = estimateScanCost(
    aiResourceCount,
    runtime.provider,
    runtime.model,
    LIBRARY_SCAN_CONCURRENCY
  );
  const displaySettings = await getDisplaySettings();
  if (
    estimate.estimatedCostCny !== null &&
    estimate.estimatedCostCny > displaySettings.scanCostLimitCny
  ) {
    throw new Error(
      `预计费用 ¥${estimate.estimatedCostCny.toFixed(4)}，超过你设置的单次上限 ¥${displaySettings.scanCostLimitCny.toFixed(2)}。请减少待处理数量或调整上限后再试。`
    );
  }
  const timestamp = now();
  const job: StoredLibraryScanJob = {
    id: crypto.randomUUID(),
    state: resources.length ? "running" : "completed",
    total: resources.length,
    processed: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    currentTitle: "",
    startedAt: timestamp,
    updatedAt: timestamp,
    completedAt: resources.length ? undefined : timestamp,
    errors: [],
    resourceKeys: resources.map((resource) => resource.resourceKey),
    nextIndex: 0,
    force,
    concurrency: LIBRARY_SCAN_CONCURRENCY,
    estimatedMinutes: estimate.estimatedMinutes,
    ...(estimate.estimatedCostCny !== null
      ? { estimatedCostCny: estimate.estimatedCostCny }
      : {}),
    actualInputTokens: 0,
    actualOutputTokens: 0,
    actualCachedInputTokens: 0,
    actualCostCny: 0,
    pricingUpdatedAt: estimate.pricingUpdatedAt,
    provider: runtime.provider,
    providerName: getAiProviderPreset(runtime.provider).name,
    model: runtime.model,
    actualUsageEstimated: false,
    usageRecorded: false
  };
  await setStoredLibraryScan(job);
  if (resources.length) {
    await scheduleLibraryScan();
    void runLibraryScan();
  } else {
    await ensureStoredOrganizationInsights(true).catch(
      () => undefined
    );
  }
  return publicLibraryScan(job);
}

async function updateLibraryScanState(
  state: "paused" | "running" | "cancelled"
): Promise<LibraryScanStatus> {
  const job = await getStoredLibraryScan();
  if (!job.id) {
    throw new Error("当前没有全目录扫描任务。");
  }
  if (
    state === "running" &&
    !["paused", "failed"].includes(job.state)
  ) {
    return publicLibraryScan(job);
  }
  if (
    state !== "running" &&
    !["running", "paused"].includes(job.state)
  ) {
    return publicLibraryScan(job);
  }
  const timestamp = now();
  const next: StoredLibraryScanJob = {
    ...job,
    state,
    currentTitle: state === "running" ? job.currentTitle : "",
    updatedAt: timestamp,
    completedAt: state === "cancelled" ? timestamp : job.completedAt
  };
  await setStoredLibraryScan(next);
  if (state === "running") {
    await scheduleLibraryScan();
    void runLibraryScan();
  } else if (state === "cancelled") {
    await chrome.alarms.clear(LIBRARY_SCAN_ALARM);
  }
  return publicLibraryScan(next);
}

interface ScanResourceResult {
  resource: ResourceRecord;
  outcome: "succeeded" | "failed" | "skipped";
  message?: string;
  usage?: AiTokenUsage;
}

function removedResourcePlaceholder(resourceKey: string): ResourceRecord {
  return {
    resourceKey,
    canonicalUrl: "",
    url: "",
    title: "已移除的书签",
    userNote: "",
    summary: "",
    tags: [],
    topics: [],
    contentExcerpt: "",
    contentHash: "",
    selectedText: "",
    author: "",
    siteName: "",
    language: "",
    imageUrl: "",
    faviconUrl: "",
    nativeBookmarkIds: [],
    nativeFolderPath: [],
    aiStatus: "not_requested",
    syncStatus: "local",
    createdAt: now(),
    updatedAt: now()
  };
}

async function scanOneLibraryResource(
  resource: ResourceRecord,
  job: StoredLibraryScanJob
): Promise<ScanResourceResult> {
  const privacySettings = await getDisplaySettings();
  if (
    isInternalOrSensitiveUrl(resource.url) ||
    isSnapshotSensitiveUrl(
      resource.url,
      privacySettings.snapshotExcludedHosts
    )
  ) {
    const blocked = {
      ...resource,
      aiStatus: "unavailable" as const,
      enhancementBlockReason: "privacy" as const,
      enhancementBlockMessage:
        "Aarre 不会读取或发送内网、银行、支付和医疗页面内容。",
      updatedAt: now()
    };
    await upsertLocalResource(blocked);
    return {
      resource: blocked,
      outcome: "skipped",
      message: "内部或受保护网址不会发起网络请求。"
    };
  }
  const runtime = await getAiRuntimeSettings();
  const needsAi =
    Boolean(runtime.apiKey) &&
    (job.force ||
      resource.aiStatus !== "ready" ||
      !resource.summary.trim() ||
      !resource.tags.length ||
      !resource.aliases?.length);
  let scannedResource: ResourceRecord = {
    ...resource,
    aiStatus: needsAi ? "processing" : resource.aiStatus,
    updatedAt: now()
  };
  await upsertLocalResource(scannedResource);
  try {
    const linkHealth = await checkLinkHealth(
      resource.url,
      resource.linkHealth
    );
    scannedResource = {
      ...scannedResource,
      linkHealth,
      updatedAt: now()
    };
    await upsertLocalResource(scannedResource);
    if (
      ["dead", "soft_404", "login_required", "temporary"].includes(
        linkHealth.status
      )
    ) {
      scannedResource = {
        ...scannedResource,
        aiStatus: resource.aiStatus,
        updatedAt: now()
      };
      await upsertLocalResource(scannedResource);
      return { resource: scannedResource, outcome: "succeeded" };
    }

    const essence = await pageEssenceForResource(resource);
    if (!essence) {
      const waiting = {
        ...scannedResource,
        aiStatus: needsAi ? ("pending" as const) : scannedResource.aiStatus,
        updatedAt: now()
      };
      await upsertLocalResource(waiting);
      return {
        resource: waiting,
        outcome: "skipped",
        message: "未获得可信公开正文，等待用户正常访问网页后再增强。"
      };
    }
    const siteBrand = await scanSiteBrand(resource, essence, job.force);
    const coverRule = matchCoverRule(resource.url);
    const registryPageImage = resolveRuleAsset(
      resource.url,
      "pageImage"
    );
    let thumbnailDataUrl = resource.thumbnailDataUrl || "";
    let representativeImageUrl =
      coverRule?.skipPageImage || siteBrand?.skipPageImage
        ? ""
        : registryPageImage || essence.imageUrl || resource.imageUrl;
    const commonPageImage =
      representativeImageUrl &&
      !registryPageImage &&
      (await registerPageImageSample(resource, representativeImageUrl));
    if (commonPageImage) representativeImageUrl = "";
    const coverSource = commonPageImage
      ? "category:common-banner"
      : coverRule?.skipPageImage || siteBrand?.skipPageImage
        ? `category:${coverRule?.id || "common-banner"}`
        : registryPageImage
          ? `registry:${coverRule?.id || "page-image"}`
          : representativeImageUrl
            ? "page-metadata"
            : "category";
    if (
      representativeImageUrl &&
      (!thumbnailDataUrl ||
        resource.imageUrl !== representativeImageUrl ||
        job.force)
    ) {
      try {
        thumbnailDataUrl = await cacheRepresentativeImage(
          representativeImageUrl
        );
      } catch {
        // 原图仍作为备用；个别站点防盗链不应让整条扫描失败。
      }
    }
    scannedResource = {
      ...scannedResource,
      imageUrl: representativeImageUrl,
      faviconUrl: essence.faviconUrl || resource.faviconUrl,
      coverSource,
      coverUpdatedAt: now(),
      ...(thumbnailDataUrl ? { thumbnailDataUrl } : {})
    };
    await upsertLocalResource(scannedResource);

    const enrichment = needsAi
      ? await enrichResourceFromEssenceWithUsage(scannedResource, essence)
      : null;
    const enriched = enrichment?.resource || scannedResource;
    const auth = await getAuthState();
    const nextResource: ResourceRecord = {
      ...enriched,
      categoryCoverId: categoryCoverForResource(enriched),
      syncStatus: auth.configured ? "pending" : enriched.syncStatus
    };
    await upsertLocalResource(nextResource);
    if (auth.configured) {
      await enqueueOutbox(nextResource, nextResource.contentExcerpt);
      void syncPendingIfReady();
    }
    return {
      resource: nextResource,
      outcome: "succeeded",
      ...(enrichment ? { usage: enrichment.usage } : {})
    };
  } catch (error) {
    await upsertLocalResource({
      ...scannedResource,
      aiStatus: needsAi ? "failed" : scannedResource.aiStatus,
      updatedAt: now()
    });
    return {
      resource,
      outcome: "failed",
      message: errorMessage(error)
    };
  }
}

async function recordScanBatchResults(
  results: ScanResourceResult[]
): Promise<StoredLibraryScanJob> {
  const job = await getStoredLibraryScan();
  const timestamp = now();
  const usage = results.reduce<AiTokenUsage>(
    (total, result) => ({
      inputTokens: total.inputTokens + (result.usage?.inputTokens || 0),
      outputTokens: total.outputTokens + (result.usage?.outputTokens || 0),
      cachedInputTokens:
        total.cachedInputTokens +
        (result.usage?.cachedInputTokens || 0),
      estimated: total.estimated || Boolean(result.usage?.estimated)
    }),
    {
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      estimated: false
    }
  );
  const batchCost =
    job.provider && job.model
      ? costCnyForUsage(job.provider, job.model, usage) || 0
      : 0;
  const nextIndex = Math.min(
    job.resourceKeys.length,
    job.nextIndex + results.length
  );
  const next: StoredLibraryScanJob = {
    ...job,
    nextIndex,
    processed: job.processed + results.length,
    succeeded:
      job.succeeded +
      results.filter((result) => result.outcome === "succeeded").length,
    failed:
      job.failed +
      results.filter((result) => result.outcome === "failed").length,
    skipped:
      job.skipped +
      results.filter((result) => result.outcome === "skipped").length,
    actualInputTokens: (job.actualInputTokens || 0) + usage.inputTokens,
    actualOutputTokens:
      (job.actualOutputTokens || 0) + usage.outputTokens,
    actualCachedInputTokens:
      (job.actualCachedInputTokens || 0) + usage.cachedInputTokens,
    actualCostCny: Number(
      ((job.actualCostCny || 0) + batchCost).toFixed(4)
    ),
    actualUsageEstimated:
      job.actualUsageEstimated || usage.estimated,
    currentTitle: "",
    updatedAt: timestamp,
    errors: [
      ...job.errors,
      ...results.flatMap((result) =>
        result.message && result.outcome !== "succeeded"
          ? [
              {
                resourceKey: result.resource.resourceKey,
                title: result.resource.title,
                message: result.message
              }
            ]
          : []
      )
    ].slice(-20)
  };
  if (nextIndex >= next.resourceKeys.length && next.state !== "cancelled") {
    next.state = "completed";
    next.completedAt = timestamp;
  }
  await setStoredLibraryScan(next);
  return next;
}

async function finalizeLibraryScanUsage(
  job: StoredLibraryScanJob
): Promise<StoredLibraryScanJob> {
  const totalTokens =
    (job.actualInputTokens || 0) + (job.actualOutputTokens || 0);
  if (
    job.usageRecorded ||
    !job.provider ||
    !job.model ||
    totalTokens === 0
  ) {
    return job;
  }
  await addScanAiUsage(job.provider, job.model, {
    inputTokens: job.actualInputTokens || 0,
    outputTokens: job.actualOutputTokens || 0,
    cachedInputTokens: job.actualCachedInputTokens || 0,
    estimated: Boolean(job.actualUsageEstimated)
  });
  const next = { ...job, usageRecorded: true, updatedAt: now() };
  await setStoredLibraryScan(next);
  return next;
}

async function runLibraryScan(): Promise<void> {
  if (libraryScanRunning) return;
  libraryScanRunning = true;
  try {
    while (true) {
      let job = await getStoredLibraryScan();
      if (job.state !== "running") break;
      if (job.nextIndex >= job.resourceKeys.length) {
        job = {
          ...job,
          state: "completed",
          currentTitle: "",
          completedAt: now(),
          updatedAt: now()
        };
        await setStoredLibraryScan(job);
        await finalizeLibraryScanUsage(job).catch(() => job);
        await ensureStoredOrganizationInsights(true).catch(
          () => undefined
        );
        break;
      }

      const keys = job.resourceKeys.slice(
        job.nextIndex,
        job.nextIndex + LIBRARY_SCAN_CONCURRENCY
      );
      const resources = await Promise.all(
        keys.map((resourceKey) => getLocalResource(resourceKey))
      );
      job = {
        ...job,
        currentTitle:
          keys.length === 1
            ? resources[0]?.title || "检查书签"
            : `并行处理 ${keys.length} 条收藏`,
        updatedAt: now()
      };
      await setStoredLibraryScan(job);
      const results = await runConcurrentTasks<
        string,
        ScanResourceResult
      >(
        keys,
        async (resourceKey, index): Promise<ScanResourceResult> => {
          const resource = resources[index];
          if (!resource || !resource.nativeBookmarkIds.length) {
            return {
              resource: removedResourcePlaceholder(resourceKey),
              outcome: "skipped",
              message: "书签已被移除。"
            };
          }
          return libraryScanRateLimiter.run(resource.url, () =>
            scanOneLibraryResource(resource, job)
          );
        },
        {
          concurrency: LIBRARY_SCAN_CONCURRENCY,
          onError: (error, resourceKey, index) => ({
            resource:
              resources[index] ||
              removedResourcePlaceholder(resourceKey),
            outcome: "failed",
            message: errorMessage(error)
          })
        }
      );
      job = await recordScanBatchResults(results);
      if (job.state === "completed") {
        await finalizeLibraryScanUsage(job).catch(() => job);
        await ensureStoredOrganizationInsights(true).catch(
          () => undefined
        );
        break;
      }
    }
  } catch (error) {
    const job = await getStoredLibraryScan();
    await setStoredLibraryScan({
      ...job,
      state: "failed",
      currentTitle: "",
      updatedAt: now(),
      errors: [
        ...job.errors,
        {
          resourceKey: "",
          title: "扫描任务",
          message: errorMessage(error)
        }
      ].slice(-20)
    });
  } finally {
    libraryScanRunning = false;
    const job = await getStoredLibraryScan();
    if (job.state !== "running") {
      await chrome.alarms.clear(LIBRARY_SCAN_ALARM);
    }
  }
}

async function getAppState(): Promise<AppState> {
  const [auth, tab, resources, outbox, scan] = await Promise.all([
    getAuthState(),
    getActiveTabSummary(),
    getLocalResources(),
    getOutbox(),
    getStoredLibraryScan()
  ]);
  const linkedResources = resources.filter(
    (resource) => resource.nativeBookmarkIds.length > 0
  );

  return {
    auth,
    activeTab: tab,
    localResourceCount: linkedResources.length,
    aiReadyResourceCount: linkedResources.filter(
      (resource) =>
        resource.aiStatus === "ready" &&
        Boolean(resource.summary) &&
        resource.tags.length > 0
    ).length,
    pendingSyncCount: auth.configured ? outbox.length : 0,
    libraryScan: publicLibraryScan(scan)
  };
}

function walkBookmarkTree(
  nodes: chrome.bookmarks.BookmarkTreeNode[],
  parentPath: string[],
  result: Array<{ node: chrome.bookmarks.BookmarkTreeNode; path: string[] }>
) {
  for (const node of nodes) {
    if (node.url) {
      result.push({ node, path: parentPath });
      continue;
    }

    const nextPath =
      node.id === "0" ? parentPath : [...parentPath, node.title || "未命名"];
    walkBookmarkTree(node.children || [], nextPath, result);
  }
}

async function importNativeBookmarks(): Promise<ImportResult> {
  const auth = await getAuthState();
  const tree = await chrome.bookmarks.getTree();
  const native: Array<{
    node: chrome.bookmarks.BookmarkTreeNode;
    path: string[];
  }> = [];
  walkBookmarkTree(tree, [], native);

  const current = await getLocalResources();
  const known = new Map(current.map((item) => [item.resourceKey, item]));
  const grouped = new Map<
    string,
    Array<{
      node: chrome.bookmarks.BookmarkTreeNode;
      path: string[];
      canonicalUrl: string;
    }>
  >();
  let imported = 0;
  let alreadyKnown = 0;

  for (const { node, path } of native) {
    if (!node.url || !isSupportedPageUrl(node.url)) {
      continue;
    }

    const canonicalUrl = canonicalizeUrl(node.url);
    const resourceKey = await resourceKeyForUrl(canonicalUrl);
    const group = grouped.get(resourceKey) || [];
    group.push({ node, path, canonicalUrl });
    grouped.set(resourceKey, group);
  }

  for (const [resourceKey, group] of grouped) {
    const primary = group[0];
    const existing =
      known.get(resourceKey) ||
      current.find((resource) =>
        group.some(
          ({ node }) =>
            resource.nativeBookmarkIds.includes(node.id) ||
            (node.url && resourceMatchesLoadedUrl(resource, node.url))
        )
      );
    const resolvedResourceKey = existing?.resourceKey || resourceKey;
    const timestamp = now();
    const nativeBookmarkIds = group.map((item) => item.node.id);
    const baseChanged =
      !existing ||
      existing.title !== primary.node.title ||
      existing.url !== primary.node.url ||
      (!existing.canonicalUrl && existing.canonicalUrl !== primary.canonicalUrl) ||
      existing.nativeFolderPath.join("\n") !== primary.path.join("\n") ||
      existing.nativeBookmarkIds.join("\n") !==
        nativeBookmarkIds.join("\n");

    const resource: ResourceRecord = {
      resourceKey: resolvedResourceKey,
      canonicalUrl: existing?.canonicalUrl || primary.canonicalUrl,
      url: primary.node.url!,
      title:
        primary.node.title || new URL(primary.node.url!).hostname,
      userNote: existing?.userNote || "",
      summary: existing?.summary || "",
      tags: existing?.tags || [],
      tagsSource: existing?.tagsSource,
      topics: existing?.topics || [],
      aliases: existing?.aliases,
      contentExcerpt: existing?.contentExcerpt || "",
      contentHash: existing?.contentHash || "",
      selectedText: existing?.selectedText || "",
      author: existing?.author || "",
      siteName:
        existing?.siteName || new URL(primary.node.url!).hostname,
      language: existing?.language || "",
      imageUrl: existing?.imageUrl || "",
      ...(existing?.thumbnailDataUrl
        ? { thumbnailDataUrl: existing.thumbnailDataUrl }
        : {}),
      coverSource: existing?.coverSource,
      coverUpdatedAt: existing?.coverUpdatedAt,
      categoryCoverId:
        existing?.categoryCoverId ||
        categoryCoverForResource({
          url: primary.node.url!,
          title:
            primary.node.title || new URL(primary.node.url!).hostname,
          topics: existing?.topics || [],
          tags: existing?.tags || [],
          summary: existing?.summary || ""
        }),
      snapshotAt: existing?.snapshotAt,
      enhancementBlockReason: existing?.enhancementBlockReason,
      enhancementBlockMessage: existing?.enhancementBlockMessage,
      faviconUrl: existing?.faviconUrl || "",
      nativeBookmarkIds,
      nativeFolderPath: primary.path,
      aiStatus: existing?.aiStatus || "not_requested",
      syncStatus: baseChanged
        ? auth.configured
          ? "pending"
          : "local"
        : existing?.syncStatus || "local",
      createdAt:
        existing?.createdAt ||
        (primary.node.dateAdded
          ? new Date(primary.node.dateAdded).toISOString()
          : timestamp),
      updatedAt: baseChanged ? timestamp : existing!.updatedAt,
      lastSyncedAt: existing?.lastSyncedAt
    };

    await upsertLocalResource(resource);
    if (baseChanged && auth.configured) {
      await enqueueOutbox(resource, "");
    }
    if (existing) alreadyKnown += group.length;
    else imported += group.length;
  }

  for (const resource of current) {
    if (
      resource.nativeBookmarkIds.length &&
      !grouped.has(resource.resourceKey)
    ) {
      await upsertLocalResource({
        ...resource,
        nativeBookmarkIds: [],
        updatedAt: now()
      });
    }
  }

  return { scanned: native.length, imported, alreadyKnown };
}

async function queueIndexedResourcesUntilVisit(): Promise<void> {
  const resources = await getLocalResources();
  for (const resource of resources) {
    if (resource.nativeBookmarkIds.length) {
      await queueEnhancementsUntilVisit(resource, "recovery");
    }
  }
}

async function ensureFolderPath(path: string[]): Promise<string> {
  const options = await getFolderOptions();
  const bar =
    options.find((item) => item.depth === 0 && item.name.includes("书签")) ||
    options.find((item) => item.depth === 0) ||
    null;

  if (!bar) {
    return defaultFolderId();
  }

  const relativePath =
    path[0] === bar.name || path[0]?.toLowerCase().includes("bookmark")
      ? path.slice(1)
      : path;
  let parentId = bar.id;

  for (const segment of relativePath) {
    const children = await chrome.bookmarks.getChildren(parentId);
    const existing = children.find(
      (item) => !item.url && item.title === segment && !item.unmodifiable
    );
    if (existing) {
      parentId = existing.id;
      continue;
    }

    const created = await chrome.bookmarks.create({
      parentId,
      title: segment
    });
    parentId = created.id;
  }

  return parentId;
}

async function restoreMissingNativeBookmarks(): Promise<RestoreResult> {
  const resources = await pullCloudResources();
  const tree = await chrome.bookmarks.getTree();
  const native: Array<{
    node: chrome.bookmarks.BookmarkTreeNode;
    path: string[];
  }> = [];
  walkBookmarkTree(tree, [], native);

  const nativeKeys = new Set<string>();
  for (const { node } of native) {
    if (node.url && isSupportedPageUrl(node.url)) {
      nativeKeys.add(await resourceKeyForUrl(node.url));
    }
  }

  let restored = 0;
  let alreadyPresent = 0;

  for (const resource of resources) {
    if (nativeKeys.has(resource.resourceKey)) {
      alreadyPresent += 1;
      continue;
    }

    const parentId = await ensureFolderPath(resource.nativeFolderPath);
    const target = bookmarkTarget(parentId, resource.url);
    internalBookmarkTargets.add(target);
    let bookmark: chrome.bookmarks.BookmarkTreeNode;
    try {
      bookmark = await chrome.bookmarks.create({
        parentId,
        title: resource.title,
        url: resource.url
      });
    } catch (error) {
      internalBookmarkTargets.delete(target);
      throw error;
    }
    internalBookmarkIds.add(bookmark.id);
    releaseInternalBookmarkWrite(bookmark.id, target);
    const updated = {
      ...resource,
      nativeBookmarkIds: [
        ...new Set([...resource.nativeBookmarkIds, bookmark.id])
      ],
      updatedAt: now()
    };
    await upsertLocalResource(updated);
    await queueEnhancementsUntilVisit(updated, "recovery");
    restored += 1;
  }

  return { restored, alreadyPresent };
}

async function syncNow() {
  const result = await drainOutbox();
  const resources = await pullCloudResources();
  return { ...result, resources };
}

async function drainOutbox(maxBatches = 50): Promise<{
  synced: number;
  failed: number;
}> {
  let synced = 0;
  let failed = 0;

  for (let batch = 0; batch < maxBatches; batch += 1) {
    const pending = await getOutbox();
    if (!pending.length) break;
    const result = await processOutbox();
    synced += result.synced;
    failed += result.failed;
    if (result.attempted === 0) break;
  }

  return { synced, failed };
}

async function getResources(query = "") {
  await importNativeBookmarks();
  void syncPendingIfReady();
  const local = await getLocalResources();
  const linked = local.filter((item) => item.nativeBookmarkIds.length > 0);
  if (!query.trim()) {
    return linked;
  }

  return searchLocalResources(linked, query);
}

function buildBookmarkAgentCatalog(
  tree: chrome.bookmarks.BookmarkTreeNode[]
): BookmarkAgentCatalog {
  const catalog: BookmarkAgentCatalog = {
    bookmarks: [],
    folders: []
  };

  function visit(
    node: chrome.bookmarks.BookmarkTreeNode,
    parentPath: string[]
  ) {
    if (node.url) {
      catalog.bookmarks.push({
        id: node.id,
        parentId: node.parentId || "",
        title: node.title || node.url,
        url: node.url,
        path: parentPath,
        writable: node.unmodifiable !== "managed",
        ...(typeof node.dateAdded === "number"
          ? { dateAdded: node.dateAdded }
          : {}),
        ...(typeof node.dateLastUsed === "number"
          ? { dateLastUsed: node.dateLastUsed }
          : {})
      });
      return;
    }

    const isBrowserRoot = node.id === "0";
    const path = isBrowserRoot
      ? parentPath
      : [...parentPath, node.title || "未命名文件夹"];
    if (!isBrowserRoot) {
      catalog.folders.push({
        id: node.id,
        parentId: node.parentId,
        title: node.title || "未命名文件夹",
        path,
        writable: node.unmodifiable !== "managed"
      });
    }
    for (const child of node.children || []) {
      visit(child, path);
    }
  }

  for (const root of tree) {
    visit(root, []);
  }
  return catalog;
}

async function getLibraryInsights() {
  return (await ensureStoredOrganizationInsights()).insights;
}

async function getStoredOrganizationInsights(): Promise<
  StoredOrganizationInsights | null
> {
  const stored = (await chrome.storage.local.get(
    ORGANIZATION_INSIGHTS_KEY
  ))[ORGANIZATION_INSIGHTS_KEY];
  if (
    !stored ||
    typeof stored !== "object" ||
    !("insights" in stored) ||
    !("fingerprint" in stored) ||
    !("signature" in stored)
  ) {
    return null;
  }
  return stored as StoredOrganizationInsights;
}

async function syncOrganizationBadge(
  tabId?: number
): Promise<void> {
  const stored = await getStoredOrganizationInsights();
  const notice = organizationNoticeFromStored(stored);
  const text = organizationBadgeText(notice?.proposalCount || 0);
  await Promise.all([
    chrome.action.setBadgeBackgroundColor({
      color: "#205aef",
      tabId
    }),
    chrome.action.setBadgeText({ text, tabId }),
    chrome.action.setTitle({
      title: notice
        ? `Aarre：发现 ${notice.proposalCount} 条整理建议`
        : "打开 Aarre",
      tabId
    })
  ]);
}

async function publishStoredOrganizationInsights(
  stored: StoredOrganizationInsights
): Promise<void> {
  await chrome.storage.local.set({
    [ORGANIZATION_INSIGHTS_KEY]: stored
  });
  await syncOrganizationBadge();
  void chrome.runtime
    .sendMessage({ type: "ORGANIZATION_INSIGHTS_UPDATED" })
    .catch(() => undefined);
}

async function ensureStoredOrganizationInsights(
  force = false
): Promise<StoredOrganizationInsights> {
  await importNativeBookmarks();
  const [resources, tree] = await Promise.all([
    getLocalResources(),
    chrome.bookmarks.getTree()
  ]);
  const linkedResources = resources.filter(
    (resource) => resource.nativeBookmarkIds.length > 0
  );
  const catalog = buildBookmarkAgentCatalog(tree);
  const fingerprint = buildLibraryFingerprint(
    linkedResources,
    catalog
  );
  const previous = await getStoredOrganizationInsights();
  if (
    !force &&
    previous &&
    sameLibraryFingerprint(previous.fingerprint, fingerprint)
  ) {
    await syncOrganizationBadge();
    return previous;
  }

  const insights = buildLibraryInsights(linkedResources, catalog);
  const next = mergeStoredOrganizationInsights(
    previous,
    insights,
    fingerprint
  );
  await publishStoredOrganizationInsights(next);
  return next;
}

async function getOrganizationNotice() {
  const stored = await ensureStoredOrganizationInsights();
  return organizationNoticeFromStored(stored);
}

async function dismissOrganizationNotice() {
  const stored = await ensureStoredOrganizationInsights();
  await publishStoredOrganizationInsights(
    dismissStoredOrganizationInsights(stored)
  );
  return { dismissed: true as const };
}

async function getKnowledgeDashboard() {
  await importNativeBookmarks();
  const [resources, tree] = await Promise.all([
    getLocalResources(),
    chrome.bookmarks.getTree()
  ]);
  return buildKnowledgeDashboard(
    resources.filter((resource) => resource.nativeBookmarkIds.length > 0),
    buildBookmarkAgentCatalog(tree)
  );
}

async function getContextResurfacing() {
  const activeTab = await getActiveTabSummary();
  if (!activeTab?.supported) return [];
  await importNativeBookmarks();
  const [resources, tree] = await Promise.all([
    getLocalResources(),
    chrome.bookmarks.getTree()
  ]);
  return resurfaceForContext(
    resources.filter((resource) => resource.nativeBookmarkIds.length > 0),
    buildBookmarkAgentCatalog(tree),
    `${activeTab.title} ${hostFromUrl(activeTab.url)}`
  );
}

async function getFolderSuggestions(
  capture: import("../lib/types").PageCapture
) {
  await importNativeBookmarks();
  const [resources, folders] = await Promise.all([
    getLocalResources(),
    getFolderOptions()
  ]);
  return suggestFolders(
    capture,
    resources.filter((resource) => resource.nativeBookmarkIds.length > 0),
    folders
  );
}

async function askAgent(
  query: string,
  history: import("../lib/types").BookmarkAgentTurn[] = []
) {
  await importNativeBookmarks();
  const [resources, tree] = await Promise.all([
    getLocalResources(),
    chrome.bookmarks.getTree()
  ]);
  return askBookmarkAgent(
    query,
    resources.filter(
      (resource) => resource.nativeBookmarkIds.length > 0
    ),
    history,
    buildBookmarkAgentCatalog(tree)
  );
}

async function indexNativeBookmark(
  id: string,
  node: chrome.bookmarks.BookmarkTreeNode,
  options: { enhance?: boolean; seed?: ResourceRecord } = {}
) {
  if (!node.url || !isSupportedPageUrl(node.url)) {
    return;
  }

  const resourceKey = await resourceKeyForUrl(node.url);
  const auth = await getAuthState();
  const existing = await getLocalResource(resourceKey);
  const seed =
    !existing &&
    options.seed &&
    options.seed.resourceKey !== resourceKey
      ? options.seed
      : undefined;
  const base = existing || seed;
  const seededAcrossUrl = Boolean(seed);
  const timestamp = now();
  const resource: ResourceRecord = {
    resourceKey,
    canonicalUrl: canonicalizeUrl(node.url),
    url: node.url,
    title: node.title || base?.title || new URL(node.url).hostname,
    userNote: base?.userNote || "",
    summary: seededAcrossUrl ? "" : base?.summary || "",
    tags: base?.tags || [],
    tagsSource: base?.tagsSource,
    topics: seededAcrossUrl ? [] : base?.topics || [],
    aliases: seededAcrossUrl ? undefined : base?.aliases,
    contentExcerpt: seededAcrossUrl ? "" : base?.contentExcerpt || "",
    contentHash: seededAcrossUrl ? "" : base?.contentHash || "",
    selectedText: seededAcrossUrl ? "" : base?.selectedText || "",
    author: seededAcrossUrl ? "" : base?.author || "",
    siteName: seededAcrossUrl
      ? new URL(node.url).hostname
      : base?.siteName || new URL(node.url).hostname,
    language: seededAcrossUrl ? "" : base?.language || "",
    imageUrl: seededAcrossUrl ? "" : base?.imageUrl || "",
    ...(!seededAcrossUrl && base?.thumbnailDataUrl
      ? { thumbnailDataUrl: base.thumbnailDataUrl }
      : {}),
    coverSource: seededAcrossUrl ? undefined : base?.coverSource,
    coverUpdatedAt: seededAcrossUrl ? undefined : base?.coverUpdatedAt,
    categoryCoverId: seededAcrossUrl
      ? categoryCoverForResource({
          url: node.url,
          title: node.title || new URL(node.url).hostname,
          topics: [],
          tags: base?.tags || [],
          summary: ""
        })
      : base?.categoryCoverId,
    snapshotAt: seededAcrossUrl ? undefined : base?.snapshotAt,
    enhancementBlockReason: seededAcrossUrl
      ? undefined
      : base?.enhancementBlockReason,
    enhancementBlockMessage: seededAcrossUrl
      ? undefined
      : base?.enhancementBlockMessage,
    faviconUrl: seededAcrossUrl ? "" : base?.faviconUrl || "",
    nativeBookmarkIds: [
      ...new Set([...(existing?.nativeBookmarkIds || []), id])
    ],
    nativeFolderPath: await folderPathForId(node.parentId || ""),
    aiStatus:
      seededAcrossUrl ||
      (options.enhance && existing?.aiStatus !== "ready")
        ? "pending"
        : existing?.aiStatus || "not_requested",
    syncStatus: auth.configured ? "pending" : "local",
    createdAt: base?.createdAt || timestamp,
    updatedAt: timestamp,
    lastSyncedAt: existing?.lastSyncedAt
  };

  await upsertLocalResource(resource);
  if (auth.configured) {
    await enqueueOutbox(resource, "");
    void syncPendingIfReady();
  }
  if (options.enhance) {
    const display = await getDisplaySettings();
    const pending: BookmarkEnhancementPart[] = [];
    if (
      resource.aiStatus !== "ready" ||
      !resource.summary.trim() ||
      !resource.tags.length
    ) {
      pending.push("ai");
    }
    if (
      display.pageSnapshotsEnabled &&
      !isSnapshotSensitiveUrl(
        resource.url,
        display.snapshotExcludedHosts
      ) &&
      !(await getPageSnapshot(resource.canonicalUrl))
    ) {
      pending.push("snapshot");
    }
    const current = await activeTab();
    const activeMatch =
      current?.url && resourceMatchesLoadedUrl(resource, current.url);
    if (activeMatch) {
      await enqueueBookmarkEnhancement(
        resource,
        pending,
        pending.includes("snapshot")
          ? {
              state: "queued",
              trigger: "chrome_bookmark",
              ...(typeof current.id === "number"
                ? { tabId: current.id }
                : {})
            }
          : undefined
      );
      await rememberImmediateSnapshotTarget(
        current,
        resource.url,
        SAVED_PAGE_SNAPSHOT_DELAY_MS,
        false,
        resource.resourceKey,
        undefined,
        "chrome_bookmark"
      );
      await coordinateActiveBookmarkedPage(
        current,
        undefined,
        "chrome_bookmark"
      );
      void processBookmarkEnhancements();
    } else {
      // Chrome Sync、批量导入或其他窗口创建书签时，只登记“首次访问再做”。
      // 不把整个同步库变成一分钟一次的 alarm/backoff 风暴。
      await queueEnhancementsUntilVisit(resource, "chrome_bookmark");
    }
  }
}

async function handleRequest(request: ExtensionRequest): Promise<unknown> {
  switch (request.type) {
    case "GET_APP_STATE":
      return getAppState();
    case "GET_AI_SETTINGS":
      return getAiSettingsStatus();
    case "SAVE_AI_SETTINGS":
      return saveAiSettings(request.payload).then(async (status) => {
        // Key 就绪后只处理用户当前正在看的真实页面。其他 waiting_for_content
        // 任务继续等首次访问，不能因为有 Key 就在后台全库制造空转与退避。
        const current = await activeTab();
        if (current?.status === "complete") {
          await coordinateActiveBookmarkedPage(
            current,
            undefined,
            "normal_browse"
          );
        }
        return status;
      });
    case "GET_BOOKMARK_BAR":
      return getBookmarkBarSnapshot();
    case "GET_PENDING_SAVE":
      return consumePendingSaveDraft(request.tabId);
    case "GET_BOOKMARK_SAVE_STATE":
      return getBookmarkSaveState(request.url);
    case "GET_NAVIGATION_SUGGESTIONS":
      return getNavigationSuggestions(request.query);
    case "NAVIGATE":
      return navigate(request.payload, true);
    case "GET_FOLDERS":
      return getFolderOptions();
    case "CAPTURE_ACTIVE_PAGE":
      return captureActivePage(request.tabId);
    case "GET_FOLDER_SUGGESTIONS":
      return getFolderSuggestions(request.capture);
    case "SAVE_BOOKMARK":
      return saveBookmark(request.payload);
    case "ASK_BOOKMARK_AGENT":
      return askAgent(request.query, request.history);
    case "EXECUTE_BOOKMARK_AGENT_ACTIONS":
      return executeBookmarkAgentActions(request.actions);
    case "GET_LIBRARY_INSIGHTS":
      return getLibraryInsights();
    case "GET_ORGANIZATION_NOTICE":
      return getOrganizationNotice();
    case "DISMISS_ORGANIZATION_NOTICE":
      return dismissOrganizationNotice();
    case "GET_KNOWLEDGE_DASHBOARD":
      return getKnowledgeDashboard();
    case "GET_CONTEXT_RESURFACING":
      return getContextResurfacing();
    case "APPLY_ORGANIZATION_ACTIONS":
      return executeBookmarkAgentActions(request.actions, {
        maxActions: 200,
        label: `整理提案（${request.actions.length} 项）`
      });
    case "GET_UNDO_SNAPSHOTS":
      return getRecentUndoSnapshots();
    case "UNDO_BOOKMARK_BATCH":
      return undoStoredBookmarkBatch(request.batchId);
    case "GET_LOCAL_RESOURCES":
      await importNativeBookmarks();
      return (await getLocalResources()).filter(
        (resource) => resource.nativeBookmarkIds.length > 0
      );
    case "GET_SITE_BRANDS":
      return getSiteBrands();
    case "GET_PAGE_SNAPSHOT":
      return (await getPageSnapshot(request.canonicalUrl)) || null;
    case "GET_AGENT_CONVERSATIONS":
      return getAgentConversations();
    case "SAVE_AGENT_CONVERSATION":
      return saveAgentConversation(request.conversation);
    case "DELETE_AGENT_CONVERSATION":
      await deleteAgentConversation(request.id);
      return { deleted: true };
    case "START_LIBRARY_SCAN":
      return startLibraryScan(Boolean(request.force));
    case "GET_LIBRARY_SCAN_ESTIMATE":
      return getLibraryScanEstimate(Boolean(request.force));
    case "GET_LIBRARY_SCAN":
      return publicLibraryScan(await getStoredLibraryScan());
    case "START_SNAPSHOT_BACKFILL":
      return startSnapshotBackfill();
    case "GET_SNAPSHOT_BACKFILL":
      return getSnapshotBackfillStatus(
        Boolean(request.includeCandidateCount)
      );
    case "PAUSE_SNAPSHOT_BACKFILL":
      return updateSnapshotBackfillState("paused");
    case "RESUME_SNAPSHOT_BACKFILL":
      return updateSnapshotBackfillState("running");
    case "CANCEL_SNAPSHOT_BACKFILL":
      return updateSnapshotBackfillState("cancelled");
    case "GET_AI_USAGE":
      return getAiUsageStats();
    case "PAUSE_LIBRARY_SCAN":
      return updateLibraryScanState("paused");
    case "RESUME_LIBRARY_SCAN":
      return updateLibraryScanState("running");
    case "CANCEL_LIBRARY_SCAN":
      return updateLibraryScanState("cancelled");
    case "GET_RESOURCES":
      return getResources(request.query);
    case "SYNC_NOW":
      return syncNow();
    case "IMPORT_NATIVE_BOOKMARKS":
      return importNativeBookmarks();
    case "RESTORE_MISSING_NATIVE_BOOKMARKS":
      return restoreMissingNativeBookmarks();
    case "UPDATE_NATIVE_BOOKMARK":
      return updateNativeBookmark(request.payload);
    case "UPDATE_RESOURCE_TAGS":
      return updateResourceTags(request.payload);
    case "UPDATE_BOOKMARK_DETAILS":
      return updateBookmarkDetails(request.payload);
    case "CREATE_NATIVE_FOLDER":
      return createNativeFolder(request.payload);
    case "MOVE_NATIVE_BOOKMARK":
      return moveNativeBookmark(request.payload);
    case "DELETE_NATIVE_BOOKMARK":
      return deleteNativeBookmark(request.payload);
    case "OPEN_MANAGER": {
      const params = new URLSearchParams();
      if (request.query) params.set("q", request.query);
      if (request.view) params.set("view", request.view);
      const suffix = params.size ? `?${params.toString()}` : "";
      await chrome.tabs.create({
        url: chrome.runtime.getURL(`manager.html${suffix}`)
      });
      return { opened: true };
    }
    case "OPEN_SIDE_PANEL": {
      const currentWindow = await chrome.windows.getCurrent();
      if (typeof currentWindow.id !== "number") {
        throw new Error("无法确定当前 Chrome 窗口。");
      }
      await chrome.sidePanel.open({ windowId: currentWindow.id });
      return { opened: true };
    }
    case "AUTH_CHANGED":
      try {
        await syncPendingIfReady();
        await pullCloudResources();
      } catch {
        // The returned state gives the UI the actionable error boundary.
      }
      return getAppState();
  }
}

chrome.runtime.onMessage.addListener(
  (
    request: ExtensionRequest,
    _sender,
    sendResponse: (response: ExtensionResponse<unknown>) => void
  ) => {
    void handleRequest(request)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) =>
        sendResponse({ ok: false, error: errorMessage(error) })
      );
    return true;
  }
);

chrome.runtime.onInstalled.addListener(() => {
  void cleanupExpiredUndoSnapshots();
  void chrome.storage.local.setAccessLevel({
    accessLevel: "TRUSTED_CONTEXTS"
  });
  void chrome.sidePanel.setPanelBehavior({
    openPanelOnActionClick: true
  });
  void chrome.alarms.create("bookmark-layer-sync", {
    delayInMinutes: 1,
    periodInMinutes: 5
  });
  void chrome.contextMenus.removeAll().then(() =>
    Promise.all([
      chrome.contextMenus.create({
        id: CONTEXT_MENU_PAGE_ID,
        title: "添加到收藏…",
        contexts: ["page", "selection"]
      }),
      chrome.contextMenus.create({
        id: CONTEXT_MENU_LINK_ID,
        title: "添加或管理此链接…",
        contexts: ["link"]
      })
    ])
  ).then(() => refreshPageContextMenuState()).catch(() => undefined);
  void importNativeBookmarks()
    .then(async () => {
      await queueIndexedResourcesUntilVisit();
      const current = await activeTab();
      if (current?.status === "complete") {
        await coordinateActiveBookmarkedPage(
          current,
          undefined,
          "normal_browse"
        );
      }
      await syncPendingIfReady();
    })
    .catch(() => undefined);
  void processBookmarkEnhancements();
  void syncOrganizationBadge();
  void getStoredLibraryScan().then((scan) => {
    if (scan.state === "running") {
      void scheduleLibraryScan();
      void runLibraryScan();
    }
  });
  void recoverSnapshotBackfill();
  void chrome.omnibox.setDefaultSuggestion({
    description:
      "搜索 Chrome 书签、历史记录和标签页，或使用默认搜索引擎"
  });
});

async function refreshPageContextMenuState(
  knownTab?: chrome.tabs.Tab
): Promise<void> {
  const revision = ++pageContextMenuRevision;
  const tab = knownTab || (await activeTab());
  if (!tab?.url || !isSupportedPageUrl(tab.url)) {
    if (revision !== pageContextMenuRevision) return;
    await chrome.contextMenus
      .update(CONTEXT_MENU_PAGE_ID, {
        title: "添加到收藏…",
        enabled: false
      })
      .catch(() => undefined);
    return;
  }
  try {
    const state = await getBookmarkSaveState(tab.url);
    if (revision !== pageContextMenuRevision) return;
    await chrome.contextMenus.update(
      CONTEXT_MENU_PAGE_ID,
      bookmarkPageMenuPresentation(state)
    );
  } catch {
    if (revision !== pageContextMenuRevision) return;
    await chrome.contextMenus
      .update(
        CONTEXT_MENU_PAGE_ID,
        bookmarkPageMenuPresentation(null)
      )
      .catch(() => undefined);
  }
}

async function handleContextMenuSave(
  info: chrome.contextMenus.OnClickData,
  tab?: chrome.tabs.Tab
): Promise<void> {
  if (
    info.menuItemId !== CONTEXT_MENU_PAGE_ID &&
    info.menuItemId !== CONTEXT_MENU_LINK_ID
  ) {
    return;
  }
  try {
    const draft = buildPendingSaveDraft(info, tab);
    pendingSaveDrafts.set(draft.tabId, draft);
    // 必须在右键用户手势仍有效时立即调用 sidePanel.open；持久化与打开
    // 同步发起，随后等草稿落盘后再通知已存在的侧边栏实例。
    const storeDraft = chrome.storage.session.set({
      [pendingSaveKey(draft.tabId)]: draft
    });
    const openPanel = chrome.sidePanel.open({ tabId: draft.tabId });
    await storeDraft;
    await openPanel.catch((error) => {
      flashActionBadge(
        tab?.id,
        "!",
        "#a33b34",
        errorMessage(error)
      );
    });
    await chrome.runtime
      .sendMessage({
        type: "PENDING_SAVE_READY",
        tabId: draft.tabId
      })
      .catch(() => undefined);
  } catch (error) {
    flashActionBadge(
      tab?.id,
      "!",
      "#a33b34",
      errorMessage(error)
    );
  }
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  void handleContextMenuSave(info, tab);
});

function escapeOmniboxText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

chrome.omnibox.onInputChanged.addListener((text, suggest) => {
  void getNavigationSuggestions(text).then((items) => {
    suggest(
      items.slice(0, 8).map((item) => ({
        content: item.url,
        description: `<match>${escapeOmniboxText(item.title)}</match> <dim>${escapeOmniboxText(item.subtitle)}</dim>`
      }))
    );
  });
});

chrome.omnibox.onInputEntered.addListener((text, disposition) => {
  void navigate({
    text,
    disposition:
      disposition === "currentTab" ? "current" : "new"
  });
});

chrome.tabs.onUpdated.addListener(async (_tabId, changeInfo, tab) => {
  if (tab.active && (changeInfo.url || changeInfo.status)) {
    void refreshPageContextMenuState(tab);
  }
  if (changeInfo.status === "loading" && typeof tab.id === "number") {
    clearPageSnapshotTimer(tab.id);
    // 不在 tabs.onUpdated 中仅凭 URL 变化删除目标：合法 server/client
    // redirect 也会先暴露最终 URL。主框架 onCommitted 会依据 Chrome 的
    // transitionQualifiers 保留重定向，普通用户导航则会删除。
    return;
  }
  // 批量补拍标签页现在可以是非活动后台标签页，不能再用 tab.active 过滤。
  const backfillTab =
    typeof tab.id === "number"
      ? await isBatchBackfillTab(tab.id)
      : false;
  // pushState/replaceState 有时只产生 URL 变更而没有新的 complete 事件。
  // 对已稳定的活动页也重新绑定增强任务，且先清掉旧路由目标。
  if (
    changeInfo.url &&
    (tab.active || backfillTab) &&
    tab.status === "complete" &&
    changeInfo.status !== "complete"
  ) {
    void coordinateActiveBookmarkedPage(tab);
  }
  if (changeInfo.status === "complete" && (tab.active || backfillTab)) {
    if (backfillTab && typeof tab.id === "number") {
      await resetSnapshotBackfillTimeoutForTab(tab.id);
    }
    void scheduleImmediateSnapshotIfReady(tab);
    void coordinateActiveBookmarkedPage(tab);
  }
});

chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId !== 0) return;
  void (async () => {
    const target = await readImmediateSnapshotTarget(details.tabId);
    if (!target) return;
    // 任何新导航都先停止旧页面的定时器；是否保留目标由 committed 的
    // redirect 证据决定，不能仅凭“同一个 tab”宽松接受不同 URL。
    clearPageSnapshotTimer(details.tabId);
    const resource = await getLocalResource(target.resourceKey);
    if (
      resource?.nativeBookmarkIds.length &&
      snapshotTargetAllowsLoadedUrl(target, resource, details.url)
    ) {
      await storeImmediateSnapshotTarget(details.tabId, {
        ...target,
        navigationStartUrl: details.url,
        redirectedUrl: undefined,
        completedUrl: undefined,
        documentId: undefined
      });
    }
  })().catch(() => undefined);
});

chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0) return;
  void (async () => {
    const target = await readImmediateSnapshotTarget(details.tabId);
    if (!target) return;
    const resource = await getLocalResource(target.resourceKey);
    if (!resource?.nativeBookmarkIds.length) {
      await removeImmediateSnapshotTarget(details.tabId, target);
      return;
    }
    const directMatch = resourceMatchesLoadedUrl(resource, details.url);
    const navigationStartUrl =
      target.navigationStartUrl || target.targetUrl;
    const redirectSourceMatches = resourceMatchesLoadedUrl(
      resource,
      navigationStartUrl
    );
    if (
      !acceptsSnapshotNavigationCommit({
        directMatch,
        redirectSourceMatches,
        transitionQualifiers: details.transitionQualifiers
      })
    ) {
      clearPageSnapshotTimer(details.tabId);
      await removeImmediateSnapshotTarget(details.tabId, target);
      return;
    }
    const committedTarget: ImmediatePageSnapshotTarget = {
      ...target,
      completedUrl: details.url,
      documentId: details.documentId,
      ...(directMatch ? {} : { redirectedUrl: details.url })
    };
    await storeImmediateSnapshotTarget(details.tabId, committedTarget);
    await updateStoredSnapshotProgress(target.resourceKey, {
      state: "waiting_page",
      trigger: target.trigger,
      tabId: details.tabId,
      documentId: details.documentId,
      loadedUrl: details.url,
      ...(target.showToast ? { showToast: true } : {}),
      ...(target.refreshExisting ? { refreshExisting: true } : {})
    });
    if (!directMatch) {
      // 只有 Chrome 明确认定为 server/client redirect 才登记别名；
      // 普通用户导航绝不会借用原收藏任务。隐私保护目标也不写入资源身份，
      // 避免把银行、支付或医疗落地页永久关联到普通收藏。
      const display = await getDisplaySettings();
      if (
        isSnapshotSensitiveUrl(
          details.url,
          display.snapshotExcludedHosts
        )
      ) {
        return;
      }
      const latest = await getLocalResource(target.resourceKey);
      if (latest?.nativeBookmarkIds.length) {
        await upsertLocalResource({
          ...latest,
          aliases: [
            ...new Set([...(latest.aliases || []), details.url])
          ],
          updatedAt: now()
        });
      }
    }
  })().catch(() => undefined);
});

chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0) return;
  void (async () => {
    const job = await getStoredSnapshotBackfill();
    if (
      job.state !== "running" ||
      job.tabId !== details.tabId ||
      !job.currentResourceKey
    ) {
      return;
    }
    const resource = await getLocalResource(job.currentResourceKey);
    if (!resource?.nativeBookmarkIds.length) return;
    const privacySettings = await getDisplaySettings();
    if (
      isSnapshotSensitiveUrl(
        details.url,
        privacySettings.snapshotExcludedHosts
      )
    ) {
      const lease = snapshotBackfillLeaseFromJob(job);
      await recordSnapshotBackfillItem(
        "skipped",
        "重定向后的网页属于隐私保护范围。",
        {
          jobId: job.id,
          resourceKey: job.currentResourceKey,
          ...(lease ? { leaseToken: lease.token } : {})
        }
      );
      void driveSnapshotBackfill();
      return;
    }
    const target = await readImmediateSnapshotTarget(details.tabId);
    const directMatch = resourceMatchesLoadedUrl(resource, details.url);
    const redirectSourceMatches = resourceMatchesLoadedUrl(
      resource,
      target?.navigationStartUrl || target?.targetUrl || resource.url
    );
    if (
      acceptsSnapshotNavigationCommit({
        directMatch,
        redirectSourceMatches,
        transitionQualifiers: details.transitionQualifiers
      })
    ) {
      return;
    }
    // 标签页被导航到非目标网页（登录页、同意页、地域页等）时不再暂停
    // 等人手动继续，直接结算失败并自动进入下一项，避免任务卡住。
    const lease = snapshotBackfillLeaseFromJob(job);
    await recordSnapshotBackfillItem(
      "failed",
      "补拍标签页被导航到其他网页，已跳过该收藏。",
      {
        jobId: job.id,
        resourceKey: job.currentResourceKey,
        ...(lease ? { leaseToken: lease.token } : {})
      }
    );
    void driveSnapshotBackfill();
  })().catch(() => undefined);
});

chrome.webNavigation.onCompleted.addListener((details) => {
  if (details.frameId !== 0) return;
  void chrome.tabs
    .get(details.tabId)
    .then(async (tab) => {
      const backfillTab =
        typeof tab.id === "number"
          ? await isBatchBackfillTab(tab.id)
          : false;
      if (!tab.active && !backfillTab) return;
      void coordinateActiveBookmarkedPage(
        tab,
        details.documentId,
        "normal_browse"
      );
    })
    .catch(() => undefined);
});

chrome.webNavigation.onErrorOccurred.addListener((details) => {
  if (details.frameId !== 0) return;
  void (async () => {
    // Chrome 在用户主动切换导航、重定向或刷新时常用 ERR_ABORTED
    // 终止旧请求。它不是可重试的站点失败；新 committed 事件会负责
    // 接受合法重定向或暂停被用户改作他用的补拍标签。
    if (details.error === "net::ERR_ABORTED") return;
    const job = await getStoredSnapshotBackfill();
    if (
      job.state === "running" &&
      job.tabId === details.tabId &&
      job.currentResourceKey
    ) {
      const resource = await getLocalResource(job.currentResourceKey);
      if (
        !resource?.nativeBookmarkIds.length ||
        !resourceMatchesLoadedUrl(resource, details.url)
      ) {
        return;
      }
      const lease = snapshotBackfillLeaseFromJob(job);
      if (lease) {
        await retryOrFailSnapshotBackfillCurrent(
          `网页加载失败：${details.error || "未知网络错误"}`,
          { jobId: lease.jobId, token: lease.token }
        );
      } else {
        await recoverSnapshotBackfill();
      }
    }
  })().catch(() => undefined);
});

chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
  if (details.frameId !== 0) return;
  void chrome.tabs
    .get(details.tabId)
    .then((tab) => {
      if (!tab.active || tab.status !== "complete") return;
      void coordinateActiveBookmarkedPage(
        tab,
        details.documentId,
        "normal_browse"
      );
    })
    .catch(() => undefined);
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  void chrome.tabs
    .get(tabId)
    .then(async (tab) => {
      void refreshPageContextMenuState(tab);
      if (tab.status === "complete") {
        void scheduleImmediateSnapshotIfReady(tab);
        void coordinateActiveBookmarkedPage(tab);
      }
      const job = await getStoredSnapshotBackfill();
      if (
        ["running", "waiting_focus"].includes(job.state) &&
        typeof job.windowId === "number" &&
        tab.windowId === job.windowId &&
        job.tabId === tabId
      ) {
        void driveSnapshotBackfill();
      }
    })
    .catch(() => undefined);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  clearPageSnapshotTimer(tabId);
  void removeImmediateSnapshotTarget(tabId);
  void (async () => {
    const job = await getStoredSnapshotBackfill();
    if (
      job.tabId !== tabId ||
      !["running", "waiting_focus", "paused"].includes(job.state)
    ) {
      return;
    }
    await mutateStoredSnapshotBackfill(async (current) => {
      if (current.id !== job.id || current.tabId !== tabId) return;
      current.state = "cancelled";
      current.currentLease = undefined;
      current.currentTitle = "";
      current.updatedAt = now();
      current.completedAt = now();
      await invalidateSnapshotBackfillCapture(current);
    });
  })().catch(() => undefined);
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  void chrome.tabs
    .query({ active: true, windowId })
    .then(async ([tab]) => {
      void refreshPageContextMenuState(tab);
      if (tab?.status === "complete") {
        void scheduleImmediateSnapshotIfReady(tab);
        void coordinateActiveBookmarkedPage(tab);
      }
      const job = await getStoredSnapshotBackfill();
      if (
        ["running", "waiting_focus"].includes(job.state) &&
        job.windowId === windowId &&
        job.tabId === tab?.id
      ) {
        void driveSnapshotBackfill();
      }
    })
    .catch(() => undefined);
});

chrome.bookmarks.onCreated.addListener((id, node) => {
  void refreshPageContextMenuState();
  if (nativeBookmarkImportInProgress) return;
  if (
    internalBookmarkIds.has(id) ||
    (node.url &&
      internalBookmarkTargets.has(
        bookmarkTarget(node.parentId || "", node.url)
      ))
  ) {
    return;
  }
  void indexNativeBookmark(id, node, { enhance: true });
});

chrome.bookmarks.onImportBegan.addListener(() => {
  nativeBookmarkImportInProgress = true;
});

chrome.bookmarks.onImportEnded.addListener(() => {
  nativeBookmarkImportInProgress = false;
  void importNativeBookmarks()
    .then(() => queueIndexedResourcesUntilVisit())
    .catch(() => undefined);
  void refreshPageContextMenuState();
});

async function reindexChangedNativeBookmark(
  id: string,
  node: chrome.bookmarks.BookmarkTreeNode,
  urlChanged: boolean
): Promise<void> {
  let sourceForNewUrl: ResourceRecord | undefined;
  if (urlChanged) {
    const resources = await getLocalResources();
    sourceForNewUrl = resources.find((resource) =>
      resource.nativeBookmarkIds.includes(id)
    );
    await Promise.all(
      resources
        .filter(
          (resource) =>
            resource.nativeBookmarkIds.includes(id) &&
            (!node.url || !resourceMatchesLoadedUrl(resource, node.url))
        )
        .map(async (resource) => {
          const next = {
            ...resource,
            nativeBookmarkIds: resource.nativeBookmarkIds.filter(
              (bookmarkId) => bookmarkId !== id
            ),
            updatedAt: now()
          };
          await upsertLocalResource(next);
          if (!next.nativeBookmarkIds.length) {
            await cancelEnhancementForResource(resource.resourceKey);
          }
        })
    );
  }
  await indexNativeBookmark(id, node, {
    enhance: urlChanged,
    ...(sourceForNewUrl ? { seed: sourceForNewUrl } : {})
  });
}

chrome.bookmarks.onChanged.addListener((id, changeInfo) => {
  void refreshPageContextMenuState();
  if (internalBookmarkIds.has(id)) {
    return;
  }
  void chrome.bookmarks
    .get(id)
    .then(
      ([node]) =>
        node &&
        reindexChangedNativeBookmark(
          id,
          node,
          typeof changeInfo.url === "string"
        )
    )
    .catch(() => undefined);
});

chrome.bookmarks.onMoved.addListener((id) => {
  void refreshPageContextMenuState();
  if (internalBookmarkIds.has(id)) {
    return;
  }
  void chrome.bookmarks
    .get(id)
    .then(([node]) => node && indexNativeBookmark(id, node))
    .catch(() => undefined);
});

function bookmarkSubtreeIds(
  node: chrome.bookmarks.BookmarkTreeNode
): Set<string> {
  const ids = new Set<string>();
  const visit = (current: chrome.bookmarks.BookmarkTreeNode) => {
    ids.add(current.id);
    for (const child of current.children || []) visit(child);
  };
  visit(node);
  return ids;
}

async function handleRemovedNativeBookmark(
  id: string,
  removeInfo: {
    parentId: string;
    index: number;
    node: chrome.bookmarks.BookmarkTreeNode;
  }
): Promise<void> {
  const internal = internalBookmarkIds.has(id);
  if (!internal) {
    await putUndoSnapshot(
      createRemovedNodeUndoBatch({
        node: removeInfo.node,
        parentId: removeInfo.parentId,
        index: removeInfo.index
      })
    );
  }

  const removedIds = bookmarkSubtreeIds(removeInfo.node);
  const resources = await getLocalResources();
  await Promise.all(
    resources
      .filter((resource) =>
        resource.nativeBookmarkIds.some((bookmarkId) =>
          removedIds.has(bookmarkId)
        )
      )
      .map(async (resource) => {
        const next = {
          ...resource,
          nativeBookmarkIds: resource.nativeBookmarkIds.filter(
            (bookmarkId) => !removedIds.has(bookmarkId)
          ),
          updatedAt: now()
        };
        await upsertLocalResource(next);
        if (!next.nativeBookmarkIds.length) {
          await cancelEnhancementForResource(resource.resourceKey);
        }
      })
  );
}

chrome.bookmarks.onRemoved.addListener((id, removeInfo) => {
  void refreshPageContextMenuState();
  void handleRemovedNativeBookmark(id, removeInfo).catch(() => undefined);
});

chrome.runtime.onStartup.addListener(() => {
  void (async () => {
    await cleanupExpiredUndoSnapshots();
    await importNativeBookmarks();
    // 浏览器启动时只恢复当前可见页面，不扫描或后台打开整个收藏库。
    // 这样安装扩展前已收藏、且当前已经打开的网页也能立即进入补拍/AI 流程。
    const current = await activeTab();
    if (current?.status === "complete") {
      await coordinateActiveBookmarkedPage(
        current,
        undefined,
        "normal_browse"
      );
    }
    await syncOrganizationBadge();
    await refreshPageContextMenuState();
    const auth = await getAuthState();
    if (auth.signedIn && auth.accountMatches === true) {
      // 先提交本地变更，再拉取云端，避免旧云端数据覆盖待同步状态。
      await syncPendingIfReady();
      await pullCloudResources();
    }
    const scan = await getStoredLibraryScan();
    if (scan.state === "running") {
      await scheduleLibraryScan();
      void runLibraryScan();
    }
    await recoverSnapshotBackfill();
    void processBookmarkEnhancements();
  })().catch(() => undefined);
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "bookmark-layer-sync") {
    void syncPendingIfReady();
  } else if (alarm.name === LIBRARY_SCAN_ALARM) {
    void runLibraryScan();
  } else if (alarm.name === BOOKMARK_ENHANCEMENT_ALARM) {
    void processBookmarkEnhancements();
  } else if (alarm.name === SNAPSHOT_BACKFILL_TIMEOUT_ALARM) {
    // 兼容升级前遗留的无身份 alarm：只恢复状态，不允许它直接推进任何
    // 新 job/attempt。新的 alarm 一律携带 jobId + lease。
    void recoverSnapshotBackfill();
  } else {
    const timeout = snapshotBackfillTimeoutIdentity(alarm.name);
    if (timeout) {
      void timeoutOrFailSnapshotBackfillCurrent(
        "网页在限定时间内没有完成稳定加载。",
        timeout
      );
    }
  }
});

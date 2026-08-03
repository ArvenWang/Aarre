import { requestSync } from "../lib/sync-request";

import {
  isOffscreenSiteIconRequest
} from "../lib/offscreen-icon-protocol";
import {
  createAlarmHandler
} from "./lifecycle/alarms";
import { registerNetworkRecovery } from "./lifecycle/network";
import { registerAgentStream } from "./lifecycle/agent-stream";
import {
  configureActionSidePanelBehavior,
} from "./lifecycle/context-menu-core";
import { createContextMenuLifecycle } from "./lifecycle/context-menus-lazy";
import { createManualSnapshotHelpers } from "./lifecycle/manual-snapshot";
import {
  createSettingsHandlers
} from "./handlers/settings";
import {
  createSiteIconHandlers
} from "./handlers/site-icons";
import {
  createSnapshotHandlers
} from "./handlers/snapshots";
import {
  createAgentActionHandlers
} from "./handlers/agent-actions-lazy";
import {
  createAgentHandlers
} from "./handlers/agent-lazy";
import { createCloudHandlers } from "./handlers/cloud-lazy";
import {
  createPageNavigationCoordinator
} from "./coordinators/page-navigation";
import {
  createPageCaptureHandlers
} from "./handlers/page-capture";
import {
  createBookmarkEditHandlers
} from "./handlers/bookmark-edit";
import {
  createPageCoordinator
} from "./coordinators/page-coordinator";
import {
  createEnhancementQueue
} from "./coordinators/enhancement-queue";
import {
  createLibraryScanPolicy
} from "./coordinators/library-scan-policy";
import {
  createLibraryScanRunner
} from "./coordinators/library-scan-runner-lazy";
import {
  createBookmarkImportHandlers
} from "./handlers/bookmark-import";
import {
  activeTab,
  defaultFolderId,
  getActiveTabSummary,
  getBookmarkBarSnapshot,
  getBookmarkSaveState,
  getFolderOptions,
  getNavigationSuggestions,
  messageWindowId,
  openManagerPage
} from "./handlers/browser";
import {
  createResourceHandlers
} from "./handlers/resources";
import {
  createMessageHandlers
} from "./handlers";
import {
  createBookmarkSaveHandlers
} from "./handlers/bookmark-save";
import {
  createEnhancementStore
} from "./coordinators/enhancement-store";
import {
  createPendingSaveHandlers
} from "./handlers/pending-save";
import {
  createResourceCore,
  USER_PROTECTION_MESSAGE
} from "./handlers/resource-core";
import {
  registerBookmarkEvents
} from "./coordinators/bookmark-events";
import {
  registerPageEvents
} from "./coordinators/page-events";
import {
  registerInstallLifecycle,
  runBackgroundStartupMaintenance
} from "./lifecycle/install";
import {
  registerUiEvents
} from "./lifecycle/ui-events";

import {
  createSnapshotCapture
} from "./snapshots/capture";
import {
  createBackfillRuntime,
  type BackfillRuntime
} from "./snapshots/backfill-runtime";
import {
  createBackfillRunner
} from "./snapshots/backfill-runner";
import {
  createBackfillControl
} from "./snapshots/backfill-control";
import {
  createBackfillCommit
} from "./snapshots/backfill-commit";

import {
  type AiEnhancementProgress,
  type BookmarkEnhancementPart,
  type SnapshotEnhancementProgress
} from "../lib/bookmark-enhancement";

import {
  undoBookmarkBatch
} from "../lib/bookmark-undo";
import {
  executeProtectedBookmarkMutation,
  type ProtectedBookmarkMutationInput
} from "../lib/protected-bookmark-mutation";
import type {
  ExtensionRequest,
  ExtensionResponse,
  ProtectionTarget
} from "../lib/messages";

import {
  deleteUndoSnapshot,
  getPageSnapshot,
  putUndoSnapshot
} from "../lib/storage";

import type {
  ResourceRecord
} from "../lib/types";

export function initializeBackground(): void {
const internalBookmarkIds = new Set<string>();
const internalBookmarkTargets = new Set<string>();
const MANUAL_PAGE_SNAPSHOT_DELAY_MS = 0;

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

const resourceCore = createResourceCore({
  importNativeBookmarks: (force) => importNativeBookmarks(force),
  cancelEnhancementsForResources: (keys) =>
    cancelEnhancementsForResources(keys),
  queueEnhancementsUntilVisit: (resource, trigger, context) =>
    queueEnhancementsUntilVisit(resource, trigger, context),
  cancelAllAgentRuns: (reason) => cancelAllAgentRuns(reason)
});
function getPrivacyProtectionContext(tree?: chrome.bookmarks.BookmarkTreeNode[]) { return resourceCore.getPrivacyProtectionContext(tree); }
function resourceProtectionState(resource: Pick<ResourceRecord, "resourceKey" | "nativeBookmarkIds" | "url">, context: any, loadedUrl?: string) { return resourceCore.resourceProtectionState(resource, context, loadedUrl); }
function getItemProtectionState(target: ProtectionTarget, context?: any) { return resourceCore.getItemProtectionState(target, context); }
function reconcileProtectionRules() { return resourceCore.reconcileProtectionRules(); }
function setItemProtection(target: ProtectionTarget, enabled: boolean) { return resourceCore.setItemProtection(target, enabled); }
function upsertLocalResource(resource: ResourceRecord) { return resourceCore.upsertLocalResource(resource); }
function pullCloudResources() { return resourceCore.pullCloudResources(); }
function bookmarkedResourceLookup() { return resourceCore.bookmarkedResourceLookup(); }

let enhancementStore: ReturnType<typeof createEnhancementStore>;
function getStoredEnhancementJobs() { return enhancementStore.getStoredEnhancementJobs(); }
function enqueueBookmarkEnhancement(resource: ResourceRecord, pending: BookmarkEnhancementPart[], snapshot?: Omit<SnapshotEnhancementProgress, "updatedAt">) {
  return enhancementStore.enqueueBookmarkEnhancement(resource, pending, snapshot);
}
function queueEnhancementsUntilVisit(resource: ResourceRecord, trigger: SnapshotEnhancementProgress["trigger"] = "recovery", context?: unknown) {
  return enhancementStore.queueEnhancementsUntilVisit(resource, trigger, context);
}
function completeStoredEnhancementPart(resourceKey: string, part: BookmarkEnhancementPart) {
  return enhancementStore.completeStoredEnhancementPart(resourceKey, part);
}
function hasPageAccess(url: string) { return enhancementStore.hasPageAccess(url); }
function deferStoredEnhancementJob(resourceKey: string, message: string) { return enhancementStore.deferStoredEnhancementJob(resourceKey, message); }
function updateStoredSnapshotProgress(resourceKey: string, progress: Omit<SnapshotEnhancementProgress, "updatedAt">) {
  return enhancementStore.updateStoredSnapshotProgress(resourceKey, progress);
}
function updateStoredAiProgress(resourceKey: string, progress: Omit<AiEnhancementProgress, "updatedAt">) {
  return enhancementStore.updateStoredAiProgress(resourceKey, progress);
}
function cancelEnhancementsForResources(resourceKeys: ReadonlySet<string>) { return enhancementStore.cancelEnhancementsForResources(resourceKeys); }
function cancelEnhancementForResource(resourceKey: string) { return enhancementStore.cancelEnhancementForResource(resourceKey); }

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

let backfillRuntime: BackfillRuntime;
let backfillCommit: ReturnType<typeof createBackfillCommit>;

const {
  clearPageSnapshotTimer,
  capturePageSnapshotForTab,
  schedulePageSnapshotForTab
} = createSnapshotCapture({
  getPrivacyProtectionContext,
  resourceProtectionState,
  upsertLocalResource,
  updateStoredSnapshotProgress,
  deferStoredEnhancementJob,
  completeStoredEnhancementPart,
  snapshotBackfillAllowsCapture: (lease) =>
    backfillRuntime.snapshotBackfillAllowsCapture(lease),
  settleBatchChallenge: (lease) =>
    backfillCommit.settleBatchChallenge(lease),
  commitSnapshotBackfillCapture: (input) =>
    backfillCommit.commitSnapshotBackfillCapture(input),
  errorMessage
});

enhancementStore = createEnhancementStore({
  getPrivacyProtectionContext,
  resourceProtectionState,
  clearPageSnapshotTimer
});

const {
  resourceMatchesLoadedUrl,
  snapshotTargetAllowsLoadedUrl,
  bookmarkedResourceForLoadedUrl,
  scheduleImmediateSnapshotIfReady,
  discardMismatchedImmediateSnapshotTarget,
  rememberImmediateSnapshotTarget,
  prepareImmediateSnapshotTargetForNavigation,
  navigate
} = createPageNavigationCoordinator({
  bookmarkedResourceLookup,
  forgetBookmarkedResourceLookup: (url) =>
    resourceCore.forgetBookmarkedResourceLookup(url),
  schedulePageSnapshotForTab,
  retryBatchSnapshotCapture: (...args) =>
    backfillCommit.retryBatchSnapshotCapture(...args),
  clearPageSnapshotTimer,
  getPrivacyProtectionContext,
  resourceProtectionState,
  cancelEnhancementForResource,
  completeStoredEnhancementPart,
  updateStoredSnapshotProgress,
  activeTab,
  enqueueBookmarkEnhancement,
  processBookmarkEnhancements
});

const {
  markNativeBookmarksDirty,
  importNativeBookmarks,
  queueIndexedResourcesUntilVisit,
  restoreMissingNativeBookmarks
} = createBookmarkImportHandlers({
  upsertLocalResource,
  resourceMatchesLoadedUrl,
  reconcileProtectionRules,
  getPrivacyProtectionContext,
  queueEnhancementsUntilVisit,
  getFolderOptions,
  defaultFolderId,
  pullCloudResources,
  beginInternalBookmarkTarget: (target) => internalBookmarkTargets.add(target),
  cancelInternalBookmarkTarget: (target) => internalBookmarkTargets.delete(target),
  markInternalBookmarkId: (id) => internalBookmarkIds.add(id),
  releaseInternalBookmarkWrite
});

let bookmarkSaveHandlers: ReturnType<typeof createBookmarkSaveHandlers>;

const { handlers: cloudHandlers } = createCloudHandlers({
  getAppState: () => getAppState()
});

const {
  folderPathForId,
  captureActivePage,
  captureRenderedPageForDocument
} = createPageCaptureHandlers({
  getFolderOptions,
  activeTab,
  getPrivacyProtectionContext,
  bookmarkedResourceForLoadedUrl,
  resourceProtectionState
});

const {
  updateNativeBookmark,
  updateResourceTags,
  updateBookmarkDetails,
  createNativeFolder,
  moveNativeBookmark,
  deleteNativeBookmark
} = createBookmarkEditHandlers({
  getBookmarkSaveState,
  markNativeBookmarksDirty,
  runProtectedBookmarkMutation,
  upsertLocalResource,
  syncPendingIfReady: () => bookmarkSaveHandlers.syncPendingIfReady(),
  importNativeBookmarks,
  folderPathForId,
  cancelEnhancementForResource,
  reconcileProtectionRules,
  queueEnhancementsUntilVisit,
  defaultFolderId,
  markInternalBookmarkRemoval,
  releaseInternalBookmarkRemoval,
  markInternalBookmarkId: (id) => internalBookmarkIds.add(id),
  forgetInternalBookmarkId: (id) => internalBookmarkIds.delete(id)
});

const { coordinateActiveBookmarkedPage } = createPageCoordinator({
  discardMismatchedImmediateSnapshotTarget,
  snapshotTargetAllowsLoadedUrl,
  bookmarkedResourceForLoadedUrl,
  getPrivacyProtectionContext,
  resourceProtectionState,
  enqueueBookmarkEnhancement,
  rememberImmediateSnapshotTarget,
  upsertLocalResource,
  updateStoredAiProgress,
  updateStoredSnapshotProgress,
  completeStoredEnhancementPart,
  captureRenderedPageForDocument,
  deferStoredEnhancementJob,
  errorMessage
});

const enhancementQueue = createEnhancementQueue({
  cancelEnhancementForResource,
  getPrivacyProtectionContext,
  resourceProtectionState,
  upsertLocalResource,
  updateStoredAiProgress,
  updateStoredSnapshotProgress,
  completeStoredEnhancementPart,
  deferStoredEnhancementJob,
  getStoredEnhancementJobs,
  hasPageAccess,
  resourceMatchesLoadedUrl,
  rememberImmediateSnapshotTarget,
  errorMessage
});
const { readLimitedText, pageEssenceForResource } = enhancementQueue;
function processBookmarkEnhancements(): Promise<void> {
  return enhancementQueue.processBookmarkEnhancements();
}

bookmarkSaveHandlers = createBookmarkSaveHandlers({
  markNativeBookmarksDirty,
  defaultFolderId,
  getBookmarkSaveState,
  updateNativeBookmark,
  moveNativeBookmark,
  runProtectedBookmarkMutation,
  bookmarkTarget,
  beginInternalBookmarkTarget: (target) => internalBookmarkTargets.add(target),
  cancelInternalBookmarkTarget: (target) => internalBookmarkTargets.delete(target),
  markInternalBookmarkId: (id) => internalBookmarkIds.add(id),
  releaseInternalBookmarkWrite,
  upsertLocalResource,
  getPrivacyProtectionContext,
  resourceProtectionState,
  folderPathForId,
  resourceMatchesLoadedUrl,
  rememberImmediateSnapshotTarget,
  cancelEnhancementForResource,
  queueEnhancementsUntilVisit,
  enqueueBookmarkEnhancement,
  processBookmarkEnhancements,
  errorMessage,
  hostFromUrl,
  getUserProtectionMessage: () => USER_PROTECTION_MESSAGE
});
const {
  syncPendingIfReady,
  saveBookmark
} = bookmarkSaveHandlers;

backfillRuntime = createBackfillRuntime({ clearPageSnapshotTimer });

const {
  isBatchBackfillTab,
  resetSnapshotBackfillTimeoutForTab
} = backfillRuntime;

const backfillRunner = createBackfillRunner({
  runtime: backfillRuntime,
  clearPageSnapshotTimer,
  prepareImmediateSnapshotTargetForNavigation,
  rememberImmediateSnapshotTarget,
  resourceMatchesLoadedUrl,
  scheduleImmediateSnapshotIfReady,
  getPrivacyProtectionContext,
  resourceProtectionState,
  errorMessage
});

const {
  cleanupSnapshotBackfillRuntime,
  recordSnapshotBackfillItem,
  driveSnapshotBackfill
} = backfillRunner;

backfillCommit = createBackfillCommit({
  getPrivacyProtectionContext,
  resourceProtectionState,
  upsertLocalResource,
  completeStoredEnhancementPart,
  cleanupSnapshotBackfillRuntime,
  driveSnapshotBackfill,
  recordSnapshotBackfillItem,
  capturePageSnapshotForTab,
  errorMessage
});

const backfillControl = createBackfillControl({
  runtime: backfillRuntime,
  runner: backfillRunner,
  importNativeBookmarks,
  getPrivacyProtectionContext,
  errorMessage
});

const {
  startSnapshotBackfill,
  getSnapshotBackfillStatus,
  updateSnapshotBackfillState,
  retryOrFailSnapshotBackfillCurrent,
  timeoutOrFailSnapshotBackfillCurrent,
  recoverSnapshotBackfill
} = backfillControl;

const {
  askAgent,
  cancelAgent,
  cancelAllAgentRuns,
  dismissOrganizationNotice,
  ensureStoredOrganizationInsights,
  getContextResurfacing,
  getFolderSuggestions,
  getKnowledgeDashboard,
  getLibraryInsights,
  getOrganizationNotice,
  syncOrganizationBadge
} = createAgentHandlers({
  importNativeBookmarks,
  getActiveTabSummary,
  getFolderOptions,
  hostFromUrl,
  getPrivacyProtectionContext
});
registerAgentStream(askAgent, cancelAgent);

const {
  flashActionBadge,
  buildPendingSaveDraft,
  consumePendingSaveDraft,
  rememberPendingSaveDraft
} = createPendingSaveHandlers({ activeTab, syncOrganizationBadge });

const siteIconHandlers = createSiteIconHandlers({
  readLimitedText,
  upsertLocalResource
});

const {
  libraryScanCandidates,
  getLibraryScanEstimate
} = createLibraryScanPolicy({
  getPrivacyProtectionContext,
  resourceProtectionState,
  importNativeBookmarks
});

const {
  getStoredLibraryScan,
  publicLibraryScan,
  startLibraryScan,
  updateLibraryScanState,
  runLibraryScan
} = createLibraryScanRunner({
  libraryScanCandidates,
  ensureStoredOrganizationInsights: (force?: boolean) =>
    ensureStoredOrganizationInsights(force),
  getPrivacyProtectionContext,
  resourceProtectionState,
  upsertLocalResource,
  pageEssenceForResource,
  siteIconHandlers,
  syncPendingIfReady,
  errorMessage
});

const {
  getAppState,
  getAppStateLight,
  getResources,
  indexNativeBookmark
} = createResourceHandlers({
  getActiveTabSummary,
  getStoredLibraryScan,
  publicLibraryScan,
  getPrivacyProtectionContext,
  resourceProtectionState,
  importNativeBookmarks,
  syncPendingIfReady,
  folderPathForId,
  upsertLocalResource,
  cancelEnhancementForResource,
  activeTab,
  resourceMatchesLoadedUrl,
  enqueueBookmarkEnhancement,
  rememberImmediateSnapshotTarget,
  coordinateActiveBookmarkedPage,
  queueEnhancementsUntilVisit,
  processBookmarkEnhancements,
  getUserProtectionMessage: () => USER_PROTECTION_MESSAGE
});

const settingsHandlers = createSettingsHandlers({
  activeTab,
  coordinateActivePage: (tab) =>
    coordinateActiveBookmarkedPage(tab, undefined, "normal_browse"),
  getItemProtectionState,
  setItemProtection
});

const snapshotHandlers = createSnapshotHandlers({
  captureActivePage,
  getPageSnapshot,
  startSnapshotBackfill,
  getSnapshotBackfillStatus,
  updateSnapshotBackfillState
});

const requestHandlers = {
  ...settingsHandlers,
  ...snapshotHandlers,
  ...cloudHandlers
};

const {
  executeBookmarkAgentActions,
  getRecentUndoSnapshots,
  undoStoredBookmarkBatch
} = createAgentActionHandlers({
  getBookmarkSaveState,
  markNativeBookmarksDirty,
  createNativeFolder,
  deleteNativeBookmark,
  updateNativeBookmark,
  moveNativeBookmark,
  upsertLocalResource,
  importNativeBookmarks,
  defaultFolderId,
  markInternalBookmarkRemoval,
  releaseInternalBookmarkRemoval,
  errorMessage
});

const handlers = createMessageHandlers(requestHandlers, {
  getAppState,
  getAppStateLight,
  getBookmarkBarSnapshot,
  consumePendingSaveDraft,
  getBookmarkSaveState,
  getNavigationSuggestions,
  navigate,
  getFolderOptions,
  getFolderSuggestions,
  saveBookmark,
  askAgent,
  cancelAgent,
  executeBookmarkAgentActions,
  getLibraryInsights,
  getOrganizationNotice,
  dismissOrganizationNotice,
  getKnowledgeDashboard,
  getContextResurfacing,
  getRecentUndoSnapshots,
  undoStoredBookmarkBatch,
  importNativeBookmarks,
  getSiteBrands: () => siteIconHandlers.getSiteBrands(),
  startLibraryScan,
  getLibraryScanEstimate,
  publicLibraryScan,
  getStoredLibraryScan,
  updateLibraryScanState,
  getResources,
  restoreMissingNativeBookmarks,
  updateNativeBookmark,
  updateResourceTags,
  updateBookmarkDetails,
  createNativeFolder,
  moveNativeBookmark,
  deleteNativeBookmark,
  openManagerPage,
  messageWindowId,
  activeTab,
  syncPendingIfReady,
  pullCloudResources
});

chrome.runtime.onMessage.addListener(
  (
    request: ExtensionRequest,
    sender,
    sendResponse: (response: ExtensionResponse<unknown>) => void
  ) => {
    if (isOffscreenSiteIconRequest(request)) return false;
    const handler = handlers[request?.type];
    if (!handler) return false;
    void handler(request, sender)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) =>
        sendResponse({ ok: false, error: errorMessage(error) })
      );
    return true;
  }
);

const {
  prepareManualSnapshotTarget,
  scheduleManualSnapshot
} = createManualSnapshotHelpers({
  clearPageSnapshotTimer,
  schedulePageSnapshotForTab
});

const contextMenuLifecycle = createContextMenuLifecycle({
  activeTab,
  getBookmarkSaveState,
  getPrivacyProtectionContext,
  bookmarkedResourceForLoadedUrl,
  resourceProtectionState,
  buildPendingSaveDraft,
  rememberPendingSaveDraft,
  flashActionBadge,
  errorMessage,
  importNativeBookmarks,
  prepareManualSnapshotTarget,
  scheduleManualSnapshot,
  markNativeBookmarksDirty,
  upsertLocalResource
});

void configureActionSidePanelBehavior().catch(() => undefined);
runBackgroundStartupMaintenance();

registerUiEvents({
  contextMenus: contextMenuLifecycle,
  flashActionBadge,
  errorMessage,
  getNavigationSuggestions,
  navigate
});

registerPageEvents({
  refreshContextMenu: (tab) => contextMenuLifecycle.refresh(tab),
  discardMismatchedImmediateSnapshotTarget,
  scheduleImmediateSnapshotIfReady,
  coordinateActiveBookmarkedPage,
  isBatchBackfillTab,
  resetSnapshotBackfillTimeoutForTab,
  resourceMatchesLoadedUrl,
  snapshotTargetAllowsLoadedUrl,
  getPrivacyProtectionContext,
  resourceProtectionState,
  recordSnapshotBackfillItem,
  driveSnapshotBackfill,
  retryOrFailSnapshotBackfillCurrent,
  recoverSnapshotBackfill,
  clearPageSnapshotTimer,
  updateStoredSnapshotProgress,
  upsertLocalResource
});

registerBookmarkEvents({
  markNativeBookmarksDirty,
  refreshContextMenu: () => contextMenuLifecycle.refresh(),
  internalBookmarkIds,
  internalBookmarkTargets,
  bookmarkTarget,
  indexNativeBookmark,
  importNativeBookmarks,
  reconcileProtectionRules,
  queueIndexedResourcesUntilVisit,
  resourceMatchesLoadedUrl,
  upsertLocalResource,
  cancelEnhancementForResource
});

registerInstallLifecycle({
  ensurePinnedSiteBrandIcons: () => siteIconHandlers.ensurePinnedSiteBrandIcons(),
  configureActionSidePanelBehavior,
  registerContextMenus: () => contextMenuLifecycle.register(),
  refreshContextMenu: () => contextMenuLifecycle.refresh(),
  importNativeBookmarks,
  queueIndexedResourcesUntilVisit,
  activeTab,
  coordinateActiveBookmarkedPage,
  requestSync,
  processBookmarkEnhancements,
  syncOrganizationBadge,
  getStoredLibraryScan,
  runLibraryScan,
  recoverSnapshotBackfill
});

const handleAlarm = createAlarmHandler({
  requestSync,
  runLibraryScan,
  processBookmarkEnhancements,
  recoverSnapshotBackfill,
  timeoutOrFailSnapshotBackfillCurrent
});

chrome.alarms.onAlarm.addListener(handleAlarm);
registerNetworkRecovery(requestSync);
}

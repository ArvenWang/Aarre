import { getAuthState } from "../../lib/auth";
import { getCloudSyncSettings } from "../../lib/cloud-settings";
import { enqueueOutbox, getLocalResource, getLocalResources, getOutbox, getPageSnapshot } from "../../lib/storage";
import { searchLocalResources } from "../../lib/search";
import { needsAiEnrichment, preservedAiRetrievalFields } from "../../lib/ai-fields";
import { categoryCoverForResource } from "../../lib/cover-registry";
import { canonicalizeUrl, isSupportedPageUrl, resourceKeyForUrl } from "../../lib/url";
import type {
  ActiveTabSummary,
  AppState,
  ImportResult,
  LibraryScanStatus,
  ResourceRecord
} from "../../lib/types";
import type {
  BookmarkEnhancementPart,
  SnapshotEnhancementProgress
} from "../../lib/bookmark-enhancement";

interface ResourcesDependencies {
  getActiveTabSummary(): Promise<ActiveTabSummary | null>;
  getStoredLibraryScan(): Promise<LibraryScanStatus>;
  publicLibraryScan(job: LibraryScanStatus): LibraryScanStatus;
  getPrivacyProtectionContext(): Promise<{ pageSnapshotsEnabled: boolean }>;
  resourceProtectionState(resource: ResourceRecord, context: unknown): { protected: boolean; userProtected?: boolean };
  importNativeBookmarks(force?: boolean): Promise<ImportResult>;
  syncPendingIfReady(): Promise<unknown>;
  folderPathForId(folderId: string): Promise<string[]>;
  upsertLocalResource(resource: ResourceRecord): Promise<void>;
  cancelEnhancementForResource(resourceKey: string): Promise<void>;
  activeTab(): Promise<chrome.tabs.Tab | null>;
  resourceMatchesLoadedUrl(resource: ResourceRecord, url: string): boolean;
  enqueueBookmarkEnhancement(resource: ResourceRecord, parts: BookmarkEnhancementPart[], snapshot?: Omit<SnapshotEnhancementProgress, "updatedAt">): Promise<void>;
  rememberImmediateSnapshotTarget(tab: chrome.tabs.Tab, targetUrl: string, delayMs: number, showToast: boolean, resourceKey?: string, documentId?: string, trigger?: SnapshotEnhancementProgress["trigger"]): Promise<void>;
  coordinateActiveBookmarkedPage(tab: chrome.tabs.Tab, documentId?: string, trigger?: SnapshotEnhancementProgress["trigger"]): Promise<void>;
  queueEnhancementsUntilVisit(resource: ResourceRecord, trigger?: "chrome_bookmark"): Promise<void>;
  processBookmarkEnhancements(): Promise<void>;
  ensureSiteBrandForResource(
    resource: ResourceRecord,
    force?: boolean
  ): Promise<boolean>;
  getUserProtectionMessage(): string;
}

export function createResourceHandlers(dependencies: ResourcesDependencies) {
  const {
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
    ensureSiteBrandForResource,
    getUserProtectionMessage
  } = dependencies;
  const now = () => new Date().toISOString();
  const SAVED_PAGE_SNAPSHOT_DELAY_MS = 250;
async function getAppState(): Promise<AppState> {
  const [
    auth,
    tab,
    resources,
    outbox,
    scan,
    privacyContext,
    cloudSettings
  ] = await Promise.all([
    getAuthState(),
    getActiveTabSummary(),
    getLocalResources(),
    getOutbox(),
    getStoredLibraryScan(),
    getPrivacyProtectionContext(),
    getCloudSyncSettings()
  ]);
  const linkedResources = resources.filter(
    (resource) => resource.nativeBookmarkIds.length > 0
  );
  const aiEligibleResources = linkedResources.filter(
    (resource) => !resourceProtectionState(resource, privacyContext).protected
  );

  return {
    auth,
    activeTab: tab,
    localResourceCount: linkedResources.length,
    aiReadyResourceCount: aiEligibleResources.filter(
      (resource) => !needsAiEnrichment(resource)
    ).length,
    aiEligibleResourceCount: aiEligibleResources.length,
    aiPrivacyProtectedCount:
      linkedResources.length - aiEligibleResources.length,
    pendingSyncCount:
      auth.signedIn && auth.accountMatches === true ? outbox.length : 0,
    libraryScan: publicLibraryScan(scan)
  };
}

async function getAppStateLight(): Promise<AppState> {
  const [auth, tab, scan] = await Promise.all([
    getAuthState(),
    getActiveTabSummary(),
    getStoredLibraryScan()
  ]);
  return {
    auth,
    activeTab: tab,
    localResourceCount: 0,
    aiReadyResourceCount: 0,
    aiEligibleResourceCount: 0,
    aiPrivacyProtectedCount: 0,
    pendingSyncCount: 0,
    libraryScan: publicLibraryScan(scan)
  };
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
    ...(seededAcrossUrl ? {} : preservedAiRetrievalFields(base)),
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
    syncStatus:
      auth.signedIn && auth.accountMatches === true ? "pending" : "local",
    createdAt: base?.createdAt || timestamp,
    updatedAt: timestamp,
    lastSyncedAt: existing?.lastSyncedAt
  };

  await upsertLocalResource(resource);
  if (auth.signedIn && auth.accountMatches === true) {
    await enqueueOutbox(resource, "");
    void syncPendingIfReady();
  }
  if (options.enhance) {
    const privacyContext = await getPrivacyProtectionContext();
    const protection = resourceProtectionState(resource, privacyContext);
    const privacyBlocked = protection.protected;
    const pending: BookmarkEnhancementPart[] = [];
    if (!privacyBlocked && needsAiEnrichment(resource)) {
      pending.push("ai");
    }
    if (
      privacyContext.pageSnapshotsEnabled &&
      !privacyBlocked &&
      !(await getPageSnapshot(resource.canonicalUrl))
    ) {
      pending.push("snapshot");
    }
    if (privacyBlocked) {
      await cancelEnhancementForResource(resource.resourceKey);
      await upsertLocalResource({
        ...resource,
        aiStatus: resource.aiStatus === "ready" ? "ready" : "unavailable",
        enhancementBlockReason: "privacy",
        enhancementBlockMessage: protection.userProtected
          ? getUserProtectionMessage()
          : "Aarre 不会读取或发送内网、银行、支付和医疗页面内容。",
        updatedAt: now()
      });
      return;
    }
    // 网站标识即时补全：不依赖手动扫描，公开 HTML 抓取失败也由
    // ensureSiteBrandForResource 内部兜底，不影响收藏本身。
    void ensureSiteBrandForResource(resource).catch(() => undefined);
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

  return { getAppState, getAppStateLight, getResources, indexNativeBookmark };
}

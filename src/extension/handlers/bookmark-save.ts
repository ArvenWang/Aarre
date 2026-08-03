import { getAuthState } from "../../lib/auth";
import {
  getTrackedCloudResourceKeys,
  shouldQueueResourceForCloud,
} from "../../lib/cloud";
import { requestSync } from "../../lib/sync-request";
import {
  enqueueOutbox,
  getLocalResource,
  getLocalResources,
  getPageSnapshot,
  removeOutboxItem
} from "../../lib/storage";
import { getProtectionSettings, buildProtectionPolicy, isResourceUserProtected } from "../../lib/protection";
import { snapshotCreatedMutation } from "../../lib/bookmark-undo";
import type { ProtectedBookmarkMutationInput } from "../../lib/protected-bookmark-mutation";
import { canonicalizeUrl, hashText, resourceKeyForUrl } from "../../lib/url";
import { needsAiEnrichment, preservedAiRetrievalFields } from "../../lib/ai-fields";
import { getAiRuntimeSettings } from "../../lib/settings";
import { categoryCoverForResource } from "../../lib/cover-registry";
import { isSnapshotSensitiveUrl } from "../../lib/page-snapshot";
import type {
  BookmarkEnhancementPart,
  SnapshotEnhancementProgress
} from "../../lib/bookmark-enhancement";
import type {
  BookmarkSaveState,
  NativeBookmarkNode,
  OutboxItem,
  ResourceRecord,
  SaveBookmarkInput,
  SaveBookmarkResult
} from "../../lib/types";

interface BookmarkSaveDependencies {
  markNativeBookmarksDirty(): void;
  defaultFolderId(): Promise<string>;
  getBookmarkSaveState(url: string): Promise<BookmarkSaveState>;
  updateNativeBookmark(input: { id: string; title: string }): Promise<NativeBookmarkNode>;
  moveNativeBookmark(input: { id: string; parentId: string }): Promise<NativeBookmarkNode>;
  runProtectedBookmarkMutation<T>(input: ProtectedBookmarkMutationInput<T>): Promise<T>;
  bookmarkTarget(parentId: string, url: string): string;
  beginInternalBookmarkTarget(target: string): void;
  cancelInternalBookmarkTarget(target: string): void;
  markInternalBookmarkId(id: string): void;
  releaseInternalBookmarkWrite(id: string, target: string): void;
  upsertLocalResource(resource: ResourceRecord): Promise<void>;
  getPrivacyProtectionContext(): Promise<{ pageSnapshotsEnabled: boolean; excludedHosts: string[] }>;
  resourceProtectionState(resource: Pick<ResourceRecord, "resourceKey" | "nativeBookmarkIds" | "url">, context: unknown): { protected: boolean; userProtected?: boolean };
  folderPathForId(folderId: string): Promise<string[]>;
  resourceMatchesLoadedUrl(resource: ResourceRecord, url: string): boolean;
  rememberImmediateSnapshotTarget(tab: chrome.tabs.Tab, targetUrl: string, delayMs: number, showToast: boolean, resourceKey?: string, documentId?: string, trigger?: SnapshotEnhancementProgress["trigger"]): Promise<void>;
  cancelEnhancementForResource(resourceKey: string): Promise<void>;
  queueEnhancementsUntilVisit(resource: ResourceRecord, trigger?: "aarre_save"): Promise<void>;
  enqueueBookmarkEnhancement(resource: ResourceRecord, parts: BookmarkEnhancementPart[], snapshot?: Omit<SnapshotEnhancementProgress, "updatedAt">): Promise<void>;
  processBookmarkEnhancements(): Promise<void>;
  errorMessage(error: unknown): string;
  hostFromUrl(url: string): string;
  getUserProtectionMessage(): string;
}

export function createBookmarkSaveHandlers(dependencies: BookmarkSaveDependencies) {
  const {
    markNativeBookmarksDirty,
    defaultFolderId,
    getBookmarkSaveState,
    updateNativeBookmark,
    moveNativeBookmark,
    runProtectedBookmarkMutation,
    bookmarkTarget,
    beginInternalBookmarkTarget,
    cancelInternalBookmarkTarget,
    markInternalBookmarkId,
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
    getUserProtectionMessage
  } = dependencies;
  const now = () => new Date().toISOString();
  const SAVED_PAGE_SNAPSHOT_DELAY_MS = 250;
async function findOrCreateNativeBookmark(
  input: SaveBookmarkInput
): Promise<{ bookmark: chrome.bookmarks.BookmarkTreeNode; created: boolean }> {
  markNativeBookmarksDirty();
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
      beginInternalBookmarkTarget(target);
      try {
        const result = await chrome.bookmarks.create({
          parentId: folderId,
          title: input.title,
          url: input.capture.url
        });
        markInternalBookmarkId(result.id);
        releaseInternalBookmarkWrite(result.id, target);
        return result;
      } catch (error) {
        cancelInternalBookmarkTarget(target);
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
  if (
    !auth.configured ||
    !auth.signedIn ||
    auth.accountMatches !== true
  ) {
    return item.resource;
  }

  requestSync("local-resource-change", 3_000);
  return item.resource;
}

async function countPendingCloudResources(): Promise<number> {
  const [local, trackedResourceKeys, protectionSettings, bookmarkTree] =
    await Promise.all([
      getLocalResources(),
      getTrackedCloudResourceKeys(),
      getProtectionSettings(),
      chrome.bookmarks.getTree()
    ]);
  const protectionPolicy = buildProtectionPolicy(
    bookmarkTree,
    protectionSettings
  );
  return local.filter(
    (resource) =>
      !isResourceUserProtected(resource, protectionPolicy) &&
      shouldQueueResourceForCloud(resource, trackedResourceKeys)
  ).length;
}

async function syncPendingIfReady(): Promise<{ synced: number; failed: number }> {
  const auth = await getAuthState();
  if (
    auth.configured &&
    auth.signedIn &&
    auth.accountMatches === true
  ) {
    const [local, trackedResourceKeys, protectionSettings, bookmarkTree] =
      await Promise.all([
        getLocalResources(),
        getTrackedCloudResourceKeys(),
        getProtectionSettings(),
        chrome.bookmarks.getTree()
      ]);
    const protectionPolicy = buildProtectionPolicy(
      bookmarkTree,
      protectionSettings
    );
    for (const resource of local) {
      if (isResourceUserProtected(resource, protectionPolicy)) {
        // A stale outbox entry must never keep a protected item looking like it
        // is waiting to upload. The server also enforces the protection rule,
        // but removing the local work avoids repeated no-op retries.
        await removeOutboxItem(resource.resourceKey);
        if (resource.syncStatus === "pending" || resource.syncStatus === "failed") {
          await upsertLocalResource({ ...resource, syncStatus: "local" });
        }
        continue;
      }
      if (!shouldQueueResourceForCloud(resource, trackedResourceKeys)) {
        continue;
      }
      const pending = resource.syncStatus === "pending"
        ? resource
        : { ...resource, syncStatus: "pending" as const };
      if (pending !== resource) await upsertLocalResource(pending);
      await enqueueOutbox(pending, "");
    }
    requestSync("local-resource-change", 3_000);
  }
  return { synced: 0, failed: 0 };
}

async function saveBookmark(
  input: SaveBookmarkInput
): Promise<SaveBookmarkResult> {
  const auth = await getAuthState();
  const sourceTab =
    typeof input.sourceTabId === "number"
      ? await chrome.tabs.get(input.sourceTabId).catch(() => null)
      : null;
  const { bookmark, created } = await findOrCreateNativeBookmark(input);
  const canonicalUrl = canonicalizeUrl(
    input.capture.url,
    input.capture.canonicalUrl
  );
  const resourceKey = await resourceKeyForUrl(canonicalUrl);
  const existing = await getLocalResource(resourceKey);
  const nativeBookmarkIds = [
    ...new Set([...(existing?.nativeBookmarkIds || []), bookmark.id])
  ];
  const privacyContext = await getPrivacyProtectionContext();
  const protection = resourceProtectionState(
    {
      resourceKey,
      nativeBookmarkIds,
      url: input.capture.url
    },
    privacyContext
  );
  const privacyBlocked = sourceTab?.incognito === true || protection.protected;
  const contentHash = privacyBlocked
    ? existing?.contentHash || ""
    : await hashText(input.capture.content);
  const timestamp = now();
  const contentChanged =
    Boolean(existing?.contentHash) && existing?.contentHash !== contentHash;
  const existingAiComplete = Boolean(
    existing && !needsAiEnrichment(existing)
  );

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
    ...preservedAiRetrievalFields(existing),
    contentExcerpt: privacyBlocked
      ? existing?.contentExcerpt || ""
      : input.capture.excerpt,
    contentHash,
    selectedText: privacyBlocked
      ? existing?.selectedText || ""
      : input.capture.selectedText,
    author: privacyBlocked ? existing?.author || "" : input.capture.author,
    siteName: privacyBlocked
      ? existing?.siteName || hostFromUrl(input.capture.url)
      : input.capture.siteName,
    language: privacyBlocked
      ? existing?.language || ""
      : input.capture.language,
    imageUrl: privacyBlocked
      ? existing?.imageUrl || ""
      : input.capture.imageUrl,
    ...(existing?.thumbnailDataUrl
      ? { thumbnailDataUrl: existing.thumbnailDataUrl }
      : {}),
    coverSource: existing?.coverSource,
    coverUpdatedAt: existing?.coverUpdatedAt,
    categoryCoverId: existing?.categoryCoverId,
    snapshotAt: existing?.snapshotAt,
    enhancementBlockReason: existing?.enhancementBlockReason,
    enhancementBlockMessage: existing?.enhancementBlockMessage,
    faviconUrl: privacyBlocked
      ? existing?.faviconUrl || ""
      : input.capture.faviconUrl,
    nativeBookmarkIds,
    nativeFolderPath: await folderPathForId(bookmark.parentId || input.folderId),
    aiStatus: input.requestAi
      ? existingAiComplete && !contentChanged
        ? "ready"
        : "pending"
      : existing?.aiStatus || "not_requested",
    syncStatus: auth.signedIn && auth.accountMatches === true ? "pending" : "local",
    createdAt: existing?.createdAt || timestamp,
    updatedAt: timestamp,
    lastSyncedAt: existing?.lastSyncedAt
  };

  // 原生书签写入和基础资源落库后立刻启动快照流程，不让可选的 AI
  // 富化网络请求阻塞截图；真正截图仍会等待页面 complete 且稳定。
  await upsertLocalResource(resource);
  void Promise.resolve(
    !privacyBlocked && privacyContext.pageSnapshotsEnabled ? sourceTab : null
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
    !(existingAiComplete && !contentChanged);
  if (privacyBlocked) {
    const blockMessage = protection.userProtected
      ? getUserProtectionMessage()
      : "Aarre 不会读取或发送无痕、内网、银行、支付和医疗页面内容。";
    aiWarning = `收藏已保存。${blockMessage}`;
    resource = {
      ...resource,
      aiStatus: existingAiComplete ? "ready" : "unavailable",
      enhancementBlockReason: "privacy",
      enhancementBlockMessage: blockMessage,
      updatedAt: now()
    };
  } else if (needsAi) {
      const aiSettings = await getAiRuntimeSettings();
      if (aiSettings.apiKey && hasTrustworthyRenderedContent) {
        try {
          const { enrichResourceLocally } = await import("../../lib/local-ai");
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
        aiWarning = `书签已保存，摘要与标签任务已保留。请在设置中填写 ${aiSettings.provider === "gemini" ? "Gemini" : aiSettings.provider === "openai" ? "OpenAI" : "DeepSeek"} API Key，填写后任务自动继续。`;
        resource = {
          ...resource,
          aiStatus: "pending",
          updatedAt: now()
        };
      } else {
        aiWarning =
          "书签已保存。首次正常打开该网页后将补全摘要、标签和封面。";
        resource = {
          ...resource,
          aiStatus: "pending",
          updatedAt: now()
        };
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
  if (auth.signedIn && auth.accountMatches === true) {
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
    privacyContext.pageSnapshotsEnabled &&
    !isSnapshotSensitiveUrl(
      synced.url,
      privacyContext.excludedHosts
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

  return {
    countPendingCloudResources,
    syncPendingIfReady,
    saveBookmark
  };
}

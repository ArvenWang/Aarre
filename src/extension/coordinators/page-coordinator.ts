import { getAiProviderPreset, getAiRuntimeSettings } from "../../lib/settings";
import { needsAiEnrichment } from "../../lib/ai-fields";
import { getLocalResource, getPageSnapshot } from "../../lib/storage";
import { hashText } from "../../lib/url";
import {
  enhancementTriggerAllowsRenderedAi,
  snapshotCapturePolicy,
  type AiEnhancementProgress,
  type BookmarkEnhancementPart,
  type SnapshotEnhancementProgress
} from "../../lib/bookmark-enhancement";
import { isLoadedSnapshotTab, isPageSnapshotStale } from "../../lib/page-snapshot";
import { readImmediateSnapshotTarget } from "../snapshots/target-store";
import type { ResourceRecord } from "../../lib/types";

const USER_PROTECTION_MESSAGE = "这条收藏受用户保护，不会读取或发送页面内容。";
const AARRE_OPEN_PAGE_SNAPSHOT_DELAY_MS = 1_500;
const SAVED_PAGE_SNAPSHOT_DELAY_MS = 250;
const BATCH_PAGE_SNAPSHOT_DELAY_MS = 300;

interface PageCoordinatorDependencies {
  discardMismatchedImmediateSnapshotTarget(tab: chrome.tabs.Tab): Promise<void>;
  snapshotTargetAllowsLoadedUrl(target: Awaited<ReturnType<typeof readImmediateSnapshotTarget>> & {}, resource: ResourceRecord, loadedUrl: string): boolean;
  bookmarkedResourceForLoadedUrl(url: string): Promise<ResourceRecord | undefined>;
  getPrivacyProtectionContext(): Promise<unknown>;
  resourceProtectionState(resource: ResourceRecord, context: unknown, loadedUrl?: string): { protected: boolean; userProtected?: boolean };
  enqueueBookmarkEnhancement(resource: ResourceRecord, parts: BookmarkEnhancementPart[], snapshot?: Omit<SnapshotEnhancementProgress, "updatedAt">): Promise<void>;
  rememberImmediateSnapshotTarget(tab: chrome.tabs.Tab, targetUrl: string, delayMs: number, showToast: boolean, resourceKey?: string, documentId?: string, trigger?: SnapshotEnhancementProgress["trigger"]): Promise<void>;
  upsertLocalResource(resource: ResourceRecord): Promise<void>;
  updateStoredAiProgress(resourceKey: string, progress: Omit<AiEnhancementProgress, "updatedAt">): Promise<void>;
  updateStoredSnapshotProgress(resourceKey: string, progress: Omit<SnapshotEnhancementProgress, "updatedAt">): Promise<void>;
  completeStoredEnhancementPart(resourceKey: string, part: BookmarkEnhancementPart): Promise<void>;
  captureRenderedPageForDocument(tabId: number, documentId?: string): Promise<import("../../lib/types").PageCapture>;
  deferStoredEnhancementJob(resourceKey: string, message: string): Promise<void>;
  errorMessage(error: unknown): string;
}

export function createPageCoordinator(dependencies: PageCoordinatorDependencies) {
  const {
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
  } = dependencies;
  const renderedPageEnhancementRunning = new Set<string>();
  const now = () => new Date().toISOString();
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
  const context = await getPrivacyProtectionContext();
  const privacyBlocked = resourceProtectionState(
    resource,
    context,
    tab.url
  ).protected;
  const existingSnapshot = await getPageSnapshot(resource.canonicalUrl);
  const snapshotPolicy = snapshotCapturePolicy({
    hasSnapshot: Boolean(existingSnapshot),
    snapshotIsStale: isPageSnapshotStale(existingSnapshot),
    trigger: effectiveTrigger
  });
  const needsAi = needsAiEnrichment(resource);

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
        resourceProtectionState(resource, context, tab.url).userProtected
          ? USER_PROTECTION_MESSAGE
          : "Aarre 不会读取或发送内网、银行、支付和医疗页面内容。",
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
    const { enrichResourceLocally } = await import("../../lib/local-ai");
    const enriched = await enrichResourceLocally(prepared, page);
    await upsertLocalResource(enriched);
    await completeStoredEnhancementPart(resource.resourceKey, "ai");
  } catch (error) {
    const failed = await getLocalResource(resource.resourceKey);
    if (failed?.nativeBookmarkIds.length) {
      await upsertLocalResource({
        ...failed,
        aiStatus: "failed",
        updatedAt: now()
      });
    }
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

  return { coordinateActiveBookmarkedPage };
}

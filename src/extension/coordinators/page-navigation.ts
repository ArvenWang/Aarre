import { canonicalizeUrl, isSupportedPageUrl, resourceKeyForUrl } from "../../lib/url";
import { parseNavigationInput } from "../../lib/navigation";
import {
  isLoadedSnapshotTab,
  isPageSnapshotStale,
  matchesSnapshotTargetUrl,
  mergePageSnapshotSchedule
} from "../../lib/page-snapshot";
import {
  snapshotCapturePolicy,
  type BookmarkEnhancementPart,
  type SnapshotEnhancementProgress
} from "../../lib/bookmark-enhancement";
import { getLocalResource, getPageSnapshot } from "../../lib/storage";
import {
  readImmediateSnapshotTarget,
  removeImmediateSnapshotTarget,
  storeImmediateSnapshotTarget,
  type ImmediatePageSnapshotTarget
} from "../snapshots/target-store";
import {
  getStoredSnapshotBackfill,
  snapshotBackfillLeaseFromWorker
} from "../snapshots/backfill-store";
import type { PageSnapshotScheduleOptions } from "../snapshots/capture";
import type { NavigationInput, ResourceRecord } from "../../lib/types";
import type { SnapshotBackfillLease } from "../../lib/snapshot-backfill";

const AARRE_OPEN_PAGE_SNAPSHOT_DELAY_MS = 1_500;
const SAVED_PAGE_SNAPSHOT_DELAY_MS = 250;
const MANUAL_PAGE_SNAPSHOT_DELAY_MS = 0;
const BATCH_PAGE_SNAPSHOT_DELAY_MS = 300;

interface PageNavigationDependencies {
  bookmarkedResourceLookup(): Promise<Map<string, string>>;
  forgetBookmarkedResourceLookup(url: string): void;
  schedulePageSnapshotForTab(tab: chrome.tabs.Tab, options: PageSnapshotScheduleOptions): boolean;
  retryBatchSnapshotCapture(tabId: number, loadedUrl: string, options: PageSnapshotScheduleOptions, target: ImmediatePageSnapshotTarget, attempt: number): Promise<void>;
  clearPageSnapshotTimer(tabId: number): void;
  getPrivacyProtectionContext(): Promise<unknown>;
  resourceProtectionState(resource: ResourceRecord, context: unknown): { protected: boolean };
  cancelEnhancementForResource(resourceKey: string): Promise<void>;
  completeStoredEnhancementPart(resourceKey: string, part: BookmarkEnhancementPart): Promise<void>;
  updateStoredSnapshotProgress(resourceKey: string, progress: Omit<SnapshotEnhancementProgress, "updatedAt">): Promise<void>;
  activeTab(): Promise<chrome.tabs.Tab | null>;
  enqueueBookmarkEnhancement(resource: ResourceRecord, parts: BookmarkEnhancementPart[], snapshot?: Omit<SnapshotEnhancementProgress, "updatedAt">): Promise<void>;
  processBookmarkEnhancements(): Promise<void>;
}

export function createPageNavigationCoordinator(dependencies: PageNavigationDependencies) {
  const {
    bookmarkedResourceLookup,
    forgetBookmarkedResourceLookup,
    schedulePageSnapshotForTab,
    retryBatchSnapshotCapture,
    clearPageSnapshotTimer,
    getPrivacyProtectionContext,
    resourceProtectionState,
    cancelEnhancementForResource,
    completeStoredEnhancementPart,
    updateStoredSnapshotProgress,
    activeTab,
    enqueueBookmarkEnhancement,
    processBookmarkEnhancements
  } = dependencies;

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
  forgetBookmarkedResourceLookup(canonicalLoadedUrl);
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
  const backfillLease = await backfillLeaseForTarget(tab.id, target);
  return schedulePageSnapshotForTab(tab, {
    delayMs: target.delayMs,
    snapshotUrl: target.targetUrl,
    resourceKey: target.resourceKey,
    showToast: target.showToast,
    documentId: target.documentId,
    trigger: target.trigger,
    refreshExisting: target.refreshExisting,
    ...(backfillLease
      ? {
          backfillLease
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
            ...(backfillLease ? { backfillLease } : {})
          },
          target,
          1
        );
      }
    }
  });
}

async function backfillLeaseForTarget(
  tabId: number,
  target: ImmediatePageSnapshotTarget
): Promise<SnapshotBackfillLease | undefined> {
  if (!target.backfillJobId || !target.backfillLease) return undefined;
  const job = await getStoredSnapshotBackfill();
  const worker = job.workers.find(
    (candidate) =>
      candidate.tabId === tabId &&
      candidate.currentLease === target.backfillLease &&
      (target.backfillWorkerId === undefined ||
        candidate.id === target.backfillWorkerId)
  );
  return worker
    ? snapshotBackfillLeaseFromWorker(job.id, worker)
    : undefined;
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
  const privacyContext = await getPrivacyProtectionContext();
  if (resourceProtectionState(resource, privacyContext).protected) {
    await cancelEnhancementForResource(resourceKey);
    return;
  }
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
    ...(backfillLease?.workerId !== undefined ||
    sameResourceTarget?.backfillWorkerId !== undefined
      ? {
          backfillWorkerId:
            backfillLease?.workerId ?? sameResourceTarget?.backfillWorkerId
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
          : trigger === "manual_refresh"
            ? MANUAL_PAGE_SNAPSHOT_DELAY_MS
            : SAVED_PAGE_SNAPSHOT_DELAY_MS,
    resourceKey: resource.resourceKey,
    showToast: showToast && policy.showToast,
    trigger,
    ...(backfillLease
      ? {
          backfillJobId: backfillLease.jobId,
          backfillWorkerId: backfillLease.workerId,
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

  // 直接带目标 URL 创建标签页，避免用户先看到 Chrome 默认首页。
  // 目标登记放在 create 返回后尽快进行；rememberImmediateSnapshotTarget
  // 会再次读取当前标签页，因此即使页面已经快速完成加载也不会漏掉截图。
  const created = await chrome.tabs.create({ url, active: true });
  if (typeof created.id !== "number") {
    throw new Error("Chrome 未返回目标标签页。");
  }
  const resource = await bookmarkedResourceForLoadedUrl(url);
  const preparedTarget =
    resource
      ? await prepareImmediateSnapshotTargetForNavigation(
          created.id,
          resource,
          url,
          "aarre_open",
          true
        )
      : undefined;
  try {
    const updated = await chrome.tabs.get(created.id);
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
    if (typeof created.id === "number") {
      if (preparedTarget) {
        await removeImmediateSnapshotTarget(
          created.id,
          preparedTarget
        ).catch(() => undefined);
      }
      await chrome.tabs.remove(created.id).catch(() => undefined);
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
  return {
    resourceMatchesLoadedUrl,
    bookmarkedResourceForLoadedUrl,
    snapshotTargetAllowsLoadedUrl,
    scheduleImmediateSnapshotIfReady,
    discardMismatchedImmediateSnapshotTarget,
    rememberImmediateSnapshotTarget,
    prepareImmediateSnapshotTargetForNavigation,
    navigate
  };
}

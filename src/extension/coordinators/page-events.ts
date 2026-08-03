import { getLocalResource } from "../../lib/storage";
import { acceptsSnapshotNavigationCommit } from "../../lib/bookmark-enhancement";
import {
  getStoredSnapshotBackfill,
  mutateStoredSnapshotBackfill,
  snapshotBackfillLeaseFromWorker,
  snapshotBackfillWorkerForTab
} from "../snapshots/backfill-store";
import {
  readImmediateSnapshotTarget,
  removeImmediateSnapshotTarget,
  storeImmediateSnapshotTarget,
  type ImmediatePageSnapshotTarget
} from "../snapshots/target-store";
import { clearSnapshotBackfillTimeout } from "../lifecycle/alarms";
import type { ResourceRecord } from "../../lib/types";

type DeferredAction = (...args: any[]) => any;

interface PageEventDependencies {
  refreshContextMenu: DeferredAction;
  discardMismatchedImmediateSnapshotTarget: DeferredAction;
  scheduleImmediateSnapshotIfReady: DeferredAction;
  coordinateActiveBookmarkedPage: DeferredAction;
  isBatchBackfillTab: DeferredAction;
  resetSnapshotBackfillTimeoutForTab: DeferredAction;
  resourceMatchesLoadedUrl(resource: ResourceRecord, url: string): boolean;
  snapshotTargetAllowsLoadedUrl: DeferredAction;
  getPrivacyProtectionContext: DeferredAction;
  resourceProtectionState: DeferredAction;
  recordSnapshotBackfillItem: DeferredAction;
  driveSnapshotBackfill: DeferredAction;
  retryOrFailSnapshotBackfillCurrent: DeferredAction;
  recoverSnapshotBackfill: DeferredAction;
  clearPageSnapshotTimer(tabId: number): void;
  updateStoredSnapshotProgress: DeferredAction;
  upsertLocalResource: DeferredAction;
}

export function registerPageEvents(dependencies: PageEventDependencies): void {
  const {
    refreshContextMenu,
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
  } = dependencies;
  const now = () => new Date().toISOString();
chrome.tabs.onUpdated.addListener(async (_tabId, changeInfo, tab) => {
  if (tab.active && (changeInfo.url || changeInfo.status)) {
    void refreshContextMenu(tab);
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
      const latest = await getLocalResource(target.resourceKey);
      if (latest?.nativeBookmarkIds.length) {
        const context = await getPrivacyProtectionContext();
        if (
          resourceProtectionState(latest, context, details.url).protected
        ) {
          return;
        }
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
    const worker = snapshotBackfillWorkerForTab(job, details.tabId);
    if (
      job.state !== "running" ||
      !worker ||
      !worker.currentResourceKey
    ) {
      return;
    }
    const resource = await getLocalResource(worker.currentResourceKey);
    if (!resource?.nativeBookmarkIds.length) return;
    const privacyContext = await getPrivacyProtectionContext();
    if (
      resourceProtectionState(resource, privacyContext, details.url).protected
    ) {
      const lease = snapshotBackfillLeaseFromWorker(job.id, worker);
      await recordSnapshotBackfillItem(
        worker.id,
        "skipped",
        "重定向后的网页属于隐私保护范围。",
        {
          jobId: job.id,
          resourceKey: worker.currentResourceKey,
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
    const lease = snapshotBackfillLeaseFromWorker(job.id, worker);
    await recordSnapshotBackfillItem(
      worker.id,
      "failed",
      "补拍标签页被导航到其他网页，已跳过该收藏。",
      {
        jobId: job.id,
        resourceKey: worker.currentResourceKey,
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
    const worker = snapshotBackfillWorkerForTab(job, details.tabId);
    if (
      job.state === "running" &&
      worker?.currentResourceKey
    ) {
      const resource = await getLocalResource(worker.currentResourceKey);
      if (
        !resource?.nativeBookmarkIds.length ||
        !resourceMatchesLoadedUrl(resource, details.url)
      ) {
        return;
      }
      const lease = snapshotBackfillLeaseFromWorker(job.id, worker);
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
      void refreshContextMenu(tab);
      if (tab.status === "complete") {
        void scheduleImmediateSnapshotIfReady(tab);
        void coordinateActiveBookmarkedPage(tab);
      }
      const job = await getStoredSnapshotBackfill();
      if (
        ["running", "waiting_focus"].includes(job.state) &&
        snapshotBackfillWorkerForTab(job, tabId)
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
    const worker = snapshotBackfillWorkerForTab(job, tabId);
    if (
      !worker ||
      !["running", "waiting_focus", "paused"].includes(job.state)
    ) {
      return;
    }
    const previousLease = snapshotBackfillLeaseFromWorker(job.id, worker);
    await mutateStoredSnapshotBackfill(async (current) => {
      const currentWorker = snapshotBackfillWorkerForTab(current, tabId);
      if (current.id !== job.id || !currentWorker) return;
      currentWorker.currentLease = undefined;
      currentWorker.tabId = undefined;
      currentWorker.windowId = undefined;
      current.updatedAt = now();
      if (current.state === "paused") return;
    });
    if (previousLease) await clearSnapshotBackfillTimeout(previousLease);
    if (job.state === "running") void driveSnapshotBackfill();
  })().catch(() => undefined);
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  void chrome.tabs
    .query({ active: true, windowId })
    .then(async ([tab]) => {
      void refreshContextMenu(tab);
      if (tab?.status === "complete") {
        void scheduleImmediateSnapshotIfReady(tab);
        void coordinateActiveBookmarkedPage(tab);
      }
      const job = await getStoredSnapshotBackfill();
      if (
        ["running", "waiting_focus"].includes(job.state) &&
        typeof tab?.id === "number" &&
        snapshotBackfillWorkerForTab(job, tab.id)
      ) {
        void driveSnapshotBackfill();
      }
    })
    .catch(() => undefined);
});

}

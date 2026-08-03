import type {
  SnapshotEnhancementProgress
} from "../../lib/bookmark-enhancement";
import {
  createPageSnapshot,
  detectBotChallengeInDocument,
  prepareBackgroundPageForCaptureInDocument,
  isLoadedSnapshotTab,
  isSnapshotSensitiveUrl,
  showSnapshotUpdatedToastInDocument,
  waitForStablePageInDocument
} from "../../lib/page-snapshot";
import type { SnapshotBackfillLease } from "../../lib/snapshot-backfill";
import {
  deletePageSnapshot,
  getLocalResource
} from "../../lib/storage";
import { putCoverSnapshot } from "../../lib/visuals";
import type { PageSnapshot, ResourceRecord } from "../../lib/types";
import { canonicalizeUrl, resourceKeyForUrl } from "../../lib/url";
import type { ImmediatePageSnapshotTarget } from "./target-store";

const AARRE_OPEN_PAGE_SNAPSHOT_DELAY_MS = 1_500;
const SNAPSHOT_BACKFILL_STABILITY_TIMEOUT_MS = 20_000;
const SNAPSHOT_BACKFILL_PREPARE_TIMEOUT_MS = 8_000;
const SNAPSHOT_BACKFILL_CHALLENGE_TIMEOUT_MS = 3_000;

export interface PageSnapshotScheduleOptions {
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

interface SnapshotProtectionContext {
  pageSnapshotsEnabled: boolean;
  excludedHosts: string[];
}

interface SnapshotCaptureDependencies<
  TProtectionContext extends SnapshotProtectionContext
> {
  getPrivacyProtectionContext(): Promise<TProtectionContext>;
  resourceProtectionState(
    resource: Pick<
      ResourceRecord,
      "resourceKey" | "nativeBookmarkIds" | "url"
    >,
    context: TProtectionContext,
    loadedUrl?: string
  ): { protected: boolean; userProtected: boolean };
  upsertLocalResource(resource: ResourceRecord): Promise<void>;
  updateStoredSnapshotProgress(
    resourceKey: string,
    progress: Omit<SnapshotEnhancementProgress, "updatedAt">
  ): Promise<void>;
  deferStoredEnhancementJob(
    resourceKey: string,
    message: string
  ): Promise<void>;
  completeStoredEnhancementPart(
    resourceKey: string,
    part: "snapshot"
  ): Promise<void>;
  snapshotBackfillAllowsCapture(
    lease: SnapshotBackfillLease
  ): Promise<boolean>;
  settleBatchChallenge(lease: SnapshotBackfillLease): Promise<void>;
  commitSnapshotBackfillCapture(input: {
    lease: SnapshotBackfillLease;
    canonicalUrl: string;
    snapshot: PageSnapshot;
    capturedAt: string;
  }): Promise<{ accepted: boolean }>;
  errorMessage(error: unknown): string;
}

export interface SnapshotCapture {
  clearPageSnapshotTimer(tabId: number): void;
  capturePageSnapshotForTab(
    tabId: number,
    expectedLoadedUrl: string,
    snapshotUrl?: string,
    options?: Omit<PageSnapshotScheduleOptions, "delayMs" | "onSettled">
  ): Promise<boolean>;
  schedulePageSnapshotForTab(
    tab: chrome.tabs.Tab,
    options?: PageSnapshotScheduleOptions
  ): boolean;
}

export function createSnapshotCapture<
  TProtectionContext extends SnapshotProtectionContext
>(
  dependencies: SnapshotCaptureDependencies<TProtectionContext>
): SnapshotCapture {
  const pageSnapshotTimers = new Map<number, number>();

  function clearPageSnapshotTimer(tabId: number): void {
    const timer = pageSnapshotTimers.get(tabId);
    if (timer !== undefined) globalThis.clearTimeout(timer);
    pageSnapshotTimers.delete(tabId);
  }

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
        ...(injection.args ? { args: injection.args as never[] } : {})
      }),
      new Promise<undefined>((resolve) => {
        globalThis.setTimeout(() => resolve(undefined), timeoutMs);
      })
    ]);
  }

  async function capturePageSnapshotViaDebugger(tabId: number): Promise<string> {
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
    options: Omit<PageSnapshotScheduleOptions, "delayMs" | "onSettled"> = {}
  ): Promise<boolean> {
    const isBatch = options.trigger === "batch_backfill";
    const isManualRefresh = options.trigger === "manual_refresh";
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (
      !tab ||
      typeof tab.windowId !== "number" ||
      !isLoadedSnapshotTab(tab, expectedLoadedUrl, !isBatch)
    ) {
      return false;
    }
    const fallbackCanonicalUrl = canonicalizeUrl(snapshotUrl);
    const resourceKey =
      options.resourceKey || (await resourceKeyForUrl(fallbackCanonicalUrl));
    const resource = await getLocalResource(resourceKey);
    if (!resource?.nativeBookmarkIds.length) return false;
    const context = await dependencies.getPrivacyProtectionContext();
    if (
      !context.pageSnapshotsEnabled ||
      dependencies.resourceProtectionState(resource, context, tab.url!).protected ||
      isSnapshotSensitiveUrl(snapshotUrl, context.excludedHosts)
    ) {
      return false;
    }
    if (
      isBatch &&
      (!options.backfillLease ||
        !(await dependencies.snapshotBackfillAllowsCapture(
          options.backfillLease
        )))
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
      if (active?.id !== tab.id || !isLoadedSnapshotTab(active, expectedLoadedUrl)) {
        return false;
      }
    }

    await dependencies.updateStoredSnapshotProgress(resourceKey, {
      state: isManualRefresh ? "capturing" : "stabilizing",
      trigger: options.trigger || "recovery",
      tabId,
      ...(options.documentId ? { documentId: options.documentId } : {}),
      loadedUrl: tab.url!,
      ...(options.showToast ? { showToast: true } : {}),
      ...(options.refreshExisting ? { refreshExisting: true } : {})
    });
    if (isBatch && options.backfillLease) {
      const [challengeResult] =
        (await executeScriptWithTimeout(
          { target: { tabId }, func: detectBotChallengeInDocument },
          SNAPSHOT_BACKFILL_CHALLENGE_TIMEOUT_MS
        )) || [];
      if (challengeResult?.result === true) {
        await dependencies.settleBatchChallenge(options.backfillLease);
        return false;
      }
      const [prepared] =
        (await executeScriptWithTimeout(
          { target: { tabId }, func: prepareBackgroundPageForCaptureInDocument },
          SNAPSHOT_BACKFILL_PREPARE_TIMEOUT_MS
        )) || [];
      if (!prepared?.result) return false;
    }
    let captureDocumentId = options.documentId;
    if (!isManualRefresh) {
      const [stabilityResult] =
        (await executeScriptWithTimeout(
          {
            target: { tabId },
            func: waitForStablePageInDocument,
            args: isBatch
              ? [
                  600,
                  4_000,
                  {
                    fontTimeoutMs: 1_500,
                    imageTimeoutMs: 2_500,
                    rAFTimeoutMs: 1_000,
                    waitForPendingImages: true,
                    resourceQuietMs: 600,
                    resourceQuietMaxMs: 6_000
                  }
                ]
              : [900, 4_000]
          },
          SNAPSHOT_BACKFILL_STABILITY_TIMEOUT_MS
        )) || [];
      if (
        stabilityResult?.result !== true ||
        (options.documentId && stabilityResult.documentId !== options.documentId)
      ) {
        return false;
      }
      captureDocumentId = stabilityResult.documentId;
    }

    if (isBatch && options.backfillLease) {
      const [challengeResult] =
        (await executeScriptWithTimeout(
          { target: { tabId }, func: detectBotChallengeInDocument },
          SNAPSHOT_BACKFILL_CHALLENGE_TIMEOUT_MS
        )) || [];
      if (challengeResult?.result === true) {
        await dependencies.settleBatchChallenge(options.backfillLease);
        return false;
      }
    }

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
        { target: { tabId }, func: () => globalThis.location.href },
        SNAPSHOT_BACKFILL_STABILITY_TIMEOUT_MS
      )) || [];
    if (
      !documentCheck?.result ||
      documentCheck.result !== stableTab.url ||
      (captureDocumentId && documentCheck.documentId !== captureDocumentId)
    ) {
      return false;
    }
    captureDocumentId = documentCheck.documentId;
    const resourceBeforeCapture = await getLocalResource(resourceKey);
    if (!resourceBeforeCapture?.nativeBookmarkIds.length) return false;
    if (
      dependencies.resourceProtectionState(
        resourceBeforeCapture,
        await dependencies.getPrivacyProtectionContext(),
        stableTab.url!
      ).protected
    ) {
      return false;
    }
    if (
      isBatch &&
      (!options.backfillLease ||
        !(await dependencies.snapshotBackfillAllowsCapture(
          options.backfillLease
        )))
    ) {
      return false;
    }

    await dependencies.updateStoredSnapshotProgress(resourceKey, {
      state: "capturing",
      trigger: options.trigger || "recovery",
      tabId,
      ...(captureDocumentId ? { documentId: captureDocumentId } : {}),
      loadedUrl: stableTab.url!,
      ...(options.showToast ? { showToast: true } : {}),
      ...(options.refreshExisting ? { refreshExisting: true } : {})
    });
    const pngDataUrl = isBatch
      ? await capturePageSnapshotViaDebugger(tabId)
      : await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
    const capturedTab = await chrome.tabs.get(tabId).catch(() => null);
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
    const [capturedDocument] =
      (await executeScriptWithTimeout(
        { target: { tabId }, func: () => globalThis.location.href },
        SNAPSHOT_BACKFILL_STABILITY_TIMEOUT_MS
      )) || [];
    if (
      !capturedTab ||
      !isLoadedSnapshotTab(capturedTab, expectedLoadedUrl, !isBatch) ||
      capturedDocument?.result !== capturedTab.url ||
      capturedDocument.documentId !== captureDocumentId
    ) {
      return false;
    }
    const capturedAt = new Date().toISOString();
    const snapshot = await createPageSnapshot(
      canonicalUrl,
      pngDataUrl,
      capturedAt
    );
    if (isBatch) {
      if (!options.backfillLease) return false;
      const committed = await dependencies.commitSnapshotBackfillCapture({
        lease: options.backfillLease,
        canonicalUrl,
        snapshot,
        capturedAt
      });
      return committed.accepted;
    }

    const resourceImmediatelyBeforeStore = await getLocalResource(resourceKey);
    if (!resourceImmediatelyBeforeStore?.nativeBookmarkIds.length) return false;
    if (
      dependencies.resourceProtectionState(
        resourceImmediatelyBeforeStore,
        await dependencies.getPrivacyProtectionContext(),
        capturedTab.url!
      ).protected
    ) {
      return false;
    }
    const visualStored = await putCoverSnapshot(
      resourceImmediatelyBeforeStore,
      snapshot,
      isManualRefresh ? "user" : "auto",
      { source: isManualRefresh ? "manual-screenshot" : "screenshot" }
    );
    if (!visualStored) {
      await dependencies.completeStoredEnhancementPart(
        options.resourceKey || resourceKey,
        "snapshot"
      );
      return true;
    }
    const latestResource = await getLocalResource(resourceKey);
    if (!latestResource?.nativeBookmarkIds.length) {
      await deletePageSnapshot(canonicalUrl);
      return false;
    }
    await dependencies.upsertLocalResource({
      ...latestResource,
      snapshotAt: capturedAt,
      coverOrigin: isManualRefresh ? "user" : latestResource.coverOrigin || "auto",
      coverUpdatedAt: capturedAt,
      updatedAt: latestResource.updatedAt
    });
    void chrome.runtime
      .sendMessage({
        type: "PAGE_SNAPSHOT_UPDATED",
        canonicalUrl,
        capturedAt
      })
      .catch(() => undefined);
    await dependencies.completeStoredEnhancementPart(
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
        options
      )
        .catch(async (error) => {
          if (options.resourceKey) {
            await dependencies.updateStoredSnapshotProgress(
              options.resourceKey,
              {
                state: "retry",
                trigger: options.trigger || "recovery",
                tabId,
                loadedUrl: expectedLoadedUrl,
                ...(options.documentId
                  ? { documentId: options.documentId }
                  : {}),
                ...(options.showToast ? { showToast: true } : {}),
                ...(options.refreshExisting ? { refreshExisting: true } : {}),
                lastError: dependencies.errorMessage(error)
              }
            ).catch(() => undefined);
            await dependencies.deferStoredEnhancementJob(
              options.resourceKey,
              dependencies.errorMessage(error)
            ).catch(() => undefined);
          }
          return false;
        })
        .then(async (succeeded) => {
          if (!succeeded && options.resourceKey) {
            await dependencies.updateStoredSnapshotProgress(
              options.resourceKey,
              {
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
              }
            ).catch(() => undefined);
          }
          options.onSettled?.(succeeded);
        });
    }, options.delayMs ?? AARRE_OPEN_PAGE_SNAPSHOT_DELAY_MS) as unknown as number;
    pageSnapshotTimers.set(tab.id, timer);
    return true;
  }

  return {
    clearPageSnapshotTimer,
    capturePageSnapshotForTab,
    schedulePageSnapshotForTab
  };
}

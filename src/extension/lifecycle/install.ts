import { hardenCloudTokenStorage } from "../../lib/auth";
import {
  ensureVisualCleanupAlarm,
  ensurePeriodicSyncAlarm,
  scheduleLibraryScan,
  scheduleVisualMigration
} from "./alarms";
import type { ImportResult } from "../../lib/types";

type DeferredAction = (...args: any[]) => any;

export function runBackgroundStartupMaintenance(): void {
  void hardenCloudTokenStorage().catch(() => undefined);
  void chrome.storage.local.set({
    "aarre:sw-heartbeat": {
      version: chrome.runtime.getManifest().version,
      time: new Date().toISOString(),
      mode: "top-level"
    }
  }).catch(() => undefined);
}

interface InstallDependencies {
  ensurePinnedSiteBrandIcons: DeferredAction;
  configureActionSidePanelBehavior: DeferredAction;
  registerContextMenus: DeferredAction;
  refreshContextMenu: DeferredAction;
  importNativeBookmarks(): Promise<ImportResult>;
  queueIndexedResourcesUntilVisit: DeferredAction;
  activeTab(): Promise<chrome.tabs.Tab | null>;
  coordinateActiveBookmarkedPage: DeferredAction;
  requestSync(reason: string, debounceMs?: number): void;
  processBookmarkEnhancements: DeferredAction;
  syncOrganizationBadge: DeferredAction;
  getStoredLibraryScan: DeferredAction;
  runLibraryScan: DeferredAction;
  recoverSnapshotBackfill: DeferredAction;
}

export function registerInstallLifecycle(dependencies: InstallDependencies): void {
  const {
    ensurePinnedSiteBrandIcons,
    configureActionSidePanelBehavior,
    registerContextMenus,
    refreshContextMenu,
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
  } = dependencies;

  chrome.runtime.onInstalled.addListener(() => {
    void ensurePinnedSiteBrandIcons().catch(() => undefined);
    void chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
    void configureActionSidePanelBehavior();
    void ensurePeriodicSyncAlarm();
    void ensureVisualCleanupAlarm();
    void scheduleVisualMigration();
    void registerContextMenus();
    void importNativeBookmarks()
      .then(async () => {
        await queueIndexedResourcesUntilVisit();
        const current = await activeTab();
        if (current?.status === "complete") {
          await coordinateActiveBookmarkedPage(current, undefined, "normal_browse");
        }
        requestSync("extension-installed", 3_000);
      })
      .catch(() => undefined);
    void processBookmarkEnhancements();
    void syncOrganizationBadge();
    void getStoredLibraryScan().then((scan: { state: string }) => {
      if (scan.state === "running") {
        void scheduleLibraryScan();
        void runLibraryScan();
      }
    });
    void recoverSnapshotBackfill();
    void chrome.omnibox.setDefaultSuggestion({
      description: "搜索 Chrome 书签、历史记录和标签页，或使用默认搜索引擎"
    });
  });

  chrome.runtime.onStartup.addListener(() => {
    void (async () => {
      await importNativeBookmarks();
      await registerContextMenus();
      const current = await activeTab();
      if (current?.status === "complete") {
        await coordinateActiveBookmarkedPage(current, undefined, "normal_browse");
      }
      await syncOrganizationBadge();
      await refreshContextMenu();
      requestSync("browser-startup");
      await scheduleVisualMigration();
      await ensureVisualCleanupAlarm();
      const scan = await getStoredLibraryScan();
      if (scan.state === "running") {
        await scheduleLibraryScan();
        void runLibraryScan();
      }
      await recoverSnapshotBackfill();
      void processBookmarkEnhancements();
    })().catch(() => undefined);
  });
}

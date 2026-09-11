import { useCallback, useEffect, useRef, useState } from "react";
import { needsAiEnrichment } from "../../../lib/ai-fields";
import { buildBookmarkBarSnapshot } from "../../../lib/bookmark-tree";
import { sendExtensionRequest } from "../../../lib/messages";
import type {
  AppState,
  BookmarkBarSnapshot,
  ResourceRecord,
  SiteBrandRecord,
} from "../../../lib/types";
import {
  readActiveTabSummary,
  subscribeToActiveTabChanges
} from "../active-tab-events";

async function readNativeBookmarkSnapshot(): Promise<BookmarkBarSnapshot> {
  const bookmarks = typeof chrome !== "undefined" ? chrome.bookmarks : undefined;
  if (bookmarks && typeof bookmarks.getTree === "function") {
    return buildBookmarkBarSnapshot(await bookmarks.getTree());
  }
  return sendExtensionRequest({ type: "GET_BOOKMARK_BAR" });
}

export function useAppState(
  setError: (value: string) => void,
  applyDisplaySettings: (settings: {
    listCoverStyle: "site" | "page";
    pageSnapshotsEnabled: boolean;
    publicFaviconFallback: boolean;
  }) => void,
) {
  const [snapshot, setSnapshot] = useState<BookmarkBarSnapshot | null>(null);
  const [appState, setAppState] = useState<AppState | null>(null);
  const [resources, setResources] = useState<ResourceRecord[]>([]);
  const [siteBrands, setSiteBrands] = useState<SiteBrandRecord[]>([]);
  const [aiConfigured, setAiConfigured] = useState(false);
  const activeTabRefreshRevision = useRef(0);

  const refreshActiveTab = useCallback(async () => {
    const revision = ++activeTabRefreshRevision.current;
    const activeTab = await readActiveTabSummary();
    if (revision !== activeTabRefreshRevision.current) return;
    setAppState((current) =>
      current ? { ...current, activeTab } : current
    );
  }, []);

  const refresh = useCallback(async () => {
    const activeTabRevisionAtStart = activeTabRefreshRevision.current;
    const nextSnapshot = await readNativeBookmarkSnapshot();
    setSnapshot(nextSnapshot);
    void sendExtensionRequest({ type: "GET_LOCAL_RESOURCES" })
      .then(setResources)
      .catch((caught) => setError(caught instanceof Error ? caught.message : "本地索引读取失败"));
    const [nextState, nextSiteBrands, nextAiSettings] = await Promise.all([
      sendExtensionRequest({ type: "GET_APP_STATE" }),
      sendExtensionRequest({ type: "GET_SITE_BRANDS" }),
      sendExtensionRequest({ type: "GET_AI_SETTINGS" }),
    ]);
    setAppState((current) =>
      current && activeTabRefreshRevision.current !== activeTabRevisionAtStart
        ? { ...nextState, activeTab: current.activeTab }
        : nextState
    );
    setSiteBrands(nextSiteBrands);
    setAiConfigured(nextAiSettings.apiKeyConfigured);
  }, [setError]);

  useEffect(() => {
    let cancelled = false;
    void readNativeBookmarkSnapshot()
      .then((nextSnapshot) => {
        if (cancelled) return;
        setSnapshot(nextSnapshot);
      })
      .catch((caught) => {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : "书签读取失败");
        }
      });

    void sendExtensionRequest({ type: "GET_BOOTSTRAP" })
      .then((bootstrap) => {
        if (cancelled) return;
        setAppState(bootstrap.appState);
        setAiConfigured(bootstrap.aiSettings.apiKeyConfigured);
        applyDisplaySettings(bootstrap.displaySettings);
        void refreshActiveTab().catch(() => undefined);
      })
      .catch((caught) => {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : "应用状态读取失败");
        }
      });

    const deferredTimer = window.setTimeout(() => {
      void refresh().catch((caught) => {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : "书签索引读取失败");
        }
      });
    }, 1_000);
    const handleChange = () => {
      void refresh().catch((caught) => {
        setError(caught instanceof Error ? caught.message : "书签刷新失败");
      });
    };
    const bookmarks = typeof chrome !== "undefined" ? chrome.bookmarks : undefined;
    bookmarks?.onCreated.addListener(handleChange);
    bookmarks?.onChanged.addListener(handleChange);
    bookmarks?.onMoved.addListener(handleChange);
    bookmarks?.onRemoved.addListener(handleChange);
    bookmarks?.onChildrenReordered.addListener(handleChange);
    return () => {
      cancelled = true;
      window.clearTimeout(deferredTimer);
      bookmarks?.onCreated.removeListener(handleChange);
      bookmarks?.onChanged.removeListener(handleChange);
      bookmarks?.onMoved.removeListener(handleChange);
      bookmarks?.onRemoved.removeListener(handleChange);
      bookmarks?.onChildrenReordered.removeListener(handleChange);
    };
  }, [applyDisplaySettings, refresh, refreshActiveTab, setError]);

  useEffect(
    () =>
      subscribeToActiveTabChanges(() =>
        refreshActiveTab().catch(() => undefined)
      ),
    [refreshActiveTab]
  );

  useEffect(() => {
    const eventSource = typeof chrome !== "undefined" ? chrome.runtime?.onMessage : undefined;
    const handleScanUpdate = (message: { type?: string; status?: AppState["libraryScan"] }) => {
      if (message.type !== "LIBRARY_SCAN_UPDATED" || !message.status) return;
      void sendExtensionRequest({ type: "GET_LOCAL_RESOURCES" })
        .then(async (nextResources) => {
          const nextSiteBrands = await sendExtensionRequest({ type: "GET_SITE_BRANDS" });
          const safeResources = Array.isArray(nextResources) ? nextResources : [];
          setResources(safeResources);
          setSiteBrands(nextSiteBrands);
          setAppState((current) => current ? {
            ...current,
            libraryScan: message.status!,
            aiReadyResourceCount: safeResources.filter((resource) => !needsAiEnrichment(resource)).length,
          } : current);
        })
        .catch(() => undefined);
    };
    const handleSiteBrandsUpdate = (message: { type?: string }) => {
      if (message.type !== "SITE_BRANDS_UPDATED") return;
      void sendExtensionRequest({ type: "GET_SITE_BRANDS" })
        .then((nextSiteBrands) => {
          if (Array.isArray(nextSiteBrands)) setSiteBrands(nextSiteBrands);
        })
        .catch(() => undefined);
    };
    eventSource?.addListener(handleScanUpdate);
    eventSource?.addListener(handleSiteBrandsUpdate);
    return () => {
      eventSource?.removeListener(handleScanUpdate);
      eventSource?.removeListener(handleSiteBrandsUpdate);
    };
  }, []);

  return {
    snapshot, appState, setAppState, resources, siteBrands,
    aiConfigured, setAiConfigured,
    refresh,
  };
}

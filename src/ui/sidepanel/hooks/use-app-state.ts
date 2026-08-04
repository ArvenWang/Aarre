import { useCallback, useEffect, useState } from "react";
import { needsAiEnrichment } from "../../../lib/ai-fields";
import { buildBookmarkBarSnapshot } from "../../../lib/bookmark-tree";
import { sendExtensionRequest } from "../../../lib/messages";
import type {
  AppState,
  BookmarkBarSnapshot,
  OrganizationNotice,
  ResourceRecord,
  ResurfacingItem,
  SiteBrandRecord,
} from "../../../lib/types";

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
  const [contextResurfacing, setContextResurfacing] = useState<ResurfacingItem[]>([]);
  const [organizationNotice, setOrganizationNotice] = useState<OrganizationNotice | null>(null);
  const [aiConfigured, setAiConfigured] = useState(false);

  const refresh = useCallback(async () => {
    const nextSnapshot = await readNativeBookmarkSnapshot();
    setSnapshot(nextSnapshot);
    void sendExtensionRequest({ type: "GET_LOCAL_RESOURCES" })
      .then(setResources)
      .catch((caught) => setError(caught instanceof Error ? caught.message : "本地索引读取失败"));
    const [nextState, nextSiteBrands, nextAiSettings, nextResurfacing, nextNotice] = await Promise.all([
      sendExtensionRequest({ type: "GET_APP_STATE" }),
      sendExtensionRequest({ type: "GET_SITE_BRANDS" }),
      sendExtensionRequest({ type: "GET_AI_SETTINGS" }),
      sendExtensionRequest({ type: "GET_CONTEXT_RESURFACING" }).catch(() => []),
      sendExtensionRequest({ type: "GET_ORGANIZATION_NOTICE" }).catch(() => null),
    ]);
    setAppState(nextState);
    setSiteBrands(nextSiteBrands);
    setAiConfigured(nextAiSettings.apiKeyConfigured);
    setContextResurfacing(nextResurfacing);
    setOrganizationNotice(nextNotice);
  }, [setError]);

  const loadOrganizationNotice = useCallback(async () => {
    setOrganizationNotice(await sendExtensionRequest({ type: "GET_ORGANIZATION_NOTICE" }));
  }, []);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      readNativeBookmarkSnapshot(),
      sendExtensionRequest({ type: "GET_BOOTSTRAP" }),
    ])
      .then(([nextSnapshot, bootstrap]) => {
        if (cancelled) return;
        setSnapshot(nextSnapshot);
        setAppState(bootstrap.appState);
        setAiConfigured(bootstrap.aiSettings.apiKeyConfigured);
        applyDisplaySettings(bootstrap.displaySettings);
      })
      .catch((caught) => {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : "书签读取失败");
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
  }, [applyDisplaySettings, refresh, setError]);

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
    const handleOrganizationUpdate = (message: { type?: string }) => {
      if (message.type === "ORGANIZATION_INSIGHTS_UPDATED") {
        void loadOrganizationNotice().catch(() => undefined);
      }
    };
    eventSource?.addListener(handleScanUpdate);
    eventSource?.addListener(handleOrganizationUpdate);
    return () => {
      eventSource?.removeListener(handleScanUpdate);
      eventSource?.removeListener(handleOrganizationUpdate);
    };
  }, [loadOrganizationNotice]);

  return {
    snapshot, appState, setAppState, resources, siteBrands, contextResurfacing,
    organizationNotice, setOrganizationNotice, aiConfigured, setAiConfigured,
    refresh,
  };
}

import type { ActiveTabSummary } from "../../lib/types";
import { isSupportedPageUrl } from "../../lib/url";

type RefreshActiveTab = () => void | Promise<void>;

interface ActiveTabEventApi {
  tabs: Pick<typeof chrome.tabs, "onActivated" | "onUpdated">;
  windows: Pick<typeof chrome.windows, "onFocusChanged" | "WINDOW_ID_NONE">;
}

export async function readActiveTabSummary(): Promise<ActiveTabSummary | null> {
  const [tab] = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true
  });
  if (!tab) return null;
  const url = tab.url || "";
  return {
    id: tab.id,
    url,
    title: tab.title || "",
    faviconUrl: tab.favIconUrl || "",
    supported: isSupportedPageUrl(url)
  };
}

export function subscribeToActiveTabChanges(
  refresh: RefreshActiveTab,
  api: ActiveTabEventApi = { tabs: chrome.tabs, windows: chrome.windows }
): () => void {
  const onActivated = () => {
    void refresh();
  };
  const onUpdated = (
    _tabId: number,
    changeInfo: chrome.tabs.OnUpdatedInfo,
    tab: chrome.tabs.Tab
  ) => {
    if (!tab.active) return;
    if (changeInfo.url === undefined && changeInfo.status === undefined) return;
    void refresh();
  };
  const onFocusChanged = (windowId: number) => {
    if (windowId === api.windows.WINDOW_ID_NONE) return;
    void refresh();
  };

  api.tabs.onActivated.addListener(onActivated);
  api.tabs.onUpdated.addListener(onUpdated);
  api.windows.onFocusChanged.addListener(onFocusChanged);
  return () => {
    api.tabs.onActivated.removeListener(onActivated);
    api.tabs.onUpdated.removeListener(onUpdated);
    api.windows.onFocusChanged.removeListener(onFocusChanged);
  };
}

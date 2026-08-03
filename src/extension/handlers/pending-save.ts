import { createPendingSaveDraft } from "../../lib/pending-save";
import { CONTEXT_MENU_LINK_ID, pendingSaveKey } from "../lifecycle/context-menu-core";
import type { PendingSaveDraft } from "../../lib/types";

interface PendingSaveDependencies {
  activeTab(): Promise<chrome.tabs.Tab | null>;
  syncOrganizationBadge(tabId?: number): Promise<void>;
}

export function createPendingSaveHandlers(dependencies: PendingSaveDependencies) {
  const { activeTab, syncOrganizationBadge } = dependencies;
  const pendingSaveDrafts = new Map<number, PendingSaveDraft>();
  const now = () => new Date().toISOString();
function flashActionBadge(
  tabId: number | undefined,
  text: string,
  color: string,
  title: string,
  durationMs = 2_000
) {
  void chrome.action.setBadgeBackgroundColor({ color, tabId });
  void chrome.action.setBadgeText({ text, tabId });
  void chrome.action.setTitle({ title, tabId });
  setTimeout(() => {
    void syncOrganizationBadge(tabId);
  }, durationMs);
}

function buildPendingSaveDraft(
  info: chrome.contextMenus.OnClickData,
  tab?: chrome.tabs.Tab
): PendingSaveDraft {
  if (typeof tab?.id !== "number") {
    throw new Error("无法确认当前 Chrome 标签页。");
  }
  const linkSave = info.menuItemId === CONTEXT_MENU_LINK_ID;
  const targetUrl = linkSave
    ? info.linkUrl
    : info.pageUrl || tab?.url;

  if (!targetUrl) {
    throw new Error("没有找到可以收藏的页面地址。");
  }

  return createPendingSaveDraft({
    kind: linkSave ? "link" : "page",
    tabId: tab.id,
    url: targetUrl,
    tabTitle: tab.title,
    faviconUrl: linkSave ? "" : tab.favIconUrl || "",
    selectedText: info.selectionText || "",
    createdAt: now()
  });
}

async function consumePendingSaveDraft(
  requestedTabId?: number
): Promise<PendingSaveDraft | null> {
  const tabId =
    requestedTabId ?? (await activeTab())?.id;
  if (typeof tabId !== "number") {
    return null;
  }

  const memoryDraft = pendingSaveDrafts.get(tabId);
  const key = pendingSaveKey(tabId);
  const stored = memoryDraft
    ? null
    : (await chrome.storage.session.get(key))[key];
  const draft =
    memoryDraft ||
    (stored && typeof stored === "object"
      ? (stored as PendingSaveDraft)
      : null);

  pendingSaveDrafts.delete(tabId);
  await chrome.storage.session.remove(key);
  return draft;
}
  function rememberPendingSaveDraft(draft: PendingSaveDraft): void {
    pendingSaveDrafts.set(draft.tabId, draft);
  }
  return {
    flashActionBadge,
    buildPendingSaveDraft,
    consumePendingSaveDraft,
    rememberPendingSaveDraft
  };
}

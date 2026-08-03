import { buildBookmarkBarSnapshot, serializeBookmarkNode } from "../../lib/bookmark-tree";
import { buildBookmarkSaveState } from "../../lib/bookmark-save-state";
import { buildSelectableFolderOptions } from "../../lib/folder-options";
import { matchesNavigationText } from "../../lib/navigation";
import { isSupportedPageUrl } from "../../lib/url";
import type {
  ActiveTabSummary,
  BookmarkBarSnapshot,
  BookmarkSaveState,
  NativeFolderOption,
  NavigationSuggestion
} from "../../lib/types";

function hostFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "") || url;
  } catch {
    return url;
  }
}

export async function activeTab(): Promise<chrome.tabs.Tab | null> {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tabs[0] || null;
}

function isManagerPageUrl(url: string | undefined): boolean {
  if (!url) return false;
  const managerUrl = chrome.runtime.getURL("manager.html");
  return url === managerUrl || url.startsWith(`${managerUrl}?`) || url.startsWith(`${managerUrl}#`);
}

export async function openManagerPage(
  relativeUrl: string,
  sourceWindowId?: number
): Promise<{ opened: true; reused: boolean }> {
  const targetUrl = chrome.runtime.getURL(relativeUrl);
  const existing = (await chrome.tabs.query({})).find((tab) => isManagerPageUrl(tab.url));
  if (typeof existing?.id === "number") {
    if (typeof existing.windowId === "number") {
      await chrome.windows.update(existing.windowId, { focused: true });
    }
    const updated = await chrome.tabs.update(existing.id, {
      active: true,
      ...(existing.url === targetUrl ? {} : { url: targetUrl })
    });
    if (!updated) throw new Error("网页端标签页已经关闭，请重试。");
  } else {
    await chrome.tabs.create({
      url: targetUrl,
      active: true,
      ...(typeof sourceWindowId === "number" ? { windowId: sourceWindowId } : {})
    });
  }
  return { opened: true, reused: Boolean(existing) };
}

export async function messageWindowId(
  sender?: chrome.runtime.MessageSender
): Promise<number | undefined> {
  if (typeof sender?.tab?.windowId === "number") return sender.tab.windowId;
  return chrome.windows.getLastFocused().then((window) => window.id).catch(() => undefined);
}

export async function getActiveTabSummary(): Promise<ActiveTabSummary | null> {
  const tab = await activeTab();
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

export async function getFolderOptions(): Promise<NativeFolderOption[]> {
  return buildSelectableFolderOptions(await chrome.bookmarks.getTree());
}

export async function defaultFolderId(): Promise<string> {
  const tree = await chrome.bookmarks.getTree();
  const stack = [...tree];
  while (stack.length) {
    const node = stack.shift();
    if (!node) continue;
    if (node.folderType === "bookmarks-bar" && node.syncing === true) return node.id;
    stack.push(...(node.children || []));
  }
  for (const node of tree.flatMap((item) => item.children || [])) {
    if (node.folderType === "bookmarks-bar") return node.id;
  }
  const firstWritableFolder = (await getFolderOptions())[0];
  if (!firstWritableFolder) throw new Error("没有找到可写入的 Chrome 书签文件夹。");
  return firstWritableFolder.id;
}

export async function getBookmarkBarSnapshot(): Promise<BookmarkBarSnapshot> {
  return buildBookmarkBarSnapshot(await chrome.bookmarks.getTree());
}

export async function getBookmarkSaveState(url: string): Promise<BookmarkSaveState> {
  if (!isSupportedPageUrl(url)) throw new Error("当前地址不是可收藏的普通网页。");
  const tree = await chrome.bookmarks.getTree();
  return buildBookmarkSaveState(tree.map(serializeBookmarkNode), url);
}

export async function getNavigationSuggestions(rawQuery: string): Promise<NavigationSuggestion[]> {
  const query = rawQuery.trim();
  if (!query) return [];
  const [bookmarkNodes, historyItems, tabs] = await Promise.all([
    chrome.bookmarks.search(query),
    chrome.history.search({ text: query, startTime: 0, maxResults: 8 }),
    chrome.tabs.query({})
  ]);
  const results: NavigationSuggestion[] = [];
  const seenUrls = new Set<string>();
  for (const tab of tabs) {
    if (!tab.url || !matchesNavigationText(query, tab.title, tab.url) || seenUrls.has(tab.url)) continue;
    results.push({
      id: `tab:${tab.id ?? tab.url}`,
      kind: "tab",
      title: tab.title || tab.url,
      url: tab.url,
      subtitle: `已打开 · ${hostFromUrl(tab.url)}`,
      tabId: tab.id,
      windowId: tab.windowId
    });
    seenUrls.add(tab.url);
    if (results.length >= 4) break;
  }
  for (const node of bookmarkNodes) {
    if (!node.url || seenUrls.has(node.url)) continue;
    results.push({
      id: `bookmark:${node.id}`,
      kind: "bookmark",
      title: node.title || node.url,
      url: node.url,
      subtitle: `书签 · ${hostFromUrl(node.url)}`
    });
    seenUrls.add(node.url);
    if (results.filter((item) => item.kind === "bookmark").length >= 6) break;
  }
  for (const item of historyItems) {
    if (!item.url || seenUrls.has(item.url)) continue;
    results.push({
      id: `history:${item.id || item.url}`,
      kind: "history",
      title: item.title || item.url,
      url: item.url,
      subtitle: `历史记录 · ${hostFromUrl(item.url)}`
    });
    seenUrls.add(item.url);
    if (results.length >= 14) break;
  }
  return results.slice(0, 14);
}

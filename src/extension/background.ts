import { getAuthState } from "../lib/auth";
import {
  processOutbox,
  pullCloudResources,
  semanticSearch,
  syncOneResource
} from "../lib/cloud";
import type {
  ExtensionRequest,
  ExtensionResponse
} from "../lib/messages";
import { searchLocalResources } from "../lib/search";
import {
  enqueueOutbox,
  getLocalResource,
  getLocalResources,
  getOutbox,
  removeOutboxItem,
  upsertLocalResource
} from "../lib/storage";
import {
  matchesNavigationText,
  parseNavigationInput
} from "../lib/navigation";
import { createPendingSaveDraft } from "../lib/pending-save";
import type {
  ActiveTabSummary,
  AppState,
  BookmarkBarSnapshot,
  ImportResult,
  NativeBookmarkNode,
  NativeFolderOption,
  NavigationInput,
  NavigationSuggestion,
  PendingSaveDraft,
  PageCapture,
  ResourceRecord,
  RestoreResult,
  SaveBookmarkInput,
  SaveBookmarkResult
} from "../lib/types";
import {
  canonicalizeUrl,
  hashText,
  isSupportedPageUrl,
  resourceKeyForUrl
} from "../lib/url";

const CONTEXT_MENU_PAGE_ID = "bookmark-layer-save-page";
const CONTEXT_MENU_LINK_ID = "bookmark-layer-save-link";
const PENDING_SAVE_PREFIX = "pending-save:";
const internalBookmarkIds = new Set<string>();
const internalBookmarkTargets = new Set<string>();
const pendingSaveDrafts = new Map<number, PendingSaveDraft>();

function bookmarkTarget(parentId: string, url: string): string {
  return `${parentId}\n${url}`;
}

function releaseInternalBookmarkWrite(id: string, target: string) {
  setTimeout(() => {
    internalBookmarkIds.delete(id);
    internalBookmarkTargets.delete(target);
  }, 1_000);
}

function now(): string {
  return new Date().toISOString();
}

function hostFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "") || url;
  } catch {
    return url;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "发生未知错误。";
}

async function activeTab(): Promise<chrome.tabs.Tab | null> {
  const tabs = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true
  });
  return tabs[0] || null;
}

async function getActiveTabSummary(): Promise<ActiveTabSummary | null> {
  const tab = await activeTab();
  if (!tab) {
    return null;
  }

  const url = tab.url || "";
  return {
    id: tab.id,
    url,
    title: tab.title || "",
    faviconUrl: tab.favIconUrl || "",
    supported: isSupportedPageUrl(url)
  };
}

async function getFolderOptions(): Promise<NativeFolderOption[]> {
  const tree = await chrome.bookmarks.getTree();
  const options: NativeFolderOption[] = [];

  function visit(
    node: chrome.bookmarks.BookmarkTreeNode,
    parentPath: string[],
    depth: number
  ) {
    if (node.url) {
      return;
    }

    const isRoot = node.id === "0";
    const path = isRoot
      ? parentPath
      : [...parentPath, node.title || "未命名文件夹"];

    if (!isRoot && node.unmodifiable !== "managed") {
      options.push({
        id: node.id,
        name: node.title || "未命名文件夹",
        path,
        depth
      });
    }

    for (const child of node.children || []) {
      visit(child, path, isRoot ? depth : depth + 1);
    }
  }

  for (const root of tree) {
    visit(root, [], 0);
  }

  return options;
}

async function defaultFolderId(): Promise<string> {
  const tree = await chrome.bookmarks.getTree();
  const stack = [...tree];

  while (stack.length) {
    const node = stack.shift();
    if (!node) continue;
    if (node.folderType === "bookmarks-bar" && node.syncing === true) {
      return node.id;
    }
    stack.push(...(node.children || []));
  }

  for (const node of tree.flatMap((item) => item.children || [])) {
    if (node.folderType === "bookmarks-bar") {
      return node.id;
    }
  }

  const firstWritableFolder = (await getFolderOptions())[0];
  if (!firstWritableFolder) {
    throw new Error("没有找到可写入的 Chrome 书签文件夹。");
  }
  return firstWritableFolder.id;
}

function serializeBookmarkNode(
  node: chrome.bookmarks.BookmarkTreeNode
): NativeBookmarkNode {
  return {
    id: node.id,
    parentId: node.parentId,
    index: node.index,
    title: node.title || "未命名",
    url: node.url,
    dateAdded: node.dateAdded,
    dateLastUsed: node.dateLastUsed,
    folderType: node.folderType,
    syncing: node.syncing,
    unmodifiable: node.unmodifiable === "managed",
    children: node.children?.map(serializeBookmarkNode)
  };
}

function countBookmarkNodes(node: chrome.bookmarks.BookmarkTreeNode): {
  bookmarkCount: number;
  folderCount: number;
} {
  if (node.url) {
    return { bookmarkCount: 1, folderCount: 0 };
  }

  return (node.children || []).reduce(
    (total, child) => {
      const count = countBookmarkNodes(child);
      total.bookmarkCount += count.bookmarkCount;
      total.folderCount += count.folderCount + (child.url ? 0 : 1);
      return total;
    },
    { bookmarkCount: 0, folderCount: 0 }
  );
}

async function getBookmarkBarSnapshot(): Promise<BookmarkBarSnapshot> {
  const tree = await chrome.bookmarks.getTree();
  const root = tree[0];
  const topLevel = root?.children || [];
  const primary =
    topLevel.find(
      (node) =>
        node.folderType === "bookmarks-bar" && node.syncing === true
    ) ||
    topLevel.find((node) => node.folderType === "bookmarks-bar") ||
    topLevel.find((node) => !node.url && node.unmodifiable !== "managed");

  if (!primary) {
    throw new Error("没有找到当前 Chrome 配置文件的书签目录。");
  }

  const roots = topLevel
    .filter((node) => !node.url)
    .sort((left, right) => {
      if (left.id === primary.id) return -1;
      if (right.id === primary.id) return 1;
      if (left.syncing !== right.syncing) return left.syncing ? -1 : 1;
      return (left.index || 0) - (right.index || 0);
    });
  const counts = roots.reduce(
    (total, node) => {
      const count = countBookmarkNodes(node);
      total.bookmarkCount += count.bookmarkCount;
      total.folderCount += count.folderCount;
      return total;
    },
    { bookmarkCount: 0, folderCount: 0 }
  );

  return {
    root: serializeBookmarkNode(primary),
    roots: roots.map(serializeBookmarkNode),
    primaryRootId: primary.id,
    ...counts,
    syncing:
      typeof primary.syncing === "boolean"
        ? primary.syncing
        : null
  };
}

async function getNavigationSuggestions(
  rawQuery: string
): Promise<NavigationSuggestion[]> {
  const query = rawQuery.trim();
  if (!query) {
    return [];
  }

  const [bookmarkNodes, historyItems, tabs] = await Promise.all([
    chrome.bookmarks.search(query),
    chrome.history.search({
      text: query,
      startTime: 0,
      maxResults: 8
    }),
    chrome.tabs.query({})
  ]);

  const results: NavigationSuggestion[] = [];
  const seenUrls = new Set<string>();

  for (const tab of tabs) {
    if (
      !tab.url ||
      !matchesNavigationText(query, tab.title, tab.url) ||
      seenUrls.has(tab.url)
    ) {
      continue;
    }
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
    if (!node.url || seenUrls.has(node.url)) {
      continue;
    }
    results.push({
      id: `bookmark:${node.id}`,
      kind: "bookmark",
      title: node.title || node.url,
      url: node.url,
      subtitle: `书签 · ${hostFromUrl(node.url)}`
    });
    seenUrls.add(node.url);
    if (
      results.filter((item) => item.kind === "bookmark").length >= 6
    ) {
      break;
    }
  }

  for (const item of historyItems) {
    if (!item.url || seenUrls.has(item.url)) {
      continue;
    }
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

async function navigate(input: NavigationInput): Promise<{ opened: true }> {
  const disposition = input.disposition || "current";

  if (typeof input.tabId === "number") {
    if (typeof input.windowId === "number") {
      await chrome.windows.update(input.windowId, { focused: true });
    }
    await chrome.tabs.update(input.tabId, { active: true });
    return { opened: true };
  }

  const parsed = input.url
    ? ({ kind: "url", url: input.url } as const)
    : parseNavigationInput(input.text);

  if (parsed.kind === "url") {
    if (disposition === "new") {
      await chrome.tabs.create({ url: parsed.url });
    } else {
      const tab = await activeTab();
      if (tab?.id) {
        await chrome.tabs.update(tab.id, { url: parsed.url });
      } else {
        await chrome.tabs.create({ url: parsed.url });
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

async function updateNativeBookmark(input: {
  id: string;
  title: string;
  url?: string;
}): Promise<NativeBookmarkNode> {
  const title = input.title.trim();
  if (!title) {
    throw new Error("名称不能为空。");
  }
  const [current] = await chrome.bookmarks.get(input.id);
  if (!current || current.unmodifiable === "managed") {
    throw new Error("这个书签由 Chrome 或组织管理，无法修改。");
  }
  const updated = await chrome.bookmarks.update(input.id, {
    title,
    ...(current.url && input.url?.trim()
      ? { url: input.url.trim() }
      : {})
  });
  return serializeBookmarkNode(updated);
}

async function createNativeFolder(input: {
  parentId: string;
  title: string;
}): Promise<NativeBookmarkNode> {
  const title = input.title.trim();
  if (!title) {
    throw new Error("文件夹名称不能为空。");
  }
  const [parent] = await chrome.bookmarks.get(input.parentId);
  if (!parent || parent.url || parent.unmodifiable === "managed") {
    throw new Error("目标文件夹不可写入。");
  }
  return serializeBookmarkNode(
    await chrome.bookmarks.create({ parentId: input.parentId, title })
  );
}

async function moveNativeBookmark(input: {
  id: string;
  parentId: string;
  index?: number;
}): Promise<NativeBookmarkNode> {
  if (input.id === input.parentId) {
    throw new Error("不能把文件夹移动到自身。");
  }
  return serializeBookmarkNode(
    await chrome.bookmarks.move(input.id, {
      parentId: input.parentId,
      index: input.index
    })
  );
}

async function deleteNativeBookmark(input: {
  id: string;
  recursive: boolean;
}): Promise<{ deleted: true }> {
  const [node] = await chrome.bookmarks.get(input.id);
  if (!node || node.unmodifiable === "managed" || node.folderType) {
    throw new Error("这个项目由 Chrome 管理，无法删除。");
  }
  if (node.url) {
    await chrome.bookmarks.remove(input.id);
  } else if (input.recursive) {
    await chrome.bookmarks.removeTree(input.id);
  } else {
    await chrome.bookmarks.remove(input.id);
  }
  return { deleted: true };
}

async function folderPathForId(folderId: string): Promise<string[]> {
  const options = await getFolderOptions();
  return options.find((item) => item.id === folderId)?.path || [];
}

async function captureActivePage(): Promise<PageCapture> {
  const tab = await activeTab();
  if (!tab?.id || !tab.url || !isSupportedPageUrl(tab.url)) {
    throw new Error("当前页面受 Chrome 保护，无法读取网页内容。");
  }

  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["content-capture.js"]
  });

  const response = (await chrome.tabs.sendMessage(tab.id, {
    type: "BOOKMARK_LAYER_CAPTURE_PAGE"
  })) as
    | { ok: true; data: PageCapture }
    | { ok: false; error: string };

  if (!response?.ok) {
    throw new Error(response?.error || "无法读取当前网页。");
  }

  return {
    ...response.data,
    faviconUrl: response.data.faviconUrl || tab.favIconUrl || ""
  };
}

async function findOrCreateNativeBookmark(
  input: SaveBookmarkInput
): Promise<{ bookmark: chrome.bookmarks.BookmarkTreeNode; created: boolean }> {
  const folderId = input.folderId || (await defaultFolderId());
  const [folder] = await chrome.bookmarks.get(folderId);

  if (!folder || folder.url || folder.unmodifiable === "managed") {
    throw new Error("选择的书签文件夹不可写入。");
  }

  const sameUrl = await chrome.bookmarks.search({ url: input.capture.url });
  const existing = sameUrl.find((item) => item.parentId === folderId);

  if (existing) {
    if (existing.title !== input.title) {
      const target = bookmarkTarget(folderId, input.capture.url);
      internalBookmarkIds.add(existing.id);
      internalBookmarkTargets.add(target);
      let updated: chrome.bookmarks.BookmarkTreeNode;
      try {
        updated = await chrome.bookmarks.update(existing.id, {
          title: input.title
        });
      } catch (error) {
        internalBookmarkIds.delete(existing.id);
        internalBookmarkTargets.delete(target);
        throw error;
      }
      releaseInternalBookmarkWrite(existing.id, target);
      return {
        bookmark: updated,
        created: false
      };
    }
    return { bookmark: existing, created: false };
  }

  const target = bookmarkTarget(folderId, input.capture.url);
  internalBookmarkTargets.add(target);
  let created: chrome.bookmarks.BookmarkTreeNode;
  try {
    created = await chrome.bookmarks.create({
      parentId: folderId,
      title: input.title,
      url: input.capture.url
    });
  } catch (error) {
    internalBookmarkTargets.delete(target);
    throw error;
  }
  internalBookmarkIds.add(created.id);
  releaseInternalBookmarkWrite(created.id, target);
  return {
    bookmark: created,
    created: true
  };
}

async function tryImmediateSync(
  resource: ResourceRecord,
  content: string
): Promise<ResourceRecord> {
  const auth = await getAuthState();
  if (!auth.configured || !auth.signedIn || auth.accountMatches !== true) {
    return resource;
  }

  try {
    const synced = await syncOneResource(resource, content);
    await removeOutboxItem(resource.resourceKey);
    return synced;
  } catch {
    return (await getLocalResource(resource.resourceKey)) || resource;
  }
}

async function syncPendingIfReady(): Promise<void> {
  const auth = await getAuthState();
  if (
    auth.configured &&
    auth.signedIn &&
    auth.accountMatches === true
  ) {
    await drainOutbox();
  }
}

async function saveBookmark(
  input: SaveBookmarkInput
): Promise<SaveBookmarkResult> {
  const { bookmark, created } = await findOrCreateNativeBookmark(input);
  const canonicalUrl = canonicalizeUrl(
    input.capture.url,
    input.capture.canonicalUrl
  );
  const resourceKey = await resourceKeyForUrl(canonicalUrl);
  const contentHash = await hashText(input.capture.content);
  const existing = await getLocalResource(resourceKey);
  const timestamp = now();
  const contentChanged =
    Boolean(existing?.contentHash) && existing?.contentHash !== contentHash;

  const resource: ResourceRecord = {
    resourceKey,
    canonicalUrl,
    url: input.capture.url,
    title: input.title.trim() || input.capture.title,
    userNote: input.userNote.trim(),
    summary: existing?.summary || "",
    tags: existing?.tags || [],
    topics: existing?.topics || [],
    contentExcerpt: input.capture.excerpt,
    contentHash,
    selectedText: input.capture.selectedText,
    author: input.capture.author,
    siteName: input.capture.siteName,
    language: input.capture.language,
    imageUrl: input.capture.imageUrl,
    faviconUrl: input.capture.faviconUrl,
    nativeBookmarkIds: [
      ...new Set([...(existing?.nativeBookmarkIds || []), bookmark.id])
    ],
    nativeFolderPath: await folderPathForId(bookmark.parentId || input.folderId),
    aiStatus: input.requestAi
      ? existing?.aiStatus === "ready" && !contentChanged
        ? "ready"
        : "pending"
      : existing?.aiStatus || "not_requested",
    syncStatus: "pending",
    createdAt: existing?.createdAt || timestamp,
    updatedAt: timestamp,
    lastSyncedAt: existing?.lastSyncedAt
  };

  await upsertLocalResource(resource);
  await enqueueOutbox(
    resource,
    input.requestAi ? input.capture.content : ""
  );
  const synced = await tryImmediateSync(
    resource,
    input.requestAi ? input.capture.content : ""
  );

  return {
    resource: synced,
    nativeBookmarkCreated: created,
    cloudSyncAttempted: synced.syncStatus === "synced"
  };
}

function flashActionBadge(
  tabId: number | undefined,
  text: string,
  color: string,
  title: string
) {
  void chrome.action.setBadgeBackgroundColor({ color, tabId });
  void chrome.action.setBadgeText({ text, tabId });
  void chrome.action.setTitle({ title, tabId });
  setTimeout(() => {
    void chrome.action.setBadgeText({ text: "", tabId });
    void chrome.action.setTitle({
      title: "打开 Bookmark Layer",
      tabId
    });
  }, 2_000);
}

function pendingSaveKey(tabId: number): string {
  return `${PENDING_SAVE_PREFIX}${tabId}`;
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

async function getAppState(): Promise<AppState> {
  const [auth, tab, resources, outbox] = await Promise.all([
    getAuthState(),
    getActiveTabSummary(),
    getLocalResources(),
    getOutbox()
  ]);

  return {
    auth,
    activeTab: tab,
    localResourceCount: resources.length,
    pendingSyncCount: outbox.length
  };
}

function walkBookmarkTree(
  nodes: chrome.bookmarks.BookmarkTreeNode[],
  parentPath: string[],
  result: Array<{ node: chrome.bookmarks.BookmarkTreeNode; path: string[] }>
) {
  for (const node of nodes) {
    if (node.url) {
      result.push({ node, path: parentPath });
      continue;
    }

    const nextPath =
      node.id === "0" ? parentPath : [...parentPath, node.title || "未命名"];
    walkBookmarkTree(node.children || [], nextPath, result);
  }
}

async function importNativeBookmarks(): Promise<ImportResult> {
  const tree = await chrome.bookmarks.getTree();
  const native: Array<{
    node: chrome.bookmarks.BookmarkTreeNode;
    path: string[];
  }> = [];
  walkBookmarkTree(tree, [], native);

  const current = await getLocalResources();
  const known = new Map(current.map((item) => [item.resourceKey, item]));
  const grouped = new Map<
    string,
    Array<{
      node: chrome.bookmarks.BookmarkTreeNode;
      path: string[];
      canonicalUrl: string;
    }>
  >();
  let imported = 0;
  let alreadyKnown = 0;

  for (const { node, path } of native) {
    if (!node.url || !isSupportedPageUrl(node.url)) {
      continue;
    }

    const canonicalUrl = canonicalizeUrl(node.url);
    const resourceKey = await resourceKeyForUrl(canonicalUrl);
    const group = grouped.get(resourceKey) || [];
    group.push({ node, path, canonicalUrl });
    grouped.set(resourceKey, group);
  }

  for (const [resourceKey, group] of grouped) {
    const primary = group[0];
    const existing = known.get(resourceKey);
    const timestamp = now();
    const nativeBookmarkIds = group.map((item) => item.node.id);
    const baseChanged =
      !existing ||
      existing.title !== primary.node.title ||
      existing.url !== primary.node.url ||
      existing.canonicalUrl !== primary.canonicalUrl ||
      existing.nativeFolderPath.join("\n") !== primary.path.join("\n") ||
      existing.nativeBookmarkIds.join("\n") !==
        nativeBookmarkIds.join("\n");

    const resource: ResourceRecord = {
      resourceKey,
      canonicalUrl: primary.canonicalUrl,
      url: primary.node.url!,
      title:
        primary.node.title || new URL(primary.node.url!).hostname,
      userNote: existing?.userNote || "",
      summary: existing?.summary || "",
      tags: existing?.tags || [],
      topics: existing?.topics || [],
      contentExcerpt: existing?.contentExcerpt || "",
      contentHash: existing?.contentHash || "",
      selectedText: existing?.selectedText || "",
      author: existing?.author || "",
      siteName:
        existing?.siteName || new URL(primary.node.url!).hostname,
      language: existing?.language || "",
      imageUrl: existing?.imageUrl || "",
      faviconUrl: existing?.faviconUrl || "",
      nativeBookmarkIds,
      nativeFolderPath: primary.path,
      aiStatus: existing?.aiStatus || "not_requested",
      syncStatus: baseChanged
        ? "pending"
        : existing?.syncStatus || "local",
      createdAt:
        existing?.createdAt ||
        (primary.node.dateAdded
          ? new Date(primary.node.dateAdded).toISOString()
          : timestamp),
      updatedAt: baseChanged ? timestamp : existing!.updatedAt,
      lastSyncedAt: existing?.lastSyncedAt
    };

    await upsertLocalResource(resource);
    if (baseChanged) {
      await enqueueOutbox(resource, "");
    }
    if (existing) alreadyKnown += group.length;
    else imported += group.length;
  }

  for (const resource of current) {
    if (
      resource.nativeBookmarkIds.length &&
      !grouped.has(resource.resourceKey)
    ) {
      await upsertLocalResource({
        ...resource,
        nativeBookmarkIds: [],
        updatedAt: now()
      });
    }
  }

  return { scanned: native.length, imported, alreadyKnown };
}

async function ensureFolderPath(path: string[]): Promise<string> {
  const options = await getFolderOptions();
  const bar =
    options.find((item) => item.depth === 0 && item.name.includes("书签")) ||
    options.find((item) => item.depth === 0) ||
    null;

  if (!bar) {
    return defaultFolderId();
  }

  const relativePath =
    path[0] === bar.name || path[0]?.toLowerCase().includes("bookmark")
      ? path.slice(1)
      : path;
  let parentId = bar.id;

  for (const segment of relativePath) {
    const children = await chrome.bookmarks.getChildren(parentId);
    const existing = children.find(
      (item) => !item.url && item.title === segment && !item.unmodifiable
    );
    if (existing) {
      parentId = existing.id;
      continue;
    }

    const created = await chrome.bookmarks.create({
      parentId,
      title: segment
    });
    parentId = created.id;
  }

  return parentId;
}

async function restoreMissingNativeBookmarks(): Promise<RestoreResult> {
  const resources = await pullCloudResources();
  const tree = await chrome.bookmarks.getTree();
  const native: Array<{
    node: chrome.bookmarks.BookmarkTreeNode;
    path: string[];
  }> = [];
  walkBookmarkTree(tree, [], native);

  const nativeKeys = new Set<string>();
  for (const { node } of native) {
    if (node.url && isSupportedPageUrl(node.url)) {
      nativeKeys.add(await resourceKeyForUrl(node.url));
    }
  }

  let restored = 0;
  let alreadyPresent = 0;

  for (const resource of resources) {
    if (nativeKeys.has(resource.resourceKey)) {
      alreadyPresent += 1;
      continue;
    }

    const parentId = await ensureFolderPath(resource.nativeFolderPath);
    const target = bookmarkTarget(parentId, resource.url);
    internalBookmarkTargets.add(target);
    let bookmark: chrome.bookmarks.BookmarkTreeNode;
    try {
      bookmark = await chrome.bookmarks.create({
        parentId,
        title: resource.title,
        url: resource.url
      });
    } catch (error) {
      internalBookmarkTargets.delete(target);
      throw error;
    }
    internalBookmarkIds.add(bookmark.id);
    releaseInternalBookmarkWrite(bookmark.id, target);
    const updated = {
      ...resource,
      nativeBookmarkIds: [
        ...new Set([...resource.nativeBookmarkIds, bookmark.id])
      ],
      updatedAt: now()
    };
    await upsertLocalResource(updated);
    restored += 1;
  }

  return { restored, alreadyPresent };
}

async function syncNow() {
  const result = await drainOutbox();
  const resources = await pullCloudResources();
  return { ...result, resources };
}

async function drainOutbox(maxBatches = 50): Promise<{
  synced: number;
  failed: number;
}> {
  let synced = 0;
  let failed = 0;

  for (let batch = 0; batch < maxBatches; batch += 1) {
    const pending = await getOutbox();
    if (!pending.length) break;
    const result = await processOutbox();
    synced += result.synced;
    failed += result.failed;
    if (result.synced === 0) break;
  }

  return { synced, failed };
}

async function getResources(query = "", semantic = false) {
  await importNativeBookmarks();
  void syncPendingIfReady();
  const local = await getLocalResources();
  const linked = local.filter((item) => item.nativeBookmarkIds.length > 0);
  if (!query.trim()) {
    return linked;
  }

  if (semantic) {
    try {
      const cloudResults = await semanticSearch(query);
      const nativeByKey = new Map(
        linked.map((resource) => [resource.resourceKey, resource])
      );
      return cloudResults.flatMap((result) => {
        const native = nativeByKey.get(result.resource.resourceKey);
        if (!native) return [];
        return [
          {
            ...result,
            resource: {
              ...result.resource,
              title: native.title,
              url: native.url,
              canonicalUrl: native.canonicalUrl,
              nativeBookmarkIds: native.nativeBookmarkIds,
              nativeFolderPath: native.nativeFolderPath
            }
          }
        ];
      });
    } catch {
      return searchLocalResources(linked, query);
    }
  }

  return searchLocalResources(linked, query);
}

async function indexNativeBookmark(
  id: string,
  node: chrome.bookmarks.BookmarkTreeNode
) {
  if (!node.url || !isSupportedPageUrl(node.url)) {
    return;
  }

  const resourceKey = await resourceKeyForUrl(node.url);
  const existing = await getLocalResource(resourceKey);
  const timestamp = now();
  const resource: ResourceRecord = {
    resourceKey,
    canonicalUrl: canonicalizeUrl(node.url),
    url: node.url,
    title: node.title || existing?.title || new URL(node.url).hostname,
    userNote: existing?.userNote || "",
    summary: existing?.summary || "",
    tags: existing?.tags || [],
    topics: existing?.topics || [],
    contentExcerpt: existing?.contentExcerpt || "",
    contentHash: existing?.contentHash || "",
    selectedText: existing?.selectedText || "",
    author: existing?.author || "",
    siteName: existing?.siteName || new URL(node.url).hostname,
    language: existing?.language || "",
    imageUrl: existing?.imageUrl || "",
    faviconUrl: existing?.faviconUrl || "",
    nativeBookmarkIds: [
      ...new Set([...(existing?.nativeBookmarkIds || []), id])
    ],
    nativeFolderPath: await folderPathForId(node.parentId || ""),
    aiStatus: existing?.aiStatus || "not_requested",
    syncStatus: "pending",
    createdAt: existing?.createdAt || timestamp,
    updatedAt: timestamp,
    lastSyncedAt: existing?.lastSyncedAt
  };

  await upsertLocalResource(resource);
  await enqueueOutbox(resource, "");
  void syncPendingIfReady();
}

async function handleRequest(request: ExtensionRequest): Promise<unknown> {
  switch (request.type) {
    case "GET_APP_STATE":
      return getAppState();
    case "GET_BOOKMARK_BAR":
      return getBookmarkBarSnapshot();
    case "GET_PENDING_SAVE":
      return consumePendingSaveDraft(request.tabId);
    case "GET_NAVIGATION_SUGGESTIONS":
      return getNavigationSuggestions(request.query);
    case "NAVIGATE":
      return navigate(request.payload);
    case "GET_FOLDERS":
      return getFolderOptions();
    case "CAPTURE_ACTIVE_PAGE":
      return captureActivePage();
    case "SAVE_BOOKMARK":
      return saveBookmark(request.payload);
    case "GET_RESOURCES":
      return getResources(request.query, request.semantic);
    case "SYNC_NOW":
      return syncNow();
    case "IMPORT_NATIVE_BOOKMARKS":
      return importNativeBookmarks();
    case "RESTORE_MISSING_NATIVE_BOOKMARKS":
      return restoreMissingNativeBookmarks();
    case "UPDATE_NATIVE_BOOKMARK":
      return updateNativeBookmark(request.payload);
    case "CREATE_NATIVE_FOLDER":
      return createNativeFolder(request.payload);
    case "MOVE_NATIVE_BOOKMARK":
      return moveNativeBookmark(request.payload);
    case "DELETE_NATIVE_BOOKMARK":
      return deleteNativeBookmark(request.payload);
    case "OPEN_MANAGER":
      await chrome.tabs.create({
        url: chrome.runtime.getURL(
          `manager.html${request.query ? `?q=${encodeURIComponent(request.query)}` : ""}`
        )
      });
      return { opened: true };
    case "AUTH_CHANGED":
      try {
        await processOutbox();
        await pullCloudResources();
      } catch {
        // The returned state gives the UI the actionable error boundary.
      }
      return getAppState();
  }
}

chrome.runtime.onMessage.addListener(
  (
    request: ExtensionRequest,
    _sender,
    sendResponse: (response: ExtensionResponse<unknown>) => void
  ) => {
    void handleRequest(request)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) =>
        sendResponse({ ok: false, error: errorMessage(error) })
      );
    return true;
  }
);

chrome.runtime.onInstalled.addListener(() => {
  void chrome.storage.local.setAccessLevel({
    accessLevel: "TRUSTED_CONTEXTS"
  });
  void chrome.sidePanel.setPanelBehavior({
    openPanelOnActionClick: true
  });
  void chrome.alarms.create("bookmark-layer-sync", {
    delayInMinutes: 1,
    periodInMinutes: 5
  });
  void chrome.contextMenus.removeAll().then(() =>
    Promise.all([
      chrome.contextMenus.create({
        id: CONTEXT_MENU_PAGE_ID,
        title: "添加当前页面到收藏…",
        contexts: ["page", "selection"]
      }),
      chrome.contextMenus.create({
        id: CONTEXT_MENU_LINK_ID,
        title: "添加此链接到收藏…",
        contexts: ["link"]
      })
    ])
  );
  void importNativeBookmarks().then(() => syncPendingIfReady());
  void chrome.omnibox.setDefaultSuggestion({
    description:
      "搜索 Chrome 书签、历史记录和标签页，或使用默认搜索引擎"
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (
    info.menuItemId !== CONTEXT_MENU_PAGE_ID &&
    info.menuItemId !== CONTEXT_MENU_LINK_ID
  ) {
    return;
  }
  try {
    const draft = buildPendingSaveDraft(info, tab);
    pendingSaveDrafts.set(draft.tabId, draft);
    void chrome.storage.session.set({
      [pendingSaveKey(draft.tabId)]: draft
    });
    void chrome.runtime
      .sendMessage({
        type: "PENDING_SAVE_READY",
        tabId: draft.tabId
      })
      .catch(() => undefined);
    void chrome.sidePanel.open({ tabId: draft.tabId }).catch((error) => {
      flashActionBadge(
        tab?.id,
        "!",
        "#a33b34",
        errorMessage(error)
      );
    });
  } catch (error) {
    flashActionBadge(
      tab?.id,
      "!",
      "#a33b34",
      errorMessage(error)
    );
  }
});

function escapeOmniboxText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

chrome.omnibox.onInputChanged.addListener((text, suggest) => {
  void getNavigationSuggestions(text).then((items) => {
    suggest(
      items.slice(0, 8).map((item) => ({
        content: item.url,
        description: `<match>${escapeOmniboxText(item.title)}</match> <dim>${escapeOmniboxText(item.subtitle)}</dim>`
      }))
    );
  });
});

chrome.omnibox.onInputEntered.addListener((text, disposition) => {
  void navigate({
    text,
    disposition:
      disposition === "currentTab" ? "current" : "new"
  });
});

chrome.bookmarks.onCreated.addListener((id, node) => {
  if (
    internalBookmarkIds.has(id) ||
    (node.url &&
      internalBookmarkTargets.has(
        bookmarkTarget(node.parentId || "", node.url)
      ))
  ) {
    return;
  }
  void indexNativeBookmark(id, node);
});

chrome.bookmarks.onChanged.addListener((id) => {
  if (internalBookmarkIds.has(id)) {
    return;
  }
  void chrome.bookmarks
    .get(id)
    .then(([node]) => node && indexNativeBookmark(id, node))
    .catch(() => undefined);
});

chrome.bookmarks.onMoved.addListener((id) => {
  if (internalBookmarkIds.has(id)) {
    return;
  }
  void chrome.bookmarks
    .get(id)
    .then(([node]) => node && indexNativeBookmark(id, node))
    .catch(() => undefined);
});

chrome.bookmarks.onRemoved.addListener((id) => {
  void getLocalResources().then(async (resources) => {
    const resource = resources.find((item) =>
      item.nativeBookmarkIds.includes(id)
    );
    if (!resource) {
      return;
    }

    await upsertLocalResource({
      ...resource,
      nativeBookmarkIds: resource.nativeBookmarkIds.filter(
        (bookmarkId) => bookmarkId !== id
      ),
      updatedAt: now()
    });
  });
});

chrome.runtime.onStartup.addListener(() => {
  void importNativeBookmarks().then(() => syncPendingIfReady());
  void getAuthState().then((auth) => {
    if (auth.signedIn && auth.accountMatches === true) {
      void processOutbox();
      void pullCloudResources();
    }
  });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "bookmark-layer-sync") {
    void syncPendingIfReady();
  }
});

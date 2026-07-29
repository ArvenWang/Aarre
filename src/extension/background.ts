import { getAuthState } from "../lib/auth";
import {
  processOutbox,
  pullCloudResources,
  syncOneResource
} from "../lib/cloud";
import {
  askBookmarkAgent,
  enrichResourceFromEssenceWithUsage,
  enrichResourceLocally
} from "../lib/local-ai";
import {
  buildLibraryInsights,
  suggestFolders
} from "../lib/library-insights";
import {
  deleteAgentConversation,
  getAgentConversations,
  saveAgentConversation
} from "../lib/conversations";
import {
  extractPageEssenceFromHtml,
  isInternalOrSensitiveUrl
} from "../lib/page-essence";
import {
  cacheRepresentativeImage,
  cacheSiteBrandIcon
} from "../lib/thumbnail";
import {
  categoryCoverForResource,
  matchCoverRule,
  recordPageImageSample,
  registrableHost,
  resolveRuleAsset
} from "../lib/cover-registry";
import {
  createPageSnapshot,
  isSnapshotSensitiveUrl
} from "../lib/page-snapshot";
import { getDisplaySettings } from "../lib/display-settings";
import {
  createUndoBatch,
  snapshotCreatedMutation,
  snapshotNodeMutation,
  undoBookmarkBatch
} from "../lib/bookmark-undo";
import type {
  ExtensionRequest,
  ExtensionResponse
} from "../lib/messages";
import { searchLocalResources } from "../lib/search";
import {
  getAiSettingsStatus,
  getAiRuntimeSettings,
  getAiProviderPreset,
  saveAiSettings
} from "../lib/settings";
import {
  addScanAiUsage,
  getAiUsageStats
} from "../lib/usage-stats";
import {
  costCnyForUsage,
  estimateScanCost
} from "../lib/ai-cost";
import { checkLinkHealth } from "../lib/link-health";
import {
  DomainRateLimiter,
  interleaveResourcesByHost
} from "../lib/scan-scheduler";
import {
  completeOutboxItem,
  cleanupExpiredUndoSnapshots,
  deferOutboxItem,
  deleteUndoSnapshot,
  enqueueOutbox,
  getLocalResource,
  getLocalResources,
  getOutbox,
  getPageSnapshot,
  getSiteBrand,
  getSiteBrands,
  getUndoSnapshot,
  getUndoSnapshots,
  putUndoSnapshot,
  putPageSnapshot,
  putSiteBrand,
  upsertLocalResource
} from "../lib/storage";
import {
  matchesNavigationText,
  parseNavigationInput
} from "../lib/navigation";
import { createPendingSaveDraft } from "../lib/pending-save";
import type {
  ActiveTabSummary,
  AiProviderId,
  AiTokenUsage,
  AppState,
  BookmarkAgentActionExecutionResult,
  BookmarkAgentActionProposal,
  BookmarkAgentCatalog,
  BookmarkBarSnapshot,
  ImportResult,
  LibraryScanStatus,
  LibraryScanEstimate,
  NativeBookmarkNode,
  NativeFolderOption,
  NavigationInput,
  NavigationSuggestion,
  OutboxItem,
  PendingSaveDraft,
  PageCapture,
  ResourceRecord,
  RestoreResult,
  SaveBookmarkInput,
  SaveBookmarkResult,
  SiteBrandRecord,
  SiteIconCandidate,
  UndoMutation,
  UndoSnapshotBatch
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
const LIBRARY_SCAN_KEY = "aarre:library-scan";
const LIBRARY_SCAN_ALARM = "aarre-library-scan";
const MAX_SCAN_HTML_BYTES = 600_000;
const internalBookmarkIds = new Set<string>();
const internalBookmarkTargets = new Set<string>();
const pendingSaveDrafts = new Map<number, PendingSaveDraft>();
const pageSnapshotTimers = new Map<number, number>();
let libraryScanRunning = false;
const libraryScanRateLimiter = new DomainRateLimiter(1_000);
const LIBRARY_SCAN_CONCURRENCY = 4;
const LINK_HEALTH_REFRESH_MS = 7 * 24 * 60 * 60 * 1_000;

interface StoredLibraryScanJob extends LibraryScanStatus {
  resourceKeys: string[];
  nextIndex: number;
  force: boolean;
  provider?: AiProviderId;
  actualUsageEstimated?: boolean;
  usageRecorded?: boolean;
}

function emptyLibraryScan(): StoredLibraryScanJob {
  return {
    id: "",
    state: "idle",
    total: 0,
    processed: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    currentTitle: "",
    errors: [],
    resourceKeys: [],
    nextIndex: 0,
    force: false,
    actualUsageEstimated: false,
    usageRecorded: false
  };
}

function publicLibraryScan(
  job: StoredLibraryScanJob
): LibraryScanStatus {
  const {
    resourceKeys: _resourceKeys,
    nextIndex: _nextIndex,
    force: _force,
    provider: _provider,
    actualUsageEstimated: _actualUsageEstimated,
    usageRecorded: _usageRecorded,
    ...status
  } = job;
  return status;
}

async function getStoredLibraryScan(): Promise<StoredLibraryScanJob> {
  const stored = (await chrome.storage.local.get(LIBRARY_SCAN_KEY))[
    LIBRARY_SCAN_KEY
  ];
  if (!stored || typeof stored !== "object") {
    return emptyLibraryScan();
  }
  const value = stored as Partial<StoredLibraryScanJob>;
  return {
    ...emptyLibraryScan(),
    ...value,
    errors: Array.isArray(value.errors) ? value.errors.slice(-20) : [],
    resourceKeys: Array.isArray(value.resourceKeys)
      ? value.resourceKeys.filter(
          (item): item is string => typeof item === "string"
        )
      : []
  };
}

async function setStoredLibraryScan(
  job: StoredLibraryScanJob
): Promise<void> {
  await chrome.storage.local.set({ [LIBRARY_SCAN_KEY]: job });
  void chrome.runtime
    .sendMessage({
      type: "LIBRARY_SCAN_UPDATED",
      status: publicLibraryScan(job)
    })
    .catch(() => undefined);
}

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

async function runProtectedBookmarkMutation<T>(input: {
  label: string;
  destructive: boolean;
  mutation: UndoMutation;
  perform: () => Promise<T>;
  createdNodeId?: (result: T) => string | undefined;
}): Promise<T> {
  const batch = createUndoBatch({
    source: "manual",
    label: input.label,
    destructive: input.destructive,
    mutations: [{ ...input.mutation, applied: true }]
  });
  await putUndoSnapshot(batch);

  let result: T;
  try {
    result = await input.perform();
  } catch (error) {
    await deleteUndoSnapshot(batch.batchId).catch(() => undefined);
    throw error;
  }

  const createdNodeId = input.createdNodeId?.(result);
  const ready: UndoSnapshotBatch = {
    ...batch,
    status: "ready",
    mutations: batch.mutations.map((mutation) => ({
      ...mutation,
      ...(createdNodeId ? { createdNodeId } : {})
    }))
  };
  try {
    await putUndoSnapshot(ready);
  } catch {
    const rolledBack = await undoBookmarkBatch(
      ready,
      defaultFolderId
    ).catch(() => null);
    if (rolledBack) {
      await putUndoSnapshot(rolledBack.batch).catch(() => undefined);
    }
    throw new Error(
      rolledBack?.failed
        ? "撤销记录写入失败，且自动回滚未完全成功。请立即查看“最近的更改”。"
        : "撤销记录写入失败，本次修改已自动回滚，没有保留不可撤销的写入。"
    );
  }
  return result;
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
}, skipUndo = false): Promise<NativeBookmarkNode> {
  const title = input.title.trim();
  if (!title) {
    throw new Error("名称不能为空。");
  }
  const [current] = await chrome.bookmarks.get(input.id);
  if (!current || current.unmodifiable === "managed") {
    throw new Error("这个书签由 Chrome 或组织管理，无法修改。");
  }
  const perform = async () =>
    serializeBookmarkNode(
      await chrome.bookmarks.update(input.id, {
        title,
        ...(current.url && input.url?.trim()
          ? { url: input.url.trim() }
          : {})
      })
    );
  if (skipUndo) return perform();
  const mutation = await snapshotNodeMutation({
    nodeId: input.id,
    kind: "restore_update",
    label: `修改“${current.title || current.url}”`
  });
  return runProtectedBookmarkMutation({
    label: mutation.label,
    destructive: false,
    mutation,
    perform
  });
}

function normalizeUserTags(tags: string[]): string[] {
  return [
    ...new Set(
      tags
        .map((tag) => tag.trim().replace(/^#+\s*/, ""))
        .filter(Boolean)
        .map((tag) => tag.slice(0, 40))
    )
  ].slice(0, 16);
}

async function updateResourceTags(input: {
  resourceKey: string;
  tags: string[];
}): Promise<ResourceRecord> {
  const resource = await getLocalResource(input.resourceKey);
  if (!resource) {
    throw new Error("没有找到这个书签的智能信息，请刷新后再试。");
  }
  const auth = await getAuthState();
  const next: ResourceRecord = {
    ...resource,
    tags: normalizeUserTags(input.tags),
    tagsSource: "user",
    syncStatus: auth.configured ? "pending" : "local",
    updatedAt: now()
  };
  await upsertLocalResource(next);
  if (auth.configured) {
    await enqueueOutbox(next, "");
    void syncPendingIfReady();
  }
  return next;
}

async function createNativeFolder(input: {
  parentId: string;
  title: string;
}, skipUndo = false): Promise<NativeBookmarkNode> {
  const title = input.title.trim();
  if (!title) {
    throw new Error("文件夹名称不能为空。");
  }
  const [parent] = await chrome.bookmarks.get(input.parentId);
  if (!parent || parent.url || parent.unmodifiable === "managed") {
    throw new Error("目标文件夹不可写入。");
  }
  const perform = async () =>
    serializeBookmarkNode(
      await chrome.bookmarks.create({ parentId: input.parentId, title })
    );
  if (skipUndo) return perform();
  const mutation = await snapshotCreatedMutation({
    parentId: input.parentId,
    label: `创建文件夹“${title}”`,
    title
  });
  return runProtectedBookmarkMutation({
    label: mutation.label,
    destructive: false,
    mutation,
    perform,
    createdNodeId: (node) => node.id
  });
}

async function moveNativeBookmark(input: {
  id: string;
  parentId: string;
  index?: number;
}, skipUndo = false): Promise<NativeBookmarkNode> {
  if (input.id === input.parentId) {
    throw new Error("不能把文件夹移动到自身。");
  }
  const perform = async () =>
    serializeBookmarkNode(
      await chrome.bookmarks.move(input.id, {
        parentId: input.parentId,
        index: input.index
      })
    );
  if (skipUndo) return perform();
  const mutation = await snapshotNodeMutation({
    nodeId: input.id,
    kind: "restore_move",
    label: "移动书签或文件夹"
  });
  mutation.label = `移动“${mutation.node?.title || "书签"}”`;
  return runProtectedBookmarkMutation({
    label: mutation.label,
    destructive: false,
    mutation,
    perform
  });
}

async function deleteNativeBookmark(input: {
  id: string;
  recursive: boolean;
}, skipUndo = false): Promise<{ deleted: true }> {
  const [node] = await chrome.bookmarks.get(input.id);
  if (!node || node.unmodifiable === "managed" || node.folderType) {
    throw new Error("这个项目由 Chrome 管理，无法删除。");
  }
  const perform = async () => {
    if (node.url) {
      await chrome.bookmarks.remove(input.id);
    } else if (input.recursive) {
      await chrome.bookmarks.removeTree(input.id);
    } else {
      await chrome.bookmarks.remove(input.id);
    }
    return { deleted: true as const };
  };
  if (skipUndo) return perform();
  const mutation = await snapshotNodeMutation({
    nodeId: input.id,
    kind: "restore_subtree",
    label: `删除“${node.title || node.url}”`,
    destructive: true
  });
  return runProtectedBookmarkMutation({
    label: mutation.label,
    destructive: true,
    mutation,
    perform
  });
}

function validateAgentBookmarkUrl(value: string | undefined): string {
  const text = value?.trim() || "";
  try {
    const parsed = new URL(text);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error("unsupported protocol");
    }
    return parsed.href;
  } catch {
    throw new Error("AI 操作中的书签网址无效，未执行任何写入。");
  }
}

async function createNativeBookmarkFromAgent(input: {
  parentId: string;
  title: string;
  url: string;
}): Promise<NativeBookmarkNode> {
  const title = input.title.trim();
  if (!title) {
    throw new Error("书签名称不能为空。");
  }
  const url = validateAgentBookmarkUrl(input.url);
  const [parent] = await chrome.bookmarks.get(input.parentId);
  if (
    !parent ||
    parent.url ||
    parent.unmodifiable === "managed"
  ) {
    throw new Error("目标文件夹不可写入。");
  }
  const created = await chrome.bookmarks.create({
    parentId: parent.id,
    title: title.slice(0, 200),
    url
  });
  const [verified] = await chrome.bookmarks.get(created.id);
  if (!verified?.url || verified.url !== url) {
    throw new Error("Chrome 没有保存这个书签，请重试。");
  }
  return serializeBookmarkNode(verified);
}

async function getAgentActionTarget(
  id: string | undefined,
  kind: "bookmark" | "folder"
): Promise<chrome.bookmarks.BookmarkTreeNode> {
  if (!id) {
    throw new Error("AI 操作缺少明确目标，未执行。");
  }
  const [node] = await chrome.bookmarks.get(id);
  if (
    !node ||
    node.unmodifiable === "managed" ||
    (kind === "bookmark" ? !node.url : Boolean(node.url)) ||
    (kind === "folder" && Boolean(node.folderType))
  ) {
    throw new Error("目标已不存在或不可修改，请刷新后重新确认。");
  }
  return node;
}

function verifyAgentActionTargetUnchanged(
  action: BookmarkAgentActionProposal,
  node: chrome.bookmarks.BookmarkTreeNode
): void {
  if (
    (action.expectedTitle !== undefined &&
      node.title !== action.expectedTitle) ||
    (action.expectedUrl !== undefined &&
      node.url !== action.expectedUrl) ||
    (action.expectedParentId !== undefined &&
      node.parentId !== action.expectedParentId)
  ) {
    throw new Error(
      "目标在确认前已发生变化。为避免误操作，本次没有执行，请重新发起请求。"
    );
  }
}

async function verifyAgentActionTargetMissing(id: string): Promise<void> {
  let exists = false;
  try {
    exists = Boolean((await chrome.bookmarks.get(id))[0]);
  } catch {
    exists = false;
  }
  if (exists) {
    throw new Error("Chrome 仍返回这个项目，删除未完成。");
  }
}

async function executeBookmarkAgentAction(
  action: BookmarkAgentActionProposal
): Promise<BookmarkAgentActionExecutionResult> {
  if (!action.id || action.status !== "pending") {
    throw new Error("这项操作已经处理或状态无效。");
  }

  switch (action.type) {
    case "create_bookmark": {
      if (!action.parentId || !action.title || !action.url) {
        throw new Error("添加书签所需信息不完整。");
      }
      const created = await createNativeBookmarkFromAgent({
        parentId: action.parentId,
        title: action.title,
        url: action.url
      });
      return {
        actionId: action.id,
        success: true,
        message: `已创建书签「${created.title}」，并从 Chrome 重新读取确认。`,
        createdNodeId: created.id
      };
    }
    case "create_folder": {
      if (!action.parentId || !action.title) {
        throw new Error("新建文件夹所需信息不完整。");
      }
      const created = await createNativeFolder({
        parentId: action.parentId,
        title: action.title
      }, true);
      const [verified] = await chrome.bookmarks.get(created.id);
      if (!verified || verified.url) {
        throw new Error("Chrome 没有保存这个文件夹，请重试。");
      }
      return {
        actionId: action.id,
        success: true,
        message: `已创建文件夹「${verified.title}」，并从 Chrome 重新读取确认。`,
        createdNodeId: verified.id
      };
    }
    case "delete_bookmark": {
      const target = await getAgentActionTarget(
        action.targetId,
        "bookmark"
      );
      verifyAgentActionTargetUnchanged(action, target);
      await deleteNativeBookmark({
        id: target.id,
        recursive: false
      }, true);
      await verifyAgentActionTargetMissing(target.id);
      return {
        actionId: action.id,
        success: true,
        message: `已从 Chrome 删除书签「${target.title || target.url}」。`
      };
    }
    case "delete_folder": {
      const target = await getAgentActionTarget(
        action.targetId,
        "folder"
      );
      verifyAgentActionTargetUnchanged(action, target);
      const count = countBookmarkNodes(target).bookmarkCount;
      await deleteNativeBookmark({
        id: target.id,
        recursive: true
      }, true);
      await verifyAgentActionTargetMissing(target.id);
      return {
        actionId: action.id,
        success: true,
        message: `已从 Chrome 删除文件夹「${target.title}」及其中 ${count} 个书签。`
      };
    }
    case "update_bookmark": {
      const target = await getAgentActionTarget(
        action.targetId,
        "bookmark"
      );
      verifyAgentActionTargetUnchanged(action, target);
      const updated = await updateNativeBookmark({
        id: target.id,
        title: action.title || target.title,
        url: validateAgentBookmarkUrl(action.url || target.url)
      }, true);
      const [verified] = await chrome.bookmarks.get(updated.id);
      if (
        !verified ||
        verified.title !== updated.title ||
        verified.url !== updated.url
      ) {
        throw new Error("Chrome 返回的书签与修改结果不一致。");
      }
      return {
        actionId: action.id,
        success: true,
        message: `已修改书签「${verified.title}」，并从 Chrome 重新读取确认。`
      };
    }
    case "rename_folder": {
      const target = await getAgentActionTarget(
        action.targetId,
        "folder"
      );
      verifyAgentActionTargetUnchanged(action, target);
      const updated = await updateNativeBookmark({
        id: target.id,
        title: action.title || ""
      }, true);
      const [verified] = await chrome.bookmarks.get(updated.id);
      if (!verified || verified.title !== updated.title) {
        throw new Error("Chrome 返回的文件夹名称与修改结果不一致。");
      }
      return {
        actionId: action.id,
        success: true,
        message: `已将文件夹重命名为「${verified.title}」。`
      };
    }
    case "move_bookmark":
    case "move_folder": {
      const target = await getAgentActionTarget(
        action.targetId,
        action.type === "move_bookmark" ? "bookmark" : "folder"
      );
      verifyAgentActionTargetUnchanged(action, target);
      if (!action.destinationId) {
        throw new Error("移动操作缺少目标文件夹。");
      }
      const [destination] = await chrome.bookmarks.get(
        action.destinationId
      );
      if (
        !destination ||
        destination.url ||
        destination.unmodifiable === "managed"
      ) {
        throw new Error("目标文件夹已不存在或不可写入。");
      }
      const moved = await moveNativeBookmark({
        id: target.id,
        parentId: destination.id
      }, true);
      const [verified] = await chrome.bookmarks.get(moved.id);
      if (!verified || verified.parentId !== destination.id) {
        throw new Error("Chrome 返回的位置与移动结果不一致。");
      }
      return {
        actionId: action.id,
        success: true,
        message: `已将「${verified.title}」移动到「${destination.title}」。`
      };
    }
  }
}

async function prepareAgentUndoBatch(
  actions: BookmarkAgentActionProposal[],
  label = `AI 批量操作（${actions.length} 项）`
): Promise<UndoSnapshotBatch> {
  const mutations: UndoMutation[] = [];
  for (const action of actions) {
    if (action.type === "create_bookmark" || action.type === "create_folder") {
      if (!action.parentId || !action.title) {
        throw new Error("AI 操作缺少创建目标，无法建立撤销快照。");
      }
      mutations.push(
        await snapshotCreatedMutation({
          parentId: action.parentId,
          actionId: action.id,
          label: action.label,
          title: action.title,
          url: action.type === "create_bookmark" ? action.url : undefined,
          destructive: action.destructive
        })
      );
      continue;
    }
    if (!action.targetId) {
      throw new Error("AI 操作缺少明确目标，无法建立撤销快照。");
    }
    mutations.push(
      await snapshotNodeMutation({
        nodeId: action.targetId,
        actionId: action.id,
        kind:
          action.type === "delete_bookmark" || action.type === "delete_folder"
            ? "restore_subtree"
            : action.type === "move_bookmark" || action.type === "move_folder"
              ? "restore_move"
              : "restore_update",
        label: action.label,
        destructive: action.destructive
      })
    );
  }
  const batch = createUndoBatch({
    source: "agent",
    label,
    destructive: actions.some((action) => action.destructive),
    mutations
  });
  await putUndoSnapshot(batch);
  return batch;
}

async function executeBookmarkAgentActions(
  actions: BookmarkAgentActionProposal[],
  options: { maxActions?: number; label?: string } = {}
): Promise<{
  results: BookmarkAgentActionExecutionResult[];
  batchId?: string;
}> {
  const maxActions = options.maxActions ?? 8;
  if (
    !Array.isArray(actions) ||
    !actions.length ||
    actions.length > maxActions ||
    actions.some((action) => action.status !== "pending")
  ) {
    throw new Error("没有可执行的已确认操作。");
  }
  let batch = await prepareAgentUndoBatch(actions, options.label);
  const results: BookmarkAgentActionExecutionResult[] = [];
  for (const action of actions) {
    const mutationIndex = batch.mutations.findIndex(
      (mutation) => mutation.actionId === action.id
    );
    let executed = false;
    let executionResult: BookmarkAgentActionExecutionResult | null = null;
    try {
      if (mutationIndex < 0) {
        throw new Error("这项操作没有对应的撤销快照，已拒绝执行。");
      }
      batch.mutations[mutationIndex] = {
        ...batch.mutations[mutationIndex],
        applied: true
      };
      await putUndoSnapshot(batch);
      executionResult = await executeBookmarkAgentAction(action);
      executed = true;
      if (executionResult.createdNodeId) {
        batch.mutations[mutationIndex] = {
          ...batch.mutations[mutationIndex],
          createdNodeId: executionResult.createdNodeId
        };
      }
      await putUndoSnapshot(batch);
      results.push(executionResult);
    } catch (error) {
      if (mutationIndex >= 0 && !executed) {
        batch.mutations[mutationIndex] = {
          ...batch.mutations[mutationIndex],
          applied: false
        };
        await putUndoSnapshot(batch).catch(() => undefined);
      }
      results.push(
        executed && executionResult
          ? {
              ...executionResult,
              message: `${executionResult.message} 撤销记录的状态更新失败，但执行前快照仍保留。`
            }
          : {
              actionId: action?.id || "",
              success: false,
              message: errorMessage(error)
            }
      );
    }
  }
  const succeeded = results.filter((result) => result.success).length;
  if (succeeded) {
    batch = { ...batch, status: "ready" };
    await putUndoSnapshot(batch);
  } else {
    await deleteUndoSnapshot(batch.batchId);
  }
  await importNativeBookmarks();
  return {
    results,
    ...(succeeded ? { batchId: batch.batchId } : {})
  };
}

async function getRecentUndoSnapshots(): Promise<UndoSnapshotBatch[]> {
  await cleanupExpiredUndoSnapshots();
  return (await getUndoSnapshots()).filter(
    (batch) => batch.status !== "undone"
  );
}

async function undoStoredBookmarkBatch(batchId: string) {
  const batch = await getUndoSnapshot(batchId);
  if (!batch) {
    throw new Error("没有找到这批更改，可能已超过 30 天保留期。");
  }
  const result = await undoBookmarkBatch(batch, defaultFolderId);
  await putUndoSnapshot(result.batch);
  await importNativeBookmarks();
  return result;
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

function clearPageSnapshotTimers(exceptTabId?: number) {
  for (const [tabId, timer] of pageSnapshotTimers) {
    if (tabId === exceptTabId) continue;
    globalThis.clearTimeout(timer);
    pageSnapshotTimers.delete(tabId);
  }
}

async function capturePageSnapshotForTab(
  tab: chrome.tabs.Tab
): Promise<void> {
  if (
    typeof tab.id !== "number" ||
    typeof tab.windowId !== "number" ||
    !tab.url ||
    !tab.active ||
    tab.incognito ||
    !isSupportedPageUrl(tab.url)
  ) {
    return;
  }
  const settings = await getDisplaySettings();
  if (
    !settings.pageSnapshotsEnabled ||
    isSnapshotSensitiveUrl(tab.url, settings.snapshotExcludedHosts)
  ) {
    return;
  }
  const canonicalUrl = canonicalizeUrl(tab.url);
  const resourceKey = await resourceKeyForUrl(canonicalUrl);
  const resource = await getLocalResource(resourceKey);
  if (!resource?.nativeBookmarkIds.length) return;

  const focusedWindow = await chrome.windows.getLastFocused();
  if (focusedWindow.id !== tab.windowId) return;
  const [active] = await chrome.tabs.query({
    active: true,
    windowId: tab.windowId
  });
  if (active?.id !== tab.id || active.url !== tab.url || active.incognito) {
    return;
  }

  const pngDataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
    format: "png"
  });
  const capturedAt = now();
  const snapshot = await createPageSnapshot(
    canonicalUrl,
    pngDataUrl,
    capturedAt
  );
  await putPageSnapshot(snapshot);
  await upsertLocalResource({
    ...resource,
    snapshotAt: capturedAt,
    updatedAt: resource.updatedAt
  });
}

function schedulePageSnapshotForTab(
  tab: chrome.tabs.Tab,
  delay = 5_000
) {
  if (typeof tab.id !== "number") return;
  clearPageSnapshotTimers(tab.id);
  const existing = pageSnapshotTimers.get(tab.id);
  if (existing !== undefined) globalThis.clearTimeout(existing);
  const timer = globalThis.setTimeout(() => {
    pageSnapshotTimers.delete(tab.id!);
    void capturePageSnapshotForTab(tab).catch(() => undefined);
  }, delay) as unknown as number;
  pageSnapshotTimers.set(tab.id, timer);
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
      const mutation = await snapshotNodeMutation({
        nodeId: existing.id,
        kind: "restore_update",
        label: `更新书签“${existing.title || existing.url}”`
      });
      const updated = await runProtectedBookmarkMutation({
        label: mutation.label,
        destructive: false,
        mutation,
        perform: async () => {
          const target = bookmarkTarget(folderId, input.capture.url);
          internalBookmarkIds.add(existing.id);
          internalBookmarkTargets.add(target);
          try {
            const result = await chrome.bookmarks.update(existing.id, {
              title: input.title
            });
            releaseInternalBookmarkWrite(existing.id, target);
            return result;
          } catch (error) {
            internalBookmarkIds.delete(existing.id);
            internalBookmarkTargets.delete(target);
            throw error;
          }
        }
      });
      return {
        bookmark: updated,
        created: false
      };
    }
    return { bookmark: existing, created: false };
  }

  const mutation = await snapshotCreatedMutation({
    parentId: folderId,
    label: `收藏“${input.title}”`,
    title: input.title,
    url: input.capture.url
  });
  const created = await runProtectedBookmarkMutation({
    label: mutation.label,
    destructive: false,
    mutation,
    perform: async () => {
      const target = bookmarkTarget(folderId, input.capture.url);
      internalBookmarkTargets.add(target);
      try {
        const result = await chrome.bookmarks.create({
          parentId: folderId,
          title: input.title,
          url: input.capture.url
        });
        internalBookmarkIds.add(result.id);
        releaseInternalBookmarkWrite(result.id, target);
        return result;
      } catch (error) {
        internalBookmarkTargets.delete(target);
        throw error;
      }
    },
    createdNodeId: (node) => node.id
  });
  return {
    bookmark: created,
    created: true
  };
}

async function tryImmediateSync(
  item: OutboxItem
): Promise<ResourceRecord> {
  const auth = await getAuthState();
  if (!auth.configured || !auth.signedIn || auth.accountMatches !== true) {
    return item.resource;
  }

  try {
    const synced = await syncOneResource(item.resource, item.content);
    await completeOutboxItem(item);
    return synced;
  } catch (error) {
    await deferOutboxItem(item, errorMessage(error));
    return (
      (await getLocalResource(item.resource.resourceKey)) || item.resource
    );
  }
}

async function syncPendingIfReady(): Promise<void> {
  const auth = await getAuthState();
  if (
    auth.configured &&
    auth.signedIn &&
    auth.accountMatches === true
  ) {
    const local = await getLocalResources();
    for (const resource of local) {
      if (
        resource.syncStatus !== "local" ||
        !resource.nativeBookmarkIds.length
      ) {
        continue;
      }
      const pending = {
        ...resource,
        syncStatus: "pending" as const
      };
      await upsertLocalResource(pending);
      await enqueueOutbox(pending, "");
    }
    await drainOutbox();
  }
}

async function saveBookmark(
  input: SaveBookmarkInput
): Promise<SaveBookmarkResult> {
  const auth = await getAuthState();
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

  let resource: ResourceRecord = {
    resourceKey,
    canonicalUrl,
    url: input.capture.url,
    title: input.title.trim() || input.capture.title,
    userNote: input.userNote.trim(),
    summary: existing?.summary || "",
    tags: existing?.tags || [],
    tagsSource: existing?.tagsSource,
    topics: existing?.topics || [],
    aliases: existing?.aliases,
    contentExcerpt: input.capture.excerpt,
    contentHash,
    selectedText: input.capture.selectedText,
    author: input.capture.author,
    siteName: input.capture.siteName,
    language: input.capture.language,
    imageUrl: input.capture.imageUrl,
    ...(existing?.thumbnailDataUrl
      ? { thumbnailDataUrl: existing.thumbnailDataUrl }
      : {}),
    coverSource: existing?.coverSource,
    coverUpdatedAt: existing?.coverUpdatedAt,
    categoryCoverId: existing?.categoryCoverId,
    snapshotAt: existing?.snapshotAt,
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
    syncStatus: auth.configured ? "pending" : "local",
    createdAt: existing?.createdAt || timestamp,
    updatedAt: timestamp,
    lastSyncedAt: existing?.lastSyncedAt
  };

  let aiWarning: string | undefined;
  const needsAi =
    input.requestAi &&
    !(existing?.aiStatus === "ready" && !contentChanged);
  if (needsAi) {
    const aiSettings = await getAiRuntimeSettings();
    if (aiSettings.apiKey) {
      try {
        resource = await enrichResourceLocally(resource, input.capture);
      } catch (error) {
        aiWarning = errorMessage(error);
        resource = {
          ...resource,
          aiStatus: "failed",
          updatedAt: now()
        };
      }
    } else {
      aiWarning = `书签已保存。请先在设置中填写 ${aiSettings.provider === "gemini" ? "Gemini" : aiSettings.provider === "openai" ? "OpenAI" : "DeepSeek"} API Key，再生成摘要与标签。`;
      resource = {
        ...resource,
        aiStatus: "unavailable",
        updatedAt: now()
      };
    }
  }

  resource = {
    ...resource,
    categoryCoverId: categoryCoverForResource(resource)
  };
  await upsertLocalResource(resource);
  void activeTab()
    .then((tab) => {
      if (tab?.url && canonicalizeUrl(tab.url) === canonicalUrl) {
        schedulePageSnapshotForTab(tab, 0);
      }
    })
    .catch(() => undefined);
  let synced = resource;
  if (auth.configured) {
    const queued = await enqueueOutbox(
      resource,
      input.requestAi && resource.aiStatus === "pending"
        ? input.capture.content
        : ""
    );
    synced = await tryImmediateSync(queued);
  }

  return {
    resource: synced,
    nativeBookmarkCreated: created,
    cloudSyncAttempted: synced.syncStatus === "synced",
    aiWarning
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
      title: "打开 Aarre",
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

async function readLimitedText(
  response: Response,
  maxBytes = MAX_SCAN_HTML_BYTES
): Promise<string> {
  if (!response.body) {
    return (await response.text()).slice(0, maxBytes);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let result = "";
  try {
    while (size < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = maxBytes - size;
      const chunk = value.byteLength > remaining
        ? value.slice(0, remaining)
        : value;
      size += chunk.byteLength;
      result += decoder.decode(chunk, { stream: true });
      if (chunk.byteLength < value.byteLength) break;
    }
    result += decoder.decode();
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return result;
}

async function pageEssenceForResource(resource: ResourceRecord) {
  try {
    const response = await fetch(resource.url, {
      credentials: "omit",
      redirect: "follow",
      headers: {
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.2"
      },
      signal: AbortSignal.timeout(15_000)
    });
    const contentType = response.headers.get("content-type") || "";
    if (
      !response.ok ||
      (!contentType.includes("text/html") &&
        !contentType.includes("application/xhtml+xml"))
    ) {
      return extractPageEssenceFromHtml("", resource.url);
    }
    return extractPageEssenceFromHtml(
      await readLimitedText(response),
      response.url || resource.url
    );
  } catch {
    // 登录墙、失效链接或网络失败时，仍允许 AI 基于名称、URL 和文件夹做保守补全。
    return extractPageEssenceFromHtml("", resource.url);
  }
}

function iconSize(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const sizes = [...value.matchAll(/(\d+)\s*x\s*(\d+)/gi)]
    .map((match) => Math.min(Number(match[1]), Number(match[2])))
    .filter((size) => Number.isFinite(size) && size > 0);
  return sizes.length ? Math.max(...sizes) : undefined;
}

async function manifestIconCandidates(
  manifestUrl: string
): Promise<SiteIconCandidate[]> {
  if (!manifestUrl) return [];
  try {
    const response = await fetch(manifestUrl, {
      credentials: "omit",
      redirect: "follow",
      headers: { Accept: "application/manifest+json,application/json" },
      signal: AbortSignal.timeout(8_000)
    });
    if (!response.ok) return [];
    const manifest = JSON.parse(
      await readLimitedText(response, 256 * 1024)
    ) as {
      icons?: Array<{
        src?: unknown;
        sizes?: unknown;
        type?: unknown;
      }>;
    };
    if (!Array.isArray(manifest.icons)) return [];
    return manifest.icons
      .flatMap((icon): SiteIconCandidate[] => {
        if (typeof icon.src !== "string" || !icon.src.trim()) return [];
        try {
          const url = new URL(icon.src, response.url || manifestUrl).toString();
          const vector =
            icon.type === "image/svg+xml" || /\.svg(?:[?#]|$)/i.test(url);
          const declaredSize = iconSize(icon.sizes);
          return [
            {
              url,
              source: "manifest",
              ...(declaredSize ? { declaredSize } : {}),
              ...(vector ? { vector: true } : {})
            }
          ];
        } catch {
          return [];
        }
      })
      .sort(
        (left, right) =>
          (right.declaredSize || 0) - (left.declaredSize || 0)
      );
  } catch {
    return [];
  }
}

async function conventionalIconCandidates(
  pageUrl: string
): Promise<SiteIconCandidate[]> {
  try {
    const origin = new URL(pageUrl).origin;
    const paths = [
      "/apple-touch-icon-180x180.png",
      "/apple-touch-icon.png",
      "/apple-touch-icon-precomposed.png",
      "/apple-touch-icon-152x152.png"
    ];
    for (const path of paths) {
      const url = new URL(path, origin).toString();
      try {
        const response = await fetch(url, {
          method: "HEAD",
          credentials: "omit",
          redirect: "follow",
          signal: AbortSignal.timeout(5_000)
        });
        if (response.ok) {
          return [
            {
              url,
              source: "conventional-apple-touch-icon",
              declaredSize: path.includes("152") ? 152 : 180
            }
          ];
        }
      } catch {
        // Continue to the next conventional path.
      }
    }
    const svgUrl = new URL("/favicon.svg", origin).toString();
    try {
      const response = await fetch(svgUrl, {
        method: "HEAD",
        credentials: "omit",
        redirect: "follow",
        signal: AbortSignal.timeout(5_000)
      });
      if (response.ok) {
        return [
          {
            url: svgUrl,
            source: "svg-icon",
            vector: true
          }
        ];
      }
    } catch {
      // No conventional SVG icon.
    }
  } catch {
    // Invalid URLs are filtered before this function.
  }
  return [];
}

function uniqueIconCandidates(
  candidates: SiteIconCandidate[]
): SiteIconCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    if (!candidate.url || seen.has(candidate.url)) return false;
    seen.add(candidate.url);
    return true;
  });
}

async function scanSiteBrand(
  resource: ResourceRecord,
  essence: ReturnType<typeof extractPageEssenceFromHtml>,
  force: boolean
): Promise<SiteBrandRecord | undefined> {
  const pageUrl = new URL(resource.url);
  const host = pageUrl.hostname.toLocaleLowerCase();
  const existing = await getSiteBrand(host);
  const cacheFresh =
    existing &&
    Date.now() - Date.parse(existing.updatedAt) <
      30 * 24 * 60 * 60 * 1_000;
  if (cacheFresh && !force) return existing;

  const rule = matchCoverRule(resource.url);
  const registryAsset = resolveRuleAsset(resource.url, "brandAsset");
  const apple = essence.siteIconCandidates.filter(
    (candidate) => candidate.source === "apple-touch-icon"
  );
  const declaredSvg = essence.siteIconCandidates.filter(
    (candidate) => candidate.source === "svg-icon"
  );
  const largeBitmap = essence.siteIconCandidates.filter(
    (candidate) => candidate.source === "large-icon"
  );
  const tile = essence.siteIconCandidates.filter(
    (candidate) => candidate.source === "msapplication-tile"
  );
  const candidates = uniqueIconCandidates([
    ...(registryAsset
      ? [{ url: registryAsset, source: "registry" as const }]
      : []),
    ...apple,
    ...(await conventionalIconCandidates(resource.url)),
    ...(await manifestIconCandidates(essence.manifestUrl)),
    ...declaredSvg,
    ...largeBitmap,
    ...tile
  ]);
  let result = await cacheSiteBrandIcon(candidates);

  const baseHost = registrableHost(host);
  if (!result.iconDataUrl && baseHost && baseHost !== host) {
    const base = await getSiteBrand(baseHost);
    if (base?.iconDataUrl && !force) {
      const aliased = { ...base, host, updatedAt: now() };
      await putSiteBrand(aliased);
      return aliased;
    }
    const baseUrl = `${pageUrl.protocol}//${baseHost}/`;
    result = await cacheSiteBrandIcon(
      await conventionalIconCandidates(baseUrl)
    );
    const baseRecord: SiteBrandRecord = {
      host: baseHost,
      ...result,
      ...(rule?.skipPageImage ? { skipPageImage: true } : {}),
      updatedAt: now()
    };
    await putSiteBrand(baseRecord);
    if (result.iconDataUrl) {
      const aliased = { ...baseRecord, host, updatedAt: now() };
      await putSiteBrand(aliased);
      return aliased;
    }
  }

  const record: SiteBrandRecord = {
    host,
    ...result,
    ...(rule?.skipPageImage ? { skipPageImage: true } : {}),
    updatedAt: now()
  };
  await putSiteBrand(record);
  return record;
}

async function registerPageImageSample(
  resource: ResourceRecord,
  imageUrl: string
): Promise<boolean> {
  if (!imageUrl) return false;
  const host = new URL(resource.url).hostname.toLocaleLowerCase();
  const existing = await getSiteBrand(host);
  const sampleResult = recordPageImageSample(
    existing?.pageImageSamples || {},
    imageUrl,
    resource.resourceKey
  );
  await putSiteBrand({
    ...(existing || {}),
    host,
    pageImageSamples: sampleResult.samples,
    ...(sampleResult.isCommonBanner ? { skipPageImage: true } : {}),
    updatedAt: now()
  });
  if (!sampleResult.isCommonBanner) return false;

  const resources = await getLocalResources();
  for (const item of resources) {
    let sameHost = false;
    try {
      sameHost =
        new URL(item.url).hostname.toLocaleLowerCase() === host;
    } catch {
      sameHost = false;
    }
    if (!sameHost || item.imageUrl !== imageUrl) continue;
    const { thumbnailDataUrl: _removed, ...withoutThumbnail } = item;
    await upsertLocalResource({
      ...withoutThumbnail,
      imageUrl: "",
      coverSource: "category:common-banner",
      coverUpdatedAt: now()
    });
  }
  return true;
}

async function scheduleLibraryScan(): Promise<void> {
  await chrome.alarms.create(LIBRARY_SCAN_ALARM, {
    delayInMinutes: 0.1,
    periodInMinutes: 0.5
  });
}

function needsRepresentativeImageRefresh(
  resource: ResourceRecord
): boolean {
  if (!resource.thumbnailDataUrl) {
    return !resource.coverSource;
  }
  try {
    const pageUrl = new URL(resource.url);
    const pathParts = pageUrl.pathname.split("/").filter(Boolean);
    const reservedGitHubPaths = new Set([
      "about",
      "apps",
      "collections",
      "codespaces",
      "enterprise",
      "events",
      "explore",
      "features",
      "issues",
      "login",
      "marketplace",
      "new",
      "notifications",
      "orgs",
      "organizations",
      "pricing",
      "search",
      "settings",
      "signup",
      "site",
      "sponsors",
      "topics",
      "users"
    ]);
    const isGitHubRepository =
      (pageUrl.hostname === "github.com" ||
        pageUrl.hostname === "www.github.com") &&
      pathParts.length >= 2 &&
      !reservedGitHubPaths.has(pathParts[0]?.toLowerCase() || "");
    return (
      isGitHubRepository &&
      !resource.imageUrl.includes("opengraph.githubassets.com/")
    );
  } catch {
    return false;
  }
}

function needsLinkHealthRefresh(
  resource: ResourceRecord,
  referenceTime = Date.now()
): boolean {
  if (!resource.linkHealth?.checkedAt) return true;
  const checkedAt = Date.parse(resource.linkHealth.checkedAt);
  return (
    !Number.isFinite(checkedAt) ||
    referenceTime - checkedAt >= LINK_HEALTH_REFRESH_MS
  );
}

async function libraryScanCandidates(force = false) {
  const runtime = await getAiRuntimeSettings();
  const hasAi = Boolean(runtime.apiKey);
  await importNativeBookmarks();
  const resources = interleaveResourcesByHost(
    (await getLocalResources()).filter(
      (resource) =>
        resource.nativeBookmarkIds.length > 0 &&
        (force ||
          needsLinkHealthRefresh(resource) ||
          !resource.coverSource ||
          (hasAi &&
            (resource.aiStatus !== "ready" ||
              !resource.summary.trim() ||
              !resource.tags.length ||
              !resource.aliases?.length)) ||
          needsRepresentativeImageRefresh(resource))
    )
  );
  const aiResourceCount = resources.filter(
    (resource) =>
      hasAi &&
      (force ||
        resource.aiStatus !== "ready" ||
        !resource.summary.trim() ||
        !resource.tags.length ||
        !resource.aliases?.length)
  ).length;
  return { runtime, resources, aiResourceCount };
}

async function getLibraryScanEstimate(
  force = false
): Promise<LibraryScanEstimate> {
  const { runtime, resources, aiResourceCount } =
    await libraryScanCandidates(force);
  const estimate = estimateScanCost(
    aiResourceCount,
    runtime.provider,
    runtime.model,
    LIBRARY_SCAN_CONCURRENCY
  );
  const networkMinutes = resources.length
    ? Math.max(
        1,
        Math.ceil(
          (resources.length * 4) /
            (60 * LIBRARY_SCAN_CONCURRENCY)
        )
      )
    : 0;
  const priceAvailable = estimate.estimatedCostCny !== null;
  return {
    total: resources.length,
    aiResourceCount,
    concurrency: LIBRARY_SCAN_CONCURRENCY,
    estimatedMinutes: Math.max(
      networkMinutes,
      estimate.estimatedMinutes
    ),
    ...(priceAvailable
      ? { estimatedCostCny: estimate.estimatedCostCny! }
      : {}),
    pricingUpdatedAt: estimate.pricingUpdatedAt,
    providerName: getAiProviderPreset(runtime.provider).name,
    model: runtime.model,
    priceAvailable
  };
}

async function startLibraryScan(force = false): Promise<LibraryScanStatus> {
  const { runtime, resources, aiResourceCount } =
    await libraryScanCandidates(force);
  const estimate = estimateScanCost(
    aiResourceCount,
    runtime.provider,
    runtime.model,
    LIBRARY_SCAN_CONCURRENCY
  );
  const timestamp = now();
  const job: StoredLibraryScanJob = {
    id: crypto.randomUUID(),
    state: resources.length ? "running" : "completed",
    total: resources.length,
    processed: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    currentTitle: "",
    startedAt: timestamp,
    updatedAt: timestamp,
    completedAt: resources.length ? undefined : timestamp,
    errors: [],
    resourceKeys: resources.map((resource) => resource.resourceKey),
    nextIndex: 0,
    force,
    concurrency: LIBRARY_SCAN_CONCURRENCY,
    estimatedMinutes: estimate.estimatedMinutes,
    ...(estimate.estimatedCostCny !== null
      ? { estimatedCostCny: estimate.estimatedCostCny }
      : {}),
    actualInputTokens: 0,
    actualOutputTokens: 0,
    actualCachedInputTokens: 0,
    actualCostCny: 0,
    pricingUpdatedAt: estimate.pricingUpdatedAt,
    provider: runtime.provider,
    providerName: getAiProviderPreset(runtime.provider).name,
    model: runtime.model,
    actualUsageEstimated: false,
    usageRecorded: false
  };
  await setStoredLibraryScan(job);
  if (resources.length) {
    await scheduleLibraryScan();
    void runLibraryScan();
  }
  return publicLibraryScan(job);
}

async function updateLibraryScanState(
  state: "paused" | "running" | "cancelled"
): Promise<LibraryScanStatus> {
  const job = await getStoredLibraryScan();
  if (!job.id) {
    throw new Error("当前没有全目录扫描任务。");
  }
  if (
    state === "running" &&
    !["paused", "failed"].includes(job.state)
  ) {
    return publicLibraryScan(job);
  }
  if (
    state !== "running" &&
    !["running", "paused"].includes(job.state)
  ) {
    return publicLibraryScan(job);
  }
  const timestamp = now();
  const next: StoredLibraryScanJob = {
    ...job,
    state,
    currentTitle: state === "running" ? job.currentTitle : "",
    updatedAt: timestamp,
    completedAt: state === "cancelled" ? timestamp : job.completedAt
  };
  await setStoredLibraryScan(next);
  if (state === "running") {
    await scheduleLibraryScan();
    void runLibraryScan();
  } else if (state === "cancelled") {
    await chrome.alarms.clear(LIBRARY_SCAN_ALARM);
  }
  return publicLibraryScan(next);
}

interface ScanResourceResult {
  resource: ResourceRecord;
  outcome: "succeeded" | "failed" | "skipped";
  message?: string;
  usage?: AiTokenUsage;
}

function removedResourcePlaceholder(resourceKey: string): ResourceRecord {
  return {
    resourceKey,
    canonicalUrl: "",
    url: "",
    title: "已移除的书签",
    userNote: "",
    summary: "",
    tags: [],
    topics: [],
    contentExcerpt: "",
    contentHash: "",
    selectedText: "",
    author: "",
    siteName: "",
    language: "",
    imageUrl: "",
    faviconUrl: "",
    nativeBookmarkIds: [],
    nativeFolderPath: [],
    aiStatus: "not_requested",
    syncStatus: "local",
    createdAt: now(),
    updatedAt: now()
  };
}

async function scanOneLibraryResource(
  resource: ResourceRecord,
  job: StoredLibraryScanJob
): Promise<ScanResourceResult> {
  if (isInternalOrSensitiveUrl(resource.url)) {
    return {
      resource,
      outcome: "skipped",
      message: "内部或受保护网址不会发起网络请求。"
    };
  }
  const runtime = await getAiRuntimeSettings();
  const needsAi =
    Boolean(runtime.apiKey) &&
    (job.force ||
      resource.aiStatus !== "ready" ||
      !resource.summary.trim() ||
      !resource.tags.length ||
      !resource.aliases?.length);
  let scannedResource: ResourceRecord = {
    ...resource,
    aiStatus: needsAi ? "processing" : resource.aiStatus,
    updatedAt: now()
  };
  await upsertLocalResource(scannedResource);
  try {
    const linkHealth = await checkLinkHealth(
      resource.url,
      resource.linkHealth
    );
    scannedResource = {
      ...scannedResource,
      linkHealth,
      updatedAt: now()
    };
    await upsertLocalResource(scannedResource);
    if (
      ["dead", "soft_404", "login_required", "temporary"].includes(
        linkHealth.status
      )
    ) {
      scannedResource = {
        ...scannedResource,
        aiStatus: resource.aiStatus,
        updatedAt: now()
      };
      await upsertLocalResource(scannedResource);
      return { resource: scannedResource, outcome: "succeeded" };
    }

    const essence = await pageEssenceForResource(resource);
    const siteBrand = await scanSiteBrand(resource, essence, job.force);
    const coverRule = matchCoverRule(resource.url);
    const registryPageImage = resolveRuleAsset(
      resource.url,
      "pageImage"
    );
    let thumbnailDataUrl = resource.thumbnailDataUrl || "";
    let representativeImageUrl =
      coverRule?.skipPageImage || siteBrand?.skipPageImage
        ? ""
        : registryPageImage || essence.imageUrl || resource.imageUrl;
    const commonPageImage =
      representativeImageUrl &&
      !registryPageImage &&
      (await registerPageImageSample(resource, representativeImageUrl));
    if (commonPageImage) representativeImageUrl = "";
    const coverSource = commonPageImage
      ? "category:common-banner"
      : coverRule?.skipPageImage || siteBrand?.skipPageImage
        ? `category:${coverRule?.id || "common-banner"}`
        : registryPageImage
          ? `registry:${coverRule?.id || "page-image"}`
          : representativeImageUrl
            ? "page-metadata"
            : "category";
    if (
      representativeImageUrl &&
      (!thumbnailDataUrl ||
        resource.imageUrl !== representativeImageUrl ||
        job.force)
    ) {
      try {
        thumbnailDataUrl = await cacheRepresentativeImage(
          representativeImageUrl
        );
      } catch {
        // 原图仍作为备用；个别站点防盗链不应让整条扫描失败。
      }
    }
    scannedResource = {
      ...scannedResource,
      imageUrl: representativeImageUrl,
      faviconUrl: essence.faviconUrl || resource.faviconUrl,
      coverSource,
      coverUpdatedAt: now(),
      ...(thumbnailDataUrl ? { thumbnailDataUrl } : {})
    };
    await upsertLocalResource(scannedResource);

    const enrichment = needsAi
      ? await enrichResourceFromEssenceWithUsage(scannedResource, essence)
      : null;
    const enriched = enrichment?.resource || scannedResource;
    const auth = await getAuthState();
    const nextResource: ResourceRecord = {
      ...enriched,
      categoryCoverId: categoryCoverForResource(enriched),
      syncStatus: auth.configured ? "pending" : enriched.syncStatus
    };
    await upsertLocalResource(nextResource);
    if (auth.configured) {
      await enqueueOutbox(nextResource, nextResource.contentExcerpt);
      void syncPendingIfReady();
    }
    return {
      resource: nextResource,
      outcome: "succeeded",
      ...(enrichment ? { usage: enrichment.usage } : {})
    };
  } catch (error) {
    await upsertLocalResource({
      ...scannedResource,
      aiStatus: needsAi ? "failed" : scannedResource.aiStatus,
      updatedAt: now()
    });
    return {
      resource,
      outcome: "failed",
      message: errorMessage(error)
    };
  }
}

async function recordScanBatchResults(
  results: ScanResourceResult[]
): Promise<StoredLibraryScanJob> {
  const job = await getStoredLibraryScan();
  const timestamp = now();
  const usage = results.reduce<AiTokenUsage>(
    (total, result) => ({
      inputTokens: total.inputTokens + (result.usage?.inputTokens || 0),
      outputTokens: total.outputTokens + (result.usage?.outputTokens || 0),
      cachedInputTokens:
        total.cachedInputTokens +
        (result.usage?.cachedInputTokens || 0),
      estimated: total.estimated || Boolean(result.usage?.estimated)
    }),
    {
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      estimated: false
    }
  );
  const batchCost =
    job.provider && job.model
      ? costCnyForUsage(job.provider, job.model, usage) || 0
      : 0;
  const nextIndex = Math.min(
    job.resourceKeys.length,
    job.nextIndex + results.length
  );
  const next: StoredLibraryScanJob = {
    ...job,
    nextIndex,
    processed: job.processed + results.length,
    succeeded:
      job.succeeded +
      results.filter((result) => result.outcome === "succeeded").length,
    failed:
      job.failed +
      results.filter((result) => result.outcome === "failed").length,
    skipped:
      job.skipped +
      results.filter((result) => result.outcome === "skipped").length,
    actualInputTokens: (job.actualInputTokens || 0) + usage.inputTokens,
    actualOutputTokens:
      (job.actualOutputTokens || 0) + usage.outputTokens,
    actualCachedInputTokens:
      (job.actualCachedInputTokens || 0) + usage.cachedInputTokens,
    actualCostCny: Number(
      ((job.actualCostCny || 0) + batchCost).toFixed(4)
    ),
    actualUsageEstimated:
      job.actualUsageEstimated || usage.estimated,
    currentTitle: "",
    updatedAt: timestamp,
    errors: [
      ...job.errors,
      ...results.flatMap((result) =>
        result.message && result.outcome !== "succeeded"
          ? [
              {
                resourceKey: result.resource.resourceKey,
                title: result.resource.title,
                message: result.message
              }
            ]
          : []
      )
    ].slice(-20)
  };
  if (nextIndex >= next.resourceKeys.length && next.state !== "cancelled") {
    next.state = "completed";
    next.completedAt = timestamp;
  }
  await setStoredLibraryScan(next);
  return next;
}

async function finalizeLibraryScanUsage(
  job: StoredLibraryScanJob
): Promise<StoredLibraryScanJob> {
  const totalTokens =
    (job.actualInputTokens || 0) + (job.actualOutputTokens || 0);
  if (
    job.usageRecorded ||
    !job.provider ||
    !job.model ||
    totalTokens === 0
  ) {
    return job;
  }
  await addScanAiUsage(job.provider, job.model, {
    inputTokens: job.actualInputTokens || 0,
    outputTokens: job.actualOutputTokens || 0,
    cachedInputTokens: job.actualCachedInputTokens || 0,
    estimated: Boolean(job.actualUsageEstimated)
  });
  const next = { ...job, usageRecorded: true, updatedAt: now() };
  await setStoredLibraryScan(next);
  return next;
}

async function runLibraryScan(): Promise<void> {
  if (libraryScanRunning) return;
  libraryScanRunning = true;
  try {
    while (true) {
      let job = await getStoredLibraryScan();
      if (job.state !== "running") break;
      if (job.nextIndex >= job.resourceKeys.length) {
        job = {
          ...job,
          state: "completed",
          currentTitle: "",
          completedAt: now(),
          updatedAt: now()
        };
        await setStoredLibraryScan(job);
        await finalizeLibraryScanUsage(job).catch(() => job);
        break;
      }

      const keys = job.resourceKeys.slice(
        job.nextIndex,
        job.nextIndex + LIBRARY_SCAN_CONCURRENCY
      );
      const resources = await Promise.all(
        keys.map((resourceKey) => getLocalResource(resourceKey))
      );
      job = {
        ...job,
        currentTitle:
          keys.length === 1
            ? resources[0]?.title || "检查书签"
            : `并行处理 ${keys.length} 条收藏`,
        updatedAt: now()
      };
      await setStoredLibraryScan(job);
      const results = await Promise.all(
        keys.map(async (resourceKey, index): Promise<ScanResourceResult> => {
          const resource = resources[index];
          if (!resource || !resource.nativeBookmarkIds.length) {
            return {
              resource: removedResourcePlaceholder(resourceKey),
              outcome: "skipped",
              message: "书签已被移除。"
            };
          }
          return libraryScanRateLimiter.run(resource.url, () =>
            scanOneLibraryResource(resource, job)
          );
        })
      );
      job = await recordScanBatchResults(results);
      if (job.state === "completed") {
        await finalizeLibraryScanUsage(job).catch(() => job);
        break;
      }
    }
  } catch (error) {
    const job = await getStoredLibraryScan();
    await setStoredLibraryScan({
      ...job,
      state: "failed",
      currentTitle: "",
      updatedAt: now(),
      errors: [
        ...job.errors,
        {
          resourceKey: "",
          title: "扫描任务",
          message: errorMessage(error)
        }
      ].slice(-20)
    });
  } finally {
    libraryScanRunning = false;
    const job = await getStoredLibraryScan();
    if (job.state !== "running") {
      await chrome.alarms.clear(LIBRARY_SCAN_ALARM);
    }
  }
}

async function getAppState(): Promise<AppState> {
  const [auth, tab, resources, outbox, scan] = await Promise.all([
    getAuthState(),
    getActiveTabSummary(),
    getLocalResources(),
    getOutbox(),
    getStoredLibraryScan()
  ]);
  const linkedResources = resources.filter(
    (resource) => resource.nativeBookmarkIds.length > 0
  );

  return {
    auth,
    activeTab: tab,
    localResourceCount: linkedResources.length,
    aiReadyResourceCount: linkedResources.filter(
      (resource) =>
        resource.aiStatus === "ready" &&
        Boolean(resource.summary) &&
        resource.tags.length > 0
    ).length,
    pendingSyncCount: auth.configured ? outbox.length : 0,
    libraryScan: publicLibraryScan(scan)
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
  const auth = await getAuthState();
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
      tagsSource: existing?.tagsSource,
      topics: existing?.topics || [],
      aliases: existing?.aliases,
      contentExcerpt: existing?.contentExcerpt || "",
      contentHash: existing?.contentHash || "",
      selectedText: existing?.selectedText || "",
      author: existing?.author || "",
      siteName:
        existing?.siteName || new URL(primary.node.url!).hostname,
      language: existing?.language || "",
      imageUrl: existing?.imageUrl || "",
      ...(existing?.thumbnailDataUrl
        ? { thumbnailDataUrl: existing.thumbnailDataUrl }
        : {}),
      coverSource: existing?.coverSource,
      coverUpdatedAt: existing?.coverUpdatedAt,
      categoryCoverId:
        existing?.categoryCoverId ||
        categoryCoverForResource({
          url: primary.node.url!,
          title:
            primary.node.title || new URL(primary.node.url!).hostname,
          topics: existing?.topics || [],
          tags: existing?.tags || [],
          summary: existing?.summary || ""
        }),
      snapshotAt: existing?.snapshotAt,
      faviconUrl: existing?.faviconUrl || "",
      nativeBookmarkIds,
      nativeFolderPath: primary.path,
      aiStatus: existing?.aiStatus || "not_requested",
      syncStatus: baseChanged
        ? auth.configured
          ? "pending"
          : "local"
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
    if (baseChanged && auth.configured) {
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
    if (result.attempted === 0) break;
  }

  return { synced, failed };
}

async function getResources(query = "") {
  await importNativeBookmarks();
  void syncPendingIfReady();
  const local = await getLocalResources();
  const linked = local.filter((item) => item.nativeBookmarkIds.length > 0);
  if (!query.trim()) {
    return linked;
  }

  return searchLocalResources(linked, query);
}

function buildBookmarkAgentCatalog(
  tree: chrome.bookmarks.BookmarkTreeNode[]
): BookmarkAgentCatalog {
  const catalog: BookmarkAgentCatalog = {
    bookmarks: [],
    folders: []
  };

  function visit(
    node: chrome.bookmarks.BookmarkTreeNode,
    parentPath: string[]
  ) {
    if (node.url) {
      catalog.bookmarks.push({
        id: node.id,
        parentId: node.parentId || "",
        title: node.title || node.url,
        url: node.url,
        path: parentPath,
        writable: node.unmodifiable !== "managed",
        ...(typeof node.dateAdded === "number"
          ? { dateAdded: node.dateAdded }
          : {}),
        ...(typeof node.dateLastUsed === "number"
          ? { dateLastUsed: node.dateLastUsed }
          : {})
      });
      return;
    }

    const isBrowserRoot = node.id === "0";
    const path = isBrowserRoot
      ? parentPath
      : [...parentPath, node.title || "未命名文件夹"];
    if (!isBrowserRoot) {
      catalog.folders.push({
        id: node.id,
        parentId: node.parentId,
        title: node.title || "未命名文件夹",
        path,
        writable: node.unmodifiable !== "managed"
      });
    }
    for (const child of node.children || []) {
      visit(child, path);
    }
  }

  for (const root of tree) {
    visit(root, []);
  }
  return catalog;
}

async function getLibraryInsights() {
  await importNativeBookmarks();
  const [resources, tree] = await Promise.all([
    getLocalResources(),
    chrome.bookmarks.getTree()
  ]);
  return buildLibraryInsights(
    resources.filter((resource) => resource.nativeBookmarkIds.length > 0),
    buildBookmarkAgentCatalog(tree)
  );
}

async function getFolderSuggestions(
  capture: import("../lib/types").PageCapture
) {
  await importNativeBookmarks();
  const [resources, folders] = await Promise.all([
    getLocalResources(),
    getFolderOptions()
  ]);
  return suggestFolders(
    capture,
    resources.filter((resource) => resource.nativeBookmarkIds.length > 0),
    folders
  );
}

async function askAgent(
  query: string,
  history: import("../lib/types").BookmarkAgentTurn[] = []
) {
  await importNativeBookmarks();
  const [resources, tree] = await Promise.all([
    getLocalResources(),
    chrome.bookmarks.getTree()
  ]);
  return askBookmarkAgent(
    query,
    resources.filter(
      (resource) => resource.nativeBookmarkIds.length > 0
    ),
    history,
    buildBookmarkAgentCatalog(tree)
  );
}

async function indexNativeBookmark(
  id: string,
  node: chrome.bookmarks.BookmarkTreeNode
) {
  if (!node.url || !isSupportedPageUrl(node.url)) {
    return;
  }

  const resourceKey = await resourceKeyForUrl(node.url);
  const auth = await getAuthState();
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
    tagsSource: existing?.tagsSource,
    topics: existing?.topics || [],
    contentExcerpt: existing?.contentExcerpt || "",
    contentHash: existing?.contentHash || "",
    selectedText: existing?.selectedText || "",
    author: existing?.author || "",
    siteName: existing?.siteName || new URL(node.url).hostname,
    language: existing?.language || "",
    imageUrl: existing?.imageUrl || "",
    ...(existing?.thumbnailDataUrl
      ? { thumbnailDataUrl: existing.thumbnailDataUrl }
      : {}),
    faviconUrl: existing?.faviconUrl || "",
    nativeBookmarkIds: [
      ...new Set([...(existing?.nativeBookmarkIds || []), id])
    ],
    nativeFolderPath: await folderPathForId(node.parentId || ""),
    aiStatus: existing?.aiStatus || "not_requested",
    syncStatus: auth.configured ? "pending" : "local",
    createdAt: existing?.createdAt || timestamp,
    updatedAt: timestamp,
    lastSyncedAt: existing?.lastSyncedAt
  };

  await upsertLocalResource(resource);
  if (auth.configured) {
    await enqueueOutbox(resource, "");
    void syncPendingIfReady();
  }
}

async function handleRequest(request: ExtensionRequest): Promise<unknown> {
  switch (request.type) {
    case "GET_APP_STATE":
      return getAppState();
    case "GET_AI_SETTINGS":
      return getAiSettingsStatus();
    case "SAVE_AI_SETTINGS":
      return saveAiSettings(request.payload);
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
    case "GET_FOLDER_SUGGESTIONS":
      return getFolderSuggestions(request.capture);
    case "SAVE_BOOKMARK":
      return saveBookmark(request.payload);
    case "ASK_BOOKMARK_AGENT":
      return askAgent(request.query, request.history);
    case "EXECUTE_BOOKMARK_AGENT_ACTIONS":
      return executeBookmarkAgentActions(request.actions);
    case "GET_LIBRARY_INSIGHTS":
      return getLibraryInsights();
    case "APPLY_ORGANIZATION_ACTIONS":
      return executeBookmarkAgentActions(request.actions, {
        maxActions: 200,
        label: `整理提案（${request.actions.length} 项）`
      });
    case "GET_UNDO_SNAPSHOTS":
      return getRecentUndoSnapshots();
    case "UNDO_BOOKMARK_BATCH":
      return undoStoredBookmarkBatch(request.batchId);
    case "GET_LOCAL_RESOURCES":
      await importNativeBookmarks();
      return (await getLocalResources()).filter(
        (resource) => resource.nativeBookmarkIds.length > 0
      );
    case "GET_SITE_BRANDS":
      return getSiteBrands();
    case "GET_PAGE_SNAPSHOT":
      return (await getPageSnapshot(request.canonicalUrl)) || null;
    case "GET_AGENT_CONVERSATIONS":
      return getAgentConversations();
    case "SAVE_AGENT_CONVERSATION":
      return saveAgentConversation(request.conversation);
    case "DELETE_AGENT_CONVERSATION":
      await deleteAgentConversation(request.id);
      return { deleted: true };
    case "START_LIBRARY_SCAN":
      return startLibraryScan(Boolean(request.force));
    case "GET_LIBRARY_SCAN_ESTIMATE":
      return getLibraryScanEstimate(Boolean(request.force));
    case "GET_LIBRARY_SCAN":
      return publicLibraryScan(await getStoredLibraryScan());
    case "GET_AI_USAGE":
      return getAiUsageStats();
    case "PAUSE_LIBRARY_SCAN":
      return updateLibraryScanState("paused");
    case "RESUME_LIBRARY_SCAN":
      return updateLibraryScanState("running");
    case "CANCEL_LIBRARY_SCAN":
      return updateLibraryScanState("cancelled");
    case "GET_RESOURCES":
      return getResources(request.query);
    case "SYNC_NOW":
      return syncNow();
    case "IMPORT_NATIVE_BOOKMARKS":
      return importNativeBookmarks();
    case "RESTORE_MISSING_NATIVE_BOOKMARKS":
      return restoreMissingNativeBookmarks();
    case "UPDATE_NATIVE_BOOKMARK":
      return updateNativeBookmark(request.payload);
    case "UPDATE_RESOURCE_TAGS":
      return updateResourceTags(request.payload);
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
    case "OPEN_SIDE_PANEL": {
      const currentWindow = await chrome.windows.getCurrent();
      if (typeof currentWindow.id !== "number") {
        throw new Error("无法确定当前 Chrome 窗口。");
      }
      await chrome.sidePanel.open({ windowId: currentWindow.id });
      return { opened: true };
    }
    case "AUTH_CHANGED":
      try {
        await syncPendingIfReady();
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
  void cleanupExpiredUndoSnapshots();
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
  void importNativeBookmarks()
    .then(() => syncPendingIfReady())
    .catch(() => undefined);
  void getStoredLibraryScan().then((scan) => {
    if (scan.state === "running") {
      void scheduleLibraryScan();
      void runLibraryScan();
    }
  });
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

chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab.active) {
    schedulePageSnapshotForTab(tab);
  }
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  clearPageSnapshotTimers();
  void chrome.tabs
    .get(tabId)
    .then((tab) => {
      if (tab.status === "complete") schedulePageSnapshotForTab(tab);
    })
    .catch(() => undefined);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  const timer = pageSnapshotTimers.get(tabId);
  if (timer !== undefined) globalThis.clearTimeout(timer);
  pageSnapshotTimers.delete(tabId);
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  clearPageSnapshotTimers();
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  void chrome.tabs
    .query({ active: true, windowId })
    .then(([tab]) => {
      if (tab?.status === "complete") schedulePageSnapshotForTab(tab);
    })
    .catch(() => undefined);
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
  void (async () => {
    await cleanupExpiredUndoSnapshots();
    await importNativeBookmarks();
    const auth = await getAuthState();
    if (auth.signedIn && auth.accountMatches === true) {
      // 先提交本地变更，再拉取云端，避免旧云端数据覆盖待同步状态。
      await syncPendingIfReady();
      await pullCloudResources();
    }
    const scan = await getStoredLibraryScan();
    if (scan.state === "running") {
      await scheduleLibraryScan();
      void runLibraryScan();
    }
  })().catch(() => undefined);
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "bookmark-layer-sync") {
    void syncPendingIfReady();
  } else if (alarm.name === LIBRARY_SCAN_ALARM) {
    void runLibraryScan();
  }
});

import { buildLibraryInsights, suggestFolders } from "../../lib/library-insights";
import { buildKnowledgeDashboard, resurfaceForContext } from "../../lib/knowledge-insights";
import { privacySafeAgentLibrary } from "../../lib/agent-privacy";
import { getLocalResources } from "../../lib/storage";
import {
  buildLibraryFingerprint,
  dismissStoredOrganizationInsights,
  mergeStoredOrganizationInsights,
  organizationBadgeText,
  organizationNoticeFromStored,
  sameLibraryFingerprint,
  storedOrganizationInsightsIsCurrent,
  type StoredOrganizationInsights
} from "../../lib/organization-notice";
import type {
  ActiveTabSummary,
  BookmarkAgentCatalog,
  BookmarkAgentTurn,
  ImportResult,
  NativeFolderOption,
  PageCapture,
} from "../../lib/types";
import type { ProtectionPolicy } from "../../lib/protection";

const ORGANIZATION_INSIGHTS_KEY = "aarre:organization-insights";

interface AgentDependencies {
  importNativeBookmarks(): Promise<ImportResult>;
  getActiveTabSummary(): Promise<ActiveTabSummary | null>;
  getFolderOptions(): Promise<NativeFolderOption[]>;
  hostFromUrl(url: string): string;
  getPrivacyProtectionContext(tree?: chrome.bookmarks.BookmarkTreeNode[]): Promise<{ excludedHosts: string[]; policy: ProtectionPolicy }>;
}

export function createAgentHandlers(dependencies: AgentDependencies) {
  const {
    importNativeBookmarks,
    getActiveTabSummary,
    getFolderOptions,
    hostFromUrl,
    getPrivacyProtectionContext
  } = dependencies;
  const activeAgentRuns = new Map<string, AbortController>();
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
  return (await ensureStoredOrganizationInsights()).insights;
}

async function getStoredOrganizationInsights(): Promise<
  StoredOrganizationInsights | null
> {
  const stored = (await chrome.storage.local.get(
    ORGANIZATION_INSIGHTS_KEY
  ))[ORGANIZATION_INSIGHTS_KEY];
  return storedOrganizationInsightsIsCurrent(stored) ? stored : null;
}

async function syncOrganizationBadge(
  tabId?: number
): Promise<void> {
  const stored = await getStoredOrganizationInsights();
  const notice = organizationNoticeFromStored(stored);
  const text = organizationBadgeText(notice?.proposalCount || 0);
  await Promise.all([
    chrome.action.setBadgeBackgroundColor({
      color: "#205aef",
      tabId
    }),
    chrome.action.setBadgeText({ text, tabId }),
    chrome.action.setTitle({
      title: notice
        ? `Aarre：发现 ${notice.proposalCount} 条整理建议`
        : "打开 Aarre",
      tabId
    })
  ]);
}

async function publishStoredOrganizationInsights(
  stored: StoredOrganizationInsights
): Promise<void> {
  await chrome.storage.local.set({
    [ORGANIZATION_INSIGHTS_KEY]: stored
  });
  await syncOrganizationBadge();
  void chrome.runtime
    .sendMessage({ type: "ORGANIZATION_INSIGHTS_UPDATED" })
    .catch(() => undefined);
}

async function ensureStoredOrganizationInsights(
  force = false
): Promise<StoredOrganizationInsights> {
  await importNativeBookmarks();
  const [resources, tree] = await Promise.all([
    getLocalResources(),
    chrome.bookmarks.getTree()
  ]);
  const linkedResources = resources.filter(
    (resource) => resource.nativeBookmarkIds.length > 0
  );
  const catalog = buildBookmarkAgentCatalog(tree);
  const fingerprint = buildLibraryFingerprint(
    linkedResources,
    catalog
  );
  const previous = await getStoredOrganizationInsights();
  if (
    !force &&
    previous &&
    sameLibraryFingerprint(previous.fingerprint, fingerprint)
  ) {
    await syncOrganizationBadge();
    return previous;
  }

  const insights = buildLibraryInsights(linkedResources, catalog);
  const next = mergeStoredOrganizationInsights(
    previous,
    insights,
    fingerprint
  );
  await publishStoredOrganizationInsights(next);
  return next;
}

async function getOrganizationNotice() {
  const stored = await ensureStoredOrganizationInsights();
  return organizationNoticeFromStored(stored);
}

async function dismissOrganizationNotice() {
  const stored = await ensureStoredOrganizationInsights();
  await publishStoredOrganizationInsights(
    dismissStoredOrganizationInsights(stored)
  );
  return { dismissed: true as const };
}

async function getKnowledgeDashboard() {
  await importNativeBookmarks();
  const [resources, tree] = await Promise.all([
    getLocalResources(),
    chrome.bookmarks.getTree()
  ]);
  return buildKnowledgeDashboard(
    resources.filter((resource) => resource.nativeBookmarkIds.length > 0),
    buildBookmarkAgentCatalog(tree)
  );
}

async function getContextResurfacing() {
  const activeTab = await getActiveTabSummary();
  if (!activeTab?.supported) return [];
  await importNativeBookmarks();
  const [resources, tree] = await Promise.all([
    getLocalResources(),
    chrome.bookmarks.getTree()
  ]);
  return resurfaceForContext(
    resources.filter((resource) => resource.nativeBookmarkIds.length > 0),
    buildBookmarkAgentCatalog(tree),
    `${activeTab.title} ${hostFromUrl(activeTab.url)}`
  );
}

async function getFolderSuggestions(
  capture: PageCapture
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
  history: BookmarkAgentTurn[] = [],
  requestId: string,
  onDelta?: (text: string) => void
) {
  const controller = new AbortController();
  activeAgentRuns.set(requestId, controller);
  try {
    await importNativeBookmarks();
    const [resources, tree] = await Promise.all([
      getLocalResources(),
      chrome.bookmarks.getTree()
    ]);
    const linkedResources = resources.filter(
      (resource) => resource.nativeBookmarkIds.length > 0
    );
    const privacyContext = await getPrivacyProtectionContext(tree);
    const safeLibrary = privacySafeAgentLibrary(
      linkedResources,
      buildBookmarkAgentCatalog(tree),
      privacyContext.excludedHosts,
      privacyContext.policy
    );
    const thinking: string[] = [];
    const [{ runAgent }, { configuredAgentProvider }] = await Promise.all([
      import("../../lib/agent/runner"),
      import("../../lib/agent/providers")
    ]);
    void chrome.runtime.sendMessage({
      type: "BOOKMARK_AGENT_PROGRESS",
      requestId,
      stage: "preparing",
      stages: ["preparing", "scanning", "synthesizing"],
      completedStages: [],
      completed: 0,
      total: 12,
      label: "正在准备收藏库"
    }).catch(() => undefined);
    const response = await runAgent({
      query,
      context: {
        resources: safeLibrary.resources,
        catalog: safeLibrary.catalog
      },
      history: history.map((turn) => ({
        role: turn.role,
        content: turn.content.slice(0, 1_500)
      })),
      provider: configuredAgentProvider,
      signal: controller.signal,
      onDelta,
      onProgress: ({ round, calls }) => {
        const label = `正在使用 ${calls.join("、")}`;
        thinking.push(label);
        void chrome.runtime.sendMessage({
          type: "BOOKMARK_AGENT_PROGRESS",
          requestId,
          stage: "scanning",
          stages: ["preparing", "scanning", "synthesizing"],
          completedStages: ["preparing"],
          completed: round,
          total: 12,
          label
        }).catch(() => undefined);
        void chrome.runtime.sendMessage({
          type: "BOOKMARK_AGENT_THINKING",
          requestId,
          steps: thinking.slice(-8)
        }).catch(() => undefined);
      }
    });
    return {
      query: query.trim(),
      answer: response.answer,
      thinking,
      providerName: response.providerName || "",
      sources: [],
      actions: response.plan.actions,
      catalogSize: linkedResources.length,
      examinedCount: linkedResources.length,
      excludedCount: safeLibrary.excludedCount,
      catalogScanComplete: true
    };
  } finally {
    if (activeAgentRuns.get(requestId) === controller) {
      activeAgentRuns.delete(requestId);
    }
  }
}

  function cancelAgent(requestId: string, reason = "AI 请求已停止。"): boolean {
    const controller = activeAgentRuns.get(requestId);
    if (!controller) return false;
    controller.abort(new DOMException(reason, "AbortError"));
    activeAgentRuns.delete(requestId);
    return true;
  }

  function cancelAllAgentRuns(reason: string): void {
    for (const [requestId, controller] of activeAgentRuns) {
      controller.abort(new DOMException(reason, "AbortError"));
      activeAgentRuns.delete(requestId);
    }
  }

  return {
    askAgent,
    cancelAllAgentRuns,
    cancelAgent,
    dismissOrganizationNotice,
    ensureStoredOrganizationInsights,
    getContextResurfacing,
    getFolderSuggestions,
    getKnowledgeDashboard,
    getLibraryInsights,
    getOrganizationNotice,
    syncOrganizationBadge
  };
}

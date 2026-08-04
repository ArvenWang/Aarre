import type {
  AgentConversation,
  AiProviderId,
  AiSettingsStatus,
  AppState,
  BookmarkAgentCatalog,
  BookmarkAgentActionExecutionResult,
  BookmarkAgentActionProposal,
  BookmarkBarSnapshot,
  NativeBookmarkNode,
  NavigationSuggestion,
  ResourceRecord,
  SiteBrandRecord
} from "../../lib/types";
import { askBookmarkAgent } from "../../lib/local-ai";
import { validateAiApiKey } from "../../lib/settings";
import { categoryCoverForResource } from "../../lib/cover-registry";
import { canonicalizeUrl } from "../../lib/url";
import { previewCoverSamples, previewFolders, previewGeneratedCovers } from "./preview-covers";
export const previewEvent = {
  addListener() {},
  removeListener() {}
};

export type PreviewRuntimeListener = (message: unknown) => void;
export const previewRuntimeListeners = new Set<PreviewRuntimeListener>();
export const previewProtectedResourceKeys = new Set<string>();
export const previewProtectedFolderIds = new Set<string>();
export const previewRuntimeMessageEvent = {
  addListener(listener: PreviewRuntimeListener) {
    previewRuntimeListeners.add(listener);
  },
  removeListener(listener: PreviewRuntimeListener) {
    previewRuntimeListeners.delete(listener);
  }
};

export function emitPreviewRuntimeMessage(message: unknown) {
  for (const listener of previewRuntimeListeners) {
    try {
      listener(message);
    } catch {
      // A broken preview listener must not interrupt the provider request.
    }
  }
}
export const previewGeneratedCoverNodes: NativeBookmarkNode[] =
  previewGeneratedCovers.map((sample, index) => ({
    id: `preview-generated-cover-${index}`,
    parentId: "preview-root",
    title: sample.title,
    url: sample.url
  }));

export function previewFolder(
  title: string,
  count: number,
  index: number
): NativeBookmarkNode {
  const id = `preview-folder-${index}`;
  return {
    id,
    parentId: "preview-root",
    title,
    children: Array.from({ length: count }, (_, childIndex) => {
      const coverSample =
        index === 0 ? previewCoverSamples[childIndex] : undefined;
      return {
        id: `${id}-${childIndex}`,
        parentId: id,
        title:
          coverSample?.title ||
          (childIndex === 0
            ? `${title}示例收藏`
            : `${title}收藏 ${childIndex + 1}`),
        url:
          coverSample?.url ||
          `https://example.com/${index}/${childIndex}`
      };
    })
  };
}

export const previewRoot: NativeBookmarkNode = {
  id: "preview-root",
  title: "书签栏",
  folderType: "bookmarks-bar",
  syncing: true,
  children: [
    ...previewGeneratedCoverNodes,
    ...previewFolders.map(([title, count], index) =>
      previewFolder(title, count, index)
    )
  ]
};

export const previewSnapshot: BookmarkBarSnapshot = {
  root: previewRoot,
  roots: [previewRoot],
  primaryRootId: previewRoot.id,
  bookmarkCount: 309,
  folderCount: previewFolders.length,
  syncing: true
};

const previewSignedIn =
  typeof location !== "undefined" &&
  new URLSearchParams(location.search).get("account") === "signed-in";

export const previewState: AppState = {
  auth: previewSignedIn
    ? {
        configured: true,
        signedIn: true,
        accountMatches: true,
        userName: "Arven wang (Nefish)",
        userEmail: "preview@example.com",
        chromeProfileEmail: "preview@example.com"
      }
    : {
        configured: false,
        signedIn: false,
        accountMatches: null
      },
  activeTab: {
    id: 1,
    url: "https://example.com/design-review",
    title: "侧边栏设计评审",
    faviconUrl: "",
    supported: true
  },
  localResourceCount: 309,
  aiReadyResourceCount: 48,
  aiEligibleResourceCount: 297,
  aiPrivacyProtectedCount: 12,
  pendingSyncCount: 0,
  libraryScan: {
    id: "",
    state: "idle",
    total: 0,
    processed: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    currentTitle: "",
    errors: []
  }
};

export const previewGeneratedCoverResources: ResourceRecord[] =
  previewGeneratedCoverNodes.map((node, index) => {
    const sample = previewGeneratedCovers[index];
    const timestamp = "2026-07-30T08:00:00.000Z";
    return {
      resourceKey: `preview-resource-${node.id}`,
      canonicalUrl: sample.url,
      url: sample.url,
      title: sample.title,
      userNote: "",
      summary: `用于评审“${sample.category}”通用缺省封面的真实网页示例。`,
      tags: [sample.category, "缺省封面", "视觉评审"],
      tagsSource: "ai",
      topics: [sample.category],
      aliases: [sample.category, sample.title],
      useCases: [`查找${sample.category}参考资料时打开`],
      contentType: "产品",
      questions: [`有哪些${sample.category}参考资料`],
      entities: [],
      aiSchemaVersion: 2,
      contentExcerpt: "",
      contentHash: "",
      selectedText: "",
      author: "",
      siteName: new URL(sample.url).hostname,
      language: "zh-CN",
      imageUrl: sample.imageUrl,
      categoryCoverId: categoryCoverForResource({
        url: sample.url,
        title: sample.title,
        topics: [sample.category],
        tags: [sample.category],
        summary: ""
      }),
      faviconUrl: "",
      nativeBookmarkIds: [node.id],
      nativeFolderPath: ["书签栏"],
      aiStatus: "ready",
      syncStatus: "local",
      createdAt: timestamp,
      updatedAt: timestamp
    } satisfies ResourceRecord;
  });

export const previewResources: ResourceRecord[] = [
  ...previewGeneratedCoverResources,
  ...(previewRoot.children || []).flatMap((folder) =>
    (folder.children || []).map((node, index) => {
      const ready = index < 2;
      const timestamp = "2026-07-29T08:00:00.000Z";
      const coverSample = previewCoverSamples.find(
        (sample) => sample.url === node.url
      );
      return {
        resourceKey: `preview-resource-${node.id}`,
        canonicalUrl: node.url || "",
        url: node.url || "",
        title: node.title,
        userNote: "",
        summary: ready
          ? `这是一份关于${folder.title}的参考资料，可用于后续方案研究与设计落地。`
          : "",
        tags: ready ? [folder.title, "参考资料", "待实践"] : [],
        tagsSource: ready ? "ai" : undefined,
        topics: ready ? ["知识管理"] : [],
        ...(ready
          ? {
              aliases: [folder.title, node.title],
              useCases: [`查找${folder.title}资料时打开`],
              contentType: "文章",
              questions: [`有哪些${folder.title}资料`],
              entities: [],
              aiSchemaVersion: 2,
            }
          : {}),
        contentExcerpt: "",
        contentHash: "",
        selectedText: "",
        author: "",
        siteName: node.url ? new URL(node.url).hostname : "",
        language: "zh-CN",
        imageUrl: coverSample?.imageUrl || "",
        faviconUrl: "",
        nativeBookmarkIds: [node.id],
        nativeFolderPath: ["书签栏", folder.title],
        aiStatus: ready ? "ready" : "not_requested",
        syncStatus: "local",
        createdAt: timestamp,
        updatedAt: timestamp
      } satisfies ResourceRecord;
    })
  )
];

export function previewBrandDataUrl(foreground: string): string {
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="192" height="192" viewBox="0 0 192 192">',
    `<path fill="${foreground}" d="M48 142 83 50h27l35 92h-27l-7-21H80l-7 21H48Zm40-44h16L96 73l-8 25Z"/>`,
    "</svg>"
  ].join("");
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export function previewSiteBrand(host: string): SiteBrandRecord {
  return {
    host,
    iconDataUrl: previewBrandDataUrl("#18191c"),
    iconDataUrlLight: previewBrandDataUrl("#18191c"),
    iconRenderVersion: 6,
    iconSource: "registry",
    nativeWidth: 192,
    nativeHeight: 192,
    updatedAt: "2026-07-30T08:00:00.000Z"
  };
}

export const previewSiteBrands: SiteBrandRecord[] = [
  previewSiteBrand("anthropic.com"),
  previewSiteBrand("example.com")
];

export const PREVIEW_AI_SETTINGS_KEY = "bookmark-layer:ai-settings";
export const previewAgentRuns = new Map<string, AbortController>();

export const previewMutable = {
  conversations: [] as AgentConversation[],
  organizationNoticeDismissed: false,
  aiSettings: {
    provider: "gemini",
    providerName: "Gemini",
    model: "gemini-2.5-flash-lite",
    apiKeyConfigured: false,
    configuredProviders: [],
    providerModels: {
      gemini: "gemini-2.5-flash-lite",
      openai: "gpt-5.6-luna",
      deepseek: "deepseek-v4-flash"
    },
    usingBuiltInService: false
  } as AiSettingsStatus
};

export const previewCapture = {
  url: "https://example.com/design-review",
  canonicalUrl: "https://example.com/design-review",
  title: "侧边栏设计评审",
  description: "用于验证收藏浮层与动效的本地页面。",
  content:
    "这是本地设计评审页面的模拟正文，只用于开发环境中的收藏浮层交互验证。",
  excerpt: "本地设计评审页面",
  selectedText: "",
  author: "",
  siteName: "example.com",
  language: "zh-CN",
  imageUrl: "",
  faviconUrl: ""
};

export function previewFolderOptions() {
  return [
    {
      id: previewRoot.id,
      name: previewRoot.title,
      path: [previewRoot.title],
      depth: 0
    },
    ...(previewRoot.children || [])
      .filter((node) => !node.url)
      .map((node) => ({
        id: node.id,
        name: node.title,
        path: [previewRoot.title, node.title],
        depth: 1
      }))
  ];
}

export function previewAgentCatalog(): BookmarkAgentCatalog {
  const catalog: BookmarkAgentCatalog = { bookmarks: [], folders: [] };
  const visit = (node: NativeBookmarkNode, parentPath: string[]) => {
    const path = node.title ? [...parentPath, node.title] : parentPath;
    if (!node.url) {
      catalog.folders.push({
        id: node.id,
        parentId: node.parentId,
        title: node.title,
        path,
        writable: true
      });
    }
    for (const child of node.children || []) {
      if (child.url) {
        catalog.bookmarks.push({
          id: child.id,
          parentId: child.parentId || node.id,
          title: child.title,
          url: child.url,
          path,
          writable: true
        });
      } else {
        visit(child, path);
      }
    }
  };
  visit(previewRoot, []);
  return catalog;
}

export const previewSuggestions: NavigationSuggestion[] = [
  {
    id: "preview-tab",
    kind: "tab",
    title: "侧边栏设计评审",
    url: "https://example.com/design-review",
    subtitle: "已打开 · example.com",
    tabId: 1,
    windowId: 1
  }
];

export function findPreviewNode(
  id: string,
  parent: NativeBookmarkNode = previewRoot
): { node: NativeBookmarkNode; parent: NativeBookmarkNode } | null {
  for (const child of parent.children || []) {
    if (child.id === id) return { node: child, parent };
    const nested = findPreviewNode(id, child);
    if (nested) return nested;
  }
  return null;
}

export function previewProtectionState(target: {
  kind: "bookmark" | "folder";
  id: string;
}) {
  const match = findPreviewNode(target.id);
  if (!match) return { protected: false, explicit: false, inherited: false };
  let parent: NativeBookmarkNode | undefined = match.parent;
  let inherited = false;
  while (parent) {
    if (previewProtectedFolderIds.has(parent.id)) {
      inherited = true;
      break;
    }
    parent = parent.parentId ? findPreviewNode(parent.parentId)?.node : undefined;
  }
  if (target.kind === "folder") {
    const explicit = previewProtectedFolderIds.has(target.id);
    return { protected: explicit || inherited, explicit, inherited };
  }
  const resource = previewResources.find((item) =>
    item.nativeBookmarkIds.includes(target.id)
  );
  const explicit = Boolean(
    resource && previewProtectedResourceKeys.has(resource.resourceKey)
  );
  return { protected: explicit || inherited, explicit, inherited };
}

export function movePreviewNode(
  id: string,
  parentId: string,
  index?: number
): NativeBookmarkNode | null {
  const source = findPreviewNode(id);
  const destination =
    parentId === previewRoot.id
      ? previewRoot
      : findPreviewNode(parentId)?.node;
  if (!source || !destination || destination.url) return null;

  const sourceChildren = source.parent.children || [];
  const sourceIndex = sourceChildren.findIndex((node) => node.id === id);
  if (sourceIndex < 0) return null;
  sourceChildren.splice(sourceIndex, 1);

  const destinationChildren = destination.children || [];
  destination.children = destinationChildren;
  const nextIndex = Math.max(
    0,
    Math.min(index ?? destinationChildren.length, destinationChildren.length)
  );
  destinationChildren.splice(nextIndex, 0, source.node);
  source.node.parentId = destination.id;

  sourceChildren.forEach((node, nodeIndex) => {
    node.index = nodeIndex;
  });
  destinationChildren.forEach((node, nodeIndex) => {
    node.index = nodeIndex;
  });
  return source.node;
}

export function removePreviewNode(id: string): NativeBookmarkNode | null {
  const source = findPreviewNode(id);
  if (!source) return null;
  const children = source.parent.children || [];
  const index = children.findIndex((node) => node.id === id);
  if (index < 0) return null;
  children.splice(index, 1);
  children.forEach((node, nodeIndex) => {
    node.index = nodeIndex;
  });
  return source.node;
}

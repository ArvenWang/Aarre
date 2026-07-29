import type {
  AgentConversation,
  AiProviderId,
  AiSettingsStatus,
  AppState,
  BookmarkBarSnapshot,
  NativeBookmarkNode,
  NavigationSuggestion,
  ResourceRecord
} from "../../lib/types";

const previewEvent = {
  addListener() {},
  removeListener() {}
};

const previewFolders = [
  ["设计赏析", 40],
  ["前端代码与组件", 58],
  ["工作与内部系统", 36],
  ["生活与娱乐", 45],
  ["工具与效率", 52],
  ["前端文章 / 教程", 38]
] as const;

// 使用真实公开页面验证代表图布局；仅存在于 ?preview=1 开发评审页。
const previewCoverSamples = [
  {
    title: "Sticker Forge — Interactive Sticker Maker",
    url: "https://sticker.oooo.so/",
    imageUrl: "https://sticker.oooo.so/og.png"
  },
  {
    title: "UIBook — Find your next UI idea",
    url: "https://uibook.art/",
    imageUrl:
      "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/8acce6a3-1c71-4036-abf0-82e190df5c47/id-preview-95323c3b--354d2877-50f8-4d3f-8761-1963e91ae9ec.lovable.app-1771515272725.png"
  },
  {
    title: "Good Web Design",
    url: "https://good-web-design.com/",
    imageUrl:
      "https://good-web-design.com/wp/wp-content/uploads/2026/07/newcreators2026-960x624.jpg"
  },
  {
    title: "60fps — UI/UX animation inspiration",
    url: "https://60fps.design/",
    imageUrl:
      "https://framerusercontent.com/images/mB8WqomRNWMwPrMEL90Vtl8JGrE.png"
  },
  {
    title: "Recent — Design Inspiration",
    url: "https://recent.design/",
    imageUrl: "https://recent.design/og.png"
  },
  {
    title: "Collect UI — Daily Design Inspiration",
    url: "https://collectui.com/",
    imageUrl: "https://collectui.com/og-image.jpg"
  }
] as const;

function previewFolder(
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

const previewRoot: NativeBookmarkNode = {
  id: "preview-root",
  title: "书签栏",
  folderType: "bookmarks-bar",
  syncing: true,
  children: previewFolders.map(([title, count], index) =>
    previewFolder(title, count, index)
  )
};

const previewSnapshot: BookmarkBarSnapshot = {
  root: previewRoot,
  roots: [previewRoot],
  primaryRootId: previewRoot.id,
  bookmarkCount: 269,
  folderCount: previewFolders.length,
  syncing: true
};

const previewState: AppState = {
  auth: {
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
  localResourceCount: 269,
  aiReadyResourceCount: 8,
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

const previewResources: ResourceRecord[] = (previewRoot.children || [])
  .flatMap((folder) =>
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
  );

let previewConversations: AgentConversation[] = [];

let previewAiSettings: AiSettingsStatus = {
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
};

const previewCapture = {
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

function previewFolderOptions() {
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

const previewSuggestions: NavigationSuggestion[] = [
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

function findPreviewNode(
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

function movePreviewNode(
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

export function installSidePanelPreview() {
  const previewChrome = {
    runtime: {
      getURL(path: string) {
        if (path === "/_favicon/") {
          return new URL("/icons/icon-32.png", window.location.origin).toString();
        }
        return new URL(path, window.location.origin).toString();
      },
      onMessage: previewEvent,
      async sendMessage(request: {
        type?: string;
        apiKey?: string;
        query?: string;
        history?: Array<{ role: "user" | "assistant"; content: string }>;
        force?: boolean;
        id?: string;
        conversation?: AgentConversation;
        payload?: {
          id?: string;
          parentId?: string;
          index?: number;
          folderId?: string;
          title?: string;
          url?: string;
          resourceKey?: string;
          tags?: string[];
          provider?: AiProviderId;
          model?: string;
          apiKey?: string;
        };
      }) {
        switch (request.type) {
          case "GET_BOOKMARK_BAR":
            return { ok: true, data: structuredClone(previewSnapshot) };
          case "GET_APP_STATE":
          case "AUTH_CHANGED":
            return { ok: true, data: previewState };
          case "GET_LOCAL_RESOURCES":
            return { ok: true, data: structuredClone(previewResources) };
          case "GET_AGENT_CONVERSATIONS":
            return { ok: true, data: structuredClone(previewConversations) };
          case "SAVE_AGENT_CONVERSATION":
            if (!request.conversation) {
              return { ok: false, error: "会话内容无效。" };
            }
            previewConversations = [
              request.conversation,
              ...previewConversations.filter(
                (item) => item.id !== request.conversation?.id
              )
            ];
            return {
              ok: true,
              data: structuredClone(request.conversation)
            };
          case "DELETE_AGENT_CONVERSATION":
            previewConversations = previewConversations.filter(
              (item) => item.id !== request.id
            );
            return { ok: true, data: { deleted: true } };
          case "GET_AI_SETTINGS":
            return { ok: true, data: previewAiSettings };
          case "SAVE_AI_SETTINGS": {
            const provider = request.payload?.provider || "gemini";
            const providerName = {
              gemini: "Gemini",
              openai: "OpenAI",
              deepseek: "DeepSeek"
            }[provider];
            const apiKey = request.payload?.apiKey?.trim() || "";
            const alreadyConfigured =
              previewAiSettings.configuredProviders.includes(provider);
            if (!alreadyConfigured && apiKey.length < 12) {
              return {
                ok: false,
                error: `请输入完整的 ${providerName} API Key。`
              };
            }
            previewAiSettings = {
              ...previewAiSettings,
              provider,
              providerName,
              model:
                request.payload?.model ||
                previewAiSettings.providerModels[provider],
              apiKeyConfigured: Boolean(apiKey) || alreadyConfigured,
              apiKeySuffix: apiKey
                ? apiKey.slice(-4)
                : alreadyConfigured &&
                    previewAiSettings.provider === provider
                  ? previewAiSettings.apiKeySuffix
                  : undefined,
              configuredProviders: apiKey || alreadyConfigured
                ? [
                    ...new Set([
                      ...previewAiSettings.configuredProviders,
                      provider
                    ])
                  ]
                : previewAiSettings.configuredProviders,
              providerModels: {
                ...previewAiSettings.providerModels,
                [provider]:
                  request.payload?.model ||
                  previewAiSettings.providerModels[provider]
              },
              usingBuiltInService: false
            };
            return { ok: true, data: previewAiSettings };
          }
          case "GET_PENDING_SAVE":
            return { ok: true, data: null };
          case "GET_FOLDERS":
            return { ok: true, data: previewFolderOptions() };
          case "CAPTURE_ACTIVE_PAGE":
            return { ok: true, data: previewCapture };
          case "GET_NAVIGATION_SUGGESTIONS":
            return { ok: true, data: previewSuggestions };
          case "NAVIGATE":
          case "OPEN_MANAGER":
            return { ok: true, data: { opened: true } };
          case "ASK_BOOKMARK_AGENT":
            return {
              ok: true,
              data: {
                query: request.query || "",
                answer:
                  "你收藏的内容里，设计赏析与前端代码两个文件夹最接近这个问题。前者适合寻找视觉参考，后者更适合落地组件实现。",
                providerName: "DeepSeek",
                sources: [
                  {
                    resourceKey: "preview-agent-source",
                    title: "设计赏析示例收藏",
                    url: "https://example.com/0/0",
                    siteName: "example.com",
                    faviconUrl: ""
                  }
                ],
                catalogSize: 269,
                examinedCount: 269
              }
            };
          case "GET_LIBRARY_SCAN":
            return {
              ok: true,
              data: structuredClone(previewState.libraryScan)
            };
          case "START_LIBRARY_SCAN":
            previewState.libraryScan = {
              id: "preview-scan",
              state: "running",
              total: 261,
              processed: 47,
              succeeded: 45,
              failed: 1,
              skipped: 1,
              currentTitle: "前端组件交互设计",
              startedAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              errors: []
            };
            previewState.aiReadyResourceCount = 55;
            return {
              ok: true,
              data: structuredClone(previewState.libraryScan)
            };
          case "PAUSE_LIBRARY_SCAN":
            previewState.libraryScan = {
              ...previewState.libraryScan,
              state: "paused",
              currentTitle: ""
            };
            return {
              ok: true,
              data: structuredClone(previewState.libraryScan)
            };
          case "RESUME_LIBRARY_SCAN":
            previewState.libraryScan = {
              ...previewState.libraryScan,
              state: "running",
              currentTitle: "前端组件交互设计"
            };
            return {
              ok: true,
              data: structuredClone(previewState.libraryScan)
            };
          case "CANCEL_LIBRARY_SCAN":
            previewState.libraryScan = {
              ...previewState.libraryScan,
              state: "cancelled",
              currentTitle: ""
            };
            return {
              ok: true,
              data: structuredClone(previewState.libraryScan)
            };
          case "MOVE_NATIVE_BOOKMARK": {
            const id = request.payload?.id || "";
            const parentId = request.payload?.parentId || "";
            const moved = movePreviewNode(
              id,
              parentId,
              request.payload?.index
            );
            return moved
              ? { ok: true, data: structuredClone(moved) }
              : { ok: false, error: "无法移动这个预览书签。" };
          }
          case "UPDATE_RESOURCE_TAGS": {
            const resource = previewResources.find(
              (item) =>
                item.resourceKey === request.payload?.resourceKey
            );
            if (!resource) {
              return { ok: false, error: "没有找到预览元数据。" };
            }
            resource.tags = request.payload?.tags || [];
            resource.tagsSource = "user";
            resource.updatedAt = new Date().toISOString();
            return { ok: true, data: structuredClone(resource) };
          }
          case "UPDATE_NATIVE_BOOKMARK": {
            const match = findPreviewNode(request.payload?.id || "");
            if (!match) {
              return { ok: false, error: "没有找到预览书签。" };
            }
            match.node.title =
              request.payload?.title || match.node.title;
            match.node.url = request.payload?.url || match.node.url;
            const resource = previewResources.find((item) =>
              item.nativeBookmarkIds.includes(match.node.id)
            );
            if (resource) {
              resource.title = match.node.title;
              resource.url = match.node.url || resource.url;
              resource.updatedAt = new Date().toISOString();
            }
            return {
              ok: true,
              data: structuredClone(match.node)
            };
          }
          case "SAVE_BOOKMARK": {
            const destination =
              request.payload?.folderId === previewRoot.id
                ? previewRoot
                : findPreviewNode(request.payload?.folderId || "")?.node;
            if (!destination || destination.url) {
              return { ok: false, error: "请选择一个预览文件夹。" };
            }
            const savedNode: NativeBookmarkNode = {
              id: `preview-saved-${Date.now()}`,
              parentId: destination.id,
              index: destination.children?.length || 0,
              title: request.payload?.title || previewCapture.title,
              url: previewCapture.url
            };
            destination.children = [...(destination.children || []), savedNode];
            return {
              ok: true,
              data: {
                resource: null,
                nativeBookmarkCreated: true,
                cloudSyncAttempted: false
              }
            };
          }
          default:
            return { ok: false, error: "设计预览不执行数据写入操作。" };
        }
      }
    },
    bookmarks: {
      onCreated: previewEvent,
      onChanged: previewEvent,
      onMoved: previewEvent,
      onRemoved: previewEvent,
      onChildrenReordered: previewEvent
    },
    permissions: {
      async request() {
        return true;
      }
    }
  };

  const previewGlobal = globalThis as unknown as {
    chrome?: Record<string, unknown>;
  };

  // 普通 Chrome 网页也会暴露一个不可替换的 window.chrome；
  // 开发预览只补齐扩展依赖的接口，避免覆盖浏览器自身对象。
  if (previewGlobal.chrome) {
    Object.assign(previewGlobal.chrome, previewChrome);
    return;
  }

  Object.defineProperty(previewGlobal, "chrome", {
    configurable: true,
    value: previewChrome
  });
}

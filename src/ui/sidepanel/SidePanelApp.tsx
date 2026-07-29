import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { signInWithGoogle } from "../../lib/auth";
import { sendExtensionRequest } from "../../lib/messages";
import type {
  AppState,
  BookmarkBarSnapshot,
  NativeBookmarkNode,
  NativeFolderOption,
  NavigationSuggestion,
  PendingSaveDraft,
  PageCapture
} from "../../lib/types";

type EditorState =
  | { kind: "bookmark"; node: NativeBookmarkNode }
  | { kind: "folder"; parentId: string }
  | { kind: "save" }
  | null;

function hostFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "") || url;
  } catch {
    return url;
  }
}

function emptyCapture(appState: AppState): PageCapture {
  const tab = appState.activeTab;
  if (!tab?.url) {
    throw new Error("没有可收藏的当前页面。");
  }
  return {
    url: tab.url,
    canonicalUrl: "",
    title: tab.title || tab.url,
    description: "",
    content: "",
    excerpt: "",
    selectedText: "",
    author: "",
    siteName: hostFromUrl(tab.url),
    language: "",
    imageUrl: "",
    faviconUrl: tab.faviconUrl
  };
}

function captureFromDraft(draft: PendingSaveDraft): PageCapture {
  return {
    url: draft.url,
    canonicalUrl: "",
    title: draft.title,
    description: "",
    content: "",
    excerpt: "",
    selectedText: draft.selectedText,
    author: "",
    siteName: hostFromUrl(draft.url),
    language: "",
    imageUrl: "",
    faviconUrl: draft.faviconUrl
  };
}

function nodeContainsUrl(
  node: NativeBookmarkNode,
  url: string
): boolean {
  if (node.url === url) return true;
  return Boolean(node.children?.some((child) => nodeContainsUrl(child, url)));
}

function countBookmarks(node: NativeBookmarkNode): number {
  if (node.url) return 1;
  return (node.children || []).reduce(
    (total, child) => total + countBookmarks(child),
    0
  );
}

function kindIcon(kind: NavigationSuggestion["kind"]): string {
  if (kind === "bookmark") return "★";
  if (kind === "tab") return "▣";
  return "↺";
}

interface TreeProps {
  nodes: NativeBookmarkNode[];
  depth?: number;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  onOpen: (node: NativeBookmarkNode, newTab: boolean) => void;
  onEdit: (node: NativeBookmarkNode) => void;
  onMove: (
    id: string,
    parentId: string,
    index?: number
  ) => Promise<void>;
}

function BookmarkTree({
  nodes,
  depth = 0,
  expanded,
  onToggle,
  onOpen,
  onEdit,
  onMove
}: TreeProps) {
  return (
    <>
      {nodes.map((node) => {
        const folder = !node.url;
        const isExpanded = expanded.has(node.id);
        return (
          <div className="bookmark-node" key={node.id}>
            <div
              className="bookmark-row"
              data-folder={folder}
              draggable={!node.unmodifiable}
              style={{ "--tree-depth": depth } as React.CSSProperties}
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData(
                  "application/x-bookmark-layer-id",
                  node.id
                );
              }}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
              }}
              onDrop={(event) => {
                event.preventDefault();
                event.stopPropagation();
                const id = event.dataTransfer.getData(
                  "application/x-bookmark-layer-id"
                );
                if (!id || id === node.id) return;
                void onMove(
                  id,
                  folder ? node.id : node.parentId || "",
                  folder ? undefined : node.index
                );
              }}
            >
              <button
                type="button"
                className="bookmark-main"
                onClick={() =>
                  folder ? onToggle(node.id) : onOpen(node, false)
                }
                onAuxClick={(event) => {
                  if (!folder && event.button === 1) {
                    event.preventDefault();
                    onOpen(node, true);
                  }
                }}
                title={node.url || node.title}
              >
                <span className="tree-chevron" data-visible={folder}>
                  {folder ? (isExpanded ? "⌄" : "›") : ""}
                </span>
                <span className="tree-icon" data-folder={folder}>
                  {folder ? (isExpanded ? "▾" : "▸") : "↗"}
                </span>
                <span className="bookmark-copy">
                  <strong>{node.title || "未命名"}</strong>
                  {node.url ? <small>{hostFromUrl(node.url)}</small> : null}
                </span>
              </button>

              {!node.unmodifiable && !node.folderType ? (
                <button
                  type="button"
                  className="row-menu"
                  aria-label={`编辑 ${node.title}`}
                  title="编辑"
                  onClick={() => onEdit(node)}
                >
                  •••
                </button>
              ) : null}
            </div>

            {folder && isExpanded && node.children?.length ? (
              <BookmarkTree
                nodes={node.children}
                depth={depth + 1}
                expanded={expanded}
                onToggle={onToggle}
                onOpen={onOpen}
                onEdit={onEdit}
                onMove={onMove}
              />
            ) : null}
          </div>
        );
      })}
    </>
  );
}

export function SidePanelApp() {
  const [snapshot, setSnapshot] = useState<BookmarkBarSnapshot | null>(null);
  const [appState, setAppState] = useState<AppState | null>(null);
  const [folders, setFolders] = useState<NativeFolderOption[]>([]);
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<NavigationSuggestion[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editor, setEditor] = useState<EditorState>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editUrl, setEditUrl] = useState("");
  const [capture, setCapture] = useState<PageCapture | null>(null);
  const [note, setNote] = useState("");
  const [folderId, setFolderId] = useState("");
  const [requestAi, setRequestAi] = useState(true);
  const [captureWarning, setCaptureWarning] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const searchSequence = useRef(0);
  const knownRootIds = useRef<Set<string>>(new Set());
  const pendingDraftInFlight = useRef(false);

  const refresh = useCallback(async () => {
    const [nextSnapshot, nextState] = await Promise.all([
      sendExtensionRequest({ type: "GET_BOOKMARK_BAR" }),
      sendExtensionRequest({ type: "GET_APP_STATE" })
    ]);
    setSnapshot(nextSnapshot);
    setAppState(nextState);
    setExpanded((current) => {
      const next = new Set(current);
      for (const root of nextSnapshot.roots || [nextSnapshot.root]) {
        if (!knownRootIds.current.has(root.id)) {
          next.add(root.id);
          knownRootIds.current.add(root.id);
        }
      }
      return next;
    });
  }, []);

  useEffect(() => {
    void refresh().catch((caught) => {
      setError(caught instanceof Error ? caught.message : "书签栏读取失败");
    });

    const handleChange = () => {
      void refresh();
    };
    chrome.bookmarks.onCreated.addListener(handleChange);
    chrome.bookmarks.onChanged.addListener(handleChange);
    chrome.bookmarks.onMoved.addListener(handleChange);
    chrome.bookmarks.onRemoved.addListener(handleChange);
    chrome.bookmarks.onChildrenReordered.addListener(handleChange);
    return () => {
      chrome.bookmarks.onCreated.removeListener(handleChange);
      chrome.bookmarks.onChanged.removeListener(handleChange);
      chrome.bookmarks.onMoved.removeListener(handleChange);
      chrome.bookmarks.onRemoved.removeListener(handleChange);
      chrome.bookmarks.onChildrenReordered.removeListener(handleChange);
    };
  }, [refresh]);

  useEffect(() => {
    const tabId = appState?.activeTab?.id;
    if (typeof tabId !== "number") return;

    const consume = async () => {
      if (pendingDraftInFlight.current) return;
      pendingDraftInFlight.current = true;
      try {
        const draft = await sendExtensionRequest({
          type: "GET_PENDING_SAVE",
          tabId
        });
        if (draft) {
          await startSave(draft);
        }
      } catch (caught) {
        setError(
          caught instanceof Error ? caught.message : "无法打开收藏表单"
        );
      } finally {
        pendingDraftInFlight.current = false;
      }
    };

    void consume();
    const handlePendingSave = (message: {
      type?: string;
      tabId?: number;
    }) => {
      if (
        message.type === "PENDING_SAVE_READY" &&
        message.tabId === tabId
      ) {
        void consume();
      }
    };
    chrome.runtime.onMessage.addListener(handlePendingSave);
    return () => {
      chrome.runtime.onMessage.removeListener(handlePendingSave);
    };
  }, [appState?.activeTab?.id]);

  useEffect(() => {
    const current = ++searchSequence.current;
    setSuggestions([]);
    setSelectedIndex(-1);
    if (!query.trim()) {
      return;
    }
    const timer = window.setTimeout(() => {
      void sendExtensionRequest({
        type: "GET_NAVIGATION_SUGGESTIONS",
        query
      })
        .then((items) => {
          if (current !== searchSequence.current) return;
          setSuggestions(items);
          setSelectedIndex(items.length ? 0 : -1);
        })
        .catch((caught) => {
          if (current !== searchSequence.current) return;
          setError(caught instanceof Error ? caught.message : "搜索失败");
        });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [query]);

  const currentSaved = useMemo(
    () =>
      Boolean(
        snapshot &&
          appState?.activeTab?.url &&
          (snapshot.roots || [snapshot.root]).some((root) =>
            nodeContainsUrl(root, appState.activeTab!.url)
          )
      ),
    [appState, snapshot]
  );

  async function openNavigation(
    input: { text: string; item?: NavigationSuggestion },
    newTab = false
  ) {
    setError("");
    try {
      await sendExtensionRequest({
        type: "NAVIGATE",
        payload: {
          text: input.text,
          url: input.item?.url,
          tabId: input.item?.tabId,
          windowId: input.item?.windowId,
          disposition: newTab ? "new" : "current"
        }
      });
      setQuery("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "无法打开");
    }
  }

  async function handleLogin() {
    setBusy("login");
    setError("");
    try {
      await signInWithGoogle();
      await sendExtensionRequest({ type: "AUTH_CHANGED" });
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Google 登录失败");
    } finally {
      setBusy("");
    }
  }

  async function handleSearchSubmit(event: React.FormEvent) {
    event.preventDefault();
    const item =
      selectedIndex >= 0 ? suggestions[selectedIndex] : undefined;
    await openNavigation({ text: query, item }, false);
  }

  async function startSave(draft?: PendingSaveDraft) {
    if (!appState) return;
    setEditor({ kind: "save" });
    setBusy("capture");
    setError("");
    setCaptureWarning("");
    setNote("");
    try {
      const folderOptions = await sendExtensionRequest({
        type: "GET_FOLDERS"
      });
      setFolders(folderOptions);
      setFolderId(
        snapshot?.primaryRootId ||
          snapshot?.root.id ||
          folderOptions[0]?.id ||
          ""
      );

      if (draft?.kind === "link") {
        const page = captureFromDraft(draft);
        setCapture(page);
        setEditTitle(page.title);
        setRequestAi(false);
        setCaptureWarning(
          "这是链接收藏。保存后打开该网页，可继续补充正文摘要和 AI 标签。"
        );
      } else try {
        const page = await sendExtensionRequest({
          type: "CAPTURE_ACTIVE_PAGE"
        });
        const merged = draft
          ? {
              ...page,
              selectedText:
                draft.selectedText || page.selectedText
            }
          : page;
        setCapture(merged);
        setEditTitle(draft?.title || merged.title);
        setRequestAi(true);
      } catch {
        const page = draft
          ? captureFromDraft(draft)
          : emptyCapture(appState);
        setCapture(page);
        setEditTitle(page.title);
        setRequestAi(false);
        setCaptureWarning(
          "此页面受 Chrome 保护，仍可保存原生书签，但不会读取正文。"
        );
      }
    } catch (caught) {
      setEditor(null);
      setError(caught instanceof Error ? caught.message : "无法读取当前页面");
    } finally {
      setBusy("");
    }
  }

  function startEdit(node: NativeBookmarkNode) {
    setEditor({ kind: "bookmark", node });
    setEditTitle(node.title);
    setEditUrl(node.url || "");
    setError("");
  }

  function startCreateFolder(parentId: string) {
    setEditor({ kind: "folder", parentId });
    setEditTitle("");
    setEditUrl("");
    setError("");
  }

  async function saveEditor() {
    if (!editor) return;
    setBusy("save");
    setError("");
    try {
      if (editor.kind === "folder") {
        await sendExtensionRequest({
          type: "CREATE_NATIVE_FOLDER",
          payload: { parentId: editor.parentId, title: editTitle }
        });
      } else if (editor.kind === "bookmark") {
        await sendExtensionRequest({
          type: "UPDATE_NATIVE_BOOKMARK",
          payload: {
            id: editor.node.id,
            title: editTitle,
            ...(editor.node.url ? { url: editUrl } : {})
          }
        });
      } else {
        if (!capture) throw new Error("当前页面尚未读取完成。");
        await sendExtensionRequest({
          type: "SAVE_BOOKMARK",
          payload: {
            capture,
            title: editTitle,
            userNote: note,
            folderId,
            requestAi
          }
        });
      }
      setEditor(null);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存失败");
    } finally {
      setBusy("");
    }
  }

  async function deleteEditorNode() {
    if (editor?.kind !== "bookmark") return;
    setBusy("delete");
    setError("");
    try {
      await sendExtensionRequest({
        type: "DELETE_NATIVE_BOOKMARK",
        payload: {
          id: editor.node.id,
          recursive: !editor.node.url
        }
      });
      setEditor(null);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "删除失败");
    } finally {
      setBusy("");
    }
  }

  async function moveNode(
    id: string,
    parentId: string,
    index?: number
  ) {
    if (!parentId) return;
    setError("");
    try {
      await sendExtensionRequest({
        type: "MOVE_NATIVE_BOOKMARK",
        payload: { id, parentId, index }
      });
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "移动失败");
    }
  }

  return (
    <main className="native-panel">
      <header className="native-header">
        <div>
          <p className="eyebrow">CHROME BOOKMARKS</p>
          <div className="native-title-row">
            <h1>书签栏</h1>
            <span
              className="native-sync"
              data-syncing={snapshot?.syncing === true}
            >
              {snapshot?.syncing === true ? "Chrome 同步" : "Chrome 数据源"}
            </span>
          </div>
        </div>
        <div className="native-actions">
          <button
            type="button"
            className="icon-button"
            title="新建文件夹"
            aria-label="新建文件夹"
            onClick={() =>
              snapshot &&
              startCreateFolder(
                snapshot.primaryRootId || snapshot.root.id
              )
            }
            disabled={!snapshot}
          >
            ＋
          </button>
          <button
            type="button"
            className="icon-button star-button"
            data-saved={currentSaved}
            title={currentSaved ? "编辑当前页面书签" : "收藏当前页面"}
            aria-label={currentSaved ? "编辑当前页面书签" : "收藏当前页面"}
            onClick={() => void startSave()}
            disabled={!appState?.activeTab?.url}
          >
            {currentSaved ? "★" : "☆"}
          </button>
        </div>
      </header>

      <form
        className="omnibox-shell"
        onSubmit={(event) => void handleSearchSubmit(event)}
      >
        <span className="omnibox-icon" aria-hidden="true">
          ⌕
        </span>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setSelectedIndex((value) =>
                Math.min(value + 1, suggestions.length - 1)
              );
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              setSelectedIndex((value) => Math.max(value - 1, 0));
            }
            if (event.key === "Escape") {
              setQuery("");
            }
            if (
              event.key === "Enter" &&
              (event.metaKey || event.ctrlKey || event.altKey)
            ) {
              event.preventDefault();
              const item =
                selectedIndex >= 0
                  ? suggestions[selectedIndex]
                  : undefined;
              void openNavigation({ text: query, item }, true);
            }
          }}
          placeholder="搜索书签、历史记录或输入网址"
          aria-label="搜索或输入网址"
          autoComplete="off"
          autoFocus
        />
        {query ? (
          <button
            type="button"
            className="clear-query"
            aria-label="清除"
            onClick={() => setQuery("")}
          >
            ×
          </button>
        ) : null}
      </form>

      {error ? (
        <div className="native-error" role="alert">
          <span>{error}</span>
          <button onClick={() => setError("")}>×</button>
        </div>
      ) : null}

      <section
        className="native-content"
        aria-label={query ? "地址栏建议" : "Chrome 书签栏"}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          const id = event.dataTransfer.getData(
            "application/x-bookmark-layer-id"
          );
          if (id && snapshot) {
            void moveNode(
              id,
              snapshot.primaryRootId || snapshot.root.id
            );
          }
        }}
      >
        {query ? (
          <div className="suggestion-list">
            {suggestions.map((item, index) => (
              <button
                type="button"
                className="suggestion-row"
                data-selected={index === selectedIndex}
                key={item.id}
                onMouseEnter={() => setSelectedIndex(index)}
                onClick={() =>
                  void openNavigation({ text: query, item }, false)
                }
                onAuxClick={(event) => {
                  if (event.button === 1) {
                    event.preventDefault();
                    void openNavigation({ text: query, item }, true);
                  }
                }}
              >
                <span
                  className="suggestion-kind"
                  data-kind={item.kind}
                  aria-hidden="true"
                >
                  {kindIcon(item.kind)}
                </span>
                <span className="suggestion-copy">
                  <strong>{item.title}</strong>
                  <small>{item.subtitle}</small>
                </span>
                <span className="suggestion-open" aria-hidden="true">
                  ↗
                </span>
              </button>
            ))}
            <button
              type="button"
              className="search-provider-row"
              onClick={() =>
                void openNavigation({ text: query }, false)
              }
            >
              <span className="suggestion-kind">G</span>
              <span className="suggestion-copy">
                <strong>使用 Chrome 默认搜索引擎搜索</strong>
                <small>{query}</small>
              </span>
              <span>↵</span>
            </button>
          </div>
        ) : snapshot ? (
          (snapshot.roots || [snapshot.root]).some(
            (root) => root.children?.length
          ) ? (
            <div className="bookmark-roots">
              {(snapshot.roots || [snapshot.root]).map((root) => {
                const rootExpanded = expanded.has(root.id);
                return (
                  <section className="bookmark-root" key={root.id}>
                    <button
                      type="button"
                      className="bookmark-root-heading"
                      onClick={() =>
                        setExpanded((current) => {
                          const next = new Set(current);
                          if (next.has(root.id)) next.delete(root.id);
                          else next.add(root.id);
                          return next;
                        })
                      }
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        const id = event.dataTransfer.getData(
                          "application/x-bookmark-layer-id"
                        );
                        if (id) void moveNode(id, root.id);
                      }}
                    >
                      <span>{rootExpanded ? "⌄" : "›"}</span>
                      <strong>{root.title}</strong>
                      {root.syncing ? <em>Google</em> : null}
                      <small>{countBookmarks(root)}</small>
                    </button>
                    {rootExpanded && root.children?.length ? (
                      <BookmarkTree
                        nodes={root.children}
                        expanded={expanded}
                        onToggle={(id) =>
                          setExpanded((current) => {
                            const next = new Set(current);
                            if (next.has(id)) next.delete(id);
                            else next.add(id);
                            return next;
                          })
                        }
                        onOpen={(node, newTab) =>
                          void openNavigation(
                            {
                              text: node.url || "",
                              item: node.url
                                ? {
                                    id: `bookmark:${node.id}`,
                                    kind: "bookmark",
                                    title: node.title,
                                    url: node.url,
                                    subtitle: ""
                                  }
                                : undefined
                            },
                            newTab
                          )
                        }
                        onEdit={startEdit}
                        onMove={moveNode}
                      />
                    ) : null}
                  </section>
                );
              })}
            </div>
          ) : (
            <div className="native-empty">
              <span>☆</span>
              <strong>Chrome 书签还是空的</strong>
              <p>点击右上角星标，或使用 Chrome 自带星标开始收藏。</p>
            </div>
          )
        ) : (
          <div className="native-loading">正在读取 Chrome 书签栏…</div>
        )}
      </section>

      <footer className="native-footer">
        <div className="native-account-summary">
          {appState?.auth.userAvatarUrl ? (
            <img src={appState.auth.userAvatarUrl} alt="" />
          ) : (
            <span className="native-account-avatar">
              {(appState?.auth.userEmail ||
                appState?.auth.chromeProfileEmail ||
                "G")
                .slice(0, 1)
                .toUpperCase()}
            </span>
          )}
          <span>
            <strong>
              {!appState?.auth.configured
                ? "账号服务待连接"
                : appState.auth.signedIn
                  ? appState.auth.userName || appState.auth.userEmail
                  : "使用 Google 登录"}
            </strong>
            <small>
              {appState?.auth.signedIn
                ? appState.pendingSyncCount
                  ? `${appState.pendingSyncCount} 条等待同步`
                  : "AI 信息已自动同步"
                : `${snapshot?.bookmarkCount ?? 0} 个 Chrome 原生书签`}
            </small>
          </span>
        </div>
        {appState?.auth.configured && !appState.auth.signedIn ? (
          <button
            type="button"
            onClick={() => void handleLogin()}
            disabled={Boolean(busy)}
          >
            {busy === "login" ? "登录中…" : "Google 登录"}
          </button>
        ) : (
          <button
            type="button"
            onClick={() =>
              void sendExtensionRequest({ type: "OPEN_MANAGER" })
            }
          >
            智能管理 <span>→</span>
          </button>
        )}
      </footer>

      {editor ? (
        <div
          className="native-dialog-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !busy) {
              setEditor(null);
            }
          }}
        >
          <section
            className="native-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="native-dialog-title"
          >
            <div className="native-dialog-heading">
              <div>
                <p className="eyebrow">
                  {editor.kind === "save"
                    ? "SAVE TO CHROME"
                    : "EDIT CHROME BOOKMARK"}
                </p>
                <h2 id="native-dialog-title">
                  {editor.kind === "save"
                    ? "收藏当前页面"
                    : editor.kind === "folder"
                      ? "新建文件夹"
                      : editor.node.url
                        ? "编辑书签"
                        : "编辑文件夹"}
                </h2>
              </div>
              <button
                className="dialog-close"
                onClick={() => setEditor(null)}
                disabled={Boolean(busy)}
                aria-label="关闭"
              >
                ×
              </button>
            </div>

            {editor.kind === "save" && busy === "capture" ? (
              <div className="native-loading dialog-loading">
                正在读取当前页面…
              </div>
            ) : (
              <>
                <label className="native-field">
                  <span>名称</span>
                  <input
                    value={editTitle}
                    onChange={(event) => setEditTitle(event.target.value)}
                    maxLength={240}
                    autoFocus
                  />
                </label>

                {editor.kind === "bookmark" && editor.node.url ? (
                  <label className="native-field">
                    <span>网址</span>
                    <input
                      value={editUrl}
                      onChange={(event) => setEditUrl(event.target.value)}
                    />
                  </label>
                ) : null}

                {editor.kind === "save" ? (
                  <>
                    <label className="native-field">
                      <span>Chrome 文件夹</span>
                      <select
                        value={folderId}
                        onChange={(event) => setFolderId(event.target.value)}
                      >
                        {folders.map((folder) => (
                          <option key={folder.id} value={folder.id}>
                            {"　".repeat(folder.depth)}
                            {folder.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="native-field">
                      <span>备注（智能增强层）</span>
                      <textarea
                        value={note}
                        onChange={(event) => setNote(event.target.value)}
                        rows={3}
                        maxLength={2_000}
                        placeholder="可选。记录你保存它的原因。"
                      />
                    </label>
                    <label className="native-check">
                      <input
                        type="checkbox"
                        checked={requestAi}
                        onChange={(event) =>
                          setRequestAi(event.target.checked)
                        }
                        disabled={!capture?.content}
                      />
                      <span>
                        <strong>生成摘要与标签</strong>
                        <small>
                          {appState?.auth.signedIn
                            ? "保存后自动理解正文并建立语义索引。"
                            : "Chrome 书签会先保存；登录后自动补充 AI 信息。"}
                        </small>
                      </span>
                    </label>
                    {captureWarning ? (
                      <p className="dialog-warning">{captureWarning}</p>
                    ) : null}
                  </>
                ) : null}

                <div className="native-dialog-actions">
                  {editor.kind === "bookmark" &&
                  !editor.node.folderType ? (
                    <button
                      type="button"
                      className="danger-button"
                      onClick={() => void deleteEditorNode()}
                      disabled={Boolean(busy)}
                    >
                      {busy === "delete"
                        ? "正在删除…"
                        : editor.node.url
                          ? "删除书签"
                          : "删除整个文件夹"}
                    </button>
                  ) : (
                    <span />
                  )}
                  <div>
                    <button
                      type="button"
                      className="button button-quiet"
                      onClick={() => setEditor(null)}
                      disabled={Boolean(busy)}
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      className="button button-dark"
                      onClick={() => void saveEditor()}
                      disabled={
                        Boolean(busy) ||
                        !editTitle.trim() ||
                        (editor.kind === "save" &&
                          (!capture || !folderId))
                      }
                    >
                      {busy === "save"
                        ? "正在保存…"
                        : editor.kind === "save"
                          ? "保存到 Chrome"
                          : "保存"}
                    </button>
                  </div>
                </div>
              </>
            )}
          </section>
        </div>
      ) : null}
    </main>
  );
}

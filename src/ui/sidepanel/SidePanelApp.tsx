import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { signInWithGoogle, signOut } from "../../lib/auth";
import { findBookmarkByUrl } from "../../lib/bookmark-tree";
import { sendExtensionRequest } from "../../lib/messages";
import { canonicalizeUrl } from "../../lib/url";
import {
  AI_PROVIDER_PRESETS,
  getAiProviderPreset
} from "../../lib/settings";
import type {
  AiProviderId,
  AiSettingsStatus,
  AgentChatMessage,
  AgentConversation,
  AppState,
  BookmarkAgentActionProposal,
  BookmarkBarSnapshot,
  NativeBookmarkNode,
  NativeFolderOption,
  PendingSaveDraft,
  PageCapture,
  ResourceRecord,
  UndoSnapshotBatch
} from "../../lib/types";
import {
  ArrowLeftIcon,
  ArrowUpIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CloseIcon,
  EllipsisIcon,
  FolderIcon,
  HistoryIcon,
  PlusIcon,
  SettingsIcon,
  StarIcon
} from "../components/Icons";
import { SiteIcon } from "../components/SiteIcon";
import { SiteThumbnail } from "../components/SiteThumbnail";

type EditorState =
  | {
      kind: "bookmark";
      node: NativeBookmarkNode;
      resourceKey?: string;
    }
  | { kind: "folder"; parentId: string }
  | { kind: "save" }
  | null;

function resourceForUrl(
  resourceByUrl: Map<string, ResourceRecord>,
  url: string
): ResourceRecord | undefined {
  const direct = resourceByUrl.get(url);
  if (direct) return direct;
  try {
    return resourceByUrl.get(canonicalizeUrl(url));
  } catch {
    return undefined;
  }
}

function parseEditableTags(value: string): string[] {
  return value
    .split(/[,，;；\n]+/)
    .map((tag) => tag.trim().replace(/^#+\s*/, "").slice(0, 40))
    .filter(Boolean);
}

function mergeEditableTags(
  current: string[],
  value: string
): string[] {
  const seen = new Set(
    current.map((tag) => tag.toLocaleLowerCase())
  );
  const next = [...current];
  for (const tag of parseEditableTags(value)) {
    const key = tag.toLocaleLowerCase();
    if (seen.has(key) || next.length >= 16) continue;
    seen.add(key);
    next.push(tag);
  }
  return next;
}

interface FolderSelectProps {
  options: NativeFolderOption[];
  value: string;
  onChange: (value: string) => void;
}

function FolderSelect({
  options,
  value,
  onChange
}: FolderSelectProps) {
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.id === value)
  );
  const selected = options[selectedIndex];
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(selectedIndex);

  useEffect(() => {
    setActiveIndex(selectedIndex);
  }, [selectedIndex]);

  useEffect(() => {
    if (!open) return;
    const handleOutsidePointer = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !rootRef.current?.contains(event.target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", handleOutsidePointer);
    return () =>
      document.removeEventListener("pointerdown", handleOutsidePointer);
  }, [open]);

  function focusOption(index: number) {
    const next = Math.max(0, Math.min(index, options.length - 1));
    setActiveIndex(next);
    window.requestAnimationFrame(() => optionRefs.current[next]?.focus());
  }

  function openMenu(index = selectedIndex) {
    if (!options.length) return;
    setOpen(true);
    focusOption(index);
  }

  function selectOption(index: number) {
    const option = options[index];
    if (!option) return;
    onChange(option.id);
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    if (!open) {
      if (
        event.key === "ArrowDown" ||
        event.key === "ArrowUp" ||
        event.key === "Enter" ||
        event.key === " "
      ) {
        event.preventDefault();
        openMenu(
          event.key === "ArrowUp" ? options.length - 1 : selectedIndex
        );
      }
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusOption((activeIndex + 1) % options.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      focusOption((activeIndex - 1 + options.length) % options.length);
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      focusOption(event.key === "Home" ? 0 : options.length - 1);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectOption(activeIndex);
    }
  }

  return (
    <div
      ref={rootRef}
      className="folder-select"
      data-open={open}
      onKeyDown={handleKeyDown}
    >
      <button
        ref={triggerRef}
        type="button"
        className="folder-select-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        onClick={() => (open ? setOpen(false) : openMenu())}
      >
        <span>{selected?.name || "选择文件夹"}</span>
        <ChevronDownIcon />
      </button>
      {open ? (
        <div
          id={listboxId}
          className="folder-select-popover"
          role="listbox"
          aria-label="文件夹"
        >
          {options.map((option, index) => (
            <button
              key={option.id}
              ref={(element) => {
                optionRefs.current[index] = element;
              }}
              type="button"
              role="option"
              aria-selected={option.id === value}
              tabIndex={index === activeIndex ? 0 : -1}
              className="folder-select-option"
              data-active={index === activeIndex}
              style={{
                "--folder-depth": option.depth
              } as React.CSSProperties}
              onPointerMove={() => setActiveIndex(index)}
              onClick={() => selectOption(index)}
            >
              <FolderIcon />
              <span>{option.name}</span>
              {option.id === value ? <span aria-hidden="true">✓</span> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

interface SettingsPageProps {
  appState: AppState | null;
  onAppStateChange: (state: AppState) => void;
  onClose: () => void;
}

function SettingsPage({
  appState,
  onAppStateChange,
  onClose
}: SettingsPageProps) {
  const [settings, setSettings] = useState<AiSettingsStatus | null>(null);
  const [provider, setProvider] = useState<AiProviderId>("gemini");
  const [model, setModel] = useState(
    getAiProviderPreset("gemini").defaultModel
  );
  const [apiKey, setApiKey] = useState("");
  const [action, setAction] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [undoBatches, setUndoBatches] = useState<UndoSnapshotBatch[]>([]);
  const backButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    backButtonRef.current?.focus();
    void sendExtensionRequest({ type: "GET_AI_SETTINGS" })
      .then((next) => {
        setSettings(next);
        setProvider(next.provider);
        setModel(next.model);
      })
      .catch((caught) =>
        setError(
          caught instanceof Error ? caught.message : "无法读取 AI 设置"
        )
      );
    void sendExtensionRequest({ type: "GET_UNDO_SNAPSHOTS" })
      .then(setUndoBatches)
      .catch((caught) =>
        setError(
          caught instanceof Error ? caught.message : "无法读取最近的更改"
        )
      );
  }, []);

  useEffect(() => {
    if (appState?.libraryScan.state !== "running") return;
    const timer = window.setInterval(() => {
      void sendExtensionRequest({ type: "GET_APP_STATE" })
        .then(onAppStateChange)
        .catch(() => undefined);
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [appState?.libraryScan.state, onAppStateChange]);

  async function saveApiSettings() {
    if (!model.trim() || action) return;
    setAction("save-key");
    setError("");
    setMessage("");
    try {
      const next = await sendExtensionRequest({
        type: "SAVE_AI_SETTINGS",
        payload: {
          provider,
          model: model.trim(),
          apiKey: apiKey.trim() || undefined
        }
      });
      setSettings(next);
      setProvider(next.provider);
      setModel(next.model);
      setApiKey("");
      setMessage(`${next.providerName} 已验证并保存。`);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "API Key 保存失败"
      );
    } finally {
      setAction("");
    }
  }

  async function handleLogin() {
    if (action) return;
    setAction("login");
    setError("");
    setMessage("");
    try {
      await signInWithGoogle();
      const state = await sendExtensionRequest({ type: "AUTH_CHANGED" });
      onAppStateChange(state);
      setMessage("Google 账号已连接。");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "登录失败");
    } finally {
      setAction("");
    }
  }

  async function handleSignOut() {
    if (action) return;
    setAction("logout");
    setError("");
    setMessage("");
    try {
      await signOut();
      const state = await sendExtensionRequest({ type: "GET_APP_STATE" });
      onAppStateChange(state);
      setMessage("已退出 Google 账号。");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "退出失败");
    } finally {
      setAction("");
    }
  }

  async function handleLibraryScan(
    intent: "start" | "pause" | "resume" | "cancel"
  ) {
    if (action) return;
    setAction(`scan-${intent}`);
    setError("");
    setMessage("");
    try {
      if (intent === "start") {
        const permissionApi = chrome.permissions;
        const granted = permissionApi?.request
          ? await permissionApi.request({
              origins: ["http://*/*", "https://*/*"]
            })
          : true;
        if (!granted) {
          throw new Error(
            "需要网页读取权限，才能为整个书签目录提取代表图、简介和标签。"
          );
        }
        await sendExtensionRequest({
          type: "START_LIBRARY_SCAN",
          force: false
        });
      } else {
        await sendExtensionRequest({
          type:
            intent === "pause"
              ? "PAUSE_LIBRARY_SCAN"
              : intent === "resume"
                ? "RESUME_LIBRARY_SCAN"
                : "CANCEL_LIBRARY_SCAN"
        });
      }
      const state = await sendExtensionRequest({ type: "GET_APP_STATE" });
      onAppStateChange(state);
      setMessage(
        intent === "start"
          ? "全目录扫描已开始，可以关闭设置页，任务会继续运行。"
          : intent === "pause"
            ? "扫描已暂停。"
            : intent === "resume"
              ? "扫描已继续。"
              : "扫描已取消。"
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "扫描操作失败");
    } finally {
      setAction("");
    }
  }

  async function handleUndoBatch(batchId: string) {
    if (action) return;
    setAction(`undo-${batchId}`);
    setError("");
    setMessage("");
    try {
      const result = await sendExtensionRequest({
        type: "UNDO_BOOKMARK_BATCH",
        batchId
      });
      setUndoBatches((current) =>
        current.filter((batch) => batch.batchId !== batchId)
      );
      setMessage(
        result.failed
          ? `已恢复 ${result.restored} 项，${result.failed} 项需要手动处理。`
          : `已撤销 ${result.restored} 项更改。`
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "撤销失败");
    } finally {
      setAction("");
    }
  }

  const accountName =
    appState?.auth.userName ||
    appState?.auth.userEmail ||
    appState?.auth.chromeProfileEmail ||
    "尚未连接";
  const providerPreset = getAiProviderPreset(provider);
  const providerConfigured = Boolean(
    settings?.configuredProviders.includes(provider)
  );
  const canSaveProvider =
    Boolean(model.trim()) &&
    (Boolean(apiKey.trim()) || providerConfigured);

  return (
    <main className="native-panel native-settings-panel">
      <header className="settings-page-header">
        <button
          ref={backButtonRef}
          type="button"
          className="icon-button settings-back-button"
          aria-label="返回我的书签"
          title="返回"
          onClick={onClose}
        >
          <ArrowLeftIcon />
        </button>
        <div>
          <h1>设置</h1>
        </div>
      </header>

      <section className="settings-page-content">
        {error ? (
          <div className="settings-notice" data-tone="error" role="alert">
            {error}
          </div>
        ) : null}
        {message ? (
          <div className="settings-notice" data-tone="success" role="status">
            {message}
          </div>
        ) : null}

        <section className="settings-section" aria-labelledby="ai-settings-title">
          <div className="settings-section-heading">
            <div>
              <h2 id="ai-settings-title">AI 服务</h2>
              <p>用于生成书签摘要和标签，增强本地检索。</p>
            </div>
            <span
              className="settings-status"
              data-active={providerConfigured}
            >
              {providerConfigured ? "已配置" : "需要 API Key"}
            </span>
          </div>

          <div
            className="settings-provider-tabs"
            role="radiogroup"
            aria-label="AI 服务商"
          >
            {AI_PROVIDER_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                role="radio"
                aria-checked={provider === preset.id}
                className="settings-provider-tab"
                data-active={provider === preset.id}
                onClick={() => {
                  setProvider(preset.id);
                  setModel(
                    settings?.providerModels[preset.id] ||
                      preset.defaultModel
                  );
                  setApiKey("");
                  setError("");
                  setMessage("");
                }}
              >
                {preset.name}
              </button>
            ))}
          </div>
          <p className="settings-provider-help">
            {providerPreset.description}
            {settings?.provider === provider &&
            settings.apiKeyConfigured &&
            settings.apiKeySuffix
              ? ` 当前 Key：•••• ${settings.apiKeySuffix}`
              : ""}
          </p>

          <label className="settings-field">
            <span>模型</span>
            <input
              type="text"
              value={model}
              onChange={(event) => setModel(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              placeholder={providerPreset.defaultModel}
            />
          </label>

          <label className="settings-field">
            <span>API Key</span>
            <input
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              placeholder={
                providerConfigured
                  ? "输入新的 Key 可替换当前配置"
                  : providerPreset.apiKeyPlaceholder
              }
            />
          </label>
          <div className="settings-field-footer">
            <p>
              Key 仅保存在这个 Chrome 配置文件中；调用时由扩展直接发送到所选 AI 服务商。
            </p>
            <button
              type="button"
              className="button button-dark button-small"
              disabled={!canSaveProvider || Boolean(action)}
              onClick={() => void saveApiSettings()}
            >
              {action === "save-key"
                ? "正在验证…"
                : "验证并保存"}
            </button>
          </div>
        </section>

        <section
          className="settings-section settings-scan-section"
          aria-labelledby="library-scan-title"
        >
          <div className="settings-section-heading">
            <div>
              <h2 id="library-scan-title">全目录扫描</h2>
              <p>
                逐个读取可访问网页，补充代表图、简介、标签和主题。
              </p>
            </div>
            <span
              className="settings-status"
              data-active={
                appState?.libraryScan.state === "running" ||
                appState?.libraryScan.state === "completed"
              }
            >
              {appState?.libraryScan.state === "running"
                ? "扫描中"
                : appState?.libraryScan.state === "paused"
                  ? "已暂停"
                  : appState?.libraryScan.state === "completed"
                    ? "已完成"
                    : "未开始"}
            </span>
          </div>
          <div className="settings-scan-progress">
            <div>
              <strong>
                {appState?.aiReadyResourceCount ?? 0}
                <span> / {appState?.localResourceCount ?? 0}</span>
              </strong>
              <small>已具备 AI 元数据</small>
            </div>
            <progress
              max={Math.max(1, appState?.libraryScan.total || 1)}
              value={appState?.libraryScan.processed || 0}
              aria-label="全目录扫描进度"
            />
            {appState?.libraryScan.currentTitle ? (
              <p title={appState.libraryScan.currentTitle}>
                正在处理：{appState.libraryScan.currentTitle}
              </p>
            ) : null}
            {appState?.libraryScan.total ? (
              <p>
                本次 {appState.libraryScan.processed}/
                {appState.libraryScan.total} · 成功{" "}
                {appState.libraryScan.succeeded} · 跳过{" "}
                {appState.libraryScan.skipped} · 失败{" "}
                {appState.libraryScan.failed}
              </p>
            ) : null}
          </div>
          <p className="settings-scan-privacy">
            代表图会压缩后只保存在本机；简介和标签会产生所选 AI 服务商的调用费用。内部网址、局域网和受保护地址不会发送给 AI。
          </p>
          <div className="settings-scan-actions">
            {appState?.libraryScan.state === "running" ? (
              <button
                type="button"
                className="button button-quiet button-small"
                disabled={Boolean(action)}
                onClick={() => void handleLibraryScan("pause")}
              >
                暂停
              </button>
            ) : appState?.libraryScan.state === "paused" ? (
              <>
                <button
                  type="button"
                  className="button button-quiet button-small"
                  disabled={Boolean(action)}
                  onClick={() => void handleLibraryScan("cancel")}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="button button-dark button-small"
                  disabled={Boolean(action)}
                  onClick={() => void handleLibraryScan("resume")}
                >
                  继续扫描
                </button>
              </>
            ) : (
              <button
                type="button"
                className="button button-dark button-small"
                disabled={
                  Boolean(action) ||
                  !settings?.apiKeyConfigured ||
                  !appState?.localResourceCount
                }
                onClick={() => void handleLibraryScan("start")}
              >
                {action === "scan-start"
                  ? "正在启动…"
                  : appState?.aiReadyResourceCount ===
                    appState?.localResourceCount &&
                    Boolean(appState?.localResourceCount)
                    ? "检查并补全"
                    : "扫描全部书签"}
              </button>
            )}
          </div>
        </section>

        <section
          className="settings-section"
          aria-labelledby="recent-changes-title"
        >
          <div className="settings-section-heading">
            <div>
              <h2 id="recent-changes-title">最近的更改</h2>
              <p>保留 30 天。恢复后 Chrome 会分配新的书签 ID，智能信息仍按网址自动关联。</p>
            </div>
          </div>
          {undoBatches.length ? (
            <div className="settings-change-list">
              {undoBatches.slice(0, 12).map((batch) => (
                <article key={batch.batchId} data-destructive={batch.destructive}>
                  <div>
                    <strong>{batch.label}</strong>
                    <small>
                      {conversationDate(batch.createdAt)}
                      {batch.destructive ? " · 回收站" : ""}
                    </small>
                  </div>
                  <button
                    type="button"
                    className="button button-quiet button-small"
                    disabled={Boolean(action)}
                    onClick={() => void handleUndoBatch(batch.batchId)}
                  >
                    {action === `undo-${batch.batchId}` ? "恢复中…" : "撤销"}
                  </button>
                </article>
              ))}
            </div>
          ) : (
            <p className="settings-empty-state">最近没有可撤销的更改。</p>
          )}
        </section>

        <section
          className="settings-section"
          aria-labelledby="account-settings-title"
        >
          <div className="settings-section-heading">
            <div>
              <h2 id="account-settings-title">Google 账号</h2>
              <p>可选，用于跨设备同步和云端备份。</p>
            </div>
          </div>
          <div className="settings-account-row">
            {appState?.auth.userAvatarUrl ? (
              <img src={appState.auth.userAvatarUrl} alt="" />
            ) : (
              <span className="settings-account-avatar">
                {accountName.slice(0, 1).toUpperCase()}
              </span>
            )}
            <div>
              <strong>{accountName}</strong>
              <small>
                {!appState?.auth.configured
                  ? "云端登录尚未配置"
                  : appState.auth.signedIn
                    ? appState.auth.accountMatches === false
                      ? "与当前 Chrome 账号不一致"
                      : "已连接"
                    : "未登录"}
              </small>
            </div>
            {appState?.auth.configured ? (
              <button
                type="button"
                className="button button-quiet button-small"
                disabled={Boolean(action)}
                onClick={() =>
                  void (appState.auth.signedIn
                    ? handleSignOut()
                    : handleLogin())
                }
              >
                {action === "login"
                  ? "登录中…"
                  : action === "logout"
                    ? "退出中…"
                    : appState.auth.signedIn
                      ? "退出"
                      : "登录"}
              </button>
            ) : null}
          </div>
        </section>

      </section>
    </main>
  );
}

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

function countBookmarks(node: NativeBookmarkNode): number {
  if (node.url) return 1;
  return (node.children || []).reduce(
    (total, child) => total + countBookmarks(child),
    0
  );
}

interface TreeProps {
  nodes: NativeBookmarkNode[];
  resourceByUrl: Map<string, ResourceRecord>;
  depth?: number;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  onOpen: (node: NativeBookmarkNode, newTab: boolean) => void;
  onEdit: (node: NativeBookmarkNode) => void;
  draggedId: string;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onMove: (
    id: string,
    parentId: string,
    index?: number
  ) => Promise<void>;
}

function BookmarkTree({
  nodes,
  resourceByUrl,
  depth = 0,
  expanded,
  onToggle,
  onOpen,
  onEdit,
  draggedId,
  onDragStart,
  onDragEnd,
  onMove
}: TreeProps) {
  const [orderedNodes, setOrderedNodes] = useState(nodes);
  const nodeElements = useRef(new Map<string, HTMLDivElement>());
  const previousPositions = useRef<Map<string, number> | null>(null);
  const lastHoverTarget = useRef("");
  const activeDragId = useRef("");

  useEffect(() => {
    setOrderedNodes(nodes);
  }, [nodes]);

  useLayoutEffect(() => {
    const positions = previousPositions.current;
    previousPositions.current = null;
    if (
      !positions ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }

    for (const node of orderedNodes) {
      const element = nodeElements.current.get(node.id);
      const previousTop = positions.get(node.id);
      if (!element || previousTop === undefined) continue;
      const deltaY = previousTop - element.getBoundingClientRect().top;
      if (Math.abs(deltaY) < 1) continue;
      element.getAnimations().forEach((animation) => animation.cancel());
      element.animate(
        [
          { transform: `translateY(${deltaY}px)` },
          { transform: "translateY(0)" }
        ],
        {
          duration: 240,
          easing: "cubic-bezier(0.22, 1, 0.36, 1)"
        }
      );
    }
  }, [orderedNodes]);

  function capturePositions(): Map<string, number> {
    return new Map(
      orderedNodes.flatMap((node) => {
        const element = nodeElements.current.get(node.id);
        return element
          ? [[node.id, element.getBoundingClientRect().top] as const]
          : [];
      })
    );
  }

  function moveDraggedNode(targetId: string) {
    const sourceId = activeDragId.current || draggedId;
    if (!sourceId || sourceId === targetId) return;
    const sourceIndex = orderedNodes.findIndex(
      (item) => item.id === sourceId
    );
    const targetIndex = orderedNodes.findIndex(
      (item) => item.id === targetId
    );
    if (sourceIndex < 0 || targetIndex < 0) return;
    const hoverKey = `${sourceId}:${targetId}`;
    if (lastHoverTarget.current === hoverKey) return;

    const next = [...orderedNodes];
    const [moved] = next.splice(sourceIndex, 1);
    next.splice(targetIndex, 0, moved);
    previousPositions.current = capturePositions();
    lastHoverTarget.current = hoverKey;
    setOrderedNodes(next);
  }

  return (
    <div className="bookmark-tree-level">
      {orderedNodes.map((node) => {
        const folder = !node.url;
        const isExpanded = expanded.has(node.id);
        const metadata = node.url
          ? resourceForUrl(resourceByUrl, node.url)
          : undefined;
        return (
          <div
            className="bookmark-node"
            key={node.id}
            ref={(element) => {
              if (element) nodeElements.current.set(node.id, element);
              else nodeElements.current.delete(node.id);
            }}
          >
            <div
              className="bookmark-row"
              data-folder={folder}
              data-expanded={folder ? isExpanded : undefined}
              data-analysis={
                folder
                  ? undefined
                  : metadata?.aiStatus === "ready"
                    ? "ready"
                    : "pending"
              }
              data-dragging={draggedId === node.id}
              draggable={!node.unmodifiable}
              style={{ "--tree-depth": depth } as React.CSSProperties}
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData(
                  "application/x-bookmark-layer-id",
                  node.id
                );
                activeDragId.current = node.id;
                onDragStart(node.id);
              }}
              onDragEnd={() => {
                activeDragId.current = "";
                lastHoverTarget.current = "";
                onDragEnd();
              }}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                moveDraggedNode(node.id);
              }}
              onDrop={(event) => {
                event.preventDefault();
                event.stopPropagation();
                const id = event.dataTransfer.getData(
                  "application/x-bookmark-layer-id"
                ) || activeDragId.current;
                if (!id || id === node.id) return;
                const reorderedIndex = orderedNodes.findIndex(
                  (item) => item.id === id
                );
                if (reorderedIndex >= 0) {
                  void onMove(
                    id,
                    node.parentId || "",
                    reorderedIndex
                  );
                  onDragEnd();
                  return;
                }
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
                aria-expanded={folder ? isExpanded : undefined}
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
                <span
                  className="tree-chevron"
                  data-visible={folder}
                  data-expanded={isExpanded}
                >
                  {folder ? <ChevronRightIcon /> : null}
                </span>
                {folder ? (
                  <span className="tree-icon" data-folder="true">
                    <FolderIcon />
                  </span>
                ) : (
                  <SiteThumbnail
                    url={node.url || ""}
                    imageUrl={
                      metadata?.thumbnailDataUrl || metadata?.imageUrl
                    }
                    faviconUrl={metadata?.faviconUrl}
                    label={node.title}
                    className="bookmark-thumbnail"
                  />
                )}
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
                  <EllipsisIcon />
                </button>
              ) : null}
            </div>

            {folder && node.children?.length ? (
              <div
                className="folder-children"
                data-expanded={isExpanded}
                aria-hidden={!isExpanded}
                inert={!isExpanded}
              >
                <div className="folder-children-inner">
                  <BookmarkTree
                    nodes={node.children}
                    resourceByUrl={resourceByUrl}
                    depth={depth + 1}
                    expanded={expanded}
                    onToggle={onToggle}
                    onOpen={onOpen}
                    onEdit={onEdit}
                    draggedId={draggedId}
                    onDragStart={onDragStart}
                    onDragEnd={onDragEnd}
                    onMove={onMove}
                  />
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

interface AgentComposerProps {
  value: string;
  busy: boolean;
  placeholder?: string;
  onChange: (value: string) => void;
  onSubmit: (event: React.FormEvent) => void;
}

function AgentComposer({
  value,
  busy,
  placeholder = "询问你的收藏…",
  onChange,
  onSubmit
}: AgentComposerProps) {
  return (
    <form
      className="agent-composer"
      onSubmit={(event) => onSubmit(event)}
    >
      <textarea
        id="bookmark-agent-prompt"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (
            event.key === "Enter" &&
            !event.shiftKey &&
            !event.nativeEvent.isComposing
          ) {
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }
        }}
        placeholder={placeholder}
        rows={2}
        aria-label={placeholder}
      />
      <div className="agent-composer-toolbar">
        <button
          type="submit"
          className="agent-send-button"
          aria-label="发送给 Aarre"
          title="发送"
          disabled={!value.trim() || busy}
        >
          <ArrowUpIcon />
        </button>
      </div>
    </form>
  );
}

function conversationDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

interface AgentChatPageProps {
  conversation: AgentConversation;
  prompt: string;
  busy: boolean;
  error: string;
  onPromptChange: (value: string) => void;
  onBack: () => void;
  onSubmit: (event: React.FormEvent) => void;
  onOpenSource: (url: string) => void;
  onConfirmActions: (messageId: string) => void;
  onCancelActions: (messageId: string) => void;
  onUndoBatch: (messageId: string, batchId: string) => void;
}

function AgentChatPage({
  conversation,
  prompt,
  busy,
  error,
  onPromptChange,
  onBack,
  onSubmit,
  onOpenSource,
  onConfirmActions,
  onCancelActions,
  onUndoBatch
}: AgentChatPageProps) {
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({
      block: "end",
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth"
    });
  }, [conversation.messages.length]);

  return (
    <main className="native-panel agent-chat-panel">
      <header className="agent-page-header">
        <button
          type="button"
          className="icon-button"
          aria-label="返回收藏列表"
          title="返回"
          onClick={onBack}
        >
          <ArrowLeftIcon />
        </button>
        <div>
          <h1>收藏对话</h1>
        </div>
      </header>
      <section className="agent-thread" aria-live="polite">
        {conversation.messages.map((message) => (
          <article
            key={message.id}
            className="agent-message"
            data-role={message.role}
            data-status={message.status || "complete"}
          >
            <div className="agent-message-copy">
              {message.status === "sending" ? (
                <div className="agent-thinking">
                  <span />
                  <span />
                  <span />
                  正在理解全部收藏…
                </div>
              ) : (
                <p>{message.content}</p>
              )}
              {message.providerName ? (
                <small>{message.providerName}</small>
              ) : null}
            </div>
            {message.sources?.length ? (
              <div className="agent-message-sources">
                <span>相关收藏</span>
                {message.sources.map((source) => (
                  <button
                    type="button"
                    key={source.resourceKey}
                    onClick={() => onOpenSource(source.url)}
                  >
                    <SiteIcon
                      url={source.url}
                      faviconUrl={source.faviconUrl}
                      label={source.siteName || source.title}
                      size={26}
                    />
                    <span>
                      <strong>{source.title}</strong>
                      <small>{hostFromUrl(source.url)}</small>
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
            {message.actions?.length ? (
              <section
                className="agent-action-card"
                aria-label="待确认的书签操作"
              >
                <header>
                  <strong>
                    {message.actions.some(
                      (action) => action.status === "pending"
                    )
                      ? "确认后才会修改 Chrome"
                      : "Chrome 操作结果"}
                  </strong>
                  <small>{message.actions.length} 项</small>
                </header>
                <ul>
                  {message.actions.map((action) => (
                    <li
                      key={action.id}
                      data-status={action.status}
                      data-destructive={action.destructive}
                    >
                      <span aria-hidden="true" />
                      <div>
                        <strong>{action.label}</strong>
                        <small>
                          {action.resultMessage || action.description}
                        </small>
                      </div>
                    </li>
                  ))}
                </ul>
                {message.actions.some(
                  (action) => action.status === "pending"
                ) ? (
                  <footer>
                    <button
                      type="button"
                      className="button-quiet"
                      disabled={busy}
                      onClick={() => onCancelActions(message.id)}
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      className={
                        message.actions.some(
                          (action) => action.destructive
                        )
                          ? "agent-action-confirm agent-action-confirm-danger"
                          : "agent-action-confirm"
                      }
                      disabled={busy}
                      onClick={() => onConfirmActions(message.id)}
                    >
                      {busy ? "正在执行…" : "确认执行"}
                    </button>
                  </footer>
                ) : null}
              </section>
            ) : null}
            {message.undoBatchId ? (
              <button
                type="button"
                className="agent-undo-button"
                disabled={busy}
                onClick={() => onUndoBatch(message.id, message.undoBatchId || "")}
              >
                {busy ? "正在恢复…" : "撤销这批操作"}
              </button>
            ) : null}
          </article>
        ))}
        {error ? (
          <div className="agent-thread-error" role="alert">
            {error}
          </div>
        ) : null}
        <div ref={endRef} />
      </section>
      <AgentComposer
        value={prompt}
        busy={busy}
        placeholder="继续询问…"
        onChange={onPromptChange}
        onSubmit={onSubmit}
      />
    </main>
  );
}

interface AgentHistoryPageProps {
  conversations: AgentConversation[];
  onBack: () => void;
  onOpen: (conversation: AgentConversation) => void;
}

function AgentHistoryPage({
  conversations,
  onBack,
  onOpen
}: AgentHistoryPageProps) {
  return (
    <main className="native-panel agent-history-panel">
      <header className="agent-page-header">
        <button
          type="button"
          className="icon-button"
          aria-label="返回收藏列表"
          title="返回"
          onClick={onBack}
        >
          <ArrowLeftIcon />
        </button>
        <div>
          <h1>历史会话</h1>
        </div>
      </header>
      <section className="agent-history-list">
        {conversations.length ? (
          conversations.map((conversation) => {
            const preview = [...conversation.messages]
              .reverse()
              .find((message) => message.role === "assistant")?.content;
            return (
              <button
                type="button"
                key={conversation.id}
                onClick={() => onOpen(conversation)}
              >
                <span>
                  <strong>{conversation.title}</strong>
                  <time>{conversationDate(conversation.updatedAt)}</time>
                </span>
                <small>{preview || "尚未生成回答"}</small>
                <ChevronRightIcon />
              </button>
            );
          })
        ) : (
          <div className="agent-history-empty">
            <HistoryIcon />
            <strong>还没有历史会话</strong>
            <p>在收藏列表底部提问后，会话会自动保存在这里。</p>
          </div>
        )}
      </section>
    </main>
  );
}

export function SidePanelApp() {
  const [snapshot, setSnapshot] = useState<BookmarkBarSnapshot | null>(null);
  const [appState, setAppState] = useState<AppState | null>(null);
  const [resources, setResources] = useState<ResourceRecord[]>([]);
  const [folders, setFolders] = useState<NativeFolderOption[]>([]);
  const [agentPrompt, setAgentPrompt] = useState("");
  const [panelView, setPanelView] = useState<
    "library" | "settings" | "chat" | "history"
  >("library");
  const [conversations, setConversations] = useState<AgentConversation[]>([]);
  const [activeConversation, setActiveConversation] =
    useState<AgentConversation | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [draggedId, setDraggedId] = useState("");
  const [editor, setEditor] = useState<EditorState>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editUrl, setEditUrl] = useState("");
  const [editTags, setEditTags] = useState<string[]>([]);
  const [editTagInput, setEditTagInput] = useState("");
  const [capture, setCapture] = useState<PageCapture | null>(null);
  const [note, setNote] = useState("");
  const [folderId, setFolderId] = useState("");
  const [requestAi, setRequestAi] = useState(true);
  const [captureWarning, setCaptureWarning] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [scrollThumb, setScrollThumb] = useState({
    scrollable: false,
    visible: false,
    height: 36,
    offset: 10,
    atEnd: false
  });
  const pendingDraftInFlight = useRef(false);
  const dialogRef = useRef<HTMLElement | null>(null);
  const contentRef = useRef<HTMLElement | null>(null);
  const scrollHideTimer = useRef<number | undefined>(undefined);
  const scrollDrag = useRef<{
    pointerId: number;
    startY: number;
    startScrollTop: number;
  } | null>(null);
  const busyRef = useRef("");
  busyRef.current = busy;

  const syncScrollThumb = useCallback((show = false) => {
    const content = contentRef.current;
    if (!content) return;
    const maxScroll = Math.max(0, content.scrollHeight - content.clientHeight);
    const trackHeight = Math.max(0, content.clientHeight - 20);
    const height =
      maxScroll > 0
        ? Math.max(
            36,
            trackHeight * (content.clientHeight / content.scrollHeight)
          )
        : trackHeight;
    const maxOffset = Math.max(0, trackHeight - height);
    const offset =
      10 + (maxScroll > 0 ? (content.scrollTop / maxScroll) * maxOffset : 0);
    setScrollThumb((current) => ({
      scrollable: maxScroll > 1,
      visible: maxScroll > 1 && (show || current.visible),
      height,
      offset,
      atEnd:
        maxScroll <= 1 || content.scrollTop >= maxScroll - 1
    }));
  }, []);

  const scheduleScrollThumbHide = useCallback(() => {
    if (scrollHideTimer.current !== undefined) {
      window.clearTimeout(scrollHideTimer.current);
    }
    scrollHideTimer.current = window.setTimeout(() => {
      setScrollThumb((current) => ({
        ...current,
        visible: false
      }));
    }, 900);
  }, []);

  const revealScrollThumb = useCallback(() => {
    syncScrollThumb(true);
    scheduleScrollThumbHide();
  }, [scheduleScrollThumbHide, syncScrollThumb]);

  const refresh = useCallback(async () => {
    const nextResources = await sendExtensionRequest({
      type: "GET_LOCAL_RESOURCES"
    });
    const [nextSnapshot, nextState] = await Promise.all([
      sendExtensionRequest({ type: "GET_BOOKMARK_BAR" }),
      sendExtensionRequest({ type: "GET_APP_STATE" })
    ]);
    setSnapshot(nextSnapshot);
    setAppState(nextState);
    setResources(nextResources);
  }, []);

  const loadConversations = useCallback(async () => {
    const next = await sendExtensionRequest({
      type: "GET_AGENT_CONVERSATIONS"
    });
    const nextConversations = Array.isArray(next) ? next : [];
    setConversations(nextConversations);
    return nextConversations;
  }, []);

  useEffect(() => {
    void refresh().catch((caught) => {
      setError(caught instanceof Error ? caught.message : "书签栏读取失败");
    });
    void loadConversations().catch((caught) => {
      setError(
        caught instanceof Error ? caught.message : "历史会话读取失败"
      );
    });

    const handleChange = () => {
      void refresh().catch((caught) => {
        setError(
          caught instanceof Error ? caught.message : "书签栏刷新失败"
        );
      });
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
  }, [loadConversations, refresh]);

  useEffect(() => {
    const handleScanUpdate = (message: {
      type?: string;
      status?: AppState["libraryScan"];
    }) => {
      if (
        message.type !== "LIBRARY_SCAN_UPDATED" ||
        !message.status
      ) {
        return;
      }
      void sendExtensionRequest({ type: "GET_LOCAL_RESOURCES" })
        .then((nextResources) => {
          const safeResources = Array.isArray(nextResources)
            ? nextResources
            : [];
          setResources(safeResources);
          setAppState((current) =>
            current
              ? {
                  ...current,
                  libraryScan: message.status!,
                  aiReadyResourceCount: safeResources.filter(
                    (resource) =>
                      resource.aiStatus === "ready" &&
                      Boolean(resource.summary) &&
                      resource.tags.length > 0
                  ).length
                }
              : current
          );
        })
        .catch(() => undefined);
    };
    chrome.runtime.onMessage.addListener(handleScanUpdate);
    return () =>
      chrome.runtime.onMessage.removeListener(handleScanUpdate);
  }, []);

  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const resizeObserver = new ResizeObserver(() => syncScrollThumb());
    resizeObserver.observe(content);
    const mutationObserver = new MutationObserver(() => {
      window.requestAnimationFrame(() => syncScrollThumb());
    });
    mutationObserver.observe(content, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-expanded"]
    });
    const frame = window.requestAnimationFrame(() => syncScrollThumb());

    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      window.cancelAnimationFrame(frame);
      if (scrollHideTimer.current !== undefined) {
        window.clearTimeout(scrollHideTimer.current);
      }
    };
  }, [panelView, syncScrollThumb]);

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
    if (!editor) return;
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const frame = window.requestAnimationFrame(() => {
      const focusable = dialogRef.current?.querySelector<HTMLElement>(
        "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]"
      );
      if (
        focusable &&
        !dialogRef.current?.contains(document.activeElement)
      ) {
        focusable.focus();
      }
    });

    const handleDialogKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busyRef.current) {
        event.preventDefault();
        setEditor(null);
        setConfirmDeleteId("");
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;

      const focusable = [
        ...dialogRef.current.querySelectorAll<HTMLElement>(
          "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]"
        )
      ];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleDialogKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleDialogKeyDown);
      previousFocus?.focus();
    };
  }, [editor]);

  const currentSavedNode = useMemo(
    () =>
      snapshot && appState?.activeTab?.url
        ? findBookmarkByUrl(
            snapshot.roots || [snapshot.root],
            appState.activeTab.url
          )
        : null,
    [appState, snapshot]
  );
  const currentWritableSavedNode = useMemo(
    () =>
      snapshot && appState?.activeTab?.url
        ? findBookmarkByUrl(
            snapshot.roots || [snapshot.root],
            appState.activeTab.url,
            true
          )
        : null,
    [appState, snapshot]
  );
  const currentSaved = Boolean(currentSavedNode);
  const visibleBookmarkNodes = useMemo(() => {
    if (!snapshot) return [];
    const roots = snapshot.roots?.length
      ? snapshot.roots
      : [snapshot.root];
    const primaryRoot =
      roots.find((root) => root.id === snapshot.primaryRootId) ||
      snapshot.root;

    return roots.flatMap((root) =>
      root.id === primaryRoot.id
        ? root.children || []
        : [{ ...root, unmodifiable: true }]
    );
  }, [snapshot]);
  const hasVisibleFolders = visibleBookmarkNodes.some(
    (node) => !node.url
  );
  const resourceByUrl = useMemo(() => {
    const map = new Map<string, ResourceRecord>();
    for (const resource of Array.isArray(resources) ? resources : []) {
      map.set(resource.url, resource);
      map.set(resource.canonicalUrl, resource);
    }
    return map;
  }, [resources]);
  const editorResource = useMemo(() => {
    if (editor?.kind !== "bookmark" || !editor.node.url) {
      return undefined;
    }
    return (
      (editor.resourceKey
        ? resources.find(
            (resource) => resource.resourceKey === editor.resourceKey
          )
        : undefined) ||
      resourceForUrl(resourceByUrl, editor.node.url)
    );
  }, [editor, resourceByUrl, resources]);

  async function openNavigation(
    input: { text: string; url?: string },
    newTab = false
  ) {
    setError("");
    try {
      await sendExtensionRequest({
        type: "NAVIGATE",
        payload: {
          text: input.text,
          url: input.url,
          disposition: newTab ? "new" : "current"
        }
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "无法打开");
    }
  }

  async function persistConversation(conversation: AgentConversation) {
    const saved = await sendExtensionRequest({
      type: "SAVE_AGENT_CONVERSATION",
      conversation
    });
    setConversations((current) => [
      saved,
      ...current.filter((item) => item.id !== saved.id)
    ]);
    return saved;
  }

  async function runAgentTurn(
    conversation: AgentConversation,
    query: string
  ) {
    if (!query || busy) return;
    const timestamp = new Date().toISOString();
    const userMessage: AgentChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: query,
      createdAt: timestamp,
      status: "complete"
    };
    const pendingMessage: AgentChatMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: "",
      createdAt: timestamp,
      status: "sending"
    };
    const pendingConversation: AgentConversation = {
      ...conversation,
      title:
        conversation.messages.length > 0
          ? conversation.title
          : query.slice(0, 36),
      updatedAt: timestamp,
      messages: [
        ...conversation.messages,
        userMessage,
        pendingMessage
      ]
    };
    setActiveConversation(pendingConversation);
    setPanelView("chat");
    setAgentPrompt("");
    setBusy("agent");
    setError("");
    setNotice("");

    try {
      await persistConversation(pendingConversation);
      const response = await sendExtensionRequest({
        type: "ASK_BOOKMARK_AGENT",
        query,
        history: conversation.messages
          .filter(
            (message) =>
              message.status !== "sending" &&
              Boolean(message.content.trim())
          )
          .slice(-10)
          .map((message) => ({
            role: message.role,
            content: message.content
          }))
      });
      const completed: AgentConversation = {
        ...pendingConversation,
        updatedAt: new Date().toISOString(),
        messages: pendingConversation.messages.map((message) =>
          message.id === pendingMessage.id
            ? {
                ...message,
                content: response.answer,
                providerName: response.providerName
                  ? `${response.providerName} · 已查看 ${response.examinedCount}/${response.catalogSize} 条收藏`
                  : undefined,
                sources: response.sources,
                actions: response.actions,
                status: "complete"
              }
            : message
        )
      };
      setActiveConversation(completed);
      await persistConversation(completed);
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "AI 暂时无法回答";
      const failed: AgentConversation = {
        ...pendingConversation,
        updatedAt: new Date().toISOString(),
        messages: pendingConversation.messages.map((item) =>
          item.id === pendingMessage.id
            ? {
                ...item,
                content: `这次没有完成：${message}`,
                status: "failed"
              }
            : item
        )
      };
      setActiveConversation(failed);
      setError(message);
      await persistConversation(failed).catch(() => undefined);
    } finally {
      setBusy("");
    }
  }

  async function handleConfirmAgentActions(messageId: string) {
    if (!activeConversation || busy) return;
    const sourceMessage = activeConversation.messages.find(
      (message) => message.id === messageId
    );
    const pendingActions = (sourceMessage?.actions || []).filter(
      (action) => action.status === "pending"
    );
    if (!sourceMessage || !pendingActions.length) return;

    const markActions = (
      actions: BookmarkAgentActionProposal[],
      status: BookmarkAgentActionProposal["status"],
      resultMessage = ""
    ) =>
      actions.map((action) =>
        action.status === "pending" || action.status === "executing"
          ? {
              ...action,
              status,
              ...(resultMessage ? { resultMessage } : {})
            }
          : action
      );

    const executingConversation: AgentConversation = {
      ...activeConversation,
      updatedAt: new Date().toISOString(),
      messages: activeConversation.messages.map((message) =>
        message.id === messageId
          ? {
              ...message,
              actions: markActions(
                message.actions || [],
                "executing"
              )
            }
          : message
      )
    };
    setActiveConversation(executingConversation);
    setBusy("agent-actions");
    setError("");

    try {
      const response = await sendExtensionRequest({
        type: "EXECUTE_BOOKMARK_AGENT_ACTIONS",
        actions: pendingActions
      });
      const resultById = new Map(
        response.results.map((result) => [result.actionId, result])
      );
      const completedActions = (sourceMessage.actions || []).map(
        (action) => {
          const result = resultById.get(action.id);
          if (!result) return action;
          return {
            ...action,
            status: result.success ? "completed" : "failed",
            resultMessage: result.message
          } satisfies BookmarkAgentActionProposal;
        }
      );
      const succeeded = response.results.filter(
        (result) => result.success
      ).length;
      const failed = response.results.length - succeeded;
      const timestamp = new Date().toISOString();
      const resultMessage: AgentChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content:
          succeeded > 0
            ? `已完成 ${succeeded} 项操作，并重新读取 Chrome 书签确认。${failed ? `另有 ${failed} 项未完成，请查看上方原因。` : ""}`
            : `没有完成任何操作。${response.results[0]?.message ? `原因：${response.results[0].message}` : ""}`,
        createdAt: timestamp,
        ...(response.batchId ? { undoBatchId: response.batchId } : {}),
        status: failed && !succeeded ? "failed" : "complete"
      };
      const completed: AgentConversation = {
        ...executingConversation,
        updatedAt: timestamp,
        messages: [
          ...executingConversation.messages.map((message) =>
            message.id === messageId
              ? { ...message, actions: completedActions }
              : message
          ),
          resultMessage
        ]
      };
      setActiveConversation(completed);
      await persistConversation(completed);
      await refresh();
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "Chrome 操作失败";
      const timestamp = new Date().toISOString();
      const failed: AgentConversation = {
        ...executingConversation,
        updatedAt: timestamp,
        messages: [
          ...executingConversation.messages.map((item) =>
            item.id === messageId
              ? {
                  ...item,
                  actions: markActions(
                    item.actions || [],
                    "failed",
                    message
                  )
                }
              : item
          ),
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: `没有完成任何操作。原因：${message}`,
            createdAt: timestamp,
            status: "failed"
          }
        ]
      };
      setActiveConversation(failed);
      setError(message);
      await persistConversation(failed).catch(() => undefined);
    } finally {
      setBusy("");
    }
  }

  function handleCancelAgentActions(messageId: string) {
    if (!activeConversation || busy) return;
    const updated: AgentConversation = {
      ...activeConversation,
      updatedAt: new Date().toISOString(),
      messages: activeConversation.messages.map((message) =>
        message.id === messageId
          ? {
              ...message,
              actions: (message.actions || []).map((action) =>
                action.status === "pending"
                  ? {
                      ...action,
                      status: "cancelled" as const,
                      resultMessage: "已取消，没有修改 Chrome。"
                    }
                  : action
              )
            }
          : message
      )
    };
    setActiveConversation(updated);
    void persistConversation(updated);
  }

  async function handleUndoAgentBatch(messageId: string, batchId: string) {
    if (!activeConversation || busy || !batchId) return;
    setBusy("agent-actions");
    setError("");
    try {
      const result = await sendExtensionRequest({
        type: "UNDO_BOOKMARK_BATCH",
        batchId
      });
      const updated: AgentConversation = {
        ...activeConversation,
        updatedAt: new Date().toISOString(),
        messages: activeConversation.messages.map((message) =>
          message.id === messageId
            ? {
                ...message,
                content: `${message.content}\n${result.failed ? `已恢复 ${result.restored} 项，${result.failed} 项需要手动处理。` : `已撤销 ${result.restored} 项更改。`}`,
                undoBatchId: undefined
              }
            : message
        )
      };
      setActiveConversation(updated);
      await persistConversation(updated);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "撤销失败");
    } finally {
      setBusy("");
    }
  }

  function handleAgentSubmit(event: React.FormEvent) {
    event.preventDefault();
    const query = agentPrompt.trim();
    if (!query || busy) return;
    const timestamp = new Date().toISOString();
    const conversation =
      panelView === "chat" && activeConversation
        ? activeConversation
        : {
            id: crypto.randomUUID(),
            title: query.slice(0, 36),
            createdAt: timestamp,
            updatedAt: timestamp,
            messages: []
          };
    void runAgentTurn(conversation, query);
  }

  async function startSave(
    draft?: PendingSaveDraft,
    existingBookmark?: NativeBookmarkNode
  ) {
    if (!appState) return;
    setEditor({ kind: "save" });
    setConfirmDeleteId("");
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
        existingBookmark?.parentId ||
          snapshot?.primaryRootId ||
          snapshot?.root.id ||
          folderOptions[0]?.id ||
          ""
      );

      if (draft?.kind === "link") {
        const page = captureFromDraft(draft);
        setCapture(page);
        setEditTitle(existingBookmark?.title || page.title);
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
        setEditTitle(
          existingBookmark?.title || draft?.title || merged.title
        );
        setRequestAi(true);
      } catch {
        const page = draft
          ? captureFromDraft(draft)
          : emptyCapture(appState);
        setCapture(page);
        setEditTitle(existingBookmark?.title || page.title);
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
    const resource = node.url
      ? resourceForUrl(resourceByUrl, node.url)
      : undefined;
    setEditor({
      kind: "bookmark",
      node,
      ...(resource ? { resourceKey: resource.resourceKey } : {})
    });
    setConfirmDeleteId("");
    setEditTitle(node.title);
    setEditUrl(node.url || "");
    setEditTags(resource?.tags || []);
    setEditTagInput("");
    setError("");
  }

  function startCreateFolder(parentId: string) {
    setEditor({ kind: "folder", parentId });
    setConfirmDeleteId("");
    setEditTitle("");
    setEditUrl("");
    setEditTags([]);
    setEditTagInput("");
    setError("");
  }

  function addEditTags(value = editTagInput) {
    if (!parseEditableTags(value).length) return;
    setEditTags((current) => mergeEditableTags(current, value));
    setEditTagInput("");
  }

  async function saveEditor() {
    if (!editor) return;
    setBusy("save");
    setError("");
    setNotice("");
    try {
      if (editor.kind === "folder") {
        await sendExtensionRequest({
          type: "CREATE_NATIVE_FOLDER",
          payload: { parentId: editor.parentId, title: editTitle }
        });
      } else if (editor.kind === "bookmark") {
        if (editor.resourceKey) {
          await sendExtensionRequest({
            type: "UPDATE_RESOURCE_TAGS",
            payload: {
              resourceKey: editor.resourceKey,
              tags: mergeEditableTags(editTags, editTagInput)
            }
          });
        }
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
        const result = await sendExtensionRequest({
          type: "SAVE_BOOKMARK",
          payload: {
            capture,
            title: editTitle,
            userNote: note,
            folderId,
            requestAi
          }
        });
        if (result.aiWarning) {
          setNotice(result.aiWarning);
        }
      }
      setEditor(null);
      setConfirmDeleteId("");
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
      setConfirmDeleteId("");
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

  function handleContentScroll() {
    revealScrollThumb();
  }

  function handleScrollThumbPointerDown(
    event: React.PointerEvent<HTMLDivElement>
  ) {
    const content = contentRef.current;
    if (!content) return;
    if (scrollHideTimer.current !== undefined) {
      window.clearTimeout(scrollHideTimer.current);
    }
    scrollDrag.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startScrollTop: content.scrollTop
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    syncScrollThumb(true);
  }

  function handleScrollThumbPointerMove(
    event: React.PointerEvent<HTMLDivElement>
  ) {
    const content = contentRef.current;
    const drag = scrollDrag.current;
    if (!content || !drag || drag.pointerId !== event.pointerId) return;
    const maxScroll = Math.max(0, content.scrollHeight - content.clientHeight);
    const trackHeight = Math.max(0, content.clientHeight - 20);
    const maxThumbTravel = Math.max(1, trackHeight - scrollThumb.height);
    content.scrollTop =
      drag.startScrollTop +
      (event.clientY - drag.startY) * (maxScroll / maxThumbTravel);
  }

  function handleScrollThumbPointerEnd(
    event: React.PointerEvent<HTMLDivElement>
  ) {
    if (scrollDrag.current?.pointerId !== event.pointerId) return;
    scrollDrag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    scheduleScrollThumbHide();
  }

  if (panelView === "settings") {
    return (
      <SettingsPage
        appState={appState}
        onAppStateChange={setAppState}
        onClose={() => setPanelView("library")}
      />
    );
  }

  if (panelView === "history") {
    return (
      <AgentHistoryPage
        conversations={conversations}
        onBack={() => setPanelView("library")}
        onOpen={(conversation) => {
          setActiveConversation(conversation);
          setAgentPrompt("");
          setError("");
          setPanelView("chat");
        }}
      />
    );
  }

  if (panelView === "chat" && activeConversation) {
    return (
      <AgentChatPage
        conversation={activeConversation}
        prompt={agentPrompt}
        busy={busy === "agent" || busy === "agent-actions"}
        error={error}
        onPromptChange={setAgentPrompt}
        onBack={() => {
          setError("");
          setPanelView("library");
        }}
        onSubmit={handleAgentSubmit}
        onOpenSource={(url) =>
          void openNavigation({ text: url, url }, true)
        }
        onConfirmActions={(messageId) =>
          void handleConfirmAgentActions(messageId)
        }
        onCancelActions={handleCancelAgentActions}
        onUndoBatch={(messageId, batchId) =>
          void handleUndoAgentBatch(messageId, batchId)
        }
      />
    );
  }

  return (
    <main className="native-panel">
      <header className="native-header">
        <div className="native-title-row">
          <h1>我的书签</h1>
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
            <PlusIcon />
          </button>
          <button
            type="button"
            className="icon-button star-button"
            data-saved={currentSaved}
            title={currentSaved ? "编辑当前页面书签" : "收藏当前页面"}
            aria-label={currentSaved ? "编辑当前页面书签" : "收藏当前页面"}
            onClick={() =>
              void startSave(
                undefined,
                currentWritableSavedNode || undefined
              )
            }
            disabled={!appState?.activeTab?.url}
          >
            <StarIcon filled={currentSaved} />
          </button>
          <button
            type="button"
            className="icon-button history-button"
            title="历史会话"
            aria-label="打开历史会话"
            onClick={() => {
              void loadConversations();
              setPanelView("history");
            }}
          >
            <HistoryIcon />
          </button>
          <button
            type="button"
            className="icon-button settings-button"
            title="设置"
            aria-label="打开设置"
            onClick={() => setPanelView("settings")}
          >
            <SettingsIcon />
          </button>
        </div>
      </header>

      {error ? (
        <div className="native-error" role="alert">
          <span>{error}</span>
          <button
            type="button"
            aria-label="关闭错误提示"
            onClick={() => setError("")}
          >
            <CloseIcon />
          </button>
        </div>
      ) : null}
      {notice && !error ? (
        <div className="native-notice" role="status">
          <span>{notice}</span>
          <button
            type="button"
            aria-label="关闭提示"
            onClick={() => setNotice("")}
          >
            <CloseIcon />
          </button>
        </div>
      ) : null}

      <div
        className="native-content-frame"
        data-has-folders={hasVisibleFolders}
        data-at-end={scrollThumb.atEnd}
      >
        <section
          id="bookmark-list"
          ref={contentRef}
          className="native-content"
          data-has-folders={hasVisibleFolders}
          aria-label="Chrome 书签栏"
          onScroll={handleContentScroll}
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
          {snapshot ? (
            visibleBookmarkNodes.length ? (
              <BookmarkTree
                nodes={visibleBookmarkNodes}
                resourceByUrl={resourceByUrl}
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
                      url: node.url
                    },
                    newTab
                  )
                }
                onEdit={startEdit}
                draggedId={draggedId}
                onDragStart={setDraggedId}
                onDragEnd={() => setDraggedId("")}
                onMove={moveNode}
              />
            ) : (
              <div className="native-empty">
                <span>
                  <StarIcon />
                </span>
                <strong>Chrome 书签还是空的</strong>
                <p>点击右上角星标，或使用 Chrome 自带星标开始收藏。</p>
              </div>
            )
          ) : (
            <div className="native-loading">正在读取 Chrome 书签栏…</div>
          )}
        </section>
        {scrollThumb.scrollable ? (
          <div
            className="native-scroll-thumb"
            data-visible={scrollThumb.visible}
            style={{
              height: `${scrollThumb.height}px`,
              transform: `translateY(${scrollThumb.offset}px)`
            }}
            role="scrollbar"
            aria-controls="bookmark-list"
            aria-orientation="vertical"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={
              contentRef.current
                ? Math.round(
                    (contentRef.current.scrollTop /
                      Math.max(
                        1,
                        contentRef.current.scrollHeight -
                          contentRef.current.clientHeight
                      )) *
                      100
                  )
                : 0
            }
            onPointerDown={handleScrollThumbPointerDown}
            onPointerMove={handleScrollThumbPointerMove}
            onPointerUp={handleScrollThumbPointerEnd}
            onPointerCancel={handleScrollThumbPointerEnd}
          />
        ) : null}
      </div>

      <AgentComposer
        value={agentPrompt}
        busy={Boolean(busy)}
        onChange={setAgentPrompt}
        onSubmit={handleAgentSubmit}
      />

      {editor ? (
        <div
          className="native-dialog-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !busy) {
              setEditor(null);
              setConfirmDeleteId("");
            }
          }}
        >
          <section
            ref={dialogRef}
            className={`native-dialog ${
              editor.kind === "bookmark" && editor.node.url
                ? "bookmark-detail-dialog"
                : ""
            }`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="native-dialog-title"
          >
            <div className="native-dialog-heading">
              <div>
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
                onClick={() => {
                  setEditor(null);
                  setConfirmDeleteId("");
                }}
                disabled={Boolean(busy)}
                aria-label="关闭"
              >
                <CloseIcon />
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
                  <>
                    <label className="native-field">
                      <span>网址</span>
                      <input
                        value={editUrl}
                        onChange={(event) => setEditUrl(event.target.value)}
                      />
                    </label>

                    <section
                      className="bookmark-analysis"
                      aria-labelledby="bookmark-analysis-title"
                    >
                      <header>
                        <div>
                          <strong id="bookmark-analysis-title">
                            AI 分析
                          </strong>
                          <small>
                            主题是 AI 归纳的内容方向；标签是用于查找和整理的关键词，可以自行修改。
                          </small>
                        </div>
                        {editorResource?.aiStatus !== "ready" ? (
                          <span data-tone="pending">
                            {editorResource?.aiStatus === "processing"
                              ? "分析中"
                              : "待分析"}
                          </span>
                        ) : null}
                      </header>

                      <div className="analysis-copy">
                        <p>
                          {editorResource?.summary ||
                            "这个书签还没有生成简介。连接 AI 后，可在设置中启动全目录扫描。"}
                        </p>
                      </div>

                      <div className="analysis-topics">
                        <span>主题</span>
                        {editorResource?.topics.length ? (
                          <div>
                            {editorResource.topics.map((topic) => (
                              <em key={topic}>{topic}</em>
                            ))}
                          </div>
                        ) : (
                          <p>尚未识别主题</p>
                        )}
                      </div>

                      <div className="analysis-tags">
                        <div className="analysis-tags-heading">
                          <span>标签</span>
                        </div>
                        <div
                          className="editable-tag-list"
                          aria-label="当前标签"
                        >
                          {editTags.length ? (
                            editTags.map((tag) => (
                              <span key={tag}>
                                {tag}
                                <button
                                  type="button"
                                  aria-label={`移除标签 ${tag}`}
                                  onClick={() =>
                                    setEditTags((current) =>
                                      current.filter(
                                        (item) => item !== tag
                                      )
                                    )
                                  }
                                >
                                  <CloseIcon />
                                </button>
                              </span>
                            ))
                          ) : (
                            <small>还没有标签</small>
                          )}
                        </div>
                        <div className="tag-entry">
                          <input
                            value={editTagInput}
                            onChange={(event) =>
                              setEditTagInput(event.target.value)
                            }
                            onKeyDown={(event) => {
                              if (
                                event.key === "Enter" ||
                                event.key === "," ||
                                event.key === "，"
                              ) {
                                event.preventDefault();
                                addEditTags();
                              }
                            }}
                            maxLength={120}
                            aria-label="添加标签"
                            placeholder="输入标签，按回车添加"
                          />
                          <button
                            type="button"
                            onClick={() => addEditTags()}
                            disabled={!editTagInput.trim()}
                          >
                            添加
                          </button>
                        </div>
                      </div>
                    </section>
                  </>
                ) : null}

                {editor.kind === "save" ? (
                  <>
                    <div className="native-field">
                      <span>文件夹</span>
                      <FolderSelect
                        options={folders}
                        value={folderId}
                        onChange={setFolderId}
                      />
                    </div>
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
                          保存后由设置中选择的 AI 服务处理；不需要连接云端。
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
                  !editor.node.folderType &&
                  confirmDeleteId === editor.node.id ? (
                    <div
                      className="delete-confirmation"
                      role="group"
                      aria-label="确认删除"
                    >
                      <p role="alert">
                        {editor.node.url
                          ? "将从 Chrome 永久删除这个书签，此操作无法撤销。"
                          : `将永久删除整个文件夹及其中 ${countBookmarks(editor.node)} 个书签，此操作无法撤销。`}
                      </p>
                      <div>
                        <button
                          type="button"
                          className="button button-quiet"
                          onClick={() => setConfirmDeleteId("")}
                          disabled={Boolean(busy)}
                        >
                          取消
                        </button>
                        <button
                          type="button"
                          className="danger-button"
                          data-confirming="true"
                          onClick={() => void deleteEditorNode()}
                          disabled={Boolean(busy)}
                        >
                          {busy === "delete"
                            ? "正在删除…"
                            : "确认"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {editor.kind === "bookmark" &&
                      !editor.node.folderType ? (
                        <button
                          type="button"
                          className="danger-button"
                          onClick={() =>
                            setConfirmDeleteId(editor.node.id)
                          }
                          disabled={Boolean(busy)}
                        >
                          {editor.node.url
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
                          onClick={() => {
                            setEditor(null);
                            setConfirmDeleteId("");
                          }}
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
                    </>
                  )}
                </div>
              </>
            )}
          </section>
        </div>
      ) : null}
    </main>
  );
}

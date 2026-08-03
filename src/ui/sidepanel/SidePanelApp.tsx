import { Button } from "../../components/ui/button";
import { TabsSubtle, TabsSubtleItem } from "../../components/ui/tabs-subtle";
import {
  FluidInput,
  FluidTextarea,
  FluidSelect,
} from "../components/FluidControls";
import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  bookmarkMatchUrls,
  bookmarkNodesByUrl,
  collectFolderIds,
  filterBookmarkTree,
} from "../../lib/bookmark-search";
import {
  buildBookmarkBarSnapshot,
  visibleBookmarkRootChildren,
} from "../../lib/bookmark-tree";
import {
  buildBookmarkEditorModel,
  mergeBookmarkEditorTags,
} from "../../lib/bookmark-editor";
import { buildBookmarkSaveState } from "../../lib/bookmark-save-state";
import { registrableHost } from "../../lib/cover-registry";
import { sendExtensionRequest } from "../../lib/messages";
import { pendingSaveReadyTabId } from "../../lib/pending-save";
import { currentSiteBrandImageUrl } from "../../lib/thumbnail";
import {
  initialSaveFolderId,
  visibleFolderLabel,
  visibleFolderPath,
} from "../../lib/folder-options";
import {
  buildLocalSearchIndex,
  hydratePinyinSearchIndex,
  isPinyinSearchQuery,
  searchLocalIndex,
} from "../../lib/search";
import { canonicalizeUrl } from "../../lib/url";
import { downloadAarreDataExport } from "../../lib/data-export";
import { AI_PROVIDER_PRESETS, getAiProviderPreset } from "../../lib/settings";
import {
  getDisplaySettings,
  requestPageSnapshotPermission,
  saveDisplaySettings,
  type ListCoverStyle,
} from "../../lib/display-settings";
import { needsAiEnrichment } from "../../lib/ai-fields";
import { estimateScanTokens } from "../../lib/ai-cost";
import {
  getSidepanelState,
  saveSidepanelState,
} from "../../lib/sidepanel-state";
import {
  completeOnboarding,
  getOnboardingState,
  restartOnboarding,
} from "../../lib/onboarding";
import type {
  AiProviderId,
  AiSettingsStatus,
  AgentChatMessage,
  AgentConversation,
  BookmarkAgentProgress,
  BookmarkAgentProgressStage,
  AppState,
  BookmarkAgentActionProposal,
  BookmarkBarSnapshot,
  BookmarkSaveMatch,
  BookmarkSaveState,
  FolderSuggestion,
  LibraryScanEstimate,
  NativeBookmarkNode,
  NativeFolderOption,
  OrganizationNotice,
  PendingSaveDraft,
  PageCapture,
  PageSnapshot,
  ResourceRecord,
  ResurfacingItem,
  SiteBrandRecord,
  UndoSnapshotBatch,
} from "../../lib/types";
import { ResourceIdentity } from "../components/ResourceIdentity";
import { BookmarkEditorFields } from "../components/BookmarkEditorFields";
import { CloudConflictNotice } from "../components/CloudConflictNotice";
import { ProtectionControl } from "../components/ProtectionControl";
import {
  ArrowLeftIcon,
  ArrowUpIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CloseIcon,
  EllipsisIcon,
  ExternalLinkIcon,
  FolderIcon,
  HistoryIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  StarIcon,
  StopIcon,
  TrashIcon,
} from "../components/Icons";
import { SiteThumbnail } from "../components/SiteThumbnail";
import { useDebouncedSearchQuery } from "../hooks/useDebouncedSearchQuery";
import type {
  CloudStorageUsage,
  CloudSyncSettings,
} from "../../lib/cloud-settings";
import type { CloudSyncProgress } from "../../lib/cloud-progress";

type EditorState =
  | {
      kind: "bookmark";
      node: NativeBookmarkNode;
      resourceKey?: string;
    }
  | { kind: "folder"; parentId: string }
  | { kind: "save" }
  | null;

function formatStorageBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(0, bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function cloudSyncProgressLabel(progress: CloudSyncProgress): string {
  const resourceTotal = progress.resourceTotal;
  const assetTotal = progress.assetTotal;
  const resourceDone =
    progress.resourceProcessed + progress.resourceFailed;
  const assetDone = progress.assetProcessed;
  if (progress.phase === "error") {
    return progress.error ? `同步未完成：${progress.error}` : "同步未完成。";
  }
  if (progress.phase === "completed") {
    if (!resourceTotal && !assetTotal) return "同步完成：内容已是最新。";
    const summary = `${resourceDone} / ${resourceTotal} 条收藏${
      assetTotal ? `，图片 ${assetDone} / ${assetTotal}` : ""
    }`;
    return progress.resourceFailed
      ? `同步完成：${summary}，${progress.resourceFailed} 条稍后重试。`
      : `同步完成：${summary}。`;
  }
  if (progress.phase === "syncing") {
    if (!resourceTotal && !assetTotal) return progress.statusText || "正在同步…";
    return `正在同步：${resourceDone} / ${resourceTotal} 条收藏${
      assetTotal ? `，图片 ${assetDone} / ${assetTotal}` : ""
    }`;
  }
  return "尚未开始同步。";
}

/**
 * The native tree is the first-paint source of truth. Reading it in the
 * side-panel keeps the initial list independent from the service worker's
 * IndexedDB reconciliation, which may still be processing a large library.
 * The message fallback keeps the local design preview working, where the
 * Chrome bookmarks API is intentionally only mocked through runtime messages.
 */
async function readNativeBookmarkSnapshot(): Promise<BookmarkBarSnapshot> {
  const nativeBookmarks =
    typeof chrome !== "undefined" ? chrome.bookmarks : undefined;
  if (nativeBookmarks && typeof nativeBookmarks.getTree === "function") {
    return buildBookmarkBarSnapshot(await nativeBookmarks.getTree());
  }
  return sendExtensionRequest({ type: "GET_BOOKMARK_BAR" });
}

function resourceForUrl(
  resourceByUrl: Map<string, ResourceRecord>,
  url: string,
): ResourceRecord | undefined {
  const direct = resourceByUrl.get(url);
  if (direct) return direct;
  try {
    return resourceByUrl.get(canonicalizeUrl(url));
  } catch {
    return undefined;
  }
}

function siteBrandForUrl(
  siteBrandByHost: Map<string, SiteBrandRecord>,
  input: string,
): SiteBrandRecord | undefined {
  try {
    const host = new URL(input).hostname.toLocaleLowerCase();
    return (
      siteBrandByHost.get(host) || siteBrandByHost.get(registrableHost(host))
    );
  } catch {
    return undefined;
  }
}

function bookmarkMatchLocation(match: BookmarkSaveMatch): string {
  return match.folderPath.filter(Boolean).join(" / ") || "Chrome 书签";
}

export function highlightTextMatches(
  text: string,
  query: string,
): React.ReactNode {
  const needle = query.trim();
  if (!needle) return text;

  const expression = new RegExp(
    needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    "giu",
  );
  const parts: React.ReactNode[] = [];
  let cursor = 0;

  for (const match of text.matchAll(expression)) {
    const matchIndex = match.index;
    if (matchIndex > cursor) {
      parts.push(text.slice(cursor, matchIndex));
    }
    const matchEnd = matchIndex + match[0].length;
    parts.push(
      <mark key={`${matchIndex}:${matchEnd}`}>
        {text.slice(matchIndex, matchEnd)}
      </mark>,
    );
    cursor = matchEnd;
  }

  if (!parts.length) return text;
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}

interface FolderSelectProps {
  options: NativeFolderOption[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

function FolderSelect({
  options,
  value,
  onChange,
  disabled = false,
}: FolderSelectProps) {
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.id === value),
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
        openMenu(event.key === "ArrowUp" ? options.length - 1 : selectedIndex);
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
      <Button
        variant="unstyled"
        ref={triggerRef}
        type="button"
        className="folder-select-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        onClick={() => (open ? setOpen(false) : openMenu())}
        disabled={disabled || !options.length}
      >
        <span>
          {selected?.name || (options.length ? "选择文件夹" : "暂无自建文件夹")}
        </span>
        <ChevronDownIcon />
      </Button>
      {open ? (
        <div
          id={listboxId}
          className="folder-select-popover"
          role="listbox"
          aria-label="文件夹"
        >
          {options.map((option, index) => (
            <Button
              key={option.id}
              ref={(element) => {
                optionRefs.current[index] = element;
              }}
              type="button"
              variant="ghost"
              role="option"
              aria-selected={option.id === value}
              tabIndex={index === activeIndex ? 0 : -1}
              className="folder-select-option"
              data-active={index === activeIndex}
              style={
                {
                  "--folder-depth": option.depth,
                } as React.CSSProperties
              }
              onPointerMove={() => setActiveIndex(index)}
              onClick={() => selectOption(index)}
            >
              <FolderIcon />
              <span>{option.name}</span>
              {option.id === value ? <span aria-hidden="true">✓</span> : null}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

interface OnboardingPageProps {
  resourceCount: number;
  initialAiConfigured: boolean;
  onComplete: (skipped: boolean, aiConfigured: boolean) => void;
}

function OnboardingPage({
  resourceCount,
  initialAiConfigured,
  onComplete,
}: OnboardingPageProps) {
  const [step, setStep] = useState(0);
  const [provider, setProvider] = useState<AiProviderId>("gemini");
  const preset = getAiProviderPreset(provider);
  const [models, setModels] = useState<Record<AiProviderId, string>>({
    gemini: getAiProviderPreset("gemini").defaultModel,
    openai: getAiProviderPreset("openai").defaultModel,
    deepseek: getAiProviderPreset("deepseek").defaultModel,
  });
  const [apiKey, setApiKey] = useState("");
  const [configured, setConfigured] = useState(initialAiConfigured);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const estimatedMinutes = Math.max(1, Math.ceil(resourceCount / 60));
  const estimatedTokens = estimateScanTokens(resourceCount);

  async function saveProvider() {
    if (!apiKey.trim() || busy) return;
    setBusy("provider");
    setError("");
    try {
      await sendExtensionRequest({
        type: "SAVE_AI_SETTINGS",
        payload: {
          provider,
          model: models[provider],
          apiKey: apiKey.trim(),
        },
      });
      setConfigured(true);
      setApiKey("");
      setStep(2);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "API Key 验证失败");
    } finally {
      setBusy("");
    }
  }

  async function finish(skipped: boolean, scan: boolean) {
    if (busy) return;
    setBusy(scan ? "scan" : "finish");
    setError("");
    try {
      if (scan) {
        const granted = await requestPageSnapshotPermission();
        if (!granted) {
          throw new Error("未获得网页读取权限，尚未开始扫描。");
        }
        await sendExtensionRequest({
          type: "START_LIBRARY_SCAN",
          force: false,
        });
      }
      await completeOnboarding(skipped);
      onComplete(skipped, configured);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "引导操作失败");
    } finally {
      setBusy("");
    }
  }

  return (
    <main className="native-panel onboarding-panel">
      <header>
        <span className="eyebrow">AARRE · {step + 1}/3</span>
        <Button
          variant="unstyled"
          type="button"
          className="text-button"
          disabled={Boolean(busy)}
          onClick={() => void finish(true, false)}
        >
          跳过引导
        </Button>
      </header>
      <section className="onboarding-card">
        {step === 0 ? (
          <>
            <div className="onboarding-mark">
              <StarIcon filled />
            </div>
            <h1>你的 Chrome 书签，原样保留</h1>
            <p>
              Aarre 直接读取你已有的 Chrome
              原生书签，不需要导入，也不会偷偷移动或删除。Chrome
              始终是唯一事实来源。
            </p>
            <div className="onboarding-facts">
              <span>已发现 {resourceCount.toLocaleString("zh-CN")} 条书签</span>
              <span>所有写操作先确认，并可在 30 天内撤销</span>
              <span>新收藏和正常打开的缺图旧收藏会在本机补齐真实预览快照</span>
            </div>
            <Button
              variant="unstyled"
              type="button"
              className="button button-dark"
              onClick={() => setStep(1)}
            >
              继续
            </Button>
          </>
        ) : step === 1 ? (
          <form
            className="onboarding-provider-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (configured && !apiKey.trim()) {
                setStep(2);
              } else {
                void saveProvider();
              }
            }}
          >
            <h1>连接你自己的 AI 服务</h1>
            <p>
              API Key 只保存在当前 Chrome 配置文件中，扩展直接调用服务商；Aarre
              不经手你的 Key。
            </p>
            <TabsSubtle
              selectedIndex={Math.max(
                0,
                AI_PROVIDER_PRESETS.findIndex((item) => item.id === provider),
              )}
              onSelect={(index) => {
                const next = AI_PROVIDER_PRESETS[index];
                if (next) setProvider(next.id);
              }}
              equalWidth
              className="settings-provider-tabs"
              aria-label="AI 服务商"
            >
              {AI_PROVIDER_PRESETS.map((item, index) => (
                <TabsSubtleItem
                  key={item.id}
                  index={index}
                  label={item.name}
                  className="settings-provider-tab"
                />
              ))}
            </TabsSubtle>
            <label className="settings-field">
              <span>模型</span>
              <FluidInput
                value={models[provider]}
                onChange={(event) =>
                  setModels((current) => ({
                    ...current,
                    [provider]: event.target.value,
                  }))
                }
              />
            </label>
            <label className="settings-field">
              <span>{preset.name} API Key</span>
              <FluidInput
                type="password"
                value={apiKey}
                autoComplete="off"
                placeholder={preset.apiKeyPlaceholder}
                onChange={(event) => setApiKey(event.target.value)}
              />
            </label>
            {error ? (
              <div className="settings-notice" data-tone="error" role="alert">
                {error}
              </div>
            ) : null}
            <div className="onboarding-actions">
              <Button
                variant="unstyled"
                type="button"
                className="button button-quiet"
                disabled={Boolean(busy)}
                onClick={() => setStep(2)}
              >
                先跳过，只管理书签
              </Button>
              <Button
                variant="unstyled"
                type="submit"
                className="button button-dark"
                disabled={
                  (!configured && !apiKey.trim()) ||
                  !models[provider].trim() ||
                  Boolean(busy)
                }
              >
                {busy === "provider"
                  ? "正在验证…"
                  : configured && !apiKey.trim()
                    ? "使用现有配置继续"
                    : "验证并继续"}
              </Button>
            </div>
          </form>
        ) : (
          <>
            <h1>让收藏变得可搜索</h1>
            <p>
              扫描会为公开网页补充清晰站点标识与页面封面
              {configured ? "，并生成摘要、标签和检索别名" : ""}。
            </p>
            <div className="onboarding-estimate">
              <strong>{resourceCount.toLocaleString("zh-CN")} 条</strong>
              <span>预计约 {estimatedMinutes} 分钟</span>
              {configured ? (
                <span>
                  预计用量 输入约{" "}
                  {estimatedTokens.estimatedInputTokens.toLocaleString()} ·
                  输出约{" "}
                  {estimatedTokens.estimatedOutputTokens.toLocaleString()}
                </span>
              ) : (
                <span>未连接 AI，本轮不会消耗 token</span>
              )}
            </div>
            <p className="onboarding-privacy">
              用量取决于服务商、模型和网页长度，以服务商实际返回为准。内网、银行、支付和医疗站点不处理；新收藏或正常打开的缺图旧收藏会生成页面快照，已有截图最多每
              7 天静默刷新一次，并且只保存在本机。
            </p>
            {error ? (
              <div className="settings-notice" data-tone="error">
                {error}
              </div>
            ) : null}
            <div className="onboarding-actions">
              <Button
                variant="unstyled"
                type="button"
                className="button button-quiet"
                disabled={Boolean(busy)}
                onClick={() => void finish(false, false)}
              >
                以后再说
              </Button>
              <Button
                variant="unstyled"
                type="button"
                className="button button-dark"
                disabled={!resourceCount || Boolean(busy)}
                onClick={() => void finish(false, true)}
              >
                {busy === "scan" ? "正在启动…" : "现在扫描"}
              </Button>
            </div>
          </>
        )}
      </section>
    </main>
  );
}

interface SettingsPageProps {
  appState: AppState | null;
  listCoverStyle: ListCoverStyle;
  onListCoverStyleChange: (style: ListCoverStyle) => void;
  onRestartOnboarding: () => void;
  onAppStateChange: (state: AppState) => void;
  onClose: () => void;
}

function SettingsPage({
  appState,
  listCoverStyle,
  onListCoverStyleChange,
  onRestartOnboarding,
  onAppStateChange,
  onClose,
}: SettingsPageProps) {
  const [settings, setSettings] = useState<AiSettingsStatus | null>(null);
  const [provider, setProvider] = useState<AiProviderId>("gemini");
  const [model, setModel] = useState(
    getAiProviderPreset("gemini").defaultModel,
  );
  const [apiKey, setApiKey] = useState("");
  const [action, setAction] = useState("");
  const [providerFeedback, setProviderFeedback] = useState<{
    tone: "error" | "success";
    message: string;
  } | null>(null);
  const [scanFeedback, setScanFeedback] = useState<{
    tone: "error" | "success";
    message: string;
  } | null>(null);
  const [undoBatches, setUndoBatches] = useState<UndoSnapshotBatch[]>([]);
  const [scanEstimate, setScanEstimate] = useState<LibraryScanEstimate | null>(
    null,
  );
  const [cloudSettings, setCloudSettings] =
    useState<CloudSyncSettings | null>(null);
  const [cloudUsage, setCloudUsage] = useState<CloudStorageUsage | null>(null);
  const [cloudSyncProgress, setCloudSyncProgress] =
    useState<CloudSyncProgress | null>(null);
  const [cloudFeedback, setCloudFeedback] = useState<{
    tone: "error" | "success";
    message: string;
  } | null>(null);
  // Everything that is read once and then never touched again lives on a
  // second page, so the first screen stays at three decisions.
  const [settingsPage, setSettingsPage] = useState<"main" | "more">("main");
  const backButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    backButtonRef.current?.focus();
    void sendExtensionRequest({ type: "GET_AI_SETTINGS" })
      .then((next) => {
        setSettings(next);
        setProvider(next.provider);
        setModel(next.model);
      })
      .catch((caught) => {
        setProviderFeedback({
          tone: "error",
          message:
            caught instanceof Error
              ? caught.message
              : "无法读取 AI 服务配置。",
        });
      });
    void sendExtensionRequest({ type: "GET_UNDO_SNAPSHOTS" })
      .then(setUndoBatches)
      .catch(() => {
        /* 设置页不再展示顶部提示条 */
      });
  }, []);

  useEffect(() => {
    if (!appState?.auth.signedIn) {
      setCloudSettings(null);
      setCloudUsage(null);
      setCloudSyncProgress(null);
      return;
    }
    let disposed = false;
    const refreshCloudState = () => {
      void sendExtensionRequest({ type: "GET_CLOUD_SETTINGS" })
        .then((next) => {
          if (!disposed) setCloudSettings(next);
        })
        .catch(() => undefined);
      void sendExtensionRequest({ type: "GET_CLOUD_USAGE" })
        .then((next) => {
          if (!disposed) setCloudUsage(next);
        })
        .catch(() => undefined);
      void sendExtensionRequest({ type: "GET_CLOUD_SYNC_PROGRESS" })
        .then((next) => {
          if (!disposed) setCloudSyncProgress(next);
        })
        .catch(() => undefined);
    };
    refreshCloudState();
    const shouldPoll =
      cloudSettings?.enabled || cloudSyncProgress?.phase === "syncing";
    if (!shouldPoll) return () => {
      disposed = true;
    };
    const timer = window.setInterval(refreshCloudState, 1_000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [
    appState?.auth.signedIn,
    cloudSettings?.enabled,
    cloudSyncProgress?.phase,
  ]);

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
    setProviderFeedback(null);
    try {
      const next = await sendExtensionRequest({
        type: "SAVE_AI_SETTINGS",
        payload: {
          provider,
          model: model.trim(),
          apiKey: apiKey.trim() || undefined,
        },
      });
      setSettings(next);
      setProvider(next.provider);
      setModel(next.model);
      setApiKey("");
      setProviderFeedback({
        tone: "success",
        message: `${next.providerName} 已验证并保存。`,
      });
    } catch (caught) {
      setProviderFeedback({
        tone: "error",
        message:
          caught instanceof Error ? caught.message : "API Key 验证失败。",
      });
    } finally {
      setAction("");
    }
  }

  async function handleLogin() {
    if (action) return;
    setAction("login");
    setCloudFeedback(null);
    try {
      const state = await sendExtensionRequest({ type: "SIGN_IN_CLOUD" });
      onAppStateChange(state);
      setCloudFeedback({
        tone: "success",
        message: "账号已连接。云端恢复与同步会在后台继续，你可以继续使用侧边栏。",
      });
    } catch (caught) {
      setCloudFeedback({
        tone: "error",
        message: caught instanceof Error ? caught.message : "Google 登录失败。",
      });
    } finally {
      setAction("");
    }
  }

  async function handleSignOut() {
    if (action) return;
    setAction("logout");
    setCloudFeedback(null);
    try {
      const state = await sendExtensionRequest({ type: "SIGN_OUT_CLOUD" });
      onAppStateChange(state);
    } catch (caught) {
      setCloudFeedback({
        tone: "error",
        message: caught instanceof Error ? caught.message : "退出账号失败。",
      });
    } finally {
      setAction("");
    }
  }

  async function handleCloudSettings(next: Pick<CloudSyncSettings, "enabled">) {
    if (action) return;
    setAction("cloud-settings");
    setCloudFeedback(null);
    try {
      const saved = await sendExtensionRequest({
        type: "SAVE_CLOUD_SETTINGS",
        payload: next,
      });
      setCloudSettings(saved);
      onAppStateChange(
        await sendExtensionRequest({ type: "GET_APP_STATE" }),
      );
      setCloudUsage(
        await sendExtensionRequest({ type: "GET_CLOUD_USAGE" }),
      );
      setCloudSyncProgress(
        await sendExtensionRequest({ type: "GET_CLOUD_SYNC_PROGRESS" }),
      );
      setCloudFeedback({
        tone: "success",
        message: saved.enabled
          ? "完整备份已开启。"
          : "云端同步已暂停，云端现有数据仍然保留。",
      });
    } catch (caught) {
      setCloudFeedback({
        tone: "error",
        message: caught instanceof Error ? caught.message : "云端设置保存失败。",
      });
    } finally {
      setAction("");
    }
  }

  async function handleLibraryScan(
    intent: "start" | "pause" | "resume" | "cancel",
  ) {
    if (action) return;
    setAction(`scan-${intent}`);
    setScanFeedback(null);
    try {
      if (intent === "start") {
        if (!scanEstimate) {
          const estimate = await sendExtensionRequest({
            type: "GET_LIBRARY_SCAN_ESTIMATE",
            force: false,
          });
          setScanEstimate(estimate);
          return;
        }
        const granted = await requestPageSnapshotPermission();
        if (!granted) {
          throw new Error(
            "需要网页读取权限，才能为整个书签目录提取代表图、简介和标签。",
          );
        }
        await sendExtensionRequest({
          type: "START_LIBRARY_SCAN",
          force: false,
        });
        setScanEstimate(null);
      } else {
        await sendExtensionRequest({
          type:
            intent === "pause"
              ? "PAUSE_LIBRARY_SCAN"
              : intent === "resume"
                ? "RESUME_LIBRARY_SCAN"
                : "CANCEL_LIBRARY_SCAN",
        });
      }
      const state = await sendExtensionRequest({ type: "GET_APP_STATE" });
      onAppStateChange(state);
      setScanFeedback({
        tone: "success",
        message:
          intent === "start"
            ? "书签增强已开始，将在后台继续处理。"
            : intent === "pause"
              ? "书签增强已暂停。"
              : intent === "resume"
                ? "书签增强已继续。"
                : "书签增强已取消。",
      });
    } catch (caught) {
      setScanFeedback({
        tone: "error",
        message:
          caught instanceof Error ? caught.message : "书签增强操作失败。",
      });
    } finally {
      setAction("");
    }
  }

  async function handleUndoBatch(batchId: string) {
    if (action) return;
    setAction(`undo-${batchId}`);
    try {
      await sendExtensionRequest({
        type: "UNDO_BOOKMARK_BATCH",
        batchId,
      });
      setUndoBatches((current) =>
        current.filter((batch) => batch.batchId !== batchId),
      );
    } catch {
      /* 设置页不再展示顶部提示条 */
    } finally {
      setAction("");
    }
  }

  async function exportLocalData() {
    if (action) return;
    setAction("export-data");
    try {
      await downloadAarreDataExport();
    } catch {
      /* 设置页不再展示顶部提示条 */
    } finally {
      setAction("");
    }
  }

  async function handleCoverStyle(style: ListCoverStyle) {
    if (action) return;
    setAction("cover-style");
    try {
      const next = await saveDisplaySettings({
        listCoverStyle: style,
      });
      onListCoverStyleChange(next.listCoverStyle);
    } catch {
      /* 设置页不再展示顶部提示条 */
    } finally {
      setAction("");
    }
  }

  const accountIdentity =
    appState?.auth.userName ||
    appState?.auth.userEmail ||
    appState?.auth.chromeProfileEmail ||
    "";
  const accountName = accountIdentity || "尚未连接";
  const providerPreset = getAiProviderPreset(provider);
  const providerConfigured = Boolean(
    settings?.configuredProviders.includes(provider),
  );
  const canSaveProvider =
    Boolean(model.trim()) && (Boolean(apiKey.trim()) || providerConfigured);

  return (
    <main className="native-panel native-settings-panel">
      <header className="settings-page-header">
        <Button
          ref={backButtonRef}
          type="button"
          variant="unstyled"
          size="icon-sm"
          className="icon-button settings-back-button"
          aria-label={settingsPage === "more" ? "返回设置" : "返回我的书签"}
          title="返回"
          onClick={() => {
            if (settingsPage === "more") {
              setSettingsPage("main");
              return;
            }
            onClose();
          }}
        >
          <ArrowLeftIcon />
        </Button>
        <div>
          <h1>{settingsPage === "more" ? "更多" : "设置"}</h1>
        </div>
      </header>

      <section className="settings-page-content">
        {settingsPage === "main" ? (
          <>
            <form
              className="settings-section"
              aria-labelledby="ai-settings-title"
              onSubmit={(event) => {
                event.preventDefault();
                void saveApiSettings();
              }}
            >
              <div className="settings-section-heading">
                <div>
                  <h2 id="ai-settings-title">AI 服务</h2>
                  <p>生成摘要与标签，增强本地检索。</p>
                </div>
                <span
                  className="settings-status"
                  data-active={providerConfigured}
                >
                  {providerConfigured ? "已配置" : "需要 API Key"}
                </span>
              </div>

              <TabsSubtle
                selectedIndex={Math.max(
                  0,
                  AI_PROVIDER_PRESETS.findIndex(
                    (preset) => preset.id === provider,
                  ),
                )}
                onSelect={(index) => {
                  const preset = AI_PROVIDER_PRESETS[index];
                  if (!preset) return;
                  setProvider(preset.id);
                  setModel(
                    settings?.providerModels[preset.id] || preset.defaultModel,
                  );
                  setApiKey("");
                  setProviderFeedback(null);
                }}
                equalWidth
                className="settings-provider-tabs"
                aria-label="AI 服务商"
              >
                {AI_PROVIDER_PRESETS.map((preset, index) => (
                  <TabsSubtleItem
                    key={preset.id}
                    index={index}
                    label={preset.name}
                    className="settings-provider-tab"
                  />
                ))}
              </TabsSubtle>
              <p className="settings-provider-help">
                {settings?.provider === provider &&
                settings.apiKeyConfigured &&
                settings.apiKeySuffix
                  ? `已保存 Key：•••• ${settings.apiKeySuffix}`
                  : "选择服务商并填写自己的 API Key。"}
              </p>

              <label className="settings-field">
                <span>模型</span>
                <FluidInput
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
                <FluidInput
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
                <p>Key 仅保存在当前 Chrome 配置文件。</p>
                <Button
                  variant="unstyled"
                  type="submit"
                  className="button button-dark button-small"
                  disabled={!canSaveProvider || Boolean(action)}
                >
                  {action === "save-key" ? "正在验证…" : "验证并保存"}
                </Button>
              </div>
              {providerFeedback ? (
                <div
                  className="settings-notice settings-inline-feedback"
                  data-tone={providerFeedback.tone}
                  role={providerFeedback.tone === "error" ? "alert" : "status"}
                >
                  {providerFeedback.message}
                </div>
              ) : null}
            </form>

            <section
              className="settings-section"
              aria-labelledby="cover-style-title"
            >
              <div className="settings-section-heading">
                <div>
                  <h2 id="cover-style-title">显示</h2>
                  <p>列表中优先显示的图片类型。</p>
                </div>
              </div>
              <TabsSubtle
                selectedIndex={listCoverStyle === "site" ? 0 : 1}
                onSelect={(index) =>
                  void handleCoverStyle(index === 0 ? "site" : "page")
                }
                equalWidth
                className="settings-provider-tabs settings-cover-tabs"
                aria-label="列表封面风格"
              >
                <TabsSubtleItem
                  index={0}
                  label="站点标识"
                  className="settings-provider-tab"
                />
                <TabsSubtleItem
                  index={1}
                  label="页面封面"
                  className="settings-provider-tab"
                />
              </TabsSubtle>
            </section>

            <section
              className="settings-section settings-scan-section"
              aria-labelledby="library-scan-title"
            >
              <div className="settings-section-heading">
                <div>
                  <h2 id="library-scan-title">书签增强</h2>
                  <p>
                    {appState?.aiReadyResourceCount ?? 0} /{" "}
                    {appState?.aiEligibleResourceCount ?? 0} 条已增强
                    {appState?.aiPrivacyProtectedCount
                      ? ` · ${appState.aiPrivacyProtectedCount} 条受保护`
                      : ""}
                    。
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
                        ? appState.libraryScan.failed
                          ? "部分完成"
                          : "已完成"
                        : appState?.libraryScan.state === "failed"
                          ? "失败"
                        : "未开始"}
                </span>
              </div>
              {/* Only a scan in flight earns progress detail on the first screen;
              estimates, concurrency and token counts live in the confirm
              dialog and the usage page. */}
              {appState?.libraryScan.state === "running" ||
              appState?.libraryScan.state === "paused" ? (
                <div className="settings-scan-progress">
                  <progress
                    max={Math.max(1, appState?.libraryScan.total || 1)}
                    value={appState?.libraryScan.processed || 0}
                    aria-label="全目录扫描进度"
                  />
                  <p title={appState.libraryScan.currentTitle || undefined}>
                    {appState.libraryScan.processed}/
                    {appState.libraryScan.total} · 成功{" "}
                    {appState.libraryScan.succeeded} · 跳过{" "}
                    {appState.libraryScan.skipped} · 失败{" "}
                    {appState.libraryScan.failed}
                  </p>
                </div>
              ) : null}
              <div className="settings-scan-actions">
                {appState?.libraryScan.state === "running" ? (
                  <Button
                    variant="unstyled"
                    type="button"
                    className="button button-quiet button-small"
                    disabled={Boolean(action)}
                    onClick={() => void handleLibraryScan("pause")}
                  >
                    暂停
                  </Button>
                ) : appState?.libraryScan.state === "paused" ? (
                  <>
                    <Button
                      variant="unstyled"
                      type="button"
                      className="button button-quiet button-small"
                      disabled={Boolean(action)}
                      onClick={() => void handleLibraryScan("cancel")}
                    >
                      取消
                    </Button>
                    <Button
                      variant="unstyled"
                      type="button"
                      className="button button-dark button-small"
                      disabled={Boolean(action)}
                      onClick={() => void handleLibraryScan("resume")}
                    >
                      继续扫描
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="unstyled"
                    type="button"
                    className="button button-dark button-small"
                    disabled={Boolean(action) || !appState?.localResourceCount}
                    onClick={() => void handleLibraryScan("start")}
                  >
                    {action === "scan-start"
                      ? "正在估算…"
                      : appState?.aiReadyResourceCount ===
                            appState?.aiEligibleResourceCount &&
                          Boolean(appState?.aiEligibleResourceCount)
                        ? "检查并补全"
                        : settings?.apiKeyConfigured
                          ? "扫描全部书签"
                          : "更新站点标识"}
                  </Button>
                )}
              </div>
              {scanFeedback ? (
                <div
                  className="settings-notice settings-inline-feedback"
                  data-tone={scanFeedback.tone}
                  role={scanFeedback.tone === "error" ? "alert" : "status"}
                >
                  {scanFeedback.message}
                </div>
              ) : null}
              {!scanFeedback &&
              appState?.libraryScan.state === "failed" ? (
                <div
                  className="settings-notice settings-inline-feedback"
                  data-tone="error"
                  role="alert"
                >
                  {appState.libraryScan.errors.at(-1)?.message ||
                    "书签增强未完成，请检查 AI 配置或网络后重试。"}
                </div>
              ) : !scanFeedback &&
                appState?.libraryScan.state === "completed" &&
                appState.libraryScan.failed > 0 ? (
                <div
                  className="settings-notice settings-inline-feedback"
                  data-tone="error"
                  role="status"
                >
                  已处理 {appState.libraryScan.processed} 条，其中失败{" "}
                  {appState.libraryScan.failed} 条；可再次运行补齐。
                </div>
              ) : null}
            </section>

            <section className="settings-section settings-more-entry">
              <Button
                type="button"
                variant="unstyled"
                size="unstyled"
                className="settings-more-button"
                onClick={() => {
                  setSettingsPage("more");
                }}
              >
                <span>
                  <strong>更多</strong>
                  <small>最近的更改、导出数据、隐私、引导与账号</small>
                </span>
                <ChevronRightIcon />
              </Button>
            </section>
          </>
        ) : (
          <>
            <section
              className="settings-section"
              aria-labelledby="recent-changes-title"
            >
              <div className="settings-section-heading">
                <div>
                  <h2 id="recent-changes-title">最近的更改</h2>
                  <p>删除的书签和文件夹保留 30 天。</p>
                </div>
              </div>
              {undoBatches.length ? (
                <div className="settings-change-list">
                  {undoBatches.slice(0, 12).map((batch) => (
                    <article
                      key={batch.batchId}
                      data-destructive={batch.destructive}
                    >
                      <div>
                        <strong>{batch.label}</strong>
                        <small>
                          {conversationDate(batch.createdAt)}
                          {batch.source === "chrome"
                            ? " · Chrome 书签管理器"
                            : ""}
                          {batch.destructive ? " · 回收站" : ""}
                        </small>
                      </div>
                      <Button
                        variant="unstyled"
                        type="button"
                        className="button button-quiet button-small"
                        disabled={Boolean(action)}
                        onClick={() => void handleUndoBatch(batch.batchId)}
                      >
                        {action === `undo-${batch.batchId}`
                          ? "恢复中…"
                          : "撤销"}
                      </Button>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="settings-empty-state">最近没有可撤销的更改。</p>
              )}
            </section>

            <section className="settings-section settings-onboarding-section">
              <div>
                <h2>首次使用引导</h2>
                <p>重新查看主要功能说明。</p>
              </div>
              <Button
                variant="unstyled"
                type="button"
                className="button button-quiet button-small"
                disabled={Boolean(action)}
                onClick={onRestartOnboarding}
              >
                重新查看引导
              </Button>
            </section>

            <section
              className="settings-section"
              aria-labelledby="privacy-settings-title"
            >
              <div className="settings-section-heading">
                <div>
                  <h2 id="privacy-settings-title">隐私与数据自主权</h2>
                  <p>导出本地数据，不包含 API Key 或登录信息。</p>
                </div>
              </div>
              <div className="settings-field-footer">
                <a
                  className="button button-quiet button-small"
                  href={chrome.runtime.getURL("privacy.html")}
                  target="_blank"
                  rel="noreferrer"
                >
                  查看隐私政策
                </a>
                <Button
                  variant="unstyled"
                  type="button"
                  className="button button-dark button-small"
                  disabled={Boolean(action)}
                  onClick={() => void exportLocalData()}
                >
                  {action === "export-data" ? "正在打包…" : "导出全部本地数据"}
                </Button>
              </div>
            </section>

            <section
              className="settings-section"
              aria-labelledby="account-settings-title"
            >
              <div className="settings-section-heading">
                <h2 id="account-settings-title">Google 账号</h2>
              </div>
              <div className="settings-account-row">
                {appState?.auth.userAvatarUrl ? (
                  <img src={appState.auth.userAvatarUrl} alt="" />
                ) : accountIdentity ? (
                  <span className="settings-account-avatar">
                    {accountIdentity.slice(0, 1).toUpperCase()}
                  </span>
                ) : null}
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
                  <Button
                    variant="unstyled"
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
                  </Button>
                ) : null}
              </div>
              {appState?.auth.signedIn && cloudSettings ? (
                <div className="settings-cloud-controls">
                  <div className="settings-field-footer">
                    <div className="settings-cloud-status">
                      <p className="settings-sync-progress" role="status" aria-live="polite">
                        {cloudSyncProgress
                          ? cloudSyncProgressLabel(cloudSyncProgress)
                          : "同步进度读取中…"}
                      </p>
                      {(cloudSyncProgress?.resourceTotal ||
                        cloudSyncProgress?.assetTotal) ? (
                        <progress
                          className="settings-sync-progress-bar"
                          value={
                            cloudSyncProgress.resourceProcessed +
                            cloudSyncProgress.resourceFailed +
                            cloudSyncProgress.assetProcessed
                          }
                          max={
                            cloudSyncProgress.resourceTotal +
                            cloudSyncProgress.assetTotal
                          }
                        />
                      ) : null}
                      <small>
                        {cloudUsage
                          ? `云端容量：${formatStorageBytes(cloudUsage.usedBytes)} / ${formatStorageBytes(cloudUsage.quotaBytes)}`
                          : "云端容量读取中…"}
                      </small>
                    </div>
                    <Button
                      variant="unstyled"
                      type="button"
                      className={
                        cloudSettings.enabled
                          ? "button button-quiet button-small"
                          : "button button-dark button-small"
                      }
                      disabled={Boolean(action)}
                      onClick={() =>
                        void handleCloudSettings({
                          enabled: !cloudSettings.enabled,
                        })
                      }
                    >
                      {action === "cloud-settings"
                        ? "正在处理…"
                        : cloudSettings.enabled
                          ? "暂停同步"
                          : "开启同步"}
                    </Button>
                  </div>
                </div>
              ) : null}
              {cloudFeedback ? (
                <div
                  className="settings-notice settings-inline-feedback"
                  data-tone={cloudFeedback.tone}
                  role={cloudFeedback.tone === "error" ? "alert" : "status"}
                >
                  {cloudFeedback.message}
                </div>
              ) : null}
            </section>

          </>
        )}
      </section>

      {scanEstimate ? (
        <div
          className="settings-scan-dialog-backdrop"
          role="presentation"
          onClick={() => {
            if (action) return;
            setScanEstimate(null);
          }}
        >
          <div
            className="settings-scan-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="scan-confirm-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="scan-confirm-title">开始前确认</h2>
            <p>
              共检查 {scanEstimate.total} 条，其中{" "}
              {scanEstimate.aiResourceCount} 条会调用{" "}
              {scanEstimate.providerName} {scanEstimate.model}。
              只补齐缺失的字段，已完成的收藏不会再次调用；中途可以随时暂停，下次从断点继续。
            </p>
            <dl>
              <div>
                <dt>预计时间</dt>
                <dd>约 {scanEstimate.estimatedMinutes} 分钟</dd>
              </div>
              <div>
                <dt>并发</dt>
                <dd>{scanEstimate.concurrency} 条任务</dd>
              </div>
              <div>
                <dt>预计用量</dt>
                <dd>
                  输入约 {scanEstimate.estimatedInputTokens.toLocaleString()} ·
                  输出约 {scanEstimate.estimatedOutputTokens.toLocaleString()}
                </dd>
              </div>
            </dl>
            <small>
              用量按每条收藏的大致 token
              估算，实际消耗以服务商返回为准。扫描结果保存在本机，AI
              请求直接发送到所选服务商。
            </small>
            <div className="settings-scan-dialog-actions">
              <Button
                variant="unstyled"
                type="button"
                className="button button-quiet button-small"
                disabled={Boolean(action)}
                onClick={() => {
                  setScanEstimate(null);
                }}
              >
                取消
              </Button>
              <Button
                variant="unstyled"
                type="button"
                className="button button-dark button-small"
                disabled={Boolean(action) || !scanEstimate.total}
                onClick={() => void handleLibraryScan("start")}
              >
                {action === "scan-start"
                  ? "正在启动…"
                  : scanEstimate.total
                    ? "确认并开始"
                    : "无需扫描"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
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
    faviconUrl: tab.faviconUrl,
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
    faviconUrl: draft.faviconUrl,
  };
}

interface TreeProps {
  nodes: NativeBookmarkNode[];
  resourceByUrl: Map<string, ResourceRecord>;
  siteBrandByHost: Map<string, SiteBrandRecord>;
  coverStyle: ListCoverStyle;
  highlightQuery: string;
  onPreviewIntent: (node: NativeBookmarkNode, rect: DOMRect) => void;
  onPreviewLeave: () => void;
  depth?: number;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  onOpen: (node: NativeBookmarkNode, newTab: boolean) => void;
  onEdit: (node: NativeBookmarkNode) => void;
  draggedId: string;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onMove: (id: string, parentId: string, index?: number) => Promise<void>;
}

export type BookmarkPreviewMoveDecision = "keep" | "cancel" | "arm";

export function decideBookmarkPreviewMove(input: {
  nodeId: string;
  activeNodeId: string;
  timerArmed: boolean;
  distance: number;
  elapsed: number;
}): BookmarkPreviewMoveDecision {
  // 速度门只用于判断“是否值得启动预览”。预览一旦已经出现，同一行内
  // 的鼠标移动不能再把它取消，否则会形成消失—重新计时—再出现的闪烁。
  if (input.activeNodeId === input.nodeId) return "keep";
  if (input.distance / Math.max(1, input.elapsed) > 0.65) {
    return "cancel";
  }
  return input.timerArmed ? "keep" : "arm";
}

function BookmarkTree({
  nodes,
  resourceByUrl,
  siteBrandByHost,
  coverStyle,
  highlightQuery,
  onPreviewIntent,
  onPreviewLeave,
  depth = 0,
  expanded,
  onToggle,
  onOpen,
  onEdit,
  draggedId,
  onDragStart,
  onDragEnd,
  onMove,
}: TreeProps) {
  const [orderedNodes, setOrderedNodes] = useState(nodes);
  const nodeElements = useRef(new Map<string, HTMLDivElement>());
  const previousPositions = useRef<Map<string, number> | null>(null);
  const lastHoverTarget = useRef("");
  const activeDragId = useRef("");
  const previewTimer = useRef<number | undefined>(undefined);
  const previewIntentNodeId = useRef("");
  const pointerSample = useRef<{
    x: number;
    y: number;
    at: number;
  } | null>(null);

  useEffect(
    () => () => {
      if (previewTimer.current !== undefined) {
        window.clearTimeout(previewTimer.current);
      }
    },
    [],
  );

  function armPreview(node: NativeBookmarkNode, target: HTMLElement) {
    if (!node.url) return;
    if (previewTimer.current !== undefined) {
      window.clearTimeout(previewTimer.current);
    }
    previewTimer.current = window.setTimeout(() => {
      previewTimer.current = undefined;
      previewIntentNodeId.current = node.id;
      onPreviewIntent(node, target.getBoundingClientRect());
    }, 400);
  }

  function cancelPreview() {
    if (previewTimer.current !== undefined) {
      window.clearTimeout(previewTimer.current);
      previewTimer.current = undefined;
    }
    previewIntentNodeId.current = "";
    pointerSample.current = null;
    onPreviewLeave();
  }

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
          { transform: "translateY(0)" },
        ],
        {
          duration: 240,
          easing: "cubic-bezier(0.22, 1, 0.36, 1)",
        },
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
      }),
    );
  }

  function moveDraggedNode(targetId: string) {
    const sourceId = activeDragId.current || draggedId;
    if (!sourceId || sourceId === targetId) return;
    const sourceIndex = orderedNodes.findIndex((item) => item.id === sourceId);
    const targetIndex = orderedNodes.findIndex((item) => item.id === targetId);
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
              style={
                {
                  "--tree-depth": `${depth * 24}px`,
                } as React.CSSProperties
              }
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData(
                  "application/x-bookmark-layer-id",
                  node.id,
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
                const id =
                  event.dataTransfer.getData(
                    "application/x-bookmark-layer-id",
                  ) || activeDragId.current;
                if (!id || id === node.id) return;
                const reorderedIndex = orderedNodes.findIndex(
                  (item) => item.id === id,
                );
                if (reorderedIndex >= 0) {
                  void onMove(id, node.parentId || "", reorderedIndex);
                  onDragEnd();
                  return;
                }
                void onMove(
                  id,
                  folder ? node.id : node.parentId || "",
                  folder ? undefined : node.index,
                );
              }}
              onPointerEnter={(event) => {
                if (folder) return;
                pointerSample.current = {
                  x: event.clientX,
                  y: event.clientY,
                  at: performance.now(),
                };
                armPreview(node, event.currentTarget);
              }}
              onPointerMove={(event) => {
                if (folder) return;
                const nowAt = performance.now();
                const previous = pointerSample.current;
                pointerSample.current = {
                  x: event.clientX,
                  y: event.clientY,
                  at: nowAt,
                };
                if (!previous) return;
                const elapsed = Math.max(1, nowAt - previous.at);
                const distance = Math.hypot(
                  event.clientX - previous.x,
                  event.clientY - previous.y,
                );
                const decision = decideBookmarkPreviewMove({
                  nodeId: node.id,
                  activeNodeId: previewIntentNodeId.current,
                  timerArmed: previewTimer.current !== undefined,
                  distance,
                  elapsed,
                });
                if (decision === "cancel") {
                  cancelPreview();
                } else if (decision === "arm") {
                  armPreview(node, event.currentTarget);
                }
              }}
              onPointerLeave={cancelPreview}
            >
              <Button
                variant="unstyled"
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
                onKeyDown={(event) => {
                  if (folder) return;
                  if (event.key.toLocaleLowerCase() === "p") {
                    event.preventDefault();
                    onPreviewIntent(
                      node,
                      event.currentTarget
                        .closest(".bookmark-row")!
                        .getBoundingClientRect(),
                    );
                  } else if (event.key === "Escape") {
                    cancelPreview();
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
                  <>
                    <span className="tree-icon" data-folder="true">
                      <FolderIcon />
                    </span>
                    <span className="bookmark-copy">
                      <strong>
                        {highlightTextMatches(
                          node.title || "未命名",
                          highlightQuery,
                        )}
                      </strong>
                    </span>
                  </>
                ) : (
                  <ResourceIdentity
                    url={node.url || ""}
                    imageUrl={metadata?.thumbnailDataUrl}
                    brandImageUrl={currentSiteBrandImageUrl(
                      siteBrandForUrl(siteBrandByHost, node.url || ""),
                    )}
                    categoryCoverId={metadata?.categoryCoverId}
                    coverStyle={coverStyle}
                    label={node.title}
                    title={highlightTextMatches(
                      node.title || "未命名",
                      highlightQuery,
                    )}
                    meta={hostFromUrl(node.url || "")}
                    className="bookmark-identity"
                    thumbnailClassName="bookmark-thumbnail"
                  />
                )}
              </Button>

              {!node.unmodifiable && !node.folderType ? (
                <Button
                  type="button"
                  variant="unstyled"
                  size="icon-sm"
                  className="row-menu"
                  aria-label={`编辑 ${node.title}`}
                  title="编辑"
                  onClick={() => onEdit(node)}
                >
                  <EllipsisIcon />
                </Button>
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
                    siteBrandByHost={siteBrandByHost}
                    coverStyle={coverStyle}
                    highlightQuery={highlightQuery}
                    depth={depth + 1}
                    expanded={expanded}
                    onToggle={onToggle}
                    onOpen={onOpen}
                    onEdit={onEdit}
                    draggedId={draggedId}
                    onDragStart={onDragStart}
                    onDragEnd={onDragEnd}
                    onMove={onMove}
                    onPreviewIntent={onPreviewIntent}
                    onPreviewLeave={onPreviewLeave}
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

interface BookmarkPreviewCardProps {
  snapshot: PageSnapshot;
  flip: boolean;
  offset: number;
}

export function BookmarkPreviewCard({
  snapshot,
  flip,
  offset,
}: BookmarkPreviewCardProps) {
  return (
    <aside
      className="bookmark-preview-card"
      data-flip={flip}
      style={
        flip
          ? {
              bottom: offset,
              maxHeight: `calc(100vh - ${offset + 12}px)`,
            }
          : {
              top: offset,
              maxHeight: `calc(100vh - ${offset + 12}px)`,
            }
      }
      aria-hidden="true"
    >
      <div className="bookmark-preview-visual">
        <img src={snapshot.imageDataUrl} alt="" />
      </div>
    </aside>
  );
}

interface BookmarkPreviewLayerProps {
  snapshot: PageSnapshot | null;
  hidden?: boolean;
  placement: {
    flip: boolean;
    offset: number;
  } | null;
}

export function BookmarkPreviewLayer({
  snapshot,
  hidden = false,
  placement,
}: BookmarkPreviewLayerProps) {
  if (hidden || !snapshot || !placement) return null;
  return (
    <BookmarkPreviewCard
      snapshot={snapshot}
      flip={placement.flip}
      offset={placement.offset}
    />
  );
}

interface AgentComposerProps {
  value: string;
  busy: boolean;
  configured: boolean;
  placeholder?: string;
  onChange: (value: string) => void;
  onSubmit: (event: React.FormEvent) => void;
  onCancel?: () => void;
  onConfigure?: () => void;
}

function AgentComposer({
  value,
  busy,
  configured,
  placeholder = "询问你的收藏…",
  onChange,
  onSubmit,
  onCancel,
  onConfigure,
}: AgentComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea || !configured) return;
    // 先归零再读取 scrollHeight，删除文字时高度才能一起回落。
    textarea.style.height = "auto";
    const nextHeight = Math.max(48, Math.min(112, textarea.scrollHeight));
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > 112 ? "auto" : "hidden";
  }, [configured, value]);

  if (!configured) {
    return (
      <div className="agent-composer agent-composer-setup">
        <Button type="button" variant="unstyled" onClick={onConfigure}>
          <span>
            <strong>配置 AI 后可以直接问你的收藏</strong>
            <small>选择服务商并填写自己的 API Key</small>
          </span>
          <ChevronRightIcon />
        </Button>
      </div>
    );
  }
  return (
    <form className="agent-composer" onSubmit={(event) => onSubmit(event)}>
      <FluidTextarea
        ref={textareaRef}
        id="bookmark-agent-prompt"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={busy}
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
        rows={1}
        aria-label={placeholder}
      />
      <div className="agent-composer-toolbar">
        {busy && onCancel ? (
          <Button
            variant="unstyled"
            type="button"
            size="icon-sm"
            className="agent-send-button agent-stop-button"
            aria-label="停止 AI 对话"
            title="停止"
            onClick={onCancel}
          >
            <StopIcon />
          </Button>
        ) : (
          <Button
            variant="unstyled"
            type="submit"
            size="icon-sm"
            className="agent-send-button"
            aria-label="发送给 Aarre"
            title="发送"
            disabled={!value.trim() || busy}
          >
            <ArrowUpIcon />
          </Button>
        )}
      </div>
    </form>
  );
}

const AGENT_PROGRESS_STEPS: Array<{
  stage: BookmarkAgentProgressStage;
  label: string;
}> = [
  { stage: "preparing", label: "准备收藏库" },
  { stage: "scanning", label: "分批检查收藏" },
  { stage: "selecting", label: "筛选相关内容" },
  { stage: "synthesizing", label: "整理并生成回答" },
];

function AgentThinkingSteps({
  progress,
}: {
  progress?: BookmarkAgentProgress;
}) {
  const completedStages = new Set(progress?.completedStages || []);
  const visibleStages = new Set(progress?.stages || ["preparing"]);
  const visibleSteps = AGENT_PROGRESS_STEPS.filter((step) =>
    visibleStages.has(step.stage),
  );
  const statusLabel = progress?.label || "正在准备收藏库";
  return (
    <div
      className="agent-thinking-steps"
      role="status"
      aria-live="polite"
      aria-label={statusLabel}
    >
      {visibleSteps.map((step, index) => {
        const state = completedStages.has(step.stage)
          ? "done"
          : step.stage === progress?.stage || (!progress && index === 0)
            ? "current"
            : "pending";
        return (
          <div
            className="agent-thinking-step"
            data-state={state}
            key={step.stage}
          >
            <span className="agent-thinking-step-mark" aria-hidden="true">
              {state === "done" ? "✓" : state === "current" ? "•" : ""}
            </span>
            <span>
              {step.label}
              {step.stage === "scanning" && progress?.stage === "scanning"
                ? ` · ${progress.completed}/${progress.total}`
                : null}
            </span>
          </div>
        );
      })}
      <small>{statusLabel}</small>
    </div>
  );
}

function conversationDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/** Proposals answering one semantic instruction share a groupLabel, so the
 *  confirm card can show the criterion once above its hit list. */
function groupAgentActions(
  actions: BookmarkAgentActionProposal[],
): Array<{ label: string; actions: BookmarkAgentActionProposal[] }> {
  const groups: Array<{
    label: string;
    actions: BookmarkAgentActionProposal[];
  }> = [];
  for (const action of actions) {
    const label = action.groupLabel || "";
    const last = groups[groups.length - 1];
    if (last && last.label === label) {
      last.actions.push(action);
    } else {
      groups.push({ label, actions: [action] });
    }
  }
  return groups;
}

function agentActionCardTitle(actions: BookmarkAgentActionProposal[]): string {
  if (!actions.some((action) => action.status === "pending")) {
    return "操作结果";
  }
  return actions.every((action) => action.type === "update_metadata")
    ? "确认后才会更新 Aarre 信息"
    : "确认后才会修改 Chrome";
}

interface AgentChatPageProps {
  conversation: AgentConversation;
  resourceByUrl: Map<string, ResourceRecord>;
  siteBrandByHost: Map<string, SiteBrandRecord>;
  prompt: string;
  busy: boolean;
  configured: boolean;
  error: string;
  onPromptChange: (value: string) => void;
  onConfigure: () => void;
  onCancel?: () => void;
  onBack: () => void;
  onSubmit: (event: React.FormEvent) => void;
  onOpenSource: (url: string) => void;
  onConfirmActions: (messageId: string) => void;
  onCancelActions: (messageId: string) => void;
  onDropAction: (messageId: string, actionId: string) => void;
  onUndoBatch: (messageId: string, batchId: string) => void;
}

function AgentChatPage({
  conversation,
  resourceByUrl,
  siteBrandByHost,
  prompt,
  busy,
  configured,
  error,
  onPromptChange,
  onConfigure,
  onCancel,
  onBack,
  onSubmit,
  onOpenSource,
  onConfirmActions,
  onCancelActions,
  onDropAction,
  onUndoBatch,
}: AgentChatPageProps) {
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({
      block: "end",
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
  }, [conversation.messages.length]);

  return (
    <main className="native-panel agent-chat-panel">
      <header className="agent-page-header">
        <Button
          type="button"
          variant="unstyled"
          size="icon-sm"
          className="icon-button"
          aria-label="返回收藏列表"
          title="返回"
          onClick={onBack}
        >
          <ArrowLeftIcon />
        </Button>
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
                <AgentThinkingSteps progress={message.progress} />
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
                  <Button
                    type="button"
                    variant="unstyled"
                    size="unstyled"
                    className="agent-source-button"
                    key={source.resourceKey}
                    onClick={() => onOpenSource(source.url)}
                  >
                    <SiteThumbnail
                      url={source.url}
                      imageUrl={
                        resourceForUrl(resourceByUrl, source.url)
                          ?.thumbnailDataUrl
                      }
                      brandImageUrl={currentSiteBrandImageUrl(
                        siteBrandForUrl(siteBrandByHost, source.url),
                      )}
                      categoryCoverId={
                        resourceForUrl(resourceByUrl, source.url)
                          ?.categoryCoverId
                      }
                      forceSiteBrand
                      label={source.siteName || source.title}
                      className="agent-source-thumbnail"
                    />
                    <span>
                      <strong>{source.title}</strong>
                      <small>{hostFromUrl(source.url)}</small>
                    </span>
                  </Button>
                ))}
              </div>
            ) : null}
            {message.actions?.length ? (
              <section
                className="agent-action-card"
                aria-label="待确认的书签操作"
              >
                <header>
                  <strong>{agentActionCardTitle(message.actions)}</strong>
                  <small>
                    {message.actions.some(
                      (action) => action.status === "pending",
                    )
                      ? `命中 ${
                          message.actions.filter(
                            (action) => action.status === "pending",
                          ).length
                        } 条`
                      : `${message.actions.length} 项`}
                  </small>
                </header>
                {groupAgentActions(message.actions).map((group) => (
                  <Fragment key={group.label || "default"}>
                    {group.label ? (
                      <p className="agent-action-group">
                        筛选条件：{group.label}
                      </p>
                    ) : null}
                    <ul>
                      {group.actions.map((action) => (
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
                          {action.status === "pending" ? (
                            <Button
                              type="button"
                              variant="unstyled"
                              size="icon-sm"
                              className="agent-action-drop"
                              aria-label={`不执行：${action.label}`}
                              disabled={busy}
                              onClick={() =>
                                onDropAction(message.id, action.id)
                              }
                            >
                              <CloseIcon />
                            </Button>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </Fragment>
                ))}
                {message.actions.some(
                  (action) => action.status === "pending",
                ) ? (
                  <footer>
                    <Button
                      variant="unstyled"
                      type="button"
                      className="button button-quiet button-small"
                      disabled={busy}
                      onClick={() => onCancelActions(message.id)}
                    >
                      取消
                    </Button>
                    <Button
                      variant="unstyled"
                      type="button"
                      className={
                        message.actions.some((action) => action.destructive)
                          ? "agent-action-confirm agent-action-confirm-danger"
                          : "agent-action-confirm"
                      }
                      disabled={busy}
                      onClick={() => onConfirmActions(message.id)}
                    >
                      {busy
                        ? "正在执行…"
                        : `确认执行 ${
                            message.actions.filter(
                              (action) => action.status === "pending",
                            ).length
                          } 项`}
                    </Button>
                  </footer>
                ) : null}
              </section>
            ) : null}
            {message.undoBatchId ? (
              <Button
                variant="unstyled"
                type="button"
                className="agent-undo-button"
                disabled={busy}
                onClick={() =>
                  onUndoBatch(message.id, message.undoBatchId || "")
                }
              >
                {busy ? "正在恢复…" : "撤销这批操作"}
              </Button>
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
        configured={configured}
        placeholder="继续询问…"
        onChange={onPromptChange}
        onSubmit={onSubmit}
        onCancel={onCancel}
        onConfigure={onConfigure}
      />
    </main>
  );
}

interface AgentHistoryPageProps {
  conversations: AgentConversation[];
  onBack: () => void;
  onOpen: (conversation: AgentConversation) => void;
  onDelete: (id: string) => Promise<void>;
  onRename: (conversation: AgentConversation, title: string) => Promise<void>;
}

function AgentHistoryPage({
  conversations,
  onBack,
  onOpen,
  onDelete,
  onRename,
}: AgentHistoryPageProps) {
  const [editingId, setEditingId] = useState("");
  const [editingTitle, setEditingTitle] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState("");
  const [busyId, setBusyId] = useState("");

  async function saveTitle(conversation: AgentConversation) {
    const title = editingTitle.trim();
    if (!title || busyId) return;
    setBusyId(conversation.id);
    try {
      await onRename(conversation, title);
      setEditingId("");
    } finally {
      setBusyId("");
    }
  }

  return (
    <main className="native-panel agent-history-panel">
      <header className="agent-page-header">
        <Button
          type="button"
          variant="unstyled"
          size="icon-sm"
          className="icon-button"
          aria-label="返回收藏列表"
          title="返回"
          onClick={onBack}
        >
          <ArrowLeftIcon />
        </Button>
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
              <article key={conversation.id}>
                {editingId === conversation.id ? (
                  <form
                    className="agent-history-rename"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void saveTitle(conversation);
                    }}
                  >
                    <FluidInput
                      autoFocus
                      value={editingTitle}
                      maxLength={80}
                      aria-label="会话名称"
                      onChange={(event) => setEditingTitle(event.target.value)}
                    />
                    <Button
                      type="button"
                      variant="unstyled"
                      className="agent-history-action"
                      disabled={Boolean(busyId)}
                      onClick={() => setEditingId("")}
                    >
                      取消
                    </Button>
                    <Button
                      type="submit"
                      variant="unstyled"
                      className="agent-history-action"
                      disabled={!editingTitle.trim() || Boolean(busyId)}
                    >
                      保存
                    </Button>
                  </form>
                ) : (
                  <>
                    <Button
                      variant="unstyled"
                      type="button"
                      className="agent-history-open"
                      onClick={() => onOpen(conversation)}
                    >
                      <span>
                        <strong>{conversation.title}</strong>
                        <time>{conversationDate(conversation.updatedAt)}</time>
                      </span>
                      <small>{preview || "尚未生成回答"}</small>
                      <ChevronRightIcon />
                    </Button>
                    <div className="agent-history-actions">
                      <Button
                        type="button"
                        variant="unstyled"
                        className="agent-history-action"
                        onClick={() => {
                          setEditingId(conversation.id);
                          setEditingTitle(conversation.title);
                          setConfirmDeleteId("");
                        }}
                      >
                        改名
                      </Button>
                      <Button
                        type="button"
                        variant="unstyled"
                        className="agent-history-action"
                        data-danger={confirmDeleteId === conversation.id}
                        disabled={busyId === conversation.id}
                        onClick={() => {
                          if (confirmDeleteId !== conversation.id) {
                            setConfirmDeleteId(conversation.id);
                            return;
                          }
                          setBusyId(conversation.id);
                          void onDelete(conversation.id).finally(() => {
                            setBusyId("");
                            setConfirmDeleteId("");
                          });
                        }}
                      >
                        {confirmDeleteId === conversation.id
                          ? "确认删除"
                          : "删除"}
                      </Button>
                    </div>
                  </>
                )}
              </article>
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
  const [siteBrands, setSiteBrands] = useState<SiteBrandRecord[]>([]);
  const [contextResurfacing, setContextResurfacing] = useState<
    ResurfacingItem[]
  >([]);
  const [organizationNotice, setOrganizationNotice] =
    useState<OrganizationNotice | null>(null);
  const [organizationNoticeBusy, setOrganizationNoticeBusy] = useState(false);
  const [listCoverStyle, setListCoverStyle] = useState<ListCoverStyle>("site");
  const [pageSnapshotsEnabled, setPageSnapshotsEnabled] = useState(true);
  const [aiConfigured, setAiConfigured] = useState(false);
  const [onboardingVisible, setOnboardingVisible] = useState<boolean | null>(
    null,
  );
  const [folders, setFolders] = useState<NativeFolderOption[]>([]);
  const [folderSuggestions, setFolderSuggestions] = useState<
    FolderSuggestion[]
  >([]);
  const [agentPrompt, setAgentPrompt] = useState("");
  const [panelView, setPanelView] = useState<
    "library" | "settings" | "chat" | "history"
  >("library");
  const [conversations, setConversations] = useState<AgentConversation[]>([]);
  const [activeConversation, setActiveConversation] =
    useState<AgentConversation | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [libraryQuery, setLibraryQuery] = useState("");
  const debouncedLibraryQuery = useDebouncedSearchQuery(libraryQuery);
  const [pinyinIndexRevision, setPinyinIndexRevision] = useState(0);
  const [librarySearchMode, setLibrarySearchMode] = useState<"tree" | "ranked">(
    "tree",
  );
  const [bookmarkPreview, setBookmarkPreview] = useState<{
    node: NativeBookmarkNode;
    flip: boolean;
    offset: number;
  } | null>(null);
  const [previewSnapshot, setPreviewSnapshot] = useState<PageSnapshot | null>(
    null,
  );
  const [draggedId, setDraggedId] = useState("");
  const [editor, setEditor] = useState<EditorState>(null);
  const [editBookmarkId, setEditBookmarkId] = useState("");
  const [editParentId, setEditParentId] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [editUrl, setEditUrl] = useState("");
  const [editTags, setEditTags] = useState<string[]>([]);
  const [editTagInput, setEditTagInput] = useState("");
  const [editTagsChanged, setEditTagsChanged] = useState(false);
  const [capture, setCapture] = useState<PageCapture | null>(null);
  const [captureSourceTabId, setCaptureSourceTabId] = useState<
    number | undefined
  >();
  const [note, setNote] = useState("");
  const [folderId, setFolderId] = useState("");
  const [bookmarkSaveState, setBookmarkSaveState] =
    useState<BookmarkSaveState | null>(null);
  const [saveDisposition, setSaveDisposition] = useState<"reuse" | "new" | "">(
    "",
  );
  const [selectedBookmarkId, setSelectedBookmarkId] = useState("");
  const [captureWarning, setCaptureWarning] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState("");
  const [removedNodeIds, setRemovedNodeIds] = useState<string[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [scrollThumb, setScrollThumb] = useState({
    scrollable: false,
    visible: false,
    height: 36,
    offset: 10,
    atEnd: false,
  });
  const pendingDraftInFlight = useRef(false);
  const pendingDraftTabQueue = useRef<number[]>([]);
  const persistentStateLoaded = useRef(false);
  const scrollSaveTimer = useRef<number | undefined>(undefined);
  const previewCloseTimer = useRef<number | undefined>(undefined);
  const previewCanonicalUrl = useRef("");
  const librarySearchSnapshot = useRef<{
    expanded: Set<string>;
    scrollTop: number;
  } | null>(null);
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
  const activeAgentRequestRef = useRef("");
  const activeAgentMessageRef = useRef("");
  const cancelledAgentRequestsRef = useRef(new Set<string>());

  const syncScrollThumb = useCallback((show = false) => {
    const content = contentRef.current;
    if (!content) return;
    const maxScroll = Math.max(0, content.scrollHeight - content.clientHeight);
    const trackHeight = Math.max(0, content.clientHeight - 20);
    const height =
      maxScroll > 0
        ? Math.max(
            36,
            trackHeight * (content.clientHeight / content.scrollHeight),
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
      atEnd: maxScroll <= 1 || content.scrollTop >= maxScroll - 1,
    }));
  }, []);

  const scheduleScrollThumbHide = useCallback(() => {
    if (scrollHideTimer.current !== undefined) {
      window.clearTimeout(scrollHideTimer.current);
    }
    scrollHideTimer.current = window.setTimeout(() => {
      setScrollThumb((current) => ({
        ...current,
        visible: false,
      }));
    }, 900);
  }, []);

  const revealScrollThumb = useCallback(() => {
    syncScrollThumb(true);
    scheduleScrollThumbHide();
  }, [scheduleScrollThumbHide, syncScrollThumb]);

  const refresh = useCallback(async () => {
    // GET_LOCAL_RESOURCES reconciles the entire Chrome bookmark tree into
    // IndexedDB. That is intentionally more expensive than reading the native
    // tree itself, and must not keep the only visible list in a loading state.
    // Paint the Chrome source of truth first; enrichment data can arrive after
    // the list is already usable.
    const nextSnapshot = await readNativeBookmarkSnapshot();
    setSnapshot(nextSnapshot);
    // Resource reconciliation is deliberately fire-and-update: thumbnails,
    // AI metadata and local search enrichment must never hold the native list
    // hostage after the first paint.
    void sendExtensionRequest({ type: "GET_LOCAL_RESOURCES" })
      .then(setResources)
      .catch((caught) => {
        setError(caught instanceof Error ? caught.message : "本地索引读取失败");
      });
    const [
      nextState,
      nextSiteBrands,
      nextAiSettings,
      nextResurfacing,
      nextOrganizationNotice,
    ] = await Promise.all([
      sendExtensionRequest({ type: "GET_APP_STATE" }),
      sendExtensionRequest({ type: "GET_SITE_BRANDS" }),
      sendExtensionRequest({ type: "GET_AI_SETTINGS" }),
      sendExtensionRequest({ type: "GET_CONTEXT_RESURFACING" }).catch(() => []),
      sendExtensionRequest({
        type: "GET_ORGANIZATION_NOTICE",
      }).catch(() => null),
    ]);
    setAppState(nextState);
    setSiteBrands(nextSiteBrands);
    setAiConfigured(nextAiSettings.apiKeyConfigured);
    setContextResurfacing(nextResurfacing);
    setOrganizationNotice(nextOrganizationNotice);
  }, []);

  const loadOrganizationNotice = useCallback(async () => {
    const next = await sendExtensionRequest({
      type: "GET_ORGANIZATION_NOTICE",
    });
    setOrganizationNotice(next);
  }, []);

  const loadConversations = useCallback(async () => {
    const next = await sendExtensionRequest({
      type: "GET_AGENT_CONVERSATIONS",
    });
    const nextConversations = Array.isArray(next) ? next : [];
    const recoveredConversations = nextConversations.map((conversation) => ({
      ...conversation,
      messages: conversation.messages.map((message) =>
        message.status === "sending"
          ? {
              ...message,
              content: "上一次 AI 对话没有完成，请重新提问。",
              status: "cancelled" as const,
              progress: undefined,
            }
          : message,
      ),
    }));
    setConversations(recoveredConversations);
    return recoveredConversations;
  }, []);

  const deleteConversation = useCallback(async (id: string) => {
    await sendExtensionRequest({
      type: "DELETE_AGENT_CONVERSATION",
      id,
    });
    setConversations((current) =>
      current.filter((conversation) => conversation.id !== id),
    );
    setActiveConversation((current) => (current?.id === id ? null : current));
  }, []);

  const renameConversation = useCallback(
    async (conversation: AgentConversation, title: string) => {
      const saved = await sendExtensionRequest({
        type: "SAVE_AGENT_CONVERSATION",
        conversation: {
          ...conversation,
          title,
          updatedAt: new Date().toISOString(),
        },
      });
      setConversations((current) =>
        [saved, ...current.filter((item) => item.id !== saved.id)].slice(0, 50),
      );
      setActiveConversation((current) =>
        current?.id === saved.id ? saved : current,
      );
    },
    [],
  );

  useEffect(() => {
    void Promise.all([
      getDisplaySettings(),
      getSidepanelState(),
      getOnboardingState(),
    ])
      .then(([display, persisted, onboarding]) => {
        setListCoverStyle(display.listCoverStyle);
        setPageSnapshotsEnabled(display.pageSnapshotsEnabled);
        setExpanded(new Set(persisted.expandedFolderIds));
        setOnboardingVisible(!onboarding.completed);
        window.requestAnimationFrame(() => {
          if (contentRef.current) {
            contentRef.current.scrollTop = persisted.scrollTop;
          }
          persistentStateLoaded.current = true;
        });
      })
      .catch(() => {
        persistentStateLoaded.current = true;
        setOnboardingVisible(false);
      });
    void refresh().catch((caught) => {
      setError(caught instanceof Error ? caught.message : "书签读取失败");
    });
    void loadConversations().catch((caught) => {
      setError(caught instanceof Error ? caught.message : "历史会话读取失败");
    });

    const handleChange = () => {
      void refresh().catch((caught) => {
        setError(caught instanceof Error ? caught.message : "书签刷新失败");
      });
    };
    const bookmarks =
      typeof chrome !== "undefined" ? chrome.bookmarks : undefined;
    bookmarks?.onCreated.addListener(handleChange);
    bookmarks?.onChanged.addListener(handleChange);
    bookmarks?.onMoved.addListener(handleChange);
    bookmarks?.onRemoved.addListener(handleChange);
    bookmarks?.onChildrenReordered.addListener(handleChange);
    return () => {
      bookmarks?.onCreated.removeListener(handleChange);
      bookmarks?.onChanged.removeListener(handleChange);
      bookmarks?.onMoved.removeListener(handleChange);
      bookmarks?.onRemoved.removeListener(handleChange);
      bookmarks?.onChildrenReordered.removeListener(handleChange);
    };
  }, [loadConversations, refresh]);

  useEffect(() => {
    const handleScanUpdate = (message: {
      type?: string;
      status?: AppState["libraryScan"];
    }) => {
      if (message.type !== "LIBRARY_SCAN_UPDATED" || !message.status) {
        return;
      }
      void sendExtensionRequest({ type: "GET_LOCAL_RESOURCES" })
        .then(async (nextResources) => {
          const nextSiteBrands = await sendExtensionRequest({
            type: "GET_SITE_BRANDS",
          });
          const safeResources = Array.isArray(nextResources)
            ? nextResources
            : [];
          setResources(safeResources);
          setSiteBrands(nextSiteBrands);
          setAppState((current) =>
            current
              ? {
                  ...current,
                  libraryScan: message.status!,
                  aiReadyResourceCount: safeResources.filter(
                    (resource) => !needsAiEnrichment(resource),
                  ).length,
                }
              : current,
          );
        })
        .catch(() => undefined);
    };
    const runtimeMessageEvent =
      typeof chrome !== "undefined" ? chrome.runtime?.onMessage : undefined;
    runtimeMessageEvent?.addListener(handleScanUpdate);
    return () => runtimeMessageEvent?.removeListener(handleScanUpdate);
  }, []);

  useEffect(() => {
    const handleOrganizationUpdate = (message: { type?: string }) => {
      if (message.type !== "ORGANIZATION_INSIGHTS_UPDATED") return;
      void loadOrganizationNotice().catch(() => undefined);
    };
    const runtimeMessageEvent =
      typeof chrome !== "undefined" ? chrome.runtime?.onMessage : undefined;
    runtimeMessageEvent?.addListener(handleOrganizationUpdate);
    return () => runtimeMessageEvent?.removeListener(handleOrganizationUpdate);
  }, [loadOrganizationNotice]);

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
      attributeFilter: ["data-expanded"],
    });
    const frame = window.requestAnimationFrame(() => syncScrollThumb());

    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      window.cancelAnimationFrame(frame);
      if (scrollHideTimer.current !== undefined) {
        window.clearTimeout(scrollHideTimer.current);
      }
      if (scrollSaveTimer.current !== undefined) {
        window.clearTimeout(scrollSaveTimer.current);
      }
      if (previewCloseTimer.current !== undefined) {
        window.clearTimeout(previewCloseTimer.current);
      }
    };
  }, [panelView, syncScrollThumb]);

  useEffect(() => {
    const runtimeMessageEvent =
      typeof chrome !== "undefined" ? chrome.runtime?.onMessage : undefined;
    const handleAgentProgress = (message: unknown) => {
      if (!message || typeof message !== "object") return;
      const event = message as Partial<BookmarkAgentProgress> & {
        type?: string;
      };
      if (
        event.type !== "BOOKMARK_AGENT_PROGRESS" ||
        event.requestId !== activeAgentRequestRef.current ||
        !activeAgentMessageRef.current ||
        !event.stage ||
        !Array.isArray(event.stages) ||
        !Array.isArray(event.completedStages) ||
        typeof event.completed !== "number" ||
        typeof event.total !== "number" ||
        typeof event.label !== "string"
      ) {
        return;
      }
      const completedStages = event.completedStages.filter(
        (stage): stage is BookmarkAgentProgressStage =>
          AGENT_PROGRESS_STEPS.some((step) => step.stage === stage),
      );
      const stages = event.stages.filter(
        (stage): stage is BookmarkAgentProgressStage =>
          AGENT_PROGRESS_STEPS.some((step) => step.stage === stage),
      );
      if (!stages.includes(event.stage)) return;
      const progress = {
        requestId: event.requestId,
        stage: event.stage,
        stages,
        completedStages,
        completed: event.completed,
        total: event.total,
        label: event.label,
      } as BookmarkAgentProgress;
      setActiveConversation((current) => {
        if (!current) return current;
        return {
          ...current,
          messages: current.messages.map((message) =>
            message.id === activeAgentMessageRef.current
              ? { ...message, progress }
              : message,
          ),
        };
      });
    };
    runtimeMessageEvent?.addListener(handleAgentProgress);
    return () => runtimeMessageEvent?.removeListener(handleAgentProgress);
  }, []);

  useEffect(() => {
    if (!persistentStateLoaded.current) return;
    void saveSidepanelState({
      expandedFolderIds: [...expanded],
      scrollTop: contentRef.current?.scrollTop || 0,
    });
  }, [expanded]);

  useEffect(() => {
    if (
      panelView !== "library" ||
      onboardingVisible !== false ||
      !persistentStateLoaded.current
    ) {
      return;
    }
    void getSidepanelState().then((persisted) => {
      window.requestAnimationFrame(() => {
        if (contentRef.current) {
          contentRef.current.scrollTop = persisted.scrollTop;
          syncScrollThumb();
        }
      });
    });
  }, [onboardingVisible, panelView, syncScrollThumb]);

  useEffect(() => {
    if (!bookmarkPreview) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setBookmarkPreview(null);
        setPreviewSnapshot(null);
        previewCanonicalUrl.current = "";
      }
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [bookmarkPreview]);

  useEffect(() => {
    const consumeQueue = async () => {
      if (pendingDraftInFlight.current) return;
      pendingDraftInFlight.current = true;
      try {
        while (pendingDraftTabQueue.current.length) {
          const tabId = pendingDraftTabQueue.current.shift()!;
          try {
            const draft = await sendExtensionRequest({
              type: "GET_PENDING_SAVE",
              tabId,
            });
            if (draft) {
              await startSave(draft);
            }
          } catch (caught) {
            setError(
              caught instanceof Error ? caught.message : "无法打开收藏表单",
            );
          }
        }
      } finally {
        pendingDraftInFlight.current = false;
        if (pendingDraftTabQueue.current.length) {
          void consumeQueue();
        }
      }
    };

    const enqueue = (tabId: number) => {
      if (!pendingDraftTabQueue.current.includes(tabId)) {
        pendingDraftTabQueue.current.push(tabId);
      }
      void consumeQueue();
    };

    const handlePendingSave = (message: unknown) => {
      const tabId = pendingSaveReadyTabId(
        message && typeof message === "object" ? message : {},
      );
      // Chrome 的全局侧边栏会跨标签页保持开启，因此必须以消息里的
      // tabId 为准，不能用侧边栏启动时缓存的活动标签页 ID 过滤。
      if (tabId !== null) enqueue(tabId);
    };
    const runtimeMessageEvent =
      typeof chrome !== "undefined" ? chrome.runtime?.onMessage : undefined;
    runtimeMessageEvent?.addListener(handlePendingSave);

    const activeTabId = appState?.activeTab?.id;
    if (typeof activeTabId === "number") {
      enqueue(activeTabId);
    }
    return () => {
      runtimeMessageEvent?.removeListener(handlePendingSave);
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
        "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]",
      );
      if (focusable && !dialogRef.current?.contains(document.activeElement)) {
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
          "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]",
        ),
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

  const currentPageSaveState = useMemo(() => {
    if (!snapshot || !appState?.activeTab?.url) return null;
    try {
      return buildBookmarkSaveState(
        snapshot.roots || [snapshot.root],
        appState.activeTab.url,
      );
    } catch {
      return null;
    }
  }, [appState, snapshot]);
  const currentSaved = Boolean(
    currentPageSaveState && currentPageSaveState.status !== "none",
  );
  const selectedSaveMatch = useMemo(
    () =>
      bookmarkSaveState?.matches.find(
        (match) => match.id === selectedBookmarkId,
      ),
    [bookmarkSaveState, selectedBookmarkId],
  );
  const bookmarkRoots = useMemo(() => {
    if (!snapshot) return [];
    const visible = visibleBookmarkRootChildren(snapshot);
    if (!removedNodeIds.length) return visible;
    // A deleted bookmark leaves the list on click rather than when Chrome's
    // own bookmark event finally arrives — until then it is still openable,
    // which reads as "the delete did nothing". Pruning here also drops it from
    // search results, which derive from this same tree.
    const removed = new Set(removedNodeIds);
    const prune = (nodes: NativeBookmarkNode[]): NativeBookmarkNode[] =>
      nodes
        .filter((node) => !removed.has(node.id))
        .map((node) =>
          node.children ? { ...node, children: prune(node.children) } : node,
        );
    return prune(visible);
  }, [removedNodeIds, snapshot]);
  const resourceByUrl = useMemo(() => {
    const map = new Map<string, ResourceRecord>();
    for (const resource of Array.isArray(resources) ? resources : []) {
      map.set(resource.url, resource);
      map.set(resource.canonicalUrl, resource);
    }
    return map;
  }, [resources]);
  const siteBrandByHost = useMemo(
    () =>
      new Map(
        siteBrands.map((brand) => [brand.host.toLocaleLowerCase(), brand]),
      ),
    [siteBrands],
  );
  const localSearchIndex = useMemo(
    () => buildLocalSearchIndex(resources),
    [resources],
  );
  useEffect(() => {
    let cancelled = false;
    if (!isPinyinSearchQuery(debouncedLibraryQuery)) return;
    void hydratePinyinSearchIndex(localSearchIndex).then((loaded) => {
      if (loaded && !cancelled) {
        setPinyinIndexRevision((value) => value + 1);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [debouncedLibraryQuery, localSearchIndex]);
  const rankedSearchResults = useMemo(
    () =>
      debouncedLibraryQuery.trim()
        ? searchLocalIndex(localSearchIndex, debouncedLibraryQuery)
        : [],
    [debouncedLibraryQuery, localSearchIndex, pinyinIndexRevision],
  );
  const nativeNodeByUrl = useMemo(
    () => bookmarkNodesByUrl(bookmarkRoots),
    [bookmarkRoots],
  );
  const rankedNativeResults = useMemo(
    () =>
      rankedSearchResults.flatMap((result) => {
        const node =
          nativeNodeByUrl.get(result.resource.url) ||
          nativeNodeByUrl.get(result.resource.canonicalUrl);
        return node ? [{ ...result, node }] : [];
      }),
    [nativeNodeByUrl, rankedSearchResults],
  );
  const filteredBookmarkNodes = useMemo(
    () =>
      debouncedLibraryQuery.trim()
        ? filterBookmarkTree(
            bookmarkRoots,
            debouncedLibraryQuery,
            bookmarkMatchUrls(
              rankedSearchResults.map((result) => result.resource.url),
            ),
          )
        : bookmarkRoots,
    [bookmarkRoots, debouncedLibraryQuery, rankedSearchResults],
  );
  const visibleBookmarkNodes =
    librarySearchMode === "ranked" && libraryQuery.trim()
      ? []
      : filteredBookmarkNodes;
  const visibleExpanded = useMemo(() => {
    if (!debouncedLibraryQuery.trim() || librarySearchMode === "ranked") {
      return expanded;
    }
    return new Set([...expanded, ...collectFolderIds(filteredBookmarkNodes)]);
  }, [
    expanded,
    filteredBookmarkNodes,
    debouncedLibraryQuery,
    librarySearchMode,
  ]);
  const hasVisibleFolders = visibleBookmarkNodes.some((node) => !node.url);
  const editorResource = useMemo(() => {
    if (editor?.kind !== "bookmark" || !editor.node.url) {
      return undefined;
    }
    return (
      (editor.resourceKey
        ? resources.find(
            (resource) => resource.resourceKey === editor.resourceKey,
          )
      : undefined) || resourceForUrl(resourceByUrl, editor.node.url)
    );
  }, [editor, resourceByUrl, resources]);
  const editorModel = useMemo(() => {
    if (editor?.kind !== "bookmark") {
      return { locations: [], folders: [] };
    }
    const bookmarkIds = editorResource?.nativeBookmarkIds?.length
      ? editorResource.nativeBookmarkIds
      : [editor.node.id];
    if (snapshot) {
      const model = buildBookmarkEditorModel(bookmarkIds, snapshot);
      if (model.locations.length) return model;
    }
    return {
      locations: [
        {
          bookmarkId: editor.node.id,
          parentId: editor.node.parentId || "",
          title: editor.node.title,
          url: editor.node.url || "",
          label: "根目录",
          writable: !editor.node.unmodifiable && !editor.node.folderType,
        },
      ],
      folders: [],
    };
  }, [editor, editorResource, snapshot]);
  const selectedEditorLocation = useMemo(
    () =>
      editorModel.locations.find(
        (location) => location.bookmarkId === editBookmarkId,
      ) || editorModel.locations[0],
    [editBookmarkId, editorModel.locations],
  );
  const editorWritable = selectedEditorLocation?.writable ?? true;

  function keepBookmarkPreviewOpen() {
    if (previewCloseTimer.current !== undefined) {
      window.clearTimeout(previewCloseTimer.current);
      previewCloseTimer.current = undefined;
    }
  }

  function dismissBookmarkPreviewImmediately() {
    previewCanonicalUrl.current = "";
    if (previewCloseTimer.current !== undefined) {
      window.clearTimeout(previewCloseTimer.current);
      previewCloseTimer.current = undefined;
    }
    setBookmarkPreview(null);
    setPreviewSnapshot(null);
  }

  function closeBookmarkPreview() {
    // 离开书签行后立即取消尚未完成的快照查询，避免异步结果晚到时闪出卡片。
    previewCanonicalUrl.current = "";
    if (previewCloseTimer.current !== undefined) {
      window.clearTimeout(previewCloseTimer.current);
    }
    previewCloseTimer.current = window.setTimeout(() => {
      setBookmarkPreview(null);
      setPreviewSnapshot(null);
      previewCloseTimer.current = undefined;
    }, 200);
  }

  function showBookmarkPreview(node: NativeBookmarkNode, rect: DOMRect) {
    if (!node.url) return;
    keepBookmarkPreviewOpen();
    setBookmarkPreview(null);
    setPreviewSnapshot(null);
    let canonicalUrl = "";
    try {
      canonicalUrl = canonicalizeUrl(node.url);
    } catch {
      return;
    }
    previewCanonicalUrl.current = canonicalUrl;
    void sendExtensionRequest({
      type: "GET_PAGE_SNAPSHOT",
      canonicalUrl,
    })
      .then((next) => {
        if (previewCanonicalUrl.current === canonicalUrl && next) {
          const gap = 14;
          const spaceBelow = window.innerHeight - rect.bottom - gap;
          const spaceAbove = rect.top - gap;
          const previewWidth = Math.min(
            286,
            Math.max(0, window.innerWidth - 72),
          );
          const previewHeight = (previewWidth * 10) / 16 + 2;
          const flip = spaceBelow < previewHeight && spaceAbove > spaceBelow;
          setBookmarkPreview({
            node,
            flip,
            // 默认放在鼠标所在书签行的下方；空间不足时放到行上方，
            // 两种情况都保留间隔，绝不覆盖当前鼠标热区。
            offset: flip
              ? Math.max(12, window.innerHeight - rect.top + gap)
              : Math.max(12, rect.bottom + gap),
          });
          setPreviewSnapshot(next);
        }
      })
      .catch(() => undefined);
  }

  async function openNavigation(
    input: { text: string; url?: string },
    newTab = false,
  ) {
    setError("");
    try {
      if (input.url && pageSnapshotsEnabled) {
        // 由用户点击直接发起权限请求；拒绝后仍然照常打开网页。
        await requestPageSnapshotPermission().catch(() => false);
      }
      await sendExtensionRequest({
        type: "NAVIGATE",
        payload: {
          text: input.text,
          url: input.url,
          disposition: newTab ? "new" : "current",
        },
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "无法打开");
    }
  }

  async function persistConversation(conversation: AgentConversation) {
    const saved = await sendExtensionRequest({
      type: "SAVE_AGENT_CONVERSATION",
      conversation,
    });
    setConversations((current) => [
      saved,
      ...current.filter((item) => item.id !== saved.id),
    ]);
    return saved;
  }

  async function runAgentTurn(conversation: AgentConversation, query: string) {
    if (!query || busy) return;
    const requestId = crypto.randomUUID();
    const timestamp = new Date().toISOString();
    const userMessage: AgentChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: query,
      createdAt: timestamp,
      status: "complete",
    };
    const pendingMessage: AgentChatMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: "",
      createdAt: timestamp,
      status: "sending",
      progress: {
        requestId,
        stage: "preparing",
        stages: ["preparing"],
        completedStages: [],
        completed: 0,
        total: 0,
        label: "正在准备收藏库",
      },
    };
    const pendingConversation: AgentConversation = {
      ...conversation,
      title:
        conversation.messages.length > 0
          ? conversation.title
          : query.slice(0, 36),
      updatedAt: timestamp,
      messages: [...conversation.messages, userMessage, pendingMessage],
    };
    setActiveConversation(pendingConversation);
    setPanelView("chat");
    setAgentPrompt("");
    setBusy("agent");
    setError("");
    setNotice("");
    activeAgentRequestRef.current = requestId;
    activeAgentMessageRef.current = pendingMessage.id;
    cancelledAgentRequestsRef.current.delete(requestId);

    try {
      await persistConversation(pendingConversation);
      const response = await sendExtensionRequest({
        type: "ASK_BOOKMARK_AGENT",
        query,
        requestId,
        history: conversation.messages
          .filter(
            (message) =>
              (message.status === undefined || message.status === "complete") &&
              Boolean(message.content.trim()),
          )
          .slice(-10)
          .map((message) => ({
            role: message.role,
            content: message.content,
          })),
      });
      if (cancelledAgentRequestsRef.current.has(requestId)) return;
      const completed: AgentConversation = {
        ...pendingConversation,
        updatedAt: new Date().toISOString(),
        messages: pendingConversation.messages.map((message) =>
          message.id === pendingMessage.id
            ? {
                ...message,
                content: response.answer,
                providerName: response.providerName
                  ? `${response.providerName} · ${
                      response.catalogScanComplete ? "已检查" : "已召回"
                    } ${response.examinedCount}/${response.catalogSize} 条收藏${
                      response.excludedCount
                        ? ` · ${response.excludedCount} 条受隐私保护`
                        : ""
                    }`
                  : undefined,
                sources: response.sources,
                actions: response.actions,
                status: "complete",
                progress: undefined,
              }
            : message,
        ),
      };
      setActiveConversation(completed);
      await persistConversation(completed);
    } catch (caught) {
      if (cancelledAgentRequestsRef.current.has(requestId)) {
        return;
      }
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
                status: "failed",
              }
            : item,
        ),
      };
      setActiveConversation(failed);
      setError("");
      await persistConversation(failed).catch(() => undefined);
    } finally {
      if (activeAgentRequestRef.current === requestId) {
        activeAgentRequestRef.current = "";
        activeAgentMessageRef.current = "";
        setBusy("");
      }
      cancelledAgentRequestsRef.current.delete(requestId);
    }
  }

  async function cancelAgentRun() {
    const requestId = activeAgentRequestRef.current;
    const messageId = activeAgentMessageRef.current;
    if (!requestId || !messageId || busy !== "agent") return;
    cancelledAgentRequestsRef.current.add(requestId);
    activeAgentMessageRef.current = "";
    setBusy("");
    setError("");
    const updated: AgentConversation | null = activeConversation
      ? {
          ...activeConversation,
          updatedAt: new Date().toISOString(),
          messages: activeConversation.messages.map((message) =>
            message.id === messageId
              ? {
                  ...message,
                  content: "已停止本次回答。",
                  status: "cancelled",
                  progress: undefined,
                }
              : message,
          ),
        }
      : null;
    if (updated) {
      setActiveConversation(updated);
      await persistConversation(updated).catch(() => undefined);
    }
    await sendExtensionRequest({
      type: "CANCEL_BOOKMARK_AGENT",
      requestId,
    }).catch(() => undefined);
  }

  async function handleConfirmAgentActions(messageId: string) {
    if (!activeConversation || busy) return;
    const sourceMessage = activeConversation.messages.find(
      (message) => message.id === messageId,
    );
    const pendingActions = (sourceMessage?.actions || []).filter(
      (action) => action.status === "pending",
    );
    if (!sourceMessage || !pendingActions.length) return;

    const markActions = (
      actions: BookmarkAgentActionProposal[],
      status: BookmarkAgentActionProposal["status"],
      resultMessage = "",
    ) =>
      actions.map((action) =>
        action.status === "pending" || action.status === "executing"
          ? {
              ...action,
              status,
              ...(resultMessage ? { resultMessage } : {}),
            }
          : action,
      );

    const executingConversation: AgentConversation = {
      ...activeConversation,
      updatedAt: new Date().toISOString(),
      messages: activeConversation.messages.map((message) =>
        message.id === messageId
          ? {
              ...message,
              actions: markActions(message.actions || [], "executing"),
            }
          : message,
      ),
    };
    setActiveConversation(executingConversation);
    setBusy("agent-actions");
    setError("");

    try {
      const response = await sendExtensionRequest({
        type: "EXECUTE_BOOKMARK_AGENT_ACTIONS",
        actions: pendingActions,
      });
      const resultById = new Map(
        response.results.map((result) => [result.actionId, result]),
      );
      const completedActions = (sourceMessage.actions || []).map((action) => {
        const result = resultById.get(action.id);
        if (!result) return action;
        return {
          ...action,
          status: result.success ? "completed" : "failed",
          resultMessage: result.message,
        } satisfies BookmarkAgentActionProposal;
      });
      const succeeded = response.results.filter(
        (result) => result.success,
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
        status: failed && !succeeded ? "failed" : "complete",
      };
      const completed: AgentConversation = {
        ...executingConversation,
        updatedAt: timestamp,
        messages: [
          ...executingConversation.messages.map((message) =>
            message.id === messageId
              ? { ...message, actions: completedActions }
              : message,
          ),
          resultMessage,
        ],
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
                  actions: markActions(item.actions || [], "failed", message),
                }
              : item,
          ),
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: `没有完成任何操作。原因：${message}`,
            createdAt: timestamp,
            status: "failed",
          },
        ],
      };
      setActiveConversation(failed);
      setError("");
      await persistConversation(failed).catch(() => undefined);
    } finally {
      setBusy("");
    }
  }

  function handleDropAgentAction(messageId: string, actionId: string) {
    if (!activeConversation || busy) return;
    const updated: AgentConversation = {
      ...activeConversation,
      updatedAt: new Date().toISOString(),
      messages: activeConversation.messages.map((message) =>
        message.id === messageId
          ? {
              ...message,
              actions: (message.actions || []).map((action) =>
                action.id === actionId && action.status === "pending"
                  ? {
                      ...action,
                      status: "cancelled" as const,
                      resultMessage: "已从这批操作中移除。",
                    }
                  : action,
              ),
            }
          : message,
      ),
    };
    setActiveConversation(updated);
    void persistConversation(updated);
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
                      resultMessage: "已取消，没有修改 Chrome。",
                    }
                  : action,
              ),
            }
          : message,
      ),
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
        batchId,
      });
      const updated: AgentConversation = {
        ...activeConversation,
        updatedAt: new Date().toISOString(),
        messages: activeConversation.messages.map((message) =>
          message.id === messageId
            ? {
                ...message,
                content: `${message.content}\n${result.failed ? `已恢复 ${result.restored} 项，${result.failed} 项需要手动处理。` : `已撤销 ${result.restored} 项更改。`}`,
                undoBatchId: undefined,
              }
            : message,
        ),
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

  function submitAgentQuery(input: string) {
    const query = input.trim();
    if (!query || busy) return;
    if (!aiConfigured) {
      setPanelView("settings");
      return;
    }
    const timestamp = new Date().toISOString();
    const conversation =
      panelView === "chat" && activeConversation
        ? activeConversation
        : {
            id: crypto.randomUUID(),
            title: query.slice(0, 36),
            createdAt: timestamp,
            updatedAt: timestamp,
            messages: [],
          };
    void runAgentTurn(conversation, query);
  }

  function handleAgentSubmit(event: React.FormEvent) {
    event.preventDefault();
    submitAgentQuery(agentPrompt);
  }

  function clearLibrarySearch() {
    const previous = librarySearchSnapshot.current;
    setLibraryQuery("");
    setLibrarySearchMode("tree");
    if (!previous) return;
    setExpanded(new Set(previous.expanded));
    librarySearchSnapshot.current = null;
    window.requestAnimationFrame(() => {
      if (contentRef.current) {
        contentRef.current.scrollTop = previous.scrollTop;
        syncScrollThumb();
      }
    });
  }

  function handleLibraryQueryChange(value: string) {
    if (
      value.trim() &&
      !libraryQuery.trim() &&
      !librarySearchSnapshot.current
    ) {
      librarySearchSnapshot.current = {
        expanded: new Set(expanded),
        scrollTop: contentRef.current?.scrollTop || 0,
      };
    }
    if (!value.trim()) {
      clearLibrarySearch();
      return;
    }
    setLibraryQuery(value);
    setLibrarySearchMode("tree");
  }

  async function startSave(draft?: PendingSaveDraft) {
    if (!appState) return;
    dismissBookmarkPreviewImmediately();
    setEditor({ kind: "save" });
    setConfirmDeleteId("");
    setBusy("capture");
    setError("");
    setCaptureWarning("");
    setCaptureSourceTabId(draft?.tabId || appState.activeTab?.id);
    setFolderSuggestions([]);
    setNote("");
    setBookmarkSaveState(null);
    setSaveDisposition("");
    setSelectedBookmarkId("");
    try {
      const targetUrl = draft?.url || appState.activeTab?.url || "";
      const [folderOptions, saveState] = await Promise.all([
        sendExtensionRequest({ type: "GET_FOLDERS" }),
        sendExtensionRequest({
          type: "GET_BOOKMARK_SAVE_STATE",
          url: targetUrl,
        }),
      ]);
      setBookmarkSaveState(saveState);
      const initialMatch =
        saveState.status === "exact" || saveState.status === "readonly"
          ? saveState.matches[0]
          : undefined;
      const existingResource = resourceForUrl(resourceByUrl, targetUrl);
      setNote(existingResource?.userNote || "");
      setSelectedBookmarkId(initialMatch?.id || "");
      setSaveDisposition(
        saveState.status === "none" ? "new" : initialMatch ? "reuse" : "",
      );
      setFolders(folderOptions);
      setFolderId(initialSaveFolderId(folderOptions, initialMatch?.parentId));

      if (draft?.kind === "link") {
        const page = captureFromDraft(draft);
        setCapture(page);
        setEditTitle(initialMatch?.title || page.title);
        setFolderSuggestions(
          await sendExtensionRequest({
            type: "GET_FOLDER_SUGGESTIONS",
            capture: page,
          }).catch(() => []),
        );
        setCaptureWarning(
          "这是链接收藏。保存后打开该网页，可继续补充正文摘要和 AI 标签。",
        );
      } else
        try {
          const page = await sendExtensionRequest({
            type: "CAPTURE_ACTIVE_PAGE",
            tabId: draft?.tabId,
          });
          const merged = draft
            ? {
                ...page,
                selectedText: draft.selectedText || page.selectedText,
              }
            : page;
          setCapture(merged);
          setEditTitle(initialMatch?.title || draft?.title || merged.title);
          setFolderSuggestions(
            await sendExtensionRequest({
              type: "GET_FOLDER_SUGGESTIONS",
              capture: merged,
            }).catch(() => []),
          );
        } catch {
          const page = draft ? captureFromDraft(draft) : emptyCapture(appState);
          setCapture(page);
          setEditTitle(initialMatch?.title || page.title);
          setFolderSuggestions(
            await sendExtensionRequest({
              type: "GET_FOLDER_SUGGESTIONS",
              capture: page,
            }).catch(() => []),
          );
          setCaptureWarning(
            "此页面受 Chrome 保护，仍可保存原生书签，但不会读取正文。",
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
    dismissBookmarkPreviewImmediately();
    const resource = node.url
      ? resourceForUrl(resourceByUrl, node.url)
      : undefined;
    setEditor({
      kind: "bookmark",
      node,
      ...(resource ? { resourceKey: resource.resourceKey } : {}),
    });
    setConfirmDeleteId("");
    // A previous save/delete leaves `busy` set until its own request settles.
    // Without this reset, reopening the editor renders every field disabled and
    // greyed out for an operation that is no longer running.
    setBusy("");
    setEditBookmarkId(node.id);
    setEditParentId(node.parentId || "");
    setEditTitle(node.title);
    setEditUrl(node.url || "");
    setEditTags(resource?.tags || []);
    setEditTagInput("");
    setEditTagsChanged(false);
    setNote(resource?.userNote || "");
    setError("");
  }

  function startCreateFolder(parentId: string) {
    dismissBookmarkPreviewImmediately();
    setEditor({ kind: "folder", parentId });
    setConfirmDeleteId("");
    setBusy("");
    setEditBookmarkId("");
    setEditParentId("");
    setEditTitle("");
    setEditUrl("");
    setEditTags([]);
    setEditTagInput("");
    setEditTagsChanged(false);
    setError("");
  }

  function addEditTags(value = editTagInput) {
    if (!mergeBookmarkEditorTags([], value).length) return;
    setEditTags((current) => mergeBookmarkEditorTags(current, value));
    setEditTagInput("");
    setEditTagsChanged(true);
  }

  function resetEditLocation(bookmarkId: string) {
    const location = editorModel.locations.find(
      (candidate) => candidate.bookmarkId === bookmarkId,
    );
    if (!location) return;
    setEditBookmarkId(location.bookmarkId);
    setEditParentId(location.parentId);
    setEditTitle(location.title);
    setEditUrl(location.url);
    setEditTagInput("");
    setConfirmDeleteId("");
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
          payload: { parentId: editor.parentId, title: editTitle },
        });
      } else if (editor.kind === "bookmark") {
        const bookmarkId = editBookmarkId || editor.node.id;
        if (editor.resourceKey && editorResource) {
          const result = await sendExtensionRequest({
            type: "UPDATE_BOOKMARK_DETAILS",
            payload: {
              bookmarkId,
              resourceKey: editor.resourceKey,
              title: editTitle,
              url: editUrl,
              parentId: editParentId,
              tags: mergeBookmarkEditorTags(editTags, editTagInput),
              tagsChanged: editTagsChanged || Boolean(editTagInput.trim()),
              userNote: note,
            },
          });
          setNotice(
            result.urlChanged
              ? "收藏信息已更新；新网址将在下次打开时重新生成摘要和封面。"
              : "收藏信息已更新",
          );
        } else {
          await sendExtensionRequest({
            type: "UPDATE_NATIVE_BOOKMARK",
            payload: {
              id: bookmarkId,
              title: editTitle,
              ...(editor.node.url ? { url: editUrl } : {}),
            },
          });
        }
      } else {
        if (!capture) throw new Error("当前页面尚未读取完成。");
        if (pageSnapshotsEnabled) {
          await requestPageSnapshotPermission().catch(() => false);
        }
        const result = await sendExtensionRequest({
          type: "SAVE_BOOKMARK",
          payload: {
            capture,
            ...(typeof captureSourceTabId === "number"
              ? { sourceTabId: captureSourceTabId }
              : {}),
            title: editTitle,
            userNote: note,
            folderId,
            requestAi: true,
            ...(saveDisposition === "reuse" && selectedBookmarkId
              ? { existingBookmarkId: selectedBookmarkId }
              : {}),
            ...(saveDisposition === "new" &&
            bookmarkSaveState?.status !== "none"
              ? { createSeparate: true }
              : {}),
            ...(saveDisposition === "reuse" &&
            bookmarkSaveState?.matches.find(
              (match) => match.id === selectedBookmarkId,
            )?.matchKind === "canonical"
              ? { confirmedCanonicalReuse: true }
              : {}),
          },
        });
        if (result.aiWarning) {
          setNotice(result.aiWarning);
        } else if (result.enhancementPending) {
          setNotice("收藏已保存，Aarre 正在后台补全摘要、标签和封面。");
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
    const target = editor.node;
    const targetId = editBookmarkId || target.id;
    setRemovedNodeIds((current) =>
      current.includes(targetId) ? current : [...current, targetId],
    );
    setEditor(null);
    setConfirmDeleteId("");
    setBusy("");
    setError("");
    try {
      await sendExtensionRequest({
        type: "DELETE_NATIVE_BOOKMARK",
        payload: { id: targetId, recursive: !target.url },
      });
      await refresh();
      setRemovedNodeIds((current) => current.filter((id) => id !== targetId));
    } catch (caught) {
      // Put the row back; the bookmark still exists in Chrome.
      setRemovedNodeIds((current) => current.filter((id) => id !== targetId));
      setError(caught instanceof Error ? caught.message : "删除失败");
    }
  }

  async function moveNode(id: string, parentId: string, index?: number) {
    if (!parentId) return;
    setError("");
    try {
      await sendExtensionRequest({
        type: "MOVE_NATIVE_BOOKMARK",
        payload: { id, parentId, index },
      });
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "移动失败");
    }
  }

  function handleContentScroll() {
    revealScrollThumb();
    if (!persistentStateLoaded.current) return;
    if (scrollSaveTimer.current !== undefined) {
      window.clearTimeout(scrollSaveTimer.current);
    }
    scrollSaveTimer.current = window.setTimeout(() => {
      void saveSidepanelState({
        expandedFolderIds: [...expanded],
        scrollTop: contentRef.current?.scrollTop || 0,
      });
    }, 180);
  }

  function handleScrollThumbPointerDown(
    event: React.PointerEvent<HTMLDivElement>,
  ) {
    const content = contentRef.current;
    if (!content) return;
    if (scrollHideTimer.current !== undefined) {
      window.clearTimeout(scrollHideTimer.current);
    }
    scrollDrag.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startScrollTop: content.scrollTop,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    syncScrollThumb(true);
  }

  function handleScrollThumbPointerMove(
    event: React.PointerEvent<HTMLDivElement>,
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
    event: React.PointerEvent<HTMLDivElement>,
  ) {
    if (scrollDrag.current?.pointerId !== event.pointerId) return;
    scrollDrag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    scheduleScrollThumbHide();
  }

  if (onboardingVisible === null) {
    return (
      <main className="sidepanel-boot-screen" aria-busy="true">
        <div className="sidepanel-boot-heading">
          <span className="sidepanel-boot-mark" aria-hidden="true" />
          <strong>Aarre</strong>
        </div>
        <div className="sidepanel-boot-lines" aria-hidden="true">
          <span className="sidepanel-boot-line" />
          <span className="sidepanel-boot-line" />
          <span className="sidepanel-boot-line" />
        </div>
      </main>
    );
  }

  if (onboardingVisible) {
    return (
      <OnboardingPage
        resourceCount={
          snapshot?.bookmarkCount || appState?.localResourceCount || 0
        }
        initialAiConfigured={aiConfigured}
        onComplete={(_skipped, configured) => {
          if (configured) setAiConfigured(true);
          setOnboardingVisible(false);
          void refresh();
        }}
      />
    );
  }

  if (panelView === "settings") {
    return (
      <SettingsPage
        appState={appState}
        listCoverStyle={listCoverStyle}
        onListCoverStyleChange={setListCoverStyle}
        onRestartOnboarding={() => {
          void restartOnboarding().then(() => {
            setPanelView("library");
            setOnboardingVisible(true);
          });
        }}
        onAppStateChange={setAppState}
        onClose={() => {
          setPanelView("library");
          void refresh();
        }}
      />
    );
  }

  if (panelView === "history") {
    return (
      <AgentHistoryPage
        conversations={conversations}
        onDelete={deleteConversation}
        onRename={renameConversation}
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
        resourceByUrl={resourceByUrl}
        siteBrandByHost={siteBrandByHost}
        prompt={agentPrompt}
        busy={busy === "agent" || busy === "agent-actions"}
        configured={aiConfigured}
        error={error}
        onPromptChange={setAgentPrompt}
        onConfigure={() => setPanelView("settings")}
        onCancel={
          busy === "agent" ? () => void cancelAgentRun() : undefined
        }
        onBack={() => {
          setError("");
          setPanelView("library");
        }}
        onSubmit={handleAgentSubmit}
        onOpenSource={(url) => void openNavigation({ text: url, url }, true)}
        onConfirmActions={(messageId) =>
          void handleConfirmAgentActions(messageId)
        }
        onCancelActions={handleCancelAgentActions}
        onDropAction={handleDropAgentAction}
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
          <Button
            type="button"
            variant="unstyled"
            size="icon-sm"
            className="icon-button"
            title="新建文件夹"
            aria-label="新建文件夹"
            onClick={() =>
              snapshot &&
              startCreateFolder(snapshot.primaryRootId || snapshot.root.id)
            }
            disabled={!snapshot}
          >
            <PlusIcon />
          </Button>
          <Button
            type="button"
            variant="unstyled"
            size="icon-sm"
            className="icon-button star-button"
            data-saved={currentSaved}
            title={currentSaved ? "管理当前页面收藏" : "添加到收藏"}
            aria-label={currentSaved ? "管理当前页面收藏" : "添加到收藏"}
            onClick={() => void startSave()}
            disabled={!appState?.activeTab?.url}
          >
            <StarIcon filled={currentSaved} />
          </Button>
          <Button
            type="button"
            variant="unstyled"
            size="icon-sm"
            className="icon-button history-button"
            title="历史会话"
            aria-label="打开历史会话"
            onClick={() => {
              void loadConversations();
              setPanelView("history");
            }}
          >
            <HistoryIcon />
          </Button>
          <Button
            type="button"
            variant="unstyled"
            size="icon-sm"
            className="icon-button"
            title="打开批量整理工作台"
            aria-label="打开批量整理工作台"
            onClick={() => void sendExtensionRequest({ type: "OPEN_MANAGER" })}
          >
            <ExternalLinkIcon />
          </Button>
          <Button
            type="button"
            variant="unstyled"
            size="icon-sm"
            className="icon-button settings-button"
            title="设置"
            aria-label="打开设置"
            onClick={() => setPanelView("settings")}
          >
            <SettingsIcon />
          </Button>
        </div>
        {appState?.libraryScan.state === "running" ? (
          <Button
            variant="unstyled"
            type="button"
            className="library-scan-indicator"
            aria-label={`扫描进度 ${appState.libraryScan.processed}/${appState.libraryScan.total}`}
            onClick={() => setPanelView("settings")}
          >
            <span
              style={{
                width: `${
                  appState.libraryScan.total
                    ? (appState.libraryScan.processed /
                        appState.libraryScan.total) *
                      100
                    : 0
                }%`,
              }}
            />
          </Button>
        ) : null}
      </header>

      {organizationNotice ? (
        <section
          className="organization-notice-banner"
          aria-label="书签整理建议"
        >
          <div>
            <strong>
              发现 {organizationNotice.proposalCount} 条可以整理的地方
            </strong>
          </div>
          <div>
            <Button
              variant="unstyled"
              type="button"
              className="button button-quiet button-small"
              disabled={organizationNoticeBusy}
              onClick={() => {
                setOrganizationNoticeBusy(true);
                void sendExtensionRequest({
                  type: "DISMISS_ORGANIZATION_NOTICE",
                })
                  .then(() => setOrganizationNotice(null))
                  .catch((caught) =>
                    setError(
                      caught instanceof Error
                        ? caught.message
                        : "暂时无法隐藏整理提示",
                    ),
                  )
                  .finally(() => setOrganizationNoticeBusy(false));
              }}
            >
              暂不
            </Button>
            <Button
              variant="unstyled"
              type="button"
              className="button button-dark button-small"
              disabled={organizationNoticeBusy}
              onClick={() =>
                void sendExtensionRequest({
                  type: "OPEN_MANAGER",
                  view: "organize",
                }).catch((caught) =>
                  setError(
                    caught instanceof Error
                      ? caught.message
                      : "无法打开整理提案",
                  ),
                )
              }
            >
              去处理
            </Button>
          </div>
        </section>
      ) : null}

      {!libraryQuery.trim() && contextResurfacing.length ? (
        <section
          className="context-resurfacing context-resurfacing-top"
          aria-label="这会儿值得重看"
        >
          <header>
            <strong>这会儿值得重看</strong>
            <Button
              type="button"
              variant="unstyled"
              onClick={() =>
                void sendExtensionRequest({
                  type: "OPEN_MANAGER",
                  view: "resurface",
                })
              }
            >
              打开工作台
            </Button>
          </header>
          {contextResurfacing.map((item) => (
            <Button
              type="button"
              variant="unstyled"
              size="unstyled"
              key={item.resourceKey}
              onClick={() =>
                void openNavigation({
                  text: item.url,
                  url: item.url,
                })
              }
            >
              <span>
                <strong>{item.title}</strong>
                <small>{item.reason}</small>
              </span>
              <em>{item.ageDays} 天</em>
            </Button>
          ))}
        </section>
      ) : null}

      <form
        className="search-box"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          if (libraryQuery.trim()) setLibrarySearchMode("ranked");
        }}
      >
        <SearchIcon aria-hidden="true" />
        <FluidInput
          type="search"
          value={libraryQuery}
          onChange={(event) => handleLibraryQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && libraryQuery) {
              event.preventDefault();
              clearLibrarySearch();
            }
          }}
          placeholder="搜索标题、标签、摘要或拼音"
          aria-label="搜索 Chrome 书签"
        />
        {libraryQuery ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="清空搜索"
            title="清空搜索"
            onClick={clearLibrarySearch}
          >
            <CloseIcon />
          </Button>
        ) : (
          <kbd>↵</kbd>
        )}
      </form>

      <div
        className="native-content-frame"
        data-has-folders={hasVisibleFolders}
        data-at-end={scrollThumb.atEnd}
      >
        {error ? (
          <div className="native-error-layout" role="alert">
            <span>{error}</span>
            <div>
              {!snapshot ? (
                <Button
                  variant="unstyled"
                  type="button"
                  className="native-error-retry"
                  onClick={() =>
                    void refresh().catch((caught) =>
                      setError(
                        caught instanceof Error
                          ? caught.message
                          : "重新读取失败",
                      ),
                    )
                  }
                >
                  重试
                </Button>
              ) : null}
              <Button
                type="button"
                variant="unstyled"
                size="icon-sm"
                className="native-status-dismiss"
                aria-label="关闭错误提示"
                onClick={() => setError("")}
              >
                <CloseIcon />
              </Button>
            </div>
          </div>
        ) : null}
        {notice && !error ? (
          <div className="native-notice" role="status">
            <span>{notice}</span>
            <Button
              type="button"
              variant="unstyled"
              size="icon-sm"
              className="native-status-dismiss"
              aria-label="关闭提示"
              onClick={() => setNotice("")}
            >
              <CloseIcon />
            </Button>
          </div>
        ) : null}
        <section
          id="bookmark-list"
          ref={contentRef}
          className="native-content"
          data-has-folders={hasVisibleFolders}
          aria-label="Chrome 书签"
          onScroll={handleContentScroll}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            const id = event.dataTransfer.getData(
              "application/x-bookmark-layer-id",
            );
            if (id && snapshot) {
              void moveNode(id, snapshot.primaryRootId || snapshot.root.id);
            }
          }}
        >
          {snapshot ? (
            librarySearchMode === "ranked" && libraryQuery.trim() ? (
              rankedNativeResults.length ? (
                <div className="library-search-results">
                  <div className="library-search-summary">
                    <span>找到 {rankedNativeResults.length} 条相关收藏</span>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setLibrarySearchMode("tree")}
                    >
                      在文件夹中查看
                    </Button>
                  </div>
                  {rankedNativeResults.map((result) => (
                    <div className="library-search-result" key={result.node.id}>
                      <Button
                        variant="unstyled"
                        type="button"
                        className="library-search-result-main"
                        onClick={() =>
                          void openNavigation({
                            text: result.node.url || "",
                            url: result.node.url,
                          })
                        }
                        onAuxClick={(event) => {
                          if (event.button !== 1) return;
                          event.preventDefault();
                          void openNavigation(
                            {
                              text: result.node.url || "",
                              url: result.node.url,
                            },
                            true,
                          );
                        }}
                      >
                        <SiteThumbnail
                          url={result.resource.url}
                          imageUrl={result.resource.thumbnailDataUrl}
                          brandImageUrl={currentSiteBrandImageUrl(
                            siteBrandForUrl(
                              siteBrandByHost,
                              result.resource.url,
                            ),
                          )}
                          categoryCoverId={result.resource.categoryCoverId}
                          coverStyle={listCoverStyle}
                          label={result.resource.title}
                          className="bookmark-thumbnail"
                        />
                        <span>
                          <strong>
                            {highlightTextMatches(
                              result.resource.title,
                              debouncedLibraryQuery,
                            )}
                          </strong>
                          <small>
                            {visibleFolderLabel(
                              result.resource.nativeFolderPath,
                              hostFromUrl(result.resource.url),
                            )}
                            {result.matchReason
                              ? ` · 匹配${result.matchReason}`
                              : ""}
                          </small>
                        </span>
                      </Button>
                      {!result.node.unmodifiable ? (
                        <Button
                          type="button"
                          variant="unstyled"
                          size="icon-sm"
                          className="row-menu"
                          aria-label={`编辑 ${result.node.title}`}
                          title="编辑"
                          onClick={() => startEdit(result.node)}
                        >
                          <EllipsisIcon />
                        </Button>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-state library-search-empty">
                  <span>
                    <SearchIcon />
                  </span>
                  <strong>没有找到相关收藏</strong>
                </div>
              )
            ) : visibleBookmarkNodes.length ? (
              <>
                <BookmarkTree
                  nodes={visibleBookmarkNodes}
                  resourceByUrl={resourceByUrl}
                  siteBrandByHost={siteBrandByHost}
                  coverStyle={listCoverStyle}
                  highlightQuery={debouncedLibraryQuery}
                  onPreviewIntent={showBookmarkPreview}
                  onPreviewLeave={closeBookmarkPreview}
                  expanded={visibleExpanded}
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
                        url: node.url,
                      },
                      newTab,
                    )
                  }
                  onEdit={startEdit}
                  draggedId={draggedId}
                  onDragStart={setDraggedId}
                  onDragEnd={() => setDraggedId("")}
                  onMove={moveNode}
                />
              </>
            ) : libraryQuery.trim() ? (
              <div className="empty-state library-search-empty">
                <span>
                  <SearchIcon />
                </span>
                <strong>没有找到相关收藏</strong>
              </div>
            ) : (
              <div className="empty-state">
                <span>
                  <StarIcon />
                </span>
                <strong>Chrome 书签还是空的</strong>
                <p>点击右上角星标，或使用 Chrome 自带星标开始收藏。</p>
              </div>
            )
          ) : (
            <div className="empty-state">正在读取 Chrome 书签…</div>
          )}
        </section>
        {scrollThumb.scrollable ? (
          <div
            className="native-scroll-thumb"
            data-visible={scrollThumb.visible}
            style={{
              height: `${scrollThumb.height}px`,
              transform: `translateY(${scrollThumb.offset}px)`,
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
                          contentRef.current.clientHeight,
                      )) *
                      100,
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

      <BookmarkPreviewLayer
        snapshot={previewSnapshot}
        hidden={Boolean(editor)}
        placement={bookmarkPreview}
      />

      {aiConfigured ? (
        <AgentComposer
          value={agentPrompt}
          busy={Boolean(busy)}
          configured
          onChange={setAgentPrompt}
          onSubmit={handleAgentSubmit}
          onCancel={
            busy === "agent" ? () => void cancelAgentRun() : undefined
          }
          onConfigure={() => setPanelView("settings")}
        />
      ) : null}

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
                    ? bookmarkSaveState?.status === "none"
                      ? "添加到收藏"
                      : "管理此收藏"
                    : editor.kind === "folder"
                      ? "新建文件夹"
                      : editor.node.url
                        ? "编辑收藏"
                        : "编辑文件夹"}
                </h2>
                {editor.kind === "bookmark" && editor.node.url ? (
                  <p>
                    Chrome 保存名称、网址和文件夹；Aarre 保存备注与自定义标签。
                  </p>
                ) : null}
              </div>
              <Button
                variant="unstyled"
                className="dialog-close"
                onClick={() => {
                  setEditor(null);
                  setConfirmDeleteId("");
                }}
                disabled={Boolean(busy)}
                aria-label="关闭"
              >
                <CloseIcon />
              </Button>
            </div>

            {editor.kind === "save" && busy === "capture" ? (
              <div className="empty-state dialog-loading">
                正在读取当前页面…
              </div>
            ) : (
              <>
                {editor.kind === "bookmark" && editor.node.url ? null : (
                  <label className="native-field">
                    <span>名称</span>
                    <FluidInput
                      value={editTitle}
                      onChange={(event) => setEditTitle(event.target.value)}
                      maxLength={240}
                      autoFocus
                      disabled={
                        editor.kind === "save" &&
                        saveDisposition === "reuse" &&
                        Boolean(selectedSaveMatch?.unmodifiable)
                      }
                    />
                  </label>
                )}

                {editor.kind === "bookmark" && !editor.node.url ? (
                  <ProtectionControl
                    target={{ kind: "folder", id: editor.node.id }}
                    disabled={Boolean(busy)}
                    onChanged={() => {
                      setNotice("保护设置已更新");
                      void refresh();
                    }}
                  />
                ) : null}

                {editor.kind === "bookmark" && editor.node.url ? (
                  <>
                    {editorResource ? (
                      <CloudConflictNotice
                        resourceKey={editorResource.resourceKey}
                        currentUserNote={note}
                        currentTags={editTags}
                        disabled={Boolean(busy)}
                        onResolved={() => setNotice("云端编辑冲突已处理")}
                      />
                    ) : null}
                    <BookmarkEditorFields
                      resource={editorResource}
                      locations={editorModel.locations}
                      folders={editorModel.folders}
                      selectedLocation={selectedEditorLocation}
                      title={editTitle}
                      url={editUrl}
                      parentId={editParentId}
                      tags={editTags}
                      tagInput={editTagInput}
                      userNote={note}
                      writable={editorWritable}
                      disabled={Boolean(busy)}
                      autoFocusTitle
                      onLocationChange={resetEditLocation}
                      onTitleChange={setEditTitle}
                      onUrlChange={setEditUrl}
                      onParentIdChange={setEditParentId}
                      onTagInputChange={setEditTagInput}
                      onAddTag={addEditTags}
                      onRemoveTag={(tag) => {
                        setEditTags((current) =>
                          current.filter((item) => item !== tag),
                        );
                        setEditTagsChanged(true);
                      }}
                      onUserNoteChange={setNote}
                      onProtectionChanged={() => {
                        setNotice("保护设置已更新");
                        void refresh();
                      }}
                    />
                  </>
                ) : null}

                {editor.kind === "save" ? (
                  <>
                    {bookmarkSaveState?.status === "exact" ? (
                      <div className="save-state-note" role="status">
                        <strong>此页面已经收藏</strong>
                        <span>保存后会更新原记录，不会创建重复收藏。</span>
                      </div>
                    ) : null}
                    {bookmarkSaveState?.status === "readonly" ? (
                      <div className="save-state-note" role="status">
                        <strong>这是受管理的 Chrome 收藏</strong>
                        <span>
                          Aarre 只更新摘要、标签和封面，不改动名称与文件夹。
                        </span>
                      </div>
                    ) : null}
                    {bookmarkSaveState &&
                    ["canonical", "multiple"].includes(
                      bookmarkSaveState.status,
                    ) ? (
                      <fieldset className="save-match-picker">
                        <legend>
                          {bookmarkSaveState.status === "multiple"
                            ? "发现多条相同收藏，请选择"
                            : "发现可能相同的收藏，请确认"}
                        </legend>
                        {bookmarkSaveState.matches.map((match) => (
                          <label key={match.id}>
                            <FluidInput
                              type="radio"
                              name="save-target"
                              checked={
                                saveDisposition === "reuse" &&
                                selectedBookmarkId === match.id
                              }
                              onChange={() => {
                                setSaveDisposition("reuse");
                                setSelectedBookmarkId(match.id);
                                setFolderId(match.parentId);
                                setEditTitle(match.title);
                              }}
                            />
                            <span>
                              <strong>{match.title}</strong>
                              <small>
                                {bookmarkMatchLocation(match)}
                                {match.unmodifiable ? " · 受 Chrome 管理" : ""}
                              </small>
                            </span>
                          </label>
                        ))}
                        <label>
                          <FluidInput
                            type="radio"
                            name="save-target"
                            checked={saveDisposition === "new"}
                            onChange={() => {
                              setSaveDisposition("new");
                              setSelectedBookmarkId("");
                              setEditTitle(capture?.title || editTitle);
                            }}
                          />
                          <span>
                            <strong>另存为一条新收藏</strong>
                            <small>仅在你明确需要两个副本时使用</small>
                          </span>
                        </label>
                      </fieldset>
                    ) : null}
                    <div className="native-field">
                      <span>文件夹</span>
                      {saveDisposition === "reuse" &&
                      selectedSaveMatch?.unmodifiable ? (
                        <div className="readonly-folder-value">
                          {bookmarkMatchLocation(selectedSaveMatch)}
                        </div>
                      ) : (
                        <FolderSelect
                          options={folders}
                          value={folderId}
                          onChange={setFolderId}
                        />
                      )}
                      {folderSuggestions.length &&
                      !selectedSaveMatch?.unmodifiable ? (
                        <div
                          className="folder-suggestions"
                          aria-label="推荐文件夹"
                        >
                          <small>本地推荐</small>
                          {folderSuggestions.map((suggestion) => (
                            <Button
                              type="button"
                              variant="ghost"
                              key={suggestion.folderId}
                              data-selected={folderId === suggestion.folderId}
                              onClick={() => setFolderId(suggestion.folderId)}
                              title={suggestion.reason}
                            >
                              {visibleFolderPath(suggestion.path).join(" / ")}
                              <span>{suggestion.reason}</span>
                            </Button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    <label className="native-field">
                      <span>备注（智能增强层）</span>
                      <FluidTextarea
                        value={note}
                        onChange={(event) => setNote(event.target.value)}
                        rows={3}
                        maxLength={2_000}
                        placeholder="可选。记录你保存它的原因。"
                      />
                    </label>
                    <div className="native-check smart-layer-required">
                      <span aria-hidden="true">✓</span>
                      <span>
                        <strong>自动完成智能增强</strong>
                        <small>
                          Aarre 会生成 AI
                          摘要与标签，并在网页加载稳定后补齐封面截图。暂时失败的任务会保留并重试。
                        </small>
                      </span>
                    </div>
                    {captureWarning ? (
                      <p className="dialog-warning">{captureWarning}</p>
                    ) : null}
                  </>
                ) : null}

                <div className="native-dialog-actions">
                  {editor.kind === "bookmark" &&
                  !editor.node.folderType &&
                  confirmDeleteId === (editBookmarkId || editor.node.id) ? (
                    <div
                      className="delete-confirmation"
                      role="group"
                      aria-label="确认删除"
                    >
                      <p role="alert">
                        <TrashIcon aria-hidden="true" />
                        <span>
                          {editorModel.locations.length > 1
                            ? "只删除当前选中的收藏位置？"
                            : "确认从 Chrome 删除？"}
                          <small>
                            {editorModel.locations.length > 1
                              ? "其他位置与 Aarre 智能信息保留"
                              : "30 天内可在侧边栏设置撤销"}
                          </small>
                        </span>
                      </p>
                      <div>
                        <Button
                          variant="unstyled"
                          type="button"
                          className="button button-quiet"
                          onClick={() => setConfirmDeleteId("")}
                        >
                          取消
                        </Button>
                        <Button
                          variant="unstyled"
                          type="button"
                          className="button button-danger"
                          data-confirming="true"
                          onClick={() => void deleteEditorNode()}
                        >
                          确认删除
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {editor.kind === "bookmark" && !editor.node.folderType ? (
                        <Button
                          variant="unstyled"
                          type="button"
                          className="button button-danger-quiet"
                          onClick={() =>
                            setConfirmDeleteId(editBookmarkId || editor.node.id)
                          }
                          disabled={Boolean(busy)}
                        >
                          <TrashIcon />
                          删除
                        </Button>
                      ) : (
                        <span />
                      )}
                      <div>
                        <Button
                          variant="unstyled"
                          type="button"
                          className="button button-quiet"
                          onClick={() => {
                            setEditor(null);
                            setConfirmDeleteId("");
                          }}
                          disabled={Boolean(busy)}
                        >
                          取消
                        </Button>
                        <Button
                          variant="unstyled"
                          type="button"
                          className="button button-dark"
                          onClick={() => void saveEditor()}
                          disabled={
                            Boolean(busy) ||
                            !editTitle.trim() ||
                            (editor.kind === "bookmark" &&
                              Boolean(editor.node.url) &&
                              (!editBookmarkId ||
                                !editUrl.trim() ||
                                !editParentId)) ||
                            (editor.kind === "save" &&
                              (!capture || !folderId || !saveDisposition))
                          }
                        >
                          {busy === "save"
                            ? "正在保存…"
                            : editor.kind === "save"
                              ? saveDisposition === "reuse"
                                ? "更新收藏"
                                : "添加到 Chrome"
                              : editor.kind === "bookmark"
                                ? "保存修改"
                                : "保存"}
                        </Button>
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

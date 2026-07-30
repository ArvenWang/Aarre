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
import {
  bookmarkMatchUrls,
  bookmarkNodesByUrl,
  collectFolderIds,
  filterBookmarkTree
} from "../../lib/bookmark-search";
import { findBookmarkByUrl } from "../../lib/bookmark-tree";
import { registrableHost } from "../../lib/cover-registry";
import { sendExtensionRequest } from "../../lib/messages";
import { pendingSaveReadyTabId } from "../../lib/pending-save";
import {
  initialSaveFolderId,
  visibleFolderPath
} from "../../lib/folder-options";
import {
  buildLocalSearchIndex,
  searchLocalIndex
} from "../../lib/search";
import { canonicalizeUrl } from "../../lib/url";
import { downloadAarreDataExport } from "../../lib/data-export";
import {
  AI_PROVIDER_PRESETS,
  getAiProviderPreset
} from "../../lib/settings";
import {
  getDisplaySettings,
  saveDisplaySettings,
  type ListCoverStyle
} from "../../lib/display-settings";
import {
  getSidepanelState,
  saveSidepanelState
} from "../../lib/sidepanel-state";
import {
  completeOnboarding,
  getOnboardingState,
  restartOnboarding
} from "../../lib/onboarding";
import type {
  AiProviderId,
  AiSettingsStatus,
  AiUsageStats,
  AgentChatMessage,
  AgentConversation,
  AppState,
  BookmarkAgentActionProposal,
  BookmarkBarSnapshot,
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
  UndoSnapshotBatch
} from "../../lib/types";
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

function siteBrandForUrl(
  siteBrandByHost: Map<string, SiteBrandRecord>,
  input: string
): SiteBrandRecord | undefined {
  try {
    const host = new URL(input).hostname.toLocaleLowerCase();
    return (
      siteBrandByHost.get(host) ||
      siteBrandByHost.get(registrableHost(host))
    );
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

export function highlightTextMatches(
  text: string,
  query: string
): React.ReactNode {
  const needle = query.trim();
  if (!needle) return text;

  const expression = new RegExp(
    needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    "giu"
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
      </mark>
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
        disabled={!options.length}
      >
        <span>
          {selected?.name ||
            (options.length ? "选择文件夹" : "暂无自建文件夹")}
        </span>
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

interface OnboardingPageProps {
  resourceCount: number;
  initialAiConfigured: boolean;
  onComplete: (skipped: boolean, aiConfigured: boolean) => void;
}

function OnboardingPage({
  resourceCount,
  initialAiConfigured,
  onComplete
}: OnboardingPageProps) {
  const [step, setStep] = useState(0);
  const [provider, setProvider] = useState<AiProviderId>("gemini");
  const preset = getAiProviderPreset(provider);
  const [models, setModels] = useState<Record<AiProviderId, string>>({
    gemini: getAiProviderPreset("gemini").defaultModel,
    openai: getAiProviderPreset("openai").defaultModel,
    deepseek: getAiProviderPreset("deepseek").defaultModel
  });
  const [apiKey, setApiKey] = useState("");
  const [configured, setConfigured] = useState(initialAiConfigured);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const estimatedMinutes = Math.max(1, Math.ceil(resourceCount / 60));
  const estimatedCostLow = (resourceCount * 0.0015).toFixed(1);
  const estimatedCostHigh = (resourceCount * 0.004).toFixed(1);

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
          apiKey: apiKey.trim()
        }
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
        const granted = chrome.permissions?.request
          ? await chrome.permissions.request({
              origins: ["http://*/*", "https://*/*"]
            })
          : true;
        if (!granted) {
          throw new Error("未获得网页读取权限，尚未开始扫描。");
        }
        await sendExtensionRequest({
          type: "START_LIBRARY_SCAN",
          force: false
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
        <button
          type="button"
          className="text-button"
          disabled={Boolean(busy)}
          onClick={() => void finish(true, false)}
        >
          跳过引导
        </button>
      </header>
      <section className="onboarding-card">
        {step === 0 ? (
          <>
            <div className="onboarding-mark">
              <StarIcon filled />
            </div>
            <h1>你的 Chrome 书签，原样保留</h1>
            <p>
              Aarre 直接读取你已有的 Chrome 原生书签，不需要导入，也不会偷偷移动或删除。Chrome
              始终是唯一事实来源。
            </p>
            <div className="onboarding-facts">
              <span>已发现 {resourceCount.toLocaleString("zh-CN")} 条书签</span>
              <span>所有写操作先确认，并可在 30 天内撤销</span>
              <span>
                常访问的网站会在本机自动积累真实预览快照，越用越完整
              </span>
            </div>
            <button
              type="button"
              className="button button-dark"
              onClick={() => setStep(1)}
            >
              继续
            </button>
          </>
        ) : step === 1 ? (
          <>
            <h1>连接你自己的 AI 服务</h1>
            <p>
              API Key 只保存在当前 Chrome 配置文件中，扩展直接调用服务商；Aarre
              不经手你的 Key。
            </p>
            <div
              className="settings-provider-tabs"
              role="radiogroup"
              aria-label="AI 服务商"
            >
              {AI_PROVIDER_PRESETS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="radio"
                  aria-checked={provider === item.id}
                  data-active={provider === item.id}
                  className="settings-provider-tab"
                  onClick={() => setProvider(item.id)}
                >
                  {item.name}
                </button>
              ))}
            </div>
            <label className="settings-field">
              <span>模型</span>
              <input
                value={models[provider]}
                onChange={(event) =>
                  setModels((current) => ({
                    ...current,
                    [provider]: event.target.value
                  }))
                }
              />
            </label>
            <label className="settings-field">
              <span>{preset.name} API Key</span>
              <input
                type="password"
                value={apiKey}
                autoComplete="off"
                placeholder={preset.apiKeyPlaceholder}
                onChange={(event) => setApiKey(event.target.value)}
              />
            </label>
            {error ? (
              <div className="settings-notice" data-tone="error">
                {error}
              </div>
            ) : null}
            <div className="onboarding-actions">
              <button
                type="button"
                className="button button-quiet"
                disabled={Boolean(busy)}
                onClick={() => setStep(2)}
              >
                先跳过，只管理书签
              </button>
              <button
                type="button"
                className="button button-dark"
                disabled={
                  (!configured && !apiKey.trim()) ||
                  !models[provider].trim() ||
                  Boolean(busy)
                }
                onClick={() =>
                  configured && !apiKey.trim()
                    ? setStep(2)
                    : void saveProvider()
                }
              >
                {busy === "provider"
                  ? "正在验证…"
                  : configured && !apiKey.trim()
                    ? "使用现有配置继续"
                    : "验证并继续"}
              </button>
            </div>
          </>
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
                  AI 费用粗估 ¥{estimatedCostLow}–{estimatedCostHigh}
                </span>
              ) : (
                <span>未连接 AI，本轮不会产生 AI 费用</span>
              )}
            </div>
            <p className="onboarding-privacy">
              费用取决于服务商、模型和网页长度，以服务商账单为准。内网、银行、支付和医疗站点不请求；页面快照只保存在本机，默认开启且可在设置中关闭。
            </p>
            {error ? (
              <div className="settings-notice" data-tone="error">
                {error}
              </div>
            ) : null}
            <div className="onboarding-actions">
              <button
                type="button"
                className="button button-quiet"
                disabled={Boolean(busy)}
                onClick={() => void finish(false, false)}
              >
                以后再说
              </button>
              <button
                type="button"
                className="button button-dark"
                disabled={!resourceCount || Boolean(busy)}
                onClick={() => void finish(false, true)}
              >
                {busy === "scan" ? "正在启动…" : "现在扫描"}
              </button>
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
  const [snapshotsEnabled, setSnapshotsEnabled] = useState(true);
  const [snapshotExcludedHosts, setSnapshotExcludedHosts] = useState("");
  const [scanCostLimitCny, setScanCostLimitCny] = useState(10);
  const [undoBatches, setUndoBatches] = useState<UndoSnapshotBatch[]>([]);
  const [scanEstimate, setScanEstimate] =
    useState<LibraryScanEstimate | null>(null);
  const [usageStats, setUsageStats] = useState<AiUsageStats | null>(null);
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
    void sendExtensionRequest({ type: "GET_AI_USAGE" })
      .then(setUsageStats)
      .catch(() => undefined);
    void getDisplaySettings().then((display) => {
      setSnapshotsEnabled(display.pageSnapshotsEnabled);
      setSnapshotExcludedHosts(
        display.snapshotExcludedHosts.join("\n")
      );
      setScanCostLimitCny(display.scanCostLimitCny);
    });
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
        if (!scanEstimate) {
          const estimate = await sendExtensionRequest({
            type: "GET_LIBRARY_SCAN_ESTIMATE",
            force: false
          });
          setScanEstimate(estimate);
          setMessage(
            estimate.total
              ? "请核对预计时间和费用，再确认开始。"
              : "当前没有需要补充或复查的收藏。"
          );
          return;
        }
        const permissionApi = chrome.permissions;
        await saveDisplaySettings({ scanCostLimitCny });
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
        setScanEstimate(null);
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
      setUsageStats(
        await sendExtensionRequest({ type: "GET_AI_USAGE" })
      );
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

  async function exportLocalData() {
    if (action) return;
    setAction("export-data");
    setError("");
    setMessage("");
    try {
      const result = await downloadAarreDataExport();
      setMessage(
        `已导出 ${result.filename}（${Math.max(1, Math.round(result.bytes / 1024)).toLocaleString()} KB）。`
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "数据导出失败");
    } finally {
      setAction("");
    }
  }

  async function handleCoverStyle(style: ListCoverStyle) {
    if (action) return;
    setAction("cover-style");
    setError("");
    try {
      const next = await saveDisplaySettings({
        listCoverStyle: style
      });
      onListCoverStyleChange(next.listCoverStyle);
      setMessage(
        style === "site"
          ? "列表已优先显示清晰的站点标识。"
          : "列表已优先显示页面封面；没有合格封面时仍会安全回退。"
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "封面设置保存失败");
    } finally {
      setAction("");
    }
  }

  async function saveSnapshotSettings(
    nextEnabled = snapshotsEnabled,
    requestCapturePermission = false
  ) {
    if (action) return;
    setAction("snapshot-settings");
    setError("");
    try {
      if (
        nextEnabled &&
        requestCapturePermission &&
        chrome.permissions?.request
      ) {
        const granted = await chrome.permissions.request({
          origins: ["http://*/*", "https://*/*"]
        });
        if (!granted) {
          throw new Error(
            "需要网页访问权限才能自动积累预览快照；设置没有更改。"
          );
        }
      }
      const next = await saveDisplaySettings({
        pageSnapshotsEnabled: nextEnabled,
        snapshotExcludedHosts: snapshotExcludedHosts
          .split(/[\n,，;；\s]+/)
          .map((host) => host.trim())
          .filter(Boolean)
      });
      setSnapshotsEnabled(next.pageSnapshotsEnabled);
      setSnapshotExcludedHosts(next.snapshotExcludedHosts.join("\n"));
      setMessage(
        next.pageSnapshotsEnabled
          ? "页面快照采集已开启，仅保存于本机。"
          : "页面快照采集已关闭，不会产生新快照。"
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "快照设置保存失败");
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
          className="settings-section"
          aria-labelledby="cover-style-title"
        >
          <div className="settings-section-heading">
            <div>
              <h2 id="cover-style-title">列表封面风格</h2>
              <p>
                站点标识在 48px 下更清晰；页面封面更丰富，但细节可能更少。
              </p>
            </div>
          </div>
          <div
            className="settings-provider-tabs"
            role="radiogroup"
            aria-label="列表封面风格"
          >
            <button
              type="button"
              role="radio"
              aria-checked={listCoverStyle === "site"}
              data-active={listCoverStyle === "site"}
              className="settings-provider-tab"
              disabled={Boolean(action)}
              onClick={() => void handleCoverStyle("site")}
            >
              站点标识（整齐）
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={listCoverStyle === "page"}
              data-active={listCoverStyle === "page"}
              className="settings-provider-tab"
              disabled={Boolean(action)}
              onClick={() => void handleCoverStyle("page")}
            >
              页面封面（丰富）
            </button>
          </div>
        </section>

        <section
          className="settings-section"
          aria-labelledby="snapshot-settings-title"
        >
          <div className="settings-section-heading">
            <div>
              <h2 id="snapshot-settings-title">页面预览快照</h2>
              <p>
                已收藏网页在前台停留 5 秒后保存真实快照；只存在本机，绝不参与同步。
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={snapshotsEnabled}
              className="settings-snapshot-switch"
              data-active={snapshotsEnabled}
              disabled={Boolean(action)}
              onClick={() => {
                const next = !snapshotsEnabled;
                void saveSnapshotSettings(next, next);
              }}
            >
              <span />
              {snapshotsEnabled ? "已开启" : "已关闭"}
            </button>
          </div>
          <label className="settings-field">
            <span>额外不采集的域名（每行一个）</span>
            <textarea
              rows={3}
              value={snapshotExcludedHosts}
              placeholder={"work.example.com\nprivate.example.org"}
              onChange={(event) =>
                setSnapshotExcludedHosts(event.target.value)
              }
            />
          </label>
          <div className="settings-field-footer">
            <p>
              内网、银行、支付和医疗站点已内置排除；无痕窗口始终不采集。
            </p>
            <button
              type="button"
              className="button button-quiet button-small"
              disabled={Boolean(action)}
              onClick={() => void saveSnapshotSettings()}
            >
              保存排除清单
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
                逐个读取可访问网页，补充站点标识和代表图；已配置 AI 时同时生成简介、标签和主题。
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
            {(appState?.libraryScan.actualInputTokens ||
              appState?.libraryScan.actualOutputTokens) ? (
              <p>
                实际令牌：输入{" "}
                {appState.libraryScan.actualInputTokens || 0} · 输出{" "}
                {appState.libraryScan.actualOutputTokens || 0} · 估算费用 ¥
                {(appState.libraryScan.actualCostCny || 0).toFixed(4)}
              </p>
            ) : null}
          </div>
          {scanEstimate ? (
            <div className="settings-scan-estimate" role="status">
              <strong>开始前确认</strong>
              <p>
                共检查 {scanEstimate.total} 条，其中{" "}
                {scanEstimate.aiResourceCount} 条会调用{" "}
                {scanEstimate.providerName} {scanEstimate.model}。
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
                  <dt>估算费用</dt>
                  <dd>
                    {scanEstimate.priceAvailable
                      ? `¥${(scanEstimate.estimatedCostCny || 0).toFixed(4)}`
                      : "自定义模型，无法可靠估算"}
                  </dd>
                </div>
              </dl>
              <label className="settings-scan-limit">
                <span>单次 AI 费用上限（人民币）</span>
                <input
                  type="number"
                  min="0.01"
                  max="10000"
                  step="0.1"
                  value={scanCostLimitCny}
                  onChange={(event) =>
                    setScanCostLimitCny(
                      Math.min(
                        10_000,
                        Math.max(0.01, Number(event.target.value) || 0.01)
                      )
                    )
                  }
                />
              </label>
              <small>
                价格表更新于 {scanEstimate.pricingUpdatedAt}；人民币金额按估算汇率计算，以服务商账单为准。
              </small>
            </div>
          ) : null}
          <p className="settings-scan-privacy">
            站点标识和代表图会压缩后只保存在本机；简介和标签会产生所选 AI 服务商的调用费用。内部网址、局域网和受保护地址不会发起任何网络请求。
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
                  !appState?.localResourceCount ||
                  Boolean(scanEstimate && !scanEstimate.total)
                }
                onClick={() => void handleLibraryScan("start")}
              >
                {action === "scan-start"
                  ? scanEstimate
                    ? "正在启动…"
                    : "正在估算…"
                  : scanEstimate
                    ? scanEstimate.total
                      ? "确认并开始"
                      : "无需扫描"
                  : appState?.aiReadyResourceCount ===
                    appState?.localResourceCount &&
                    Boolean(appState?.localResourceCount)
                    ? "检查并补全"
                    : settings?.apiKeyConfigured
                      ? "扫描全部书签"
                      : "更新站点标识"}
              </button>
            )}
          </div>
          {scanEstimate ? (
            <button
              type="button"
              className="text-button"
              disabled={Boolean(action)}
              onClick={() => {
                setScanEstimate(null);
                setMessage("");
              }}
            >
              取消本次扫描
            </button>
          ) : null}
          {usageStats ? (
            <div className="settings-usage-summary">
              <strong>累计 AI 用量（仅本机）</strong>
              <span>
                {usageStats.scanCount} 次扫描 · 输入{" "}
                {usageStats.inputTokens.toLocaleString()} · 输出{" "}
                {usageStats.outputTokens.toLocaleString()} · 估算 ¥
                {usageStats.estimatedCostCny.toFixed(4)}
              </span>
              {usageStats.estimatedTokens ? (
                <small>
                  其中 {usageStats.estimatedTokens.toLocaleString()} 个令牌为服务商未返回用量时的本地估算。
                </small>
              ) : null}
            </div>
          ) : null}
        </section>

        <section
          className="settings-section"
          aria-labelledby="recent-changes-title"
        >
          <div className="settings-section-heading">
            <div>
              <h2 id="recent-changes-title">最近的更改</h2>
              <p>
                删除的书签和文件夹结构会保留 30 天，可以在这里完整恢复。恢复后
                Chrome 会分配新的书签 ID，智能信息仍按网址自动关联。
              </p>
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

        <section className="settings-section settings-onboarding-section">
          <div>
            <h2>首次使用引导</h2>
            <p>重新查看 Chrome 书签、AI 服务和本地快照的使用说明。</p>
          </div>
          <button
            type="button"
            className="button button-quiet button-small"
            disabled={Boolean(action)}
            onClick={onRestartOnboarding}
          >
            重新查看引导
          </button>
        </section>

        <section
          className="settings-section"
          aria-labelledby="privacy-settings-title"
        >
          <div className="settings-section-heading">
            <div>
              <h2 id="privacy-settings-title">隐私与数据自主权</h2>
              <p>
                一键导出智能层元数据、Agent 会话、站点资产、页面快照、撤销记录和安全设置；API Key、Key 尾号与登录令牌永不写入导出文件。
              </p>
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
            <button
              type="button"
              className="button button-dark button-small"
              disabled={Boolean(action)}
              onClick={() => void exportLocalData()}
            >
              {action === "export-data" ? "正在打包…" : "导出全部本地数据"}
            </button>
          </div>
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
  siteBrandByHost: Map<string, SiteBrandRecord>;
  coverStyle: ListCoverStyle;
  highlightQuery: string;
  onPreviewIntent: (
    node: NativeBookmarkNode,
    rect: DOMRect
  ) => void;
  onPreviewLeave: () => void;
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
  onMove
}: TreeProps) {
  const [orderedNodes, setOrderedNodes] = useState(nodes);
  const nodeElements = useRef(new Map<string, HTMLDivElement>());
  const previousPositions = useRef<Map<string, number> | null>(null);
  const lastHoverTarget = useRef("");
  const activeDragId = useRef("");
  const previewTimer = useRef<number | undefined>(undefined);
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
    []
  );

  function armPreview(
    node: NativeBookmarkNode,
    target: HTMLElement
  ) {
    if (!node.url) return;
    if (previewTimer.current !== undefined) {
      window.clearTimeout(previewTimer.current);
    }
    previewTimer.current = window.setTimeout(() => {
      previewTimer.current = undefined;
      onPreviewIntent(node, target.getBoundingClientRect());
    }, 400);
  }

  function cancelPreview() {
    if (previewTimer.current !== undefined) {
      window.clearTimeout(previewTimer.current);
      previewTimer.current = undefined;
    }
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
              onPointerEnter={(event) => {
                if (folder) return;
                pointerSample.current = {
                  x: event.clientX,
                  y: event.clientY,
                  at: performance.now()
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
                  at: nowAt
                };
                if (!previous) return;
                const elapsed = Math.max(1, nowAt - previous.at);
                const distance = Math.hypot(
                  event.clientX - previous.x,
                  event.clientY - previous.y
                );
                if (distance / elapsed > 0.65) {
                  cancelPreview();
                } else if (previewTimer.current === undefined) {
                  armPreview(node, event.currentTarget);
                }
              }}
              onPointerLeave={cancelPreview}
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
                onKeyDown={(event) => {
                  if (folder) return;
                  if (event.key.toLocaleLowerCase() === "p") {
                    event.preventDefault();
                    onPreviewIntent(
                      node,
                      event.currentTarget
                        .closest(".bookmark-row")!
                        .getBoundingClientRect()
                    );
                  } else if (event.key === "Escape") {
                    onPreviewLeave();
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
                    imageUrl={metadata?.thumbnailDataUrl}
                    brandImageUrl={
                      siteBrandForUrl(
                        siteBrandByHost,
                        node.url || ""
                      )?.iconDataUrl
                    }
                    categoryCoverId={metadata?.categoryCoverId}
                    coverStyle={coverStyle}
                    label={node.title}
                    className="bookmark-thumbnail"
                  />
                )}
                <span className="bookmark-copy">
                  <strong>
                    {highlightTextMatches(
                      node.title || "未命名",
                      highlightQuery
                    )}
                  </strong>
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

function BookmarkPreviewCard({
  snapshot,
  flip,
  offset
}: BookmarkPreviewCardProps) {
  return (
    <aside
      className="bookmark-preview-card"
      data-flip={flip}
      style={
        flip
          ? {
              bottom: offset,
              maxHeight: `calc(100vh - ${offset + 12}px)`
            }
          : {
              top: offset,
              maxHeight: `calc(100vh - ${offset + 12}px)`
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

interface AgentComposerProps {
  value: string;
  busy: boolean;
  configured: boolean;
  placeholder?: string;
  onChange: (value: string) => void;
  onSubmit: (event: React.FormEvent) => void;
  onConfigure?: () => void;
}

function AgentComposer({
  value,
  busy,
  configured,
  placeholder = "询问你的收藏…",
  onChange,
  onSubmit,
  onConfigure
}: AgentComposerProps) {
  if (!configured) {
    return (
      <div className="agent-composer agent-composer-setup">
        <button type="button" onClick={onConfigure}>
          <span>
            <strong>配置 AI 后可以直接问你的收藏</strong>
            <small>选择服务商并填写自己的 API Key</small>
          </span>
          <ChevronRightIcon />
        </button>
      </div>
    );
  }
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

function organizationNoticeDetails(
  notice: OrganizationNotice
): string {
  const details = [
    notice.counts.duplicate
      ? `${notice.counts.duplicate} 组重复`
      : "",
    notice.counts.dead ? `${notice.counts.dead} 条失效` : "",
    notice.counts.classify
      ? `${notice.counts.classify} 组可归类`
      : "",
    notice.counts.largeFolder
      ? `${notice.counts.largeFolder} 个大文件夹`
      : ""
  ].filter(Boolean);
  return details.join("、") || `${notice.actionableCount} 组可执行建议`;
}

interface AgentChatPageProps {
  conversation: AgentConversation;
  prompt: string;
  busy: boolean;
  configured: boolean;
  error: string;
  onPromptChange: (value: string) => void;
  onConfigure: () => void;
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
  configured,
  error,
  onPromptChange,
  onConfigure,
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
        configured={configured}
        placeholder="继续询问…"
        onChange={onPromptChange}
        onSubmit={onSubmit}
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
  onRename: (
    conversation: AgentConversation,
    title: string
  ) => Promise<void>;
}

function AgentHistoryPage({
  conversations,
  onBack,
  onOpen,
  onDelete,
  onRename
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
              <article key={conversation.id}>
                {editingId === conversation.id ? (
                  <form
                    className="agent-history-rename"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void saveTitle(conversation);
                    }}
                  >
                    <input
                      autoFocus
                      value={editingTitle}
                      maxLength={80}
                      aria-label="会话名称"
                      onChange={(event) =>
                        setEditingTitle(event.target.value)
                      }
                    />
                    <button
                      type="button"
                      disabled={Boolean(busyId)}
                      onClick={() => setEditingId("")}
                    >
                      取消
                    </button>
                    <button
                      type="submit"
                      disabled={!editingTitle.trim() || Boolean(busyId)}
                    >
                      保存
                    </button>
                  </form>
                ) : (
                  <>
                    <button
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
                    </button>
                    <div className="agent-history-actions">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(conversation.id);
                          setEditingTitle(conversation.title);
                          setConfirmDeleteId("");
                        }}
                      >
                        改名
                      </button>
                      <button
                        type="button"
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
                      </button>
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
        <p className="agent-history-limit">
          最多保留 50 个会话；超出后自动移除最久未使用的会话。
        </p>
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
  const [organizationNoticeBusy, setOrganizationNoticeBusy] =
    useState(false);
  const [listCoverStyle, setListCoverStyle] =
    useState<ListCoverStyle>("site");
  const [aiConfigured, setAiConfigured] = useState(false);
  const [onboardingVisible, setOnboardingVisible] = useState<
    boolean | null
  >(null);
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
  const [librarySearchMode, setLibrarySearchMode] = useState<
    "tree" | "ranked"
  >("tree");
  const [bookmarkPreview, setBookmarkPreview] = useState<{
    node: NativeBookmarkNode;
    flip: boolean;
    offset: number;
  } | null>(null);
  const [previewSnapshot, setPreviewSnapshot] =
    useState<PageSnapshot | null>(null);
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
    const [
      nextSnapshot,
      nextState,
      nextSiteBrands,
      nextAiSettings,
      nextResurfacing,
      nextOrganizationNotice
    ] = await Promise.all([
      sendExtensionRequest({ type: "GET_BOOKMARK_BAR" }),
      sendExtensionRequest({ type: "GET_APP_STATE" }),
      sendExtensionRequest({ type: "GET_SITE_BRANDS" }),
      sendExtensionRequest({ type: "GET_AI_SETTINGS" }),
      sendExtensionRequest({ type: "GET_CONTEXT_RESURFACING" }).catch(
        () => []
      ),
      sendExtensionRequest({
        type: "GET_ORGANIZATION_NOTICE"
      }).catch(() => null)
    ]);
    setSnapshot(nextSnapshot);
    setAppState(nextState);
    setResources(nextResources);
    setSiteBrands(nextSiteBrands);
    setAiConfigured(nextAiSettings.apiKeyConfigured);
    setContextResurfacing(nextResurfacing);
    setOrganizationNotice(nextOrganizationNotice);
  }, []);

  const loadOrganizationNotice = useCallback(async () => {
    const next = await sendExtensionRequest({
      type: "GET_ORGANIZATION_NOTICE"
    });
    setOrganizationNotice(next);
  }, []);

  const loadConversations = useCallback(async () => {
    const next = await sendExtensionRequest({
      type: "GET_AGENT_CONVERSATIONS"
    });
    const nextConversations = Array.isArray(next) ? next : [];
    setConversations(nextConversations);
    return nextConversations;
  }, []);

  const deleteConversation = useCallback(async (id: string) => {
    await sendExtensionRequest({
      type: "DELETE_AGENT_CONVERSATION",
      id
    });
    setConversations((current) =>
      current.filter((conversation) => conversation.id !== id)
    );
    setActiveConversation((current) =>
      current?.id === id ? null : current
    );
  }, []);

  const renameConversation = useCallback(
    async (conversation: AgentConversation, title: string) => {
      const saved = await sendExtensionRequest({
        type: "SAVE_AGENT_CONVERSATION",
        conversation: {
          ...conversation,
          title,
          updatedAt: new Date().toISOString()
        }
      });
      setConversations((current) =>
        [saved, ...current.filter((item) => item.id !== saved.id)].slice(
          0,
          50
        )
      );
      setActiveConversation((current) =>
        current?.id === saved.id ? saved : current
      );
    },
    []
  );

  useEffect(() => {
    void Promise.all([
      getDisplaySettings(),
      getSidepanelState(),
      getOnboardingState()
    ])
      .then(([display, persisted, onboarding]) => {
        setListCoverStyle(display.listCoverStyle);
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
        .then(async (nextResources) => {
          const nextSiteBrands = await sendExtensionRequest({
            type: "GET_SITE_BRANDS"
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
    const handleOrganizationUpdate = (message: { type?: string }) => {
      if (message.type !== "ORGANIZATION_INSIGHTS_UPDATED") return;
      void loadOrganizationNotice().catch(() => undefined);
    };
    chrome.runtime.onMessage.addListener(handleOrganizationUpdate);
    return () =>
      chrome.runtime.onMessage.removeListener(handleOrganizationUpdate);
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
      if (scrollSaveTimer.current !== undefined) {
        window.clearTimeout(scrollSaveTimer.current);
      }
      if (previewCloseTimer.current !== undefined) {
        window.clearTimeout(previewCloseTimer.current);
      }
    };
  }, [panelView, syncScrollThumb]);

  useEffect(() => {
    if (!persistentStateLoaded.current) return;
    void saveSidepanelState({
      expandedFolderIds: [...expanded],
      scrollTop: contentRef.current?.scrollTop || 0
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
              tabId
            });
            if (draft) {
              await startSave(draft);
            }
          } catch (caught) {
            setError(
              caught instanceof Error
                ? caught.message
                : "无法打开收藏表单"
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
        message && typeof message === "object"
          ? message
          : {}
      );
      // Chrome 的全局侧边栏会跨标签页保持开启，因此必须以消息里的
      // tabId 为准，不能用侧边栏启动时缓存的活动标签页 ID 过滤。
      if (tabId !== null) enqueue(tabId);
    };
    chrome.runtime.onMessage.addListener(handlePendingSave);

    const activeTabId = appState?.activeTab?.id;
    if (typeof activeTabId === "number") {
      enqueue(activeTabId);
    }
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
  const bookmarkRoots = useMemo(() => {
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
        siteBrands.map((brand) => [
          brand.host.toLocaleLowerCase(),
          brand
        ])
      ),
    [siteBrands]
  );
  const localSearchIndex = useMemo(
    () => buildLocalSearchIndex(resources),
    [resources]
  );
  const rankedSearchResults = useMemo(
    () =>
      libraryQuery.trim()
        ? searchLocalIndex(localSearchIndex, libraryQuery)
        : [],
    [libraryQuery, localSearchIndex]
  );
  const nativeNodeByUrl = useMemo(
    () => bookmarkNodesByUrl(bookmarkRoots),
    [bookmarkRoots]
  );
  const rankedNativeResults = useMemo(
    () =>
      rankedSearchResults.flatMap((result) => {
        const node =
          nativeNodeByUrl.get(result.resource.url) ||
          nativeNodeByUrl.get(result.resource.canonicalUrl);
        return node ? [{ ...result, node }] : [];
      }),
    [nativeNodeByUrl, rankedSearchResults]
  );
  const filteredBookmarkNodes = useMemo(
    () =>
      libraryQuery.trim()
        ? filterBookmarkTree(
            bookmarkRoots,
            libraryQuery,
            bookmarkMatchUrls(
              rankedSearchResults.map((result) => result.resource.url)
            )
          )
        : bookmarkRoots,
    [bookmarkRoots, libraryQuery, rankedSearchResults]
  );
  const visibleBookmarkNodes =
    librarySearchMode === "ranked" && libraryQuery.trim()
      ? []
      : filteredBookmarkNodes;
  const visibleExpanded = useMemo(() => {
    if (!libraryQuery.trim() || librarySearchMode === "ranked") {
      return expanded;
    }
    return new Set([
      ...expanded,
      ...collectFolderIds(filteredBookmarkNodes)
    ]);
  }, [
    expanded,
    filteredBookmarkNodes,
    libraryQuery,
    librarySearchMode
  ]);
  const hasVisibleFolders = visibleBookmarkNodes.some(
    (node) => !node.url
  );
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

  function keepBookmarkPreviewOpen() {
    if (previewCloseTimer.current !== undefined) {
      window.clearTimeout(previewCloseTimer.current);
      previewCloseTimer.current = undefined;
    }
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

  function showBookmarkPreview(
    node: NativeBookmarkNode,
    rect: DOMRect
  ) {
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
      canonicalUrl
    })
      .then((next) => {
        if (
          previewCanonicalUrl.current === canonicalUrl &&
          next
        ) {
          const gap = 14;
          const spaceBelow = window.innerHeight - rect.bottom - gap;
          const spaceAbove = rect.top - gap;
          const flip = spaceBelow < 360 && spaceAbove > spaceBelow;
          setBookmarkPreview({
            node,
            flip,
            // 默认放在鼠标所在书签行的下方；空间不足时放到行上方，
            // 两种情况都保留间隔，绝不覆盖当前鼠标热区。
            offset: flip
              ? Math.max(12, window.innerHeight - rect.top + gap)
              : Math.max(12, rect.bottom + gap)
          });
          setPreviewSnapshot(next);
        }
      })
      .catch(() => undefined);
  }

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
            messages: []
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
        scrollTop: contentRef.current?.scrollTop || 0
      };
    }
    if (!value.trim()) {
      clearLibrarySearch();
      return;
    }
    setLibraryQuery(value);
    setLibrarySearchMode("tree");
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
    setFolderSuggestions([]);
    setNote("");
    try {
      const folderOptions = await sendExtensionRequest({
        type: "GET_FOLDERS"
      });
      setFolders(folderOptions);
      setFolderId(
        initialSaveFolderId(
          folderOptions,
          existingBookmark?.parentId
        )
      );

      if (draft?.kind === "link") {
        const page = captureFromDraft(draft);
        setCapture(page);
        setEditTitle(existingBookmark?.title || page.title);
        setRequestAi(false);
        setFolderSuggestions(
          await sendExtensionRequest({
            type: "GET_FOLDER_SUGGESTIONS",
            capture: page
          }).catch(() => [])
        );
        setCaptureWarning(
          "这是链接收藏。保存后打开该网页，可继续补充正文摘要和 AI 标签。"
        );
      } else try {
        const page = await sendExtensionRequest({
          type: "CAPTURE_ACTIVE_PAGE",
          tabId: draft?.tabId
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
        setFolderSuggestions(
          await sendExtensionRequest({
            type: "GET_FOLDER_SUGGESTIONS",
            capture: merged
          }).catch(() => [])
        );
      } catch {
        const page = draft
          ? captureFromDraft(draft)
          : emptyCapture(appState);
        setCapture(page);
        setEditTitle(existingBookmark?.title || page.title);
        setRequestAi(false);
        setFolderSuggestions(
          await sendExtensionRequest({
            type: "GET_FOLDER_SUGGESTIONS",
            capture: page
          }).catch(() => [])
        );
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
    if (!persistentStateLoaded.current) return;
    if (scrollSaveTimer.current !== undefined) {
      window.clearTimeout(scrollSaveTimer.current);
    }
    scrollSaveTimer.current = window.setTimeout(() => {
      void saveSidepanelState({
        expandedFolderIds: [...expanded],
        scrollTop: contentRef.current?.scrollTop || 0
      });
    }, 180);
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

  if (onboardingVisible === null) {
    return (
      <main className="native-panel">
        <div className="native-loading">正在准备 Aarre…</div>
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
        onClose={() => setPanelView("library")}
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
        prompt={agentPrompt}
        busy={busy === "agent" || busy === "agent-actions"}
        configured={aiConfigured}
        error={error}
        onPromptChange={setAgentPrompt}
        onConfigure={() => setPanelView("settings")}
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
            className="icon-button"
            title="打开批量整理工作台"
            aria-label="打开批量整理工作台"
            onClick={() =>
              void sendExtensionRequest({ type: "OPEN_MANAGER" })
            }
          >
            <ExternalLinkIcon />
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
        {appState?.libraryScan.state === "running" ? (
          <button
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
                }%`
              }}
            />
          </button>
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
            <small>{organizationNoticeDetails(organizationNotice)}</small>
          </div>
          <div>
            <button
              type="button"
              className="button button-quiet button-small"
              disabled={organizationNoticeBusy}
              onClick={() => {
                setOrganizationNoticeBusy(true);
                void sendExtensionRequest({
                  type: "DISMISS_ORGANIZATION_NOTICE"
                })
                  .then(() => setOrganizationNotice(null))
                  .catch((caught) =>
                    setError(
                      caught instanceof Error
                        ? caught.message
                        : "暂时无法隐藏整理提示"
                    )
                  )
                  .finally(() => setOrganizationNoticeBusy(false));
              }}
            >
              暂不
            </button>
            <button
              type="button"
              className="button button-dark button-small"
              disabled={organizationNoticeBusy}
              onClick={() =>
                void sendExtensionRequest({
                  type: "OPEN_MANAGER",
                  view: "organize"
                }).catch((caught) =>
                  setError(
                    caught instanceof Error
                      ? caught.message
                      : "无法打开整理提案"
                  )
                )
              }
            >
              去处理
            </button>
          </div>
        </section>
      ) : null}

      <form
        className="library-search"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          if (libraryQuery.trim()) setLibrarySearchMode("ranked");
        }}
      >
        <SearchIcon aria-hidden="true" />
        <input
          type="search"
          value={libraryQuery}
          onChange={(event) =>
            handleLibraryQueryChange(event.target.value)
          }
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
          <button
            type="button"
            aria-label="清空搜索"
            title="清空搜索"
            onClick={clearLibrarySearch}
          >
            <CloseIcon />
          </button>
        ) : (
          <kbd>↵</kbd>
        )}
      </form>

      {error ? (
        <div className="native-error" role="alert">
          <span>{error}</span>
          <div>
            {!snapshot ? (
              <button
                type="button"
                className="native-error-retry"
                onClick={() =>
                  void refresh().catch((caught) =>
                    setError(
                      caught instanceof Error
                        ? caught.message
                        : "重新读取失败"
                    )
                  )
                }
              >
                重试
              </button>
            ) : null}
            <button
              type="button"
              aria-label="关闭错误提示"
              onClick={() => setError("")}
            >
              <CloseIcon />
            </button>
          </div>
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
            librarySearchMode === "ranked" &&
            libraryQuery.trim() ? (
              rankedNativeResults.length ? (
                <div className="library-search-results">
                  <div className="library-search-summary">
                    <span>
                      找到 {rankedNativeResults.length} 条相关收藏
                    </span>
                    <button
                      type="button"
                      onClick={() => setLibrarySearchMode("tree")}
                    >
                      在文件夹中查看
                    </button>
                  </div>
                  {rankedNativeResults.map((result) => (
                    <div
                      className="library-search-result"
                      key={result.node.id}
                    >
                      <button
                        type="button"
                        className="library-search-result-main"
                        onClick={() =>
                          void openNavigation({
                            text: result.node.url || "",
                            url: result.node.url
                          })
                        }
                        onAuxClick={(event) => {
                          if (event.button !== 1) return;
                          event.preventDefault();
                          void openNavigation(
                            {
                              text: result.node.url || "",
                              url: result.node.url
                            },
                            true
                          );
                        }}
                      >
                        <SiteThumbnail
                          url={result.resource.url}
                          imageUrl={result.resource.thumbnailDataUrl}
                          brandImageUrl={
                            siteBrandForUrl(
                              siteBrandByHost,
                              result.resource.url
                            )?.iconDataUrl
                          }
                          categoryCoverId={
                            result.resource.categoryCoverId
                          }
                          coverStyle={listCoverStyle}
                          label={result.resource.title}
                          className="bookmark-thumbnail"
                        />
                        <span>
                          <strong>
                            {highlightTextMatches(
                              result.resource.title,
                              libraryQuery
                            )}
                          </strong>
                          <small>
                            {result.resource.nativeFolderPath.join(
                              " / "
                            ) || hostFromUrl(result.resource.url)}
                            {result.matchReason
                              ? ` · 匹配${result.matchReason}`
                              : ""}
                          </small>
                        </span>
                      </button>
                      {!result.node.unmodifiable ? (
                        <button
                          type="button"
                          className="row-menu"
                          aria-label={`编辑 ${result.node.title}`}
                          title="编辑"
                          onClick={() => startEdit(result.node)}
                        >
                          <EllipsisIcon />
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="native-empty library-search-empty">
                  <span>
                    <SearchIcon />
                  </span>
                  <strong>没有找到相关收藏</strong>
                  <p>可以换个关键词，或让 AI 理解你的描述。</p>
                  <button
                    type="button"
                    className="button button-dark button-small"
                    disabled={Boolean(busy)}
                    onClick={() =>
                      aiConfigured
                        ? submitAgentQuery(libraryQuery)
                        : setPanelView("settings")
                    }
                  >
                    {aiConfigured
                      ? "让 AI 帮我找"
                      : "配置 AI 后可以让它帮你找"}
                  </button>
                </div>
              )
            ) : visibleBookmarkNodes.length ? (
              <>
                {!libraryQuery.trim() && contextResurfacing.length ? (
                  <section className="context-resurfacing">
                    <header>
                      <strong>这会儿值得重看</strong>
                      <button
                        type="button"
                        onClick={() =>
                          void sendExtensionRequest({
                            type: "OPEN_MANAGER",
                            view: "resurface"
                          })
                        }
                      >
                        打开工作台
                      </button>
                    </header>
                    {contextResurfacing.map((item) => (
                      <button
                        type="button"
                        key={item.resourceKey}
                        onClick={() =>
                          void openNavigation({
                            text: item.url,
                            url: item.url
                          })
                        }
                      >
                        <span>
                          <strong>{item.title}</strong>
                          <small>{item.reason}</small>
                        </span>
                        <em>{item.ageDays} 天</em>
                      </button>
                    ))}
                  </section>
                ) : null}
                <BookmarkTree
                  nodes={visibleBookmarkNodes}
                  resourceByUrl={resourceByUrl}
                  siteBrandByHost={siteBrandByHost}
                  coverStyle={listCoverStyle}
                  highlightQuery={libraryQuery}
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
              </>
            ) : libraryQuery.trim() ? (
              <div className="native-empty library-search-empty">
                <span>
                  <SearchIcon />
                </span>
                <strong>没有找到相关收藏</strong>
                <p>按回车查看完整排序，或让 AI 理解你的描述。</p>
                <button
                  type="button"
                  className="button button-dark button-small"
                  disabled={Boolean(busy)}
                  onClick={() =>
                    aiConfigured
                      ? submitAgentQuery(libraryQuery)
                      : setPanelView("settings")
                  }
                >
                  {aiConfigured
                    ? "让 AI 帮我找"
                    : "配置 AI 后可以让它帮你找"}
                </button>
              </div>
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

      {bookmarkPreview && previewSnapshot ? (
        <BookmarkPreviewCard
          snapshot={previewSnapshot}
          flip={bookmarkPreview.flip}
          offset={bookmarkPreview.offset}
        />
      ) : null}

      <AgentComposer
        value={agentPrompt}
        busy={Boolean(busy)}
        configured={aiConfigured}
        onChange={setAgentPrompt}
        onSubmit={handleAgentSubmit}
        onConfigure={() => setPanelView("settings")}
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
                      {folderSuggestions.length ? (
                        <div
                          className="folder-suggestions"
                          aria-label="推荐文件夹"
                        >
                          <small>本地推荐</small>
                          {folderSuggestions.map((suggestion) => (
                            <button
                              type="button"
                              key={suggestion.folderId}
                              data-selected={
                                folderId === suggestion.folderId
                              }
                              onClick={() =>
                                setFolderId(suggestion.folderId)
                              }
                              title={suggestion.reason}
                            >
                              {visibleFolderPath(
                                suggestion.path
                              ).join(" / ")}
                              <span>{suggestion.reason}</span>
                            </button>
                          ))}
                        </div>
                      ) : null}
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
                          ? "将从 Chrome 删除这个书签。30 天内可以在设置页「最近的更改」里恢复。"
                          : `将删除整个文件夹及其中 ${countBookmarks(editor.node)} 个书签。30 天内可以在设置页「最近的更改」里恢复。`}
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

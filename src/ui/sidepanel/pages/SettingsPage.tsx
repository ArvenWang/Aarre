import { ScrollSurface } from "@/ui/components/ui/scroll-area";
import { FloatingSettingsSection } from "../../floating/FloatingSettingsSection";
import { useEffect, useRef, useState } from "react";
import "../../sidepanel-lazy.css";
import { Button } from "@/ui/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/ui/components/ui/select";
import { ArrowLeftIcon } from "../../components/Icons";
import { getAiProviderPreset } from "../../../lib/settings";
import {
  requestPageSnapshotPermission,
  saveDisplaySettings,
} from "../../../lib/display-settings";
import { sendExtensionRequest } from "../../../lib/messages";
import { SettingsMoreContent } from "../components/settings/SettingsMoreContent";
import { LibraryScanConfirmDialog } from "../components/settings/LibraryScanConfirmDialog";
import { AccountCloudSection } from "../components/settings/AccountCloudSection";
import { AiServiceSection } from "../components/settings/AiServiceSection";
import { DisplaySettingsSection } from "../components/settings/DisplaySettingsSection";
import { LibraryScanSection } from "../components/settings/LibraryScanSection";
import { useSyncStatus } from "../hooks/use-sync-status";
import type {
  AiProviderId,
  AiSettingsStatus,
  AppState,
  LibraryScanEstimate,
  UndoSnapshotBatch
} from "../../../lib/types";
import type { CloudStorageUsage } from "../../../lib/cloud-settings";

const SETTINGS_GROUPS = [
  ["ai", "AI 服务"], ["appearance", "外观与快捷栏"], ["account", "账号与同步"],
  ["enhance", "书签增强"], ["activity", "最近动作"], ["data", "数据与帮助"],
] as const;
type SettingsGroup = typeof SETTINGS_GROUPS[number][0];

interface SettingsPageProps {
  layout?: "manager" | "compact";
  onAiConfiguredChange?: (configured: boolean) => void;
  appState: AppState | null;
  publicFaviconFallback: boolean;
  onPublicFaviconFallbackChange: (enabled: boolean) => void;
  onRestartOnboarding: () => void;
  onAppStateChange: (state: AppState) => void;
  onClose: () => void;
}

function SettingsPage({
  layout = "compact",
  onAiConfiguredChange,
  appState,
  publicFaviconFallback,
  onPublicFaviconFallbackChange,
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
  const [cloudUsage, setCloudUsage] = useState<CloudStorageUsage | null>(null);
  const syncStatus = useSyncStatus();
  const [cloudFeedback, setCloudFeedback] = useState<{
    tone: "error" | "success";
    message: string;
  } | null>(null);
  const [group, setGroup] = useState<SettingsGroup>("ai");
  const contentRef = useRef<HTMLElement | null>(null);
  useEffect(() => { if (contentRef.current) contentRef.current.scrollTop = 0; }, [group]);
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
      setCloudUsage(null);
      return;
    }
    let disposed = false;
    void sendExtensionRequest({ type: "GET_CLOUD_USAGE" })
      .then((next) => { if (!disposed) setCloudUsage(next); })
      .catch(() => undefined);
    return () => { disposed = true; };
  }, [appState?.auth.signedIn]);

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
      onAiConfiguredChange?.(next.apiKeyConfigured);
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
        message: "账号已连接。开启完整备份后，才会开始云端恢复与同步。",
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

  async function handleSyncNow() {
    if (action) return;
    setAction("sync-now");
    setCloudFeedback(null);
    try {
      await sendExtensionRequest({ type: "SYNC_NOW" });
      setCloudUsage(await sendExtensionRequest({ type: "GET_CLOUD_USAGE" }));
    } catch (caught) {
      setCloudFeedback({
        tone: "error",
        message: caught instanceof Error ? caught.message : "立即同步失败。",
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

  async function handlePublicFaviconFallback(enabled: boolean) {
    if (action) return;
    setAction("public-favicon-fallback");
    try {
      const next = await saveDisplaySettings({
        publicFaviconFallback: enabled,
      });
      onPublicFaviconFallbackChange(next.publicFaviconFallback);
    } catch {
      /* 设置页不再展示顶部提示条 */
    } finally {
      setAction("");
    }
  }

  return (
    <main className="native-panel native-settings-panel" data-layout={layout}>
      <header className="settings-page-header">
        <Button ref={backButtonRef} type="button" variant="ghost" size="icon-sm"
          className="icon-button settings-back-button" aria-label="返回收藏" onClick={onClose}>
          <ArrowLeftIcon />
        </Button>
        <h1>设置</h1>
      </header>
      <div className="settings-workspace">
        <nav className="settings-group-navigation" aria-label="设置分组">
          {SETTINGS_GROUPS.map(([id, label]) => (
            <Button key={id} variant="ghost" size="sm" aria-current={group === id ? "page" : undefined}
              onClick={() => setGroup(id)}>{label}</Button>
          ))}
        </nav>
        <div className="settings-group-picker">
          <Select value={group} onValueChange={(id) => setGroup(id as SettingsGroup)}>
            <SelectTrigger aria-label="设置分组" />
            <SelectContent>{SETTINGS_GROUPS.map(([id, label], index) => (
              <SelectItem key={id} value={id} index={index}>{label}</SelectItem>
            ))}</SelectContent>
          </Select>
        </div>
        <ScrollSurface as="section" className="settings-page-content" ref={contentRef}>
          <div hidden={group !== "ai"} className="settings-group-panel" aria-label="AI 服务">
            <AiServiceSection settings={settings} provider={provider} model={model} apiKey={apiKey}
              action={action} feedback={providerFeedback}
              onProviderChange={(nextProvider, nextModel) => {
                setProvider(nextProvider); setModel(nextModel); setApiKey(""); setProviderFeedback(null);
              }} onApiKeyChange={setApiKey} onSubmit={() => void saveApiSettings()} />
          </div>
          <div hidden={group !== "appearance"} className="settings-group-panel" aria-label="外观与快捷栏">
            <DisplaySettingsSection publicFaviconFallback={publicFaviconFallback} disabled={Boolean(action)}
              onPublicFaviconFallbackChange={(enabled) => void handlePublicFaviconFallback(enabled)} />
            <FloatingSettingsSection />
          </div>
          <div hidden={group !== "account"} className="settings-group-panel" aria-label="账号与同步">
            <AccountCloudSection appState={appState} action={action} status={syncStatus} usage={cloudUsage}
              feedback={cloudFeedback} onLogin={() => void handleLogin()}
              onSignOut={() => void handleSignOut()} onSync={() => void handleSyncNow()} />
          </div>
          <div hidden={group !== "enhance"} className="settings-group-panel" aria-label="书签增强">
            <LibraryScanSection appState={appState} settings={settings} action={action}
              feedback={scanFeedback} onAction={(intent) => void handleLibraryScan(intent)} />
          </div>
          <div hidden={group !== "activity"} className="settings-group-panel" aria-label="最近动作">
            <h2 className="settings-group-title">最近动作</h2>
            <SettingsMoreContent action={action} undoBatches={undoBatches}
              onUndo={(batchId) => void handleUndoBatch(batchId)} />
          </div>
          <div hidden={group !== "data"} className="settings-group-panel" aria-label="数据与帮助">
            <h2 className="settings-group-title">数据与帮助</h2>
            <section className="settings-section settings-data-links">
              <div className="settings-link-row">
                <div><strong>本地备份与恢复</strong><small>导出收藏副本，或从备份恢复。</small></div>
                <Button variant="tertiary" size="sm" asChild><a href={chrome.runtime.getURL("manager.html?archive=1")} target="_blank" rel="noreferrer">打开</a></Button>
              </div>
              <div className="settings-link-row">
                <div><strong>隐私与数据</strong><small>了解收藏、AI 与同步的数据使用方式。</small></div>
                <Button variant="tertiary" size="sm" asChild><a href={chrome.runtime.getURL("privacy.html")} target="_blank" rel="noreferrer">查看</a></Button>
              </div>
              <div className="settings-link-row">
                <div><strong>首次使用引导</strong><small>重新了解 Aarre 的使用方式。</small></div>
                <Button variant="tertiary" size="sm" type="button" onClick={onRestartOnboarding}>重新查看</Button>
              </div>
            </section>
          </div>
        </ScrollSurface>
      </div>

      <LibraryScanConfirmDialog
        estimate={scanEstimate}
        action={action}
        onClose={() => setScanEstimate(null)}
        onConfirm={() => void handleLibraryScan("start")}
      />
    </main>
  );
}


export default SettingsPage;

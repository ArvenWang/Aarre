import { useEffect, useRef, useState } from "react";
import "../../sidepanel-lazy.css";
import { Button } from "@/ui/components/ui/button";
import { ArrowLeftIcon, ChevronRightIcon } from "../../components/Icons";
import { getAiProviderPreset } from "../../../lib/settings";
import {
  getDisplaySettings,
  requestPageSnapshotPermission,
  saveDisplaySettings,
  type ListCoverStyle
} from "../../../lib/display-settings";
import { sendExtensionRequest } from "../../../lib/messages";
import { downloadAarreDataExport } from "../../../lib/data-export";
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
  const [cloudUsage, setCloudUsage] = useState<CloudStorageUsage | null>(null);
  const syncStatus = useSyncStatus();
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

  return (
    <main className="native-panel native-settings-panel">
      <header className="settings-page-header">
        <Button
          ref={backButtonRef}
          type="button"
          variant="ghost"
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

            <AccountCloudSection
              appState={appState}
              action={action}
              status={syncStatus}
              usage={cloudUsage}
              feedback={cloudFeedback}
              onLogin={() => void handleLogin()}
              onSignOut={() => void handleSignOut()}
              onSync={() => void handleSyncNow()}
            />

            <AiServiceSection
              settings={settings}
              provider={provider}
              model={model}
              apiKey={apiKey}
              action={action}
              feedback={providerFeedback}
              onProviderChange={(nextProvider, nextModel) => {
                setProvider(nextProvider);
                setModel(nextModel);
                setApiKey("");
                setProviderFeedback(null);
              }}
              onModelChange={setModel}
              onApiKeyChange={setApiKey}
              onSubmit={() => void saveApiSettings()}
            />

            <DisplaySettingsSection
              value={listCoverStyle}
              onChange={(style) => void handleCoverStyle(style)}
            />

            <LibraryScanSection
              appState={appState}
              settings={settings}
              action={action}
              feedback={scanFeedback}
              onAction={(intent) => void handleLibraryScan(intent)}
            />

            <section className="settings-section settings-more-entry">
              <Button
                type="button"
                variant="ghost"
                size="unstyled"
                className="settings-more-button"
                onClick={() => {
                  setSettingsPage("more");
                }}
              >
                <span>
                  <strong>更多</strong>
                </span>
                <ChevronRightIcon />
              </Button>
            </section>
          </>
        ) : (
          <SettingsMoreContent
            action={action}
            undoBatches={undoBatches}
            onUndo={(batchId) => void handleUndoBatch(batchId)}
            onRestartOnboarding={onRestartOnboarding}
            onExport={() => void exportLocalData()}
          />
        )}
      </section>

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

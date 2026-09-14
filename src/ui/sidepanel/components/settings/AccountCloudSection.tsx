import { useEffect, useState } from "react";
import { sendExtensionRequest } from "../../../../lib/messages";
import { CloudBackupConsent } from "./CloudBackupConsent";
import { Button } from "@/ui/components/ui/button";
import type { CloudStorageUsage } from "../../../../lib/cloud-settings";
import type { SyncStatus } from "../../../../lib/sync-engine";
import type { AppState } from "../../../../lib/types";
import { CloudStatusActions, CloudStatusRow } from "../CloudStatusRow";

type Feedback = { tone: "error" | "success"; message: string } | null;

interface AccountCloudSectionProps {
  appState: AppState | null;
  action: string;
  status: SyncStatus | null;
  usage: CloudStorageUsage | null;
  feedback: Feedback;
  onLogin: () => void;
  onSignOut: () => void;
  onSync: () => void;
}

const INITIAL_SYNC_STATUS: SyncStatus = {
  phase: "idle", current: 0, total: 0, lastSyncedAt: null, error: null, nextRetryAt: null,
};

export function AccountCloudSection({
  appState, action, status, usage, feedback, onLogin, onSignOut, onSync,
}: AccountCloudSectionProps) {
  const [backupEnabled, setBackupEnabled] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupError, setBackupError] = useState("");
  useEffect(() => {
    let active = true;
    void sendExtensionRequest({ type: "GET_CLOUD_SETTINGS" }).then((settings) => { if (active) setBackupEnabled(settings.enabled); }).catch(() => undefined);
    return () => { active = false; };
  }, [appState?.auth.signedIn, appState?.auth.userEmail]);
  async function changeBackup(enabled: boolean) {
    setBackupBusy(true); setBackupError("");
    try { const next = await sendExtensionRequest({ type: "SAVE_CLOUD_SETTINGS", payload: { enabled } }); setBackupEnabled(next.enabled); }
    catch (error) { setBackupError(error instanceof Error ? error.message : "未能保存备份选择，请重试。"); }
    finally { setBackupBusy(false); }
  }
  const identity = appState?.auth.userName || appState?.auth.userEmail || appState?.auth.chromeProfileEmail || "";
  return (
    <section className="settings-section" aria-labelledby="account-settings-title">
      <div className="settings-section-heading"><h2 id="account-settings-title">Google 账号</h2></div>
      <div className="settings-account-row">
        {identity ? (
          <span className="settings-account-avatar" aria-hidden="true">
            {appState?.auth.userAvatarUrl ? (
              <img src={appState.auth.userAvatarUrl} alt="" />
            ) : (
              identity.slice(0, 1).toUpperCase()
            )}
          </span>
        ) : null}
        <div className="settings-account-identity">
          <strong>{identity || "尚未连接"}</strong>
          {appState?.auth.signedIn ? (
            <CloudStatusRow
              status={backupEnabled ? status || INITIAL_SYNC_STATUS : { ...INITIAL_SYNC_STATUS, phase: "paused" }}
              usage={usage}
              showActions={false}
              busy={Boolean(action)}
              onSync={onSync}
              onDisconnect={onSignOut}
            />
          ) : (
            <small>{appState?.auth.configured ? "未登录" : "云端登录尚未配置"}</small>
          )}
        </div>
        {appState?.auth.configured && !appState.auth.signedIn ? (
          <Button variant="tertiary" size="sm" type="button" disabled={Boolean(action)} onClick={onLogin}>
            {action === "login" ? "登录中…" : "登录"}
          </Button>
        ) : null}
        {appState?.auth.signedIn && backupEnabled ? (
          <CloudStatusActions
            status={backupEnabled ? status || INITIAL_SYNC_STATUS : { ...INITIAL_SYNC_STATUS, phase: "paused" }}
            busy={Boolean(action)}
            onSync={onSync}
            onDisconnect={onSignOut}
          />
        ) : null}
      </div>
      {appState?.auth.signedIn && <CloudBackupConsent enabled={backupEnabled} busy={backupBusy || Boolean(action)} onChange={(value) => void changeBackup(value)} />}
      {appState?.auth.signedIn && !backupEnabled && <Button variant="ghost" size="sm" disabled={Boolean(action)} onClick={onSignOut}>退出账号</Button>}
      {backupError && <p role="alert" className="settings-inline-feedback" data-tone="error">{backupError}</p>}
      {feedback?.tone === "error" ? (
        <div className="settings-notice settings-inline-feedback" data-tone="error" role="alert">{feedback.message}</div>
      ) : null}
    </section>
  );
}

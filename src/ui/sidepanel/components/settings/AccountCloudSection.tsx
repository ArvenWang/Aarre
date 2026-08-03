import { Button } from "@/ui/components/ui/button";
import type { CloudStorageUsage } from "../../../../lib/cloud-settings";
import type { SyncStatus } from "../../../../lib/sync-engine";
import type { AppState } from "../../../../lib/types";
import { CloudStatusRow } from "../CloudStatusRow";

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

const PAUSED: SyncStatus = {
  phase: "paused", current: 0, total: 0, lastSyncedAt: null, error: null, nextRetryAt: null,
};

export function AccountCloudSection({
  appState, action, status, usage, feedback, onLogin, onSignOut, onSync,
}: AccountCloudSectionProps) {
  const identity = appState?.auth.userName || appState?.auth.userEmail || appState?.auth.chromeProfileEmail || "";
  return (
    <section className="settings-section" aria-labelledby="account-settings-title">
      <div className="settings-section-heading"><h2 id="account-settings-title">Google 账号</h2></div>
      <div className="settings-account-row">
        {appState?.auth.userAvatarUrl ? <img src={appState.auth.userAvatarUrl} alt="" />
          : identity ? <span className="settings-account-avatar">{identity.slice(0, 1).toUpperCase()}</span> : null}
        <div>
          <strong>{identity || "尚未连接"}</strong>
          {!appState?.auth.signedIn ? <small>{appState?.auth.configured ? "未登录" : "云端登录尚未配置"}</small> : null}
        </div>
        {appState?.auth.configured && !appState.auth.signedIn ? (
          <Button variant="ghost" size="sm" type="button" disabled={Boolean(action)} onClick={onLogin}>
            {action === "login" ? "登录中…" : "登录"}
          </Button>
        ) : null}
      </div>
      {appState?.auth.signedIn ? (
        <CloudStatusRow status={status || PAUSED} usage={usage} busy={Boolean(action)} onSync={onSync} onDisconnect={onSignOut} />
      ) : null}
      {feedback?.tone === "error" ? (
        <div className="settings-notice settings-inline-feedback" data-tone="error" role="alert">{feedback.message}</div>
      ) : null}
    </section>
  );
}

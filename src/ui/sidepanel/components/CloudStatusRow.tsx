import { Button } from "@/ui/components/ui/button";
import type { CloudStorageUsage } from "../../../lib/cloud-settings";
import type { SyncStatus } from "../../../lib/sync-engine";

function relativeTime(value: string): string {
  const milliseconds = Date.parse(value) - Date.now();
  const absolute = Math.abs(milliseconds);
  if (absolute < 60_000) return milliseconds > 0 ? `${Math.max(1, Math.ceil(absolute / 1_000))} 秒` : "刚刚";
  if (absolute < 3_600_000) return `${Math.round(absolute / 60_000)} 分钟${milliseconds > 0 ? "" : "前"}`;
  if (absolute < 86_400_000) return `${Math.round(absolute / 3_600_000)} 小时${milliseconds > 0 ? "" : "前"}`;
  return `${Math.round(absolute / 86_400_000)} 天${milliseconds > 0 ? "" : "前"}`;
}

export function statusText(status: SyncStatus): string {
  switch (status.phase) {
    case "paused": return "同步已暂停";
    case "error":
      return status.nextRetryAt
        ? `同步失败 · ${relativeTime(status.nextRetryAt)}后重试`
        : "同步失败";
    case "pulling":
    case "pushing":
    case "assets-up":
    case "assets-down": return status.total ? `正在同步数据 · ${status.current}/${status.total}` : "正在同步数据";
    case "idle":
    default: return status.lastSyncedAt ? `已同步 · ${relativeTime(status.lastSyncedAt)}` : "等待同步";
  }
}

export function syncIsActive(status: SyncStatus): boolean {
  return ["pulling", "pushing", "assets-up", "assets-down"].includes(
    status.phase,
  );
}

interface CloudStatusRowProps {
  status: SyncStatus;
  usage: CloudStorageUsage | null;
  busy?: boolean;
  onSync: () => void;
  onDisconnect: () => void;
}

export function CloudStatusRow({ status, usage, busy, onSync, onDisconnect }: CloudStatusRowProps) {
  const showUsage = Boolean(usage && usage.usageRatio >= 0.8);
  const syncing = syncIsActive(status);
  return (
    <div className="cloud-status" aria-live="polite">
      <div className="cloud-status-summary">
        <span className="cloud-status-dot" data-phase={status.phase} aria-hidden="true" />
        <span className="cloud-status-text">{statusText(status)}</span>
      </div>
      {syncing && status.total > 0 ? (
        <progress
          className="cloud-status-progress"
          value={Math.min(status.current, status.total)}
          max={status.total}
          aria-label="云端同步进度"
        />
      ) : null}
      {status.error ? (
        <p className="cloud-status-error" role="alert" title={status.error}>
          {status.error}
        </p>
      ) : null}
      {showUsage && usage ? (
        <p className="cloud-status-usage">
          云端用量 {Math.round(usage.usageRatio * 100)}%
        </p>
      ) : null}
      <div className="cloud-status-actions">
        <Button
          type="button"
          variant="tertiary"
          size="sm"
          className="cloud-status-sync"
          disabled={Boolean(busy) || syncing}
          onClick={onSync}
        >
          {syncing ? "同步中…" : "立即同步"}
        </Button>
        <Button
          type="button"
          variant="danger-quiet"
          size="sm"
          className="cloud-status-disconnect"
          disabled={Boolean(busy)}
          onClick={onDisconnect}
        >
          断开账号
        </Button>
      </div>
    </div>
  );
}

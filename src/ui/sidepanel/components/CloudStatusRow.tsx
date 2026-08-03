import { useState } from "react";
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
    case "paused": return "未登录";
    case "error":
      return `同步失败 · ${status.error || "未知错误"}${status.nextRetryAt ? `（${relativeTime(status.nextRetryAt)}后重试）` : ""}`;
    case "pulling":
    case "pushing": return status.total ? `正在同步 · ${status.current}/${status.total}` : "正在同步";
    case "assets-up": return status.total ? `正在上传封面 · ${status.current}/${status.total}` : "正在上传封面";
    case "assets-down": return status.total ? `正在下载封面 · ${status.current}/${status.total}` : "正在下载封面";
    case "idle":
    default: return status.lastSyncedAt ? `已同步 · ${relativeTime(status.lastSyncedAt)}` : "等待同步";
  }
}

interface CloudStatusRowProps {
  status: SyncStatus;
  usage: CloudStorageUsage | null;
  busy?: boolean;
  onSync: () => void;
  onDisconnect: () => void;
}

export function CloudStatusRow({ status, usage, busy, onSync, onDisconnect }: CloudStatusRowProps) {
  const [expanded, setExpanded] = useState(false);
  const showUsage = Boolean(usage && usage.usageRatio >= 0.8);
  return (
    <div className="cloud-status">
      <Button type="button" variant="ghost" size="unstyled" className="cloud-status-row" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
        <span className="cloud-status-dot" data-phase={status.phase} aria-hidden="true" />
        <span className="cloud-status-text">{statusText(status)}</span>
      </Button>
      {expanded ? (
        <div className="cloud-status-detail">
          {status.error ? <p role="alert">{status.error}</p> : null}
          {showUsage && usage ? <p>云端用量 {Math.round(usage.usageRatio * 100)}%</p> : null}
          {status.phase === "error" || status.phase === "idle" ? (
            <Button type="button" variant="ghost" size="unstyled" className="cloud-status-sync" disabled={busy} onClick={onSync}>立即同步</Button>
          ) : null}
          <Button type="button" variant="ghost" size="unstyled" className="cloud-status-disconnect" disabled={busy} onClick={onDisconnect}>断开账号</Button>
        </div>
      ) : null}
    </div>
  );
}

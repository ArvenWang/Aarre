import { Button } from "@/ui/components/ui/button";
import type { AiSettingsStatus, AppState } from "../../../../lib/types";

type ScanIntent = "start" | "pause" | "resume" | "cancel";
type Feedback = { tone: "error" | "success"; message: string } | null;

interface LibraryScanSectionProps {
  appState: AppState | null;
  settings: AiSettingsStatus | null;
  action: string;
  feedback: Feedback;
  onAction: (intent: ScanIntent) => void;
}

function scanStatus(appState: AppState | null): string {
  const scan = appState?.libraryScan;
  if (scan?.state === "running") return "扫描中";
  if (scan?.state === "paused") return "已暂停";
  if (scan?.state === "completed") return scan.failed ? "部分完成" : "已完成";
  if (scan?.state === "failed") return "失败";
  return "未开始";
}

export function LibraryScanSection({
  appState,
  settings,
  action,
  feedback,
  onAction,
}: LibraryScanSectionProps) {
  const scan = appState?.libraryScan;
  const active = scan?.state === "running" || scan?.state === "completed";
  return (
    <section className="settings-section settings-scan-section" aria-labelledby="library-scan-title">
      <div className="settings-section-heading">
        <div>
          <h2 id="library-scan-title">书签增强</h2>
          <p>
            {appState?.aiReadyResourceCount ?? 0} / {appState?.aiEligibleResourceCount ?? 0} 条已增强
            {appState?.aiPrivacyProtectedCount ? ` · ${appState.aiPrivacyProtectedCount} 条受保护` : ""}。
          </p>
        </div>
        <span className="settings-status" data-active={active}>{scanStatus(appState)}</span>
      </div>
      {scan?.state === "running" || scan?.state === "paused" ? (
        <div className="settings-scan-progress">
          <progress max={Math.max(1, scan.total || 1)} value={scan.processed || 0} aria-label="全目录扫描进度" />
          <p title={scan.currentTitle || undefined}>
            {scan.processed}/{scan.total} · 成功 {scan.succeeded} · 跳过 {scan.skipped} · 失败 {scan.failed}
          </p>
        </div>
      ) : null}
      <div className="settings-scan-actions">
        {scan?.state === "running" ? (
          <Button variant="ghost" size="sm" type="button" disabled={Boolean(action)} onClick={() => onAction("pause")}>暂停</Button>
        ) : scan?.state === "paused" ? (
          <>
            <Button variant="ghost" size="sm" type="button" disabled={Boolean(action)} onClick={() => onAction("cancel")}>取消</Button>
            <Button variant="primary" size="sm" type="button" disabled={Boolean(action)} onClick={() => onAction("resume")}>继续扫描</Button>
          </>
        ) : (
          <Button
            variant="primary" size="sm"
            type="button"

            disabled={Boolean(action) || !appState?.localResourceCount}
            onClick={() => onAction("start")}
          >
            {action === "scan-start"
              ? "正在估算…"
              : appState?.aiReadyResourceCount === appState?.aiEligibleResourceCount && Boolean(appState?.aiEligibleResourceCount)
                ? "检查并补全"
                : settings?.apiKeyConfigured ? "扫描全部书签" : "更新站点标识"}
          </Button>
        )}
      </div>
      {feedback ? (
        <div className="settings-notice settings-inline-feedback" data-tone={feedback.tone} role={feedback.tone === "error" ? "alert" : "status"}>{feedback.message}</div>
      ) : !feedback && scan?.state === "failed" ? (
        <div className="settings-notice settings-inline-feedback" data-tone="error" role="alert">
          {scan.errors.at(-1)?.message || "书签增强未完成，请检查 AI 配置或网络后重试。"}
        </div>
      ) : !feedback && scan?.state === "completed" && scan.failed > 0 ? (
        <div className="settings-notice settings-inline-feedback" data-tone="error" role="status">
          已处理 {scan.processed} 条，其中失败 {scan.failed} 条；可再次运行补齐。
        </div>
      ) : null}
    </section>
  );
}

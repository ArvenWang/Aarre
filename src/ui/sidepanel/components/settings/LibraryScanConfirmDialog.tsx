import { AppModal } from "@/ui/components/ui/modal";
import { Button } from "@/ui/components/ui/button";
import type { LibraryScanEstimate } from "../../../../lib/types";

interface LibraryScanConfirmDialogProps {
  estimate: LibraryScanEstimate | null;
  action: string;
  onClose: () => void;
  onConfirm: () => void;
}

export function LibraryScanConfirmDialog({
  estimate,
  action,
  onClose,
  onConfirm,
}: LibraryScanConfirmDialogProps) {
  if (!estimate) return null;
  return (
    <AppModal onClose={onClose} busy={Boolean(action)} labelledBy="scan-confirm-title"
      className="settings-scan-dialog" backdropClassName="settings-scan-dialog-backdrop">
        <h2 id="scan-confirm-title">开始前确认</h2>
        <p>
          {estimate.aiResourceCount} 条将调用 {estimate.providerName} {estimate.model}，已完成的不会重复。
        </p>
        <dl>
          <div>
            <dt>预计时间</dt>
            <dd>约 {estimate.estimatedMinutes} 分钟</dd>
          </div>
          <div>
            <dt>预计用量</dt>
            <dd>
              输入约 {estimate.estimatedInputTokens.toLocaleString()} · 输出约{" "}
              {estimate.estimatedOutputTokens.toLocaleString()}
            </dd>
          </div>
        </dl>
        <small>用量为估算值，数据保存在本机。</small>
        <div className="settings-scan-dialog-actions">
          <Button
            variant="ghost" size="sm"
            type="button"

            disabled={Boolean(action)}
            onClick={onClose}
          >
            取消
          </Button>
          <Button
            variant="primary" size="sm"
            type="button"

            disabled={Boolean(action) || !estimate.total}
            onClick={onConfirm}
          >
            {action === "scan-start"
              ? "正在启动…"
              : estimate.total
                ? "确认并开始"
                : "无需扫描"}
          </Button>
        </div>
    </AppModal>
  );
}

import { Button } from "@/ui/components/ui/button";
import type { UndoSnapshotBatch } from "../../../../lib/types";
import { conversationDate } from "../../utils";

interface SettingsMoreContentProps {
  action: string;
  undoBatches: UndoSnapshotBatch[];
  onUndo: (batchId: string) => void;
  onRestartOnboarding: () => void;
  onExport: () => void;
}

export function SettingsMoreContent({
  action,
  undoBatches,
  onUndo,
  onRestartOnboarding,
  onExport,
}: SettingsMoreContentProps) {
  return (
    <>
      <section className="settings-section" aria-labelledby="recent-changes-title">
        <div className="settings-section-heading">
          <div>
            <h2 id="recent-changes-title">最近的更改</h2>
            <p>删除的书签和文件夹保留 30 天。</p>
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
                    {batch.source === "chrome" ? " · Chrome 书签管理器" : ""}
                    {batch.destructive ? " · 回收站" : ""}
                  </small>
                </div>
                <Button
                  variant="ghost" size="sm"
                  type="button"

                  disabled={Boolean(action)}
                  onClick={() => onUndo(batch.batchId)}
                >
                  {action === `undo-${batch.batchId}` ? "恢复中…" : "撤销"}
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
        </div>
        <Button
          variant="ghost" size="sm"
          type="button"

          disabled={Boolean(action)}
          onClick={onRestartOnboarding}
        >
          重新查看引导
        </Button>
      </section>

      <section className="settings-section" aria-labelledby="privacy-settings-title">
        <div className="settings-section-heading">
          <div>
            <h2 id="privacy-settings-title">隐私与数据自主权</h2>
            <p>导出本地数据，不包含 API Key 或登录信息。</p>
          </div>
        </div>
        <div className="settings-field-footer">
          <Button variant="ghost" size="sm" asChild>
            <a
              href={chrome.runtime.getURL("privacy.html")}
              target="_blank"
              rel="noreferrer"
            >
              查看隐私政策
            </a>
          </Button>
          <Button
            variant="primary" size="sm"
            type="button"

            disabled={Boolean(action)}
            onClick={onExport}
          >
            {action === "export-data" ? "正在打包…" : "导出全部本地数据"}
          </Button>
        </div>
      </section>
    </>
  );
}

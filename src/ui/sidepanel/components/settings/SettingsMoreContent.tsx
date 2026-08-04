import { Button } from "@/ui/components/ui/button";
import type { UndoSnapshotBatch } from "../../../../lib/types";
import { conversationDate } from "../../utils";

interface SettingsMoreContentProps {
  action: string;
  undoBatches: UndoSnapshotBatch[];
  onUndo: (batchId: string) => void;
}

export function SettingsMoreContent({
  action,
  undoBatches,
  onUndo,
}: SettingsMoreContentProps) {
  return (
    <>
      <section className="settings-section" aria-label="可撤销的最近动作">
        <p className="settings-change-retention">删除的书签和文件夹保留 30 天。</p>
        {undoBatches.length ? (
          <div className="settings-change-list">
            {undoBatches.slice(0, 12).map((batch) => (
              <article className="bookmark-row" key={batch.batchId} data-destructive={batch.destructive}>
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
                  className="settings-row-action"
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
    </>
  );
}

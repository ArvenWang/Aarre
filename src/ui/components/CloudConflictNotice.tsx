import { useEffect, useMemo, useState } from "react";
import { Button } from "../../components/ui/button";
import type { CloudConflict } from "../../lib/cloud";
import { sendExtensionRequest } from "../../lib/messages";

interface CloudConflictNoticeProps {
  resourceKey: string;
  currentUserNote: string;
  currentTags: string[];
  disabled?: boolean;
  onResolved?: () => void;
}

function fieldText(value: string | string[]): string {
  return Array.isArray(value) ? value.join("、") || "（无标签）" : value || "（空备注）";
}

export function CloudConflictNotice({
  resourceKey,
  currentUserNote,
  currentTags,
  disabled = false,
  onResolved
}: CloudConflictNoticeProps) {
  const [conflicts, setConflicts] = useState<CloudConflict[]>([]);
  const [resolving, setResolving] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void sendExtensionRequest({ type: "GET_CLOUD_CONFLICTS" })
      .then((items) => {
        if (active) setConflicts(items.filter((item) => item.resourceKey === resourceKey));
      })
      .catch(() => {
        // Cloud is optional. A disconnected editor must remain fully usable.
      });
    return () => {
      active = false;
    };
  }, [resourceKey]);

  const conflict = conflicts[0];
  const remaining = useMemo(
    () => Math.max(0, conflicts.length - 1),
    [conflicts.length]
  );
  if (!conflict) return null;

  async function resolve(resolution: "current" | "incoming" | "merged") {
    if (disabled || resolving) return;
    setResolving(resolution);
    setError("");
    try {
      await sendExtensionRequest({
        type: "RESOLVE_CLOUD_CONFLICT",
        conflictId: conflict.conflictId,
        resolution,
        ...(resolution === "merged"
          ? { mergedUserNote: currentUserNote, mergedTags: currentTags }
          : {})
      });
      setConflicts((items) => items.filter((item) => item.conflictId !== conflict.conflictId));
      onResolved?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "冲突处理失败，请稍后再试。");
    } finally {
      setResolving("");
    }
  }

  return (
    <section className="cloud-conflict-notice" aria-label="云端编辑冲突">
      <div className="cloud-conflict-heading">
        <strong>检测到另一台设备的修改</strong>
        <span>{remaining ? `后面还有 ${remaining} 组` : "两份内容都已保留"}</span>
      </div>
      <p>请选择一个版本，或先在下方编辑备注和标签，再把当前内容作为合并结果。</p>
      <div className="cloud-conflict-versions">
        {conflict.fields.map((field) => (
          <div key={field.field}>
            <span>{field.field === "userNote" ? "备注" : "标签"}</span>
            <dl>
              <div><dt>云端版</dt><dd>{fieldText(field.current)}</dd></div>
              <div><dt>离线版</dt><dd>{fieldText(field.incoming)}</dd></div>
            </dl>
          </div>
        ))}
      </div>
      {error ? <p className="cloud-conflict-error" role="alert">{error}</p> : null}
      <div className="cloud-conflict-actions">
        <Button type="button" variant="secondary" size="sm" disabled={disabled || Boolean(resolving)} onClick={() => void resolve("current")}>
          保留云端版
        </Button>
        <Button type="button" variant="secondary" size="sm" disabled={disabled || Boolean(resolving)} onClick={() => void resolve("incoming")}>
          采用离线版
        </Button>
        <Button type="button" variant="primary" size="sm" disabled={disabled || Boolean(resolving)} onClick={() => void resolve("merged")}>
          以当前内容合并
        </Button>
      </div>
    </section>
  );
}

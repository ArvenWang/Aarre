import { useEffect, useState } from "react";
import {
  sendExtensionRequest,
  type ProtectionTarget,
} from "../../lib/messages";
import type { ItemProtectionState } from "../../lib/protection";
import { Button } from "../../components/ui/button";

interface ProtectionControlProps {
  target: ProtectionTarget;
  disabled?: boolean;
  onChanged?: (state: ItemProtectionState) => void;
}

function protectionDescription(
  target: ProtectionTarget,
  state: ItemProtectionState | null,
): string {
  if (state?.inherited && !state.explicit) {
    return target.kind === "folder"
      ? "已由上级文件夹继承保护；请在上级文件夹中关闭。"
      : "已由所在文件夹继承保护；请在该文件夹中关闭。";
  }
  if (state?.protected) {
    return target.kind === "folder"
      ? "此文件夹及所有后代网页不会被增强、截图或用于 AI 对话。"
      : "不会读取正文、生成截图、检查链接或用于 AI 对话。";
  }
  return target.kind === "folder"
    ? "开启后，此文件夹及其所有子文件夹内的网页都不会被扫描。"
    : "开启后，不读取正文、不生成截图，也不用于 AI 对话。";
}

export function ProtectionControl({
  target,
  disabled = false,
  onChanged,
}: ProtectionControlProps) {
  const [state, setState] = useState<ItemProtectionState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setState(null);
    setError("");
    void sendExtensionRequest({
      type: "GET_ITEM_PROTECTION",
      target,
    })
      .then((next) => {
        if (active) setState(next);
      })
      .catch((caught) => {
        if (!active) return;
        setError(caught instanceof Error ? caught.message : "无法读取保护状态");
      });
    return () => {
      active = false;
    };
  }, [target.id, target.kind]);

  const inheritedOnly = state?.inherited === true && !state.explicit;
  const unavailable = disabled || saving || !state || inheritedOnly;

  async function toggleProtection() {
    if (!state || unavailable) return;
    setSaving(true);
    setError("");
    try {
      const next = await sendExtensionRequest({
          type: "SET_ITEM_PROTECTION",
          target,
          protected: !state.protected,
        });
      setState(next);
      onChanged?.(next);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保护状态保存失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="protection-control" aria-label="隐私保护">
      <div className="protection-control-copy">
        <strong>受保护</strong>
        <small>{protectionDescription(target, state)}</small>
        {error ? <small className="protection-control-error">{error}</small> : null}
      </div>
      <Button
        type="button"
        variant="unstyled"
        size="unstyled"
        className="protection-switch"
        role="switch"
        aria-checked={state?.protected === true}
        aria-label={state?.protected ? "关闭受保护" : "开启受保护"}
        disabled={unavailable}
        data-state={state?.protected ? "checked" : "unchecked"}
        onClick={() => void toggleProtection()}
      >
        <span aria-hidden="true" />
      </Button>
    </section>
  );
}

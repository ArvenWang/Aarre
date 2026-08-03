import React, { useLayoutEffect, useRef } from "react";
import { Button } from "@/ui/components/ui/button";
import { FluidTextarea } from "@/ui/components/ui/input";
import { ArrowUpIcon, ChevronRightIcon, StopIcon } from "../../components/Icons";
interface AgentComposerProps {
  value: string;
  busy: boolean;
  configured: boolean;
  placeholder?: string;
  onChange: (value: string) => void;
  onSubmit: (event: React.FormEvent) => void;
  onCancel?: () => void;
  onConfigure?: () => void;
}

function AgentComposer({
  value,
  busy,
  configured,
  placeholder = "询问你的收藏…",
  onChange,
  onSubmit,
  onCancel,
  onConfigure,
}: AgentComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea || !configured) return;
    // 先归零再读取 scrollHeight，删除文字时高度才能一起回落。
    textarea.style.height = "auto";
    const nextHeight = Math.max(48, Math.min(112, textarea.scrollHeight));
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > 112 ? "auto" : "hidden";
  }, [configured, value]);

  if (!configured) {
    return (
      <div className="agent-composer agent-composer-setup">
        <Button type="button" variant="ghost" onClick={onConfigure}>
          <span>
            <strong>配置 AI 后可以直接问你的收藏</strong>
          </span>
          <ChevronRightIcon />
        </Button>
      </div>
    );
  }
  return (
    <form className="agent-composer" onSubmit={(event) => onSubmit(event)}>
      <FluidTextarea
        ref={textareaRef}
        id="bookmark-agent-prompt"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={busy}
        onKeyDown={(event) => {
          if (
            event.key === "Enter" &&
            !event.shiftKey &&
            !event.nativeEvent.isComposing
          ) {
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }
        }}
        placeholder={placeholder}
        rows={1}
        aria-label={placeholder}
      />
      <div className="agent-composer-toolbar">
        {busy && onCancel ? (
          <Button
            variant="ghost"
            type="button"
            size="icon-sm"
            className="agent-send-button agent-stop-button"
            aria-label="停止 AI 对话"
            title="停止"
            onClick={onCancel}
          >
            <StopIcon />
          </Button>
        ) : (
          <Button
            variant="ghost"
            type="submit"
            size="icon-sm"
            className="agent-send-button"
            aria-label="发送给 Aarre"
            title="发送"
            disabled={!value.trim() || busy}
          >
            <ArrowUpIcon />
          </Button>
        )}
      </div>
    </form>
  );
}


export { AgentComposer };

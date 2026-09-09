import React, { useLayoutEffect, useRef } from "react";
import { Button } from "@/ui/components/ui/button";
import { FluidTextarea } from "@/ui/components/ui/input";
import { ArrowUpIcon, StopIcon } from "../../components/Icons";
import { MessageSquare, Settings2 } from "lucide-react";
interface AgentComposerProps {
  value: string;
  busy: boolean;
  configured: boolean;
  placeholder?: string;
  onChange: (value: string) => void;
  onSubmit: (event: React.FormEvent) => void;
  onCancel?: () => void;
  onConfigure?: () => void;
  onResume?: () => void;
}

function AgentComposer({ value, busy, configured, placeholder = "问问收藏，或让我帮你整理…", onChange, onSubmit, onCancel, onConfigure, onResume }: AgentComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    const nextHeight = Math.max(56, Math.min(112, textarea.scrollHeight));
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > 112 ? "auto" : "hidden";
  }, [value]);

  return <form className="agent-composer" aria-label="与 Aarre 对话" onSubmit={event => {
    if (!configured) { event.preventDefault(); if (value.trim() && !busy) onConfigure?.(); return; }
    onSubmit(event);
  }}>
    <FluidTextarea ref={textareaRef} id="bookmark-agent-prompt" value={value}
      onChange={event => onChange(event.target.value)} disabled={busy}
      onKeyDown={event => {
        if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
          event.preventDefault(); event.currentTarget.form?.requestSubmit();
        }
      }} placeholder={placeholder} rows={2} aria-label="向 Aarre 提问" />
    <div className="agent-composer-toolbar">
      <div className="agent-composer-context">
        {onResume ? <Button variant="ghost" size="sm" onClick={onResume}><MessageSquare size={14}/>继续对话</Button>
          : <span>基于你的收藏</span>}
      </div>
      <div className="agent-composer-actions">
        {!configured && <Button variant="ghost" size="sm" className="agent-connect-action" onClick={onConfigure}><Settings2 size={14}/>连接服务</Button>}
        {busy && onCancel ? <Button variant="secondary" type="button" size="icon-sm" className="agent-send-button agent-stop-button" aria-label="停止 AI 对话" onClick={onCancel}><StopIcon /></Button>
          : <Button variant="primary" type="submit" size="icon-sm" className="agent-send-button" aria-label="发送给 Aarre" disabled={!value.trim() || busy}><ArrowUpIcon /></Button>}
      </div>
    </div>
  </form>;
}
export { AgentComposer };

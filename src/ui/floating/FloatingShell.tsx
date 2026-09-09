import { useEffect, type ReactNode } from "react";
import { Tabs } from "@heroui/react/tabs";
import { Bookmark, MessageSquare, Settings, X, Maximize2, History, SquarePen } from "lucide-react";
import { Button } from "@/ui/components/ui/button";
import { Tooltip } from "@/ui/components/ui/tooltip";
import { sendExtensionRequest } from "../../lib/messages";
import type { SidePanelView } from "../sidepanel/hooks/use-agent-chat";
import { postToFloatingHost } from "./bridge";
export function FloatingShell({ children, view, onViewChange, onHistory, onNewConversation, busy, onboarding }: {
  children: ReactNode; view: SidePanelView; onViewChange: (view: SidePanelView) => void; onHistory: () => void; onNewConversation: () => void; busy: boolean; onboarding: boolean;
}) {
  const selected = view === "history" ? "chat" : view;
  useEffect(() => { postToFloatingHost({ type: "FLOAT_CURRENT_VIEW", view }); }, [view]);
  return <div className="floating-shell">
    <header className="floating-header">
      <div className="floating-brand"><Bookmark size={18} aria-hidden="true" /><strong>Aarre</strong></div>
      <div className="floating-window-actions">
        {selected === "chat" && <Tooltip content="新会话"><Button variant="ghost" size="icon-sm" aria-label="新会话" disabled={busy} onClick={onNewConversation}><SquarePen size={16} /></Button></Tooltip>}
        {selected === "chat" && <Tooltip content="历史会话"><Button variant="ghost" size="icon-sm" aria-label="历史会话" onClick={onHistory}><History size={16} /></Button></Tooltip>}
        <Tooltip content="打开完整收藏库"><Button variant="ghost" size="icon-sm" aria-label="打开完整收藏库" onClick={() => void sendExtensionRequest({ type: "OPEN_MANAGER" })}><Maximize2 size={16} /></Button></Tooltip>
        <Tooltip content="收起菜单 · Esc"><Button variant="ghost" size="icon-sm" aria-label="收起菜单" onClick={() => postToFloatingHost({ type: "FLOAT_CLOSE" })}><X size={16} /></Button></Tooltip>
      </div>
    </header>
    {onboarding ? <div className="floating-body floating-onboarding">{children}</div> : <Tabs className="floating-tabs aarre-tabs" selectedKey={selected} onSelectionChange={(key) => onViewChange(String(key) as SidePanelView)}>
      <Tabs.List className="floating-nav aarre-tabs-list" aria-label="Aarre 功能">
        {[["library", "收藏", Bookmark], ["chat", "AI", MessageSquare], ["settings", "设置", Settings]].map(([key, label, Icon]) => {
          const Glyph = Icon as typeof Bookmark;
          return <Tabs.Tab key={String(key)} id={String(key)} className="aarre-tab"><Glyph size={16} aria-hidden="true" /><span>{String(label)}</span></Tabs.Tab>;
        })}
      </Tabs.List>
      {["library", "chat", "settings"].map((id) => <Tabs.Panel key={id} id={id} className="floating-body aarre-tab-panel">{selected === id ? children : null}</Tabs.Panel>)}
    </Tabs>}
  </div>;
}

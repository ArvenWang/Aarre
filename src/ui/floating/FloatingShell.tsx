import { useEffect, type ReactNode } from "react";
import { Dropdown } from "@heroui/react/dropdown";
import { Label } from "@heroui/react/label";
import { Settings, X, Maximize2, History, SquarePen, MoreHorizontal, Star, FolderPlus, ArrowLeft } from "lucide-react";
import { AarreIcon } from "../components/AarreIcon";
import { AarreWordmark } from "../components/AarreWordmark";
import { Button, buttonVariants } from "@/ui/components/ui/button";
import { Tooltip } from "@/ui/components/ui/tooltip";
import { ScrollSurface } from "@/ui/components/ui/scroll-area";
import { sendExtensionRequest } from "../../lib/messages";
import type { SidePanelView } from "../sidepanel/hooks/use-agent-chat";
import { postToFloatingHost } from "./bridge";

interface FloatingShellProps {
  children: ReactNode;
  composer?: ReactNode;
  view: SidePanelView;
  conversationTitle?: string;
  onViewChange: (view: SidePanelView) => void;
  onHistory: () => void;
  onNewConversation: () => void;
  onSaveCurrent: () => void;
  onCreateFolder: () => void;
  currentSaved: boolean;
  canSave: boolean;
  canCreateFolder: boolean;
  busy: boolean;
  onboarding: boolean;
}

/** One workspace with a persistent composer. Utility windows are secondary. */
export function FloatingShell({ children, composer, view, conversationTitle, onViewChange, onHistory, onNewConversation, onSaveCurrent, onCreateFolder, currentSaved, canSave, canCreateFolder, busy, onboarding }: FloatingShellProps) {
  useEffect(() => { postToFloatingHost({ type: "FLOAT_CURRENT_VIEW", view }); }, [view]);
  return <div className="floating-shell">
    <header className="floating-header">
      <div className="floating-brand">
        {view === "chat" ? <Tooltip content="返回收藏列表"><Button variant="ghost" size="icon-sm" aria-label="返回收藏列表" onClick={() => onViewChange("library")}><ArrowLeft size={16}/></Button></Tooltip> : <AarreIcon />}
        {view === "chat" ? <strong title={conversationTitle}>{conversationTitle || "对话"}</strong> : <AarreWordmark />}
      </div>
      <div className="floating-window-actions">
        {!onboarding && <Tooltip content={currentSaved ? "管理当前网页收藏" : "收藏当前网页"}>
          <Button variant="ghost" size="icon-sm" aria-label={currentSaved ? "管理当前网页收藏" : "收藏当前网页"} disabled={!canSave || busy} onClick={onSaveCurrent} className="floating-save-action" data-saved={currentSaved}>
            <Star size={16} fill={currentSaved ? "currentColor" : "none"} />
          </Button>
        </Tooltip>}
        {!onboarding && <Dropdown>
          <Dropdown.Trigger className={buttonVariants({variant:"ghost",size:"icon-sm"})} aria-label="更多操作"><MoreHorizontal size={18} aria-hidden="true" /></Dropdown.Trigger>
          <Dropdown.Popover data-elevation="popover" className="aarre-menu-popover" placement="bottom end" offset={6}>
            <ScrollSurface className="aarre-menu-viewport" label="更多操作">
              <Dropdown.Menu aria-label="菜单操作" className="aarre-menu" onAction={key => {
                if (key === "new") onNewConversation();
                if (key === "history") onHistory();
                if (key === "folder") onCreateFolder();
                if (key === "settings") onViewChange("settings");
              }}>
                <Dropdown.Item id="new" textValue="新会话" isDisabled={busy}><SquarePen size={16}/><Label>新会话</Label></Dropdown.Item>
                <Dropdown.Item id="history" textValue="历史会话" isDisabled={busy}><History size={16}/><Label>历史会话</Label></Dropdown.Item>
                <Dropdown.Item id="folder" textValue="新建文件夹" isDisabled={busy || !canCreateFolder}><FolderPlus size={16}/><Label>新建文件夹</Label></Dropdown.Item>
                <Dropdown.Item id="settings" textValue="设置"><Settings size={16}/><Label>设置</Label></Dropdown.Item>
              </Dropdown.Menu>
            </ScrollSurface>
          </Dropdown.Popover>
        </Dropdown>}
        <Tooltip content="打开完整收藏库"><Button variant="ghost" size="icon-sm" aria-label="打开完整收藏库" onClick={() => void sendExtensionRequest({ type: "OPEN_MANAGER" })}><Maximize2 size={16} /></Button></Tooltip>
        <Tooltip content="收起菜单 · Esc"><Button variant="ghost" size="icon-sm" aria-label="收起菜单" onClick={() => postToFloatingHost({ type: "FLOAT_CLOSE" })}><X size={16} /></Button></Tooltip>
      </div>
    </header>
    <div className={`floating-body${onboarding ? " floating-onboarding" : ""}`}>{children}</div>
    {!onboarding && composer}
  </div>;
}

import { Button } from "@/ui/components/ui/button";
import type { AppState } from "../../../lib/types";
import {
  ExternalLinkIcon,
  HistoryIcon,
  PlusIcon,
  SettingsIcon,
  StarIcon,
} from "../../components/Icons";

interface LibraryHeaderProps {
  appState: AppState | null;
  hasSnapshot: boolean;
  currentSaved: boolean;
  onCreateFolder: () => void;
  onSaveCurrent: () => void;
  onOpenHistory: () => void;
  onOpenManager: () => void;
  onOpenSettings: () => void;
}

export function LibraryHeader({
  appState,
  hasSnapshot,
  currentSaved,
  onCreateFolder,
  onSaveCurrent,
  onOpenHistory,
  onOpenManager,
  onOpenSettings,
}: LibraryHeaderProps) {
  const auth = appState?.auth;
  const identity = auth?.userEmail || auth?.chromeProfileEmail || "A";
  return (
    <header className="native-header">
      <div className="native-title-row">
        <h1>
          {auth?.signedIn && auth.userName ? (
            <Button
              type="button"
              variant="ghost"
              size="unstyled"
              className="native-title-account"
              title="打开账号与同步设置"
              onClick={onOpenSettings}
            >
              {auth.userAvatarUrl ? (
                <img
                  src={auth.userAvatarUrl}
                  alt=""
                  className="native-title-avatar"
                />
              ) : identity ? (
                <span className="native-title-avatar native-title-avatar-fallback">
                  {identity.slice(0, 1).toUpperCase()}
                </span>
              ) : null}
              我的书签
            </Button>
          ) : (
            "我的书签"
          )}
        </h1>
      </div>
      <div className="native-actions">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="icon-button"
          title="新建文件夹"
          aria-label="新建文件夹"
          onClick={onCreateFolder}
          disabled={!hasSnapshot}
        >
          <PlusIcon />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="icon-button star-button"
          data-saved={currentSaved}
          title={currentSaved ? "管理当前页面收藏" : "添加到收藏"}
          aria-label={currentSaved ? "管理当前页面收藏" : "添加到收藏"}
          onClick={onSaveCurrent}
          disabled={!appState?.activeTab?.url}
        >
          <StarIcon filled={currentSaved} />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="icon-button history-button"
          title="历史会话"
          aria-label="打开历史会话"
          onClick={onOpenHistory}
        >
          <HistoryIcon />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="icon-button"
          title="打开批量整理工作台"
          aria-label="打开批量整理工作台"
          onClick={onOpenManager}
        >
          <ExternalLinkIcon />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="icon-button settings-button"
          title="设置"
          aria-label="打开设置"
          onClick={onOpenSettings}
        >
          <SettingsIcon />
        </Button>
      </div>
      {appState?.libraryScan.state === "running" ? (
        <Button
          variant="ghost"
          type="button"
          className="library-scan-indicator"
          aria-label={`扫描进度 ${appState.libraryScan.processed}/${appState.libraryScan.total}`}
          onClick={onOpenSettings}
        >
          <span
            style={{
              width: `${
                appState.libraryScan.total
                  ? (appState.libraryScan.processed /
                      appState.libraryScan.total) *
                    100
                  : 0
              }%`,
            }}
          />
        </Button>
      ) : null}
    </header>
  );
}

import { lazy, Suspense, useState } from "react";
import { Archive, Settings, X } from "lucide-react";
import { Button } from "@/ui/components/ui/button";
import { AppModal } from "@/ui/components/ui/modal";
import { ArchiveControls } from "../../components/ArchiveControls";
import type { AppState } from "../../../lib/types";
import { restartOnboarding } from "../../../lib/onboarding";
const SettingsPage = lazy(() => import("../../sidepanel/pages/SettingsPage"));
export function ManagerUtilities({ appState, onStateChange, onRestored }: { appState: AppState | null; onStateChange: (state: AppState) => void; onRestored: () => void }) {
  const [opened,setOpened] = useState<"archive" | "settings" | null>(() => new URLSearchParams(location.search).has("archive") ? "archive" : new URLSearchParams(location.search).has("settings") ? "settings" : null);
  const [busy,setBusy] = useState(false), [publicIcons,setPublicIcons] = useState(true);
  return <>
    <div className="manager-utilities">
      <Button variant="ghost" size="icon" aria-label="本地备份与恢复" onClick={() => setOpened("archive")}><Archive size={18}/></Button>
      <Button variant="ghost" size="icon" aria-label="收藏库设置" onClick={() => setOpened("settings")}><Settings size={18}/></Button>
    </div>
    {opened && <AppModal labelledBy="manager-utility-title" className="manager-utility-dialog" busy={busy} onClose={() => setOpened(null)}>
      <header className="manager-utility-header"><h2 id="manager-utility-title">{opened === "archive" ? "本地备份与恢复" : "设置"}</h2><Button variant="ghost" size="icon" aria-label="关闭" disabled={busy} onClick={() => setOpened(null)}><X size={18}/></Button></header>
      {opened === "archive" ? <ArchiveControls onBusyChange={setBusy} onRestored={onRestored}/> : <Suspense fallback={<p role="status">正在打开设置…</p>}><SettingsPage appState={appState} onAppStateChange={onStateChange} onClose={() => setOpened(null)} publicFaviconFallback={publicIcons} onPublicFaviconFallbackChange={setPublicIcons} onRestartOnboarding={() => { void restartOnboarding().then(() => { localStorage.removeItem("aarre:onboarding-done"); return chrome.tabs.create({url:chrome.runtime.getURL("sidepanel.html?onboarding=1")}); }); }}/></Suspense>}
    </AppModal>}
  </>;
}

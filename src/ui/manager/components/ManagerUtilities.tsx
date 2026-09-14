import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { Archive, Settings, X } from "lucide-react";
import { Button } from "@/ui/components/ui/button";
import { AppModal } from "@/ui/components/ui/modal";
import { ArchiveControls } from "../../components/ArchiveControls";
import type { AppState } from "../../../lib/types";
import { getDisplaySettings } from "../../../lib/display-settings";
import { restartOnboarding } from "../../../lib/onboarding";
const SettingsPage = lazy(() => import("../../sidepanel/pages/SettingsPage"));
export type ManagerUtility = "archive" | "settings";
export function ManagerUtilityActions({ onOpen, themeControl }: { onOpen: (kind: ManagerUtility) => void; themeControl?: ReactNode }) {
  return <div className="manager-utilities">
    {themeControl}
    <Button variant="ghost" size="icon" aria-label="本地备份与恢复" onClick={() => onOpen("archive")}><Archive size={18}/></Button>
    <Button variant="ghost" size="icon" aria-label="收藏库设置" onClick={() => onOpen("settings")}><Settings size={18}/></Button>
  </div>;
}

/** Render once outside Tabs: its collection discovery pass also renders children,
 * so portals placed in the tab header can otherwise mount twice on direct links. */
export function ManagerUtilities({ opened, onClose, appState, onStateChange, onRestored }: {
  opened: ManagerUtility | null; onClose: () => void; appState: AppState | null;
  onStateChange: (state: AppState) => void; onRestored: () => void;
}) {
  const [busy,setBusy] = useState(false), [publicIcons,setPublicIcons] = useState(true);
  useEffect(() => {
    if (opened !== "settings") return;
    let active = true;
    void getDisplaySettings().then((settings) => { if (active) setPublicIcons(settings.publicFaviconFallback); }).catch(() => undefined);
    return () => { active = false; };
  }, [opened]);
  if (!opened) return null;
  return <AppModal labelledBy="manager-utility-title" className={`manager-utility-dialog${opened === "settings" ? " manager-settings-dialog" : ""}`} busy={busy} onClose={onClose}>
    <header className="manager-utility-header"><h2 id="manager-utility-title">{opened === "archive" ? "本地备份与恢复" : "设置"}</h2><Button variant="ghost" size="icon" aria-label="关闭" disabled={busy} onClick={onClose}><X size={18}/></Button></header>
    {opened === "archive" ? <ArchiveControls onBusyChange={setBusy} onRestored={onRestored}/> : <Suspense fallback={<p role="status">正在打开设置…</p>}><SettingsPage layout="manager" appState={appState} onAppStateChange={onStateChange} onClose={onClose} publicFaviconFallback={publicIcons} onPublicFaviconFallbackChange={setPublicIcons} onRestartOnboarding={() => { void restartOnboarding().then(() => { localStorage.removeItem("aarre:onboarding-done"); return chrome.tabs.create({url:chrome.runtime.getURL("sidepanel.html?onboarding=1")}); }); }}/></Suspense>}
  </AppModal>;
}

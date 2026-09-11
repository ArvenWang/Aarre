import { useEffect, useState } from "react";
import { getFloatingSettings, saveFloatingSettings, type FloatingSettings } from "../../lib/floating-settings";
import { defaultFloatingPosition } from "../../lib/floating-geometry";
import { getFloatingContext, postToFloatingHost } from "./bridge";
import { Switch } from "@/ui/components/ui/switch";
import { Button } from "@/ui/components/ui/button";
export function FloatingSettingsSection() {
  const [settings, setSettings] = useState<FloatingSettings | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const source = getFloatingContext()?.source.url;
  const host = source ? new URL(source).hostname : null;
  useEffect(() => { void getFloatingSettings().then(setSettings).catch(() => setError("无法读取快捷栏设置，请重试。")); }, []);
  async function save(next: FloatingSettings, hide = false) {
    setBusy(true); setError("");
    try { setSettings(await saveFloatingSettings(next)); if (hide) postToFloatingHost({ type: "FLOAT_HIDE" }); }
    catch { setError("设置未保存，请重试。"); }
    finally { setBusy(false); }
  }
  return <section className="settings-section" aria-labelledby="floating-settings-title">
    <div className="settings-section-heading"><h2 id="floating-settings-title">悬浮菜单</h2></div>
    <div className="settings-toggle-row"><div><strong>显示右侧快捷栏</strong><small>贴在网页右边，可展开菜单或一键收藏当前网页。</small></div>
      <Switch checked={settings?.enabled ?? false} disabled={busy || !settings} label="显示右侧快捷栏" onChange={(enabled) => settings && void save({ ...settings, enabled }, !enabled)} />
    </div>
    {host && settings && <div className="settings-toggle-row"><div><strong>在此网站显示</strong><small>{host}</small></div>
      <Switch checked={!settings.hiddenHosts.includes(host)} disabled={busy} label={`在 ${host} 显示快捷栏`}
        onChange={(visible) => void save({ ...settings, hiddenHosts: visible ? settings.hiddenHosts.filter((item) => item !== host) : [...settings.hiddenHosts, host] }, !visible)} />
    </div>}
    <p className="settings-helper">隐藏后仍可点击浏览器扩展图标，或按 Alt + Shift + B 打开菜单。</p>
    {settings && <div className="floating-settings-actions">
      <Button variant="tertiary" size="sm" disabled={busy} onClick={() => void save({ ...settings, position: defaultFloatingPosition })}>恢复默认宽度</Button>
      {settings.hiddenHosts.length > 0 && <Button variant="ghost" size="sm" disabled={busy} onClick={() => void save({ ...settings, hiddenHosts: [] })}>恢复 {settings.hiddenHosts.length} 个隐藏网站</Button>}
    </div>}
    {error && <p role="alert" className="settings-inline-feedback" data-tone="error">{error}</p>}
  </section>;
}

import { Switch } from "@/ui/components/ui/switch";
import { useEffect, useState } from "react";
import { applyTheme, THEME_CHANGE_EVENT } from "../../../../lib/theme";

interface DisplaySettingsSectionProps {
  publicFaviconFallback: boolean;
  disabled?: boolean;
  onPublicFaviconFallbackChange: (value: boolean) => void;
}

export function DisplaySettingsSection({
  publicFaviconFallback,
  disabled = false,
  onPublicFaviconFallbackChange,
}: DisplaySettingsSectionProps) {
  const [dark, setDark] = useState(() => document.documentElement.dataset.theme === "dark");
  useEffect(() => {
    const sync = () => setDark(document.documentElement.dataset.theme === "dark");
    window.addEventListener(THEME_CHANGE_EVENT, sync);
    return () => window.removeEventListener(THEME_CHANGE_EVENT, sync);
  }, []);
  return (
    <section className="settings-section" aria-labelledby="cover-style-title">
      <div className="settings-section-heading">
        <div>
          <h2 id="cover-style-title">显示</h2>
        </div>
      </div>
      <div className="settings-toggle-row">
        <div><strong>深色模式</strong><small>同时应用于悬浮菜单和完整收藏库。</small></div>
        <Switch checked={dark} label="深色模式" onChange={(value) => { setDark(value); applyTheme(value ? "dark" : "light"); }} />
      </div>
      <div className="settings-toggle-row">
        <div>
          <strong>公共站点图标补全</strong>
          <small>站点图标不可用时，向 Google 或 DuckDuckGo 请求非敏感域名。</small>
        </div>
        <Switch checked={publicFaviconFallback} disabled={disabled}
          label={publicFaviconFallback ? "关闭公共站点图标补全" : "开启公共站点图标补全"}
          onChange={onPublicFaviconFallbackChange} />
      </div>
    </section>
  );
}

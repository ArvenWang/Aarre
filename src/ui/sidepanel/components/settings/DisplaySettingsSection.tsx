import { TabsSubtle, TabsSubtleItem } from "@/ui/components/ui/tabs-subtle";
import { Button } from "@/ui/components/ui/button";
import type { ListCoverStyle } from "../../../../lib/display-settings";

interface DisplaySettingsSectionProps {
  value: ListCoverStyle;
  publicFaviconFallback: boolean;
  disabled?: boolean;
  onChange: (value: ListCoverStyle) => void;
  onPublicFaviconFallbackChange: (value: boolean) => void;
}

export function DisplaySettingsSection({
  value,
  publicFaviconFallback,
  disabled = false,
  onChange,
  onPublicFaviconFallbackChange,
}: DisplaySettingsSectionProps) {
  return (
    <section className="settings-section" aria-labelledby="cover-style-title">
      <div className="settings-section-heading">
        <div>
          <h2 id="cover-style-title">显示</h2>
        </div>
      </div>
      <TabsSubtle
        selectedIndex={value === "site" ? 0 : 1}
        onSelect={(index) => onChange(index === 0 ? "site" : "page")}
        equalWidth
        className="settings-provider-tabs settings-cover-tabs"
        aria-label="列表封面风格"
      >
        <TabsSubtleItem index={0} label="站点标识" className="settings-provider-tab" />
        <TabsSubtleItem index={1} label="页面封面" className="settings-provider-tab" />
      </TabsSubtle>
      <div className="settings-toggle-row">
        <div>
          <strong>公共站点图标补全</strong>
          <small>站点自身图标不可用时，将非敏感域名发送给 Google 或 DuckDuckGo。</small>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="unstyled"
          className="protection-switch"
          role="switch"
          aria-checked={publicFaviconFallback}
          aria-label={publicFaviconFallback ? "关闭公共站点图标补全" : "开启公共站点图标补全"}
          data-state={publicFaviconFallback ? "checked" : "unchecked"}
          disabled={disabled}
          onClick={() => onPublicFaviconFallbackChange(!publicFaviconFallback)}
        >
          <span aria-hidden="true" />
        </Button>
      </div>
    </section>
  );
}

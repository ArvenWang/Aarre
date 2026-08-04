import { Button } from "@/ui/components/ui/button";

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
  return (
    <section className="settings-section" aria-labelledby="cover-style-title">
      <div className="settings-section-heading">
        <div>
          <h2 id="cover-style-title">显示</h2>
        </div>
      </div>
      <div className="settings-toggle-row">
        <div>
          <strong>公共站点图标补全</strong>
          <small>站点图标不可用时，向 Google 或 DuckDuckGo 请求非敏感域名。</small>
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

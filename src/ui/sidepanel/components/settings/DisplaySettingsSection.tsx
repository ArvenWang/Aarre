import { TabsSubtle, TabsSubtleItem } from "@/ui/components/ui/tabs-subtle";
import type { ListCoverStyle } from "../../../../lib/display-settings";

interface DisplaySettingsSectionProps {
  value: ListCoverStyle;
  onChange: (value: ListCoverStyle) => void;
}

export function DisplaySettingsSection({
  value,
  onChange,
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
    </section>
  );
}

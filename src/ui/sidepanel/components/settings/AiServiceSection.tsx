import { Button } from "@/ui/components/ui/button";
import { TabsSubtle, TabsSubtleItem } from "@/ui/components/ui/tabs-subtle";
import { AI_PROVIDER_PRESETS, getAiProviderPreset } from "../../../../lib/settings";
import type { AiProviderId, AiSettingsStatus } from "../../../../lib/types";
import { FluidInput } from "@/ui/components/ui/input";

type Feedback = { tone: "error" | "success"; message: string } | null;

interface AiServiceSectionProps {
  settings: AiSettingsStatus | null;
  provider: AiProviderId;
  model: string;
  apiKey: string;
  action: string;
  feedback: Feedback;
  onProviderChange: (provider: AiProviderId, model: string) => void;
  onModelChange: (model: string) => void;
  onApiKeyChange: (apiKey: string) => void;
  onSubmit: () => void;
}

export function AiServiceSection({
  settings,
  provider,
  model,
  apiKey,
  action,
  feedback,
  onProviderChange,
  onModelChange,
  onApiKeyChange,
  onSubmit,
}: AiServiceSectionProps) {
  const preset = getAiProviderPreset(provider);
  const configured = Boolean(settings?.configuredProviders.includes(provider));
  const canSave = Boolean(model.trim()) && (Boolean(apiKey.trim()) || configured);
  return (
    <form
      className="settings-section"
      aria-labelledby="ai-settings-title"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div className="settings-section-heading">
        <div>
          <h2 id="ai-settings-title">AI 服务</h2>
        </div>
        <span className="settings-status" data-active={configured}>
          {configured ? "已配置" : "需要 API Key"}
        </span>
      </div>
      <TabsSubtle
        selectedIndex={Math.max(0, AI_PROVIDER_PRESETS.findIndex((item) => item.id === provider))}
        onSelect={(index) => {
          const next = AI_PROVIDER_PRESETS[index];
          if (next) onProviderChange(next.id, settings?.providerModels[next.id] || next.defaultModel);
        }}
        equalWidth
        className="settings-provider-tabs"
        aria-label="AI 服务商"
      >
        {AI_PROVIDER_PRESETS.map((item, index) => (
          <TabsSubtleItem key={item.id} index={index} label={item.name} className="settings-provider-tab" />
        ))}
      </TabsSubtle>
      <p className="settings-provider-help">
        {settings?.provider === provider && settings.apiKeyConfigured && settings.apiKeySuffix
          ? `已保存 Key：•••• ${settings.apiKeySuffix}`
          : ""}
      </p>
      <label className="settings-field">
        <span>模型</span>
        <FluidInput type="text" value={model} onChange={(event) => onModelChange(event.target.value)} autoComplete="off" spellCheck={false} placeholder={preset.defaultModel} />
      </label>
      <label className="settings-field">
        <span>API Key</span>
        <FluidInput
          type="password"
          value={apiKey}
          onChange={(event) => onApiKeyChange(event.target.value)}
          autoComplete="off"
          spellCheck={false}
          placeholder={configured ? "输入新的 Key 可替换当前配置" : preset.apiKeyPlaceholder}
        />
      </label>
      <div className="settings-field-footer">
        <p>Key 仅保存在当前 Chrome 配置文件。</p>
        <Button variant="primary" size="sm" type="submit" disabled={!canSave || Boolean(action)}>
          {action === "save-key" ? "正在验证…" : "验证并保存"}
        </Button>
      </div>
      {feedback ? (
        <div className="settings-notice settings-inline-feedback" data-tone={feedback.tone} role={feedback.tone === "error" ? "alert" : "status"}>
          {feedback.message}
        </div>
      ) : null}
    </form>
  );
}

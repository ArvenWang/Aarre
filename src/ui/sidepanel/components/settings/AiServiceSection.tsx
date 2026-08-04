import { useEffect, useRef, useState } from "react";
import { Button } from "@/ui/components/ui/button";
import { AI_PROVIDER_PRESETS, getAiProviderPreset } from "../../../../lib/settings";
import type { AiProviderId, AiSettingsStatus } from "../../../../lib/types";
import { FluidInput } from "@/ui/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/ui/components/ui/select";

type Feedback = { tone: "error" | "success"; message: string } | null;

interface AiServiceSectionProps {
  settings: AiSettingsStatus | null;
  provider: AiProviderId;
  model: string;
  apiKey: string;
  action: string;
  feedback: Feedback;
  onProviderChange: (provider: AiProviderId, model: string) => void;
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
  onApiKeyChange,
  onSubmit,
}: AiServiceSectionProps) {
  const [editingKey, setEditingKey] = useState(false);
  const keyInputRef = useRef<HTMLInputElement | null>(null);
  const preset = getAiProviderPreset(provider);
  const configured = Boolean(settings?.configuredProviders.includes(provider));
  const showMaskedKey = configured && !editingKey;
  const canSave = Boolean(model.trim() && apiKey.trim());

  useEffect(() => {
    setEditingKey(false);
  }, [provider, settings]);

  function beginEditingKey() {
    setEditingKey(true);
    onApiKeyChange("");
    window.requestAnimationFrame(() => keyInputRef.current?.focus());
  }

  return (
    <form
      className="settings-section"
      aria-labelledby="ai-settings-title"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div className="settings-section-heading"><div><h2 id="ai-settings-title">AI 服务</h2></div></div>
      <label className="settings-field settings-model-field">
        <span>模型与服务</span>
        <Select
          value={provider}
          disabled={showMaskedKey || Boolean(action)}
          onValueChange={(value) => {
            const next = AI_PROVIDER_PRESETS.find((item) => item.id === value);
          if (next) {
            setEditingKey(false);
            onProviderChange(next.id, settings?.providerModels[next.id] || next.defaultModel);
          }
          }}
        >
          <SelectTrigger
            className="settings-model-select-trigger"
            aria-label="选择 AI 服务和模型"
            placeholder="选择 AI 服务和模型"
          />
          <SelectContent className="settings-model-select-content">
            {AI_PROVIDER_PRESETS.map((item, index) => (
              <SelectItem key={item.id} value={item.id} index={index}>
                {item.name} · {settings?.providerModels[item.id] || item.defaultModel}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      <label className="settings-field">
        <span>API Key</span>
        <FluidInput
          ref={keyInputRef}
          type="password"
          value={showMaskedKey ? `••••••••••••${settings?.apiKeySuffix || ""}` : apiKey}
          readOnly={showMaskedKey}
          onChange={(event) => onApiKeyChange(event.target.value)}
          autoComplete="off"
          spellCheck={false}
          placeholder={configured ? "输入新的 Key 替换当前配置" : preset.apiKeyPlaceholder}
        />
      </label>
      <div className="settings-field-footer">
        <p>Key 仅保存在当前 Chrome 配置文件。</p>
        {showMaskedKey ? (
          <Button variant="tertiary" size="sm" type="button" disabled={Boolean(action)} onClick={beginEditingKey}>
            编辑
          </Button>
        ) : (
          <Button variant="primary" size="sm" type="submit" disabled={!canSave || Boolean(action)}>
            {action === "save-key" ? "正在验证…" : "验证并保存"}
          </Button>
        )}
      </div>
      {feedback ? (
        <div className="settings-notice settings-inline-feedback" data-tone={feedback.tone} role={feedback.tone === "error" ? "alert" : "status"}>
          {feedback.message}
        </div>
      ) : null}
    </form>
  );
}

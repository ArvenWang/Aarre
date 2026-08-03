import { useState } from "react";
import "../../sidepanel-lazy.css";
import { Button } from "@/ui/components/ui/button";
import { TabsSubtle, TabsSubtleItem } from "@/ui/components/ui/tabs-subtle";
import { FluidInput } from "@/ui/components/ui/input";
import { StarIcon } from "../../components/Icons";
import { AI_PROVIDER_PRESETS, getAiProviderPreset } from "../../../lib/settings";
import { estimateScanTokens } from "../../../lib/ai-cost";
import { requestPageSnapshotPermission } from "../../../lib/display-settings";
import { completeOnboarding } from "../../../lib/onboarding";
import { sendExtensionRequest } from "../../../lib/messages";
import type { AiProviderId } from "../../../lib/types";
interface OnboardingPageProps {
  resourceCount: number;
  initialAiConfigured: boolean;
  onComplete: (skipped: boolean, aiConfigured: boolean) => void;
}

function OnboardingPage({
  resourceCount,
  initialAiConfigured,
  onComplete,
}: OnboardingPageProps) {
  const [step, setStep] = useState(0);
  const [provider, setProvider] = useState<AiProviderId>("gemini");
  const preset = getAiProviderPreset(provider);
  const [models, setModels] = useState<Record<AiProviderId, string>>({
    gemini: getAiProviderPreset("gemini").defaultModel,
    openai: getAiProviderPreset("openai").defaultModel,
    deepseek: getAiProviderPreset("deepseek").defaultModel,
  });
  const [apiKey, setApiKey] = useState("");
  const [configured, setConfigured] = useState(initialAiConfigured);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const estimatedMinutes = Math.max(1, Math.ceil(resourceCount / 60));
  const estimatedTokens = estimateScanTokens(resourceCount);

  async function saveProvider() {
    if (!apiKey.trim() || busy) return;
    setBusy("provider");
    setError("");
    try {
      await sendExtensionRequest({
        type: "SAVE_AI_SETTINGS",
        payload: {
          provider,
          model: models[provider],
          apiKey: apiKey.trim(),
        },
      });
      setConfigured(true);
      setApiKey("");
      setStep(2);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "API Key 验证失败");
    } finally {
      setBusy("");
    }
  }

  async function finish(skipped: boolean, scan: boolean) {
    if (busy) return;
    setBusy(scan ? "scan" : "finish");
    setError("");
    try {
      if (scan) {
        const granted = await requestPageSnapshotPermission();
        if (!granted) {
          throw new Error("未获得网页读取权限，尚未开始扫描。");
        }
        await sendExtensionRequest({
          type: "START_LIBRARY_SCAN",
          force: false,
        });
      }
      await completeOnboarding(skipped);
      onComplete(skipped, configured);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "引导操作失败");
    } finally {
      setBusy("");
    }
  }

  return (
    <main className="native-panel onboarding-panel">
      <header>
        <span className="eyebrow">AARRE · {step + 1}/3</span>
        <Button
          variant="ghost"
          type="button"
 className="text-button"
          disabled={Boolean(busy)}
          onClick={() => void finish(true, false)}
        >
          跳过引导
        </Button>
      </header>
      <section className="onboarding-card">
        {step === 0 ? (
          <>
            <div className="onboarding-mark">
              <StarIcon filled />
            </div>
            <h1>你的 Chrome 书签，原样保留</h1>
            <p>
              Aarre 直接读取你已有的 Chrome
              原生书签，不需要导入，也不会偷偷移动或删除。Chrome
              始终是唯一事实来源。
            </p>
            <div className="onboarding-facts">
              <span>已发现 {resourceCount.toLocaleString("zh-CN")} 条书签</span>
              <span>所有写操作先确认，并可在 30 天内撤销</span>
              <span>新收藏和正常打开的缺图旧收藏会在本机补齐真实预览快照</span>
            </div>
            <Button
              variant="primary"
              type="button"

              onClick={() => setStep(1)}
            >
              继续
            </Button>
          </>
        ) : step === 1 ? (
          <form
            className="onboarding-provider-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (configured && !apiKey.trim()) {
                setStep(2);
              } else {
                void saveProvider();
              }
            }}
          >
            <h1>连接你自己的 AI 服务</h1>
            <p>
              API Key 只保存在当前 Chrome 配置文件中，扩展直接调用服务商；Aarre
              不经手你的 Key。
            </p>
            <TabsSubtle
              selectedIndex={Math.max(
                0,
                AI_PROVIDER_PRESETS.findIndex((item) => item.id === provider),
              )}
              onSelect={(index) => {
                const next = AI_PROVIDER_PRESETS[index];
                if (next) setProvider(next.id);
              }}
              equalWidth
              className="settings-provider-tabs"
              aria-label="AI 服务商"
            >
              {AI_PROVIDER_PRESETS.map((item, index) => (
                <TabsSubtleItem
                  key={item.id}
                  index={index}
                  label={item.name}
                  className="settings-provider-tab"
                />
              ))}
            </TabsSubtle>
            <label className="settings-field">
              <span>模型</span>
              <FluidInput
                value={models[provider]}
                onChange={(event) =>
                  setModels((current) => ({
                    ...current,
                    [provider]: event.target.value,
                  }))
                }
              />
            </label>
            <label className="settings-field">
              <span>{preset.name} API Key</span>
              <FluidInput
                type="password"
                value={apiKey}
                autoComplete="off"
                placeholder={preset.apiKeyPlaceholder}
                onChange={(event) => setApiKey(event.target.value)}
              />
            </label>
            {error ? (
              <div className="settings-notice" data-tone="error" role="alert">
                {error}
              </div>
            ) : null}
            <div className="onboarding-actions">
              <Button
                variant="ghost"
                type="button"

                disabled={Boolean(busy)}
                onClick={() => setStep(2)}
              >
                先跳过，只管理书签
              </Button>
              <Button
                variant="primary"
                type="submit"

                disabled={
                  (!configured && !apiKey.trim()) ||
                  !models[provider].trim() ||
                  Boolean(busy)
                }
              >
                {busy === "provider"
                  ? "正在验证…"
                  : configured && !apiKey.trim()
                    ? "使用现有配置继续"
                    : "验证并继续"}
              </Button>
            </div>
          </form>
        ) : (
          <>
            <h1>让收藏变得可搜索</h1>
            <p>
              扫描会为公开网页补充清晰站点标识与页面封面
              {configured ? "，并生成摘要、标签和检索别名" : ""}。
            </p>
            <div className="onboarding-estimate">
              <strong>{resourceCount.toLocaleString("zh-CN")} 条</strong>
              <span>预计约 {estimatedMinutes} 分钟</span>
              {configured ? (
                <span>
                  预计用量 输入约{" "}
                  {estimatedTokens.estimatedInputTokens.toLocaleString()} ·
                  输出约{" "}
                  {estimatedTokens.estimatedOutputTokens.toLocaleString()}
                </span>
              ) : (
                <span>未连接 AI，本轮不会消耗 token</span>
              )}
            </div>
            <p className="onboarding-privacy">
              用量取决于服务商、模型和网页长度，以服务商实际返回为准。内网、银行、支付和医疗站点不处理；新收藏或正常打开的缺图旧收藏会生成页面快照，已有截图最多每
              7 天静默刷新一次，并且只保存在本机。
            </p>
            {error ? (
              <div className="settings-notice" data-tone="error">
                {error}
              </div>
            ) : null}
            <div className="onboarding-actions">
              <Button
                variant="ghost"
                type="button"

                disabled={Boolean(busy)}
                onClick={() => void finish(false, false)}
              >
                以后再说
              </Button>
              <Button
                variant="primary"
                type="button"

                disabled={!resourceCount || Boolean(busy)}
                onClick={() => void finish(false, true)}
              >
                {busy === "scan" ? "正在启动…" : "现在扫描"}
              </Button>
            </div>
          </>
        )}
      </section>
    </main>
  );
}

export default OnboardingPage;

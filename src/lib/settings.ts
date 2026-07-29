import type {
  AiProviderId,
  AiProviderPreset,
  AiSettingsStatus,
  SaveAiSettingsInput
} from "./types";

const AI_SETTINGS_KEY = "bookmark-layer:ai-settings";

export const AI_PROVIDER_PRESETS: readonly AiProviderPreset[] = [
  {
    id: "gemini",
    name: "Gemini",
    defaultModel: "gemini-2.5-flash-lite",
    description: "填写自己的 Key 后，由扩展直接调用 Gemini 生成摘要与标签。",
    apiKeyPlaceholder: "输入 Gemini API Key"
  },
  {
    id: "openai",
    name: "OpenAI",
    defaultModel: "gpt-5.6-luna",
    description: "适合快速生成摘要、标签与结构化信息。",
    apiKeyPlaceholder: "输入 OpenAI API Key"
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    defaultModel: "deepseek-v4-flash",
    description: "适合中文内容整理，由扩展直接调用 DeepSeek 生成摘要与标签。",
    apiKeyPlaceholder: "输入 DeepSeek API Key"
  }
] as const;

interface StoredAiSettings {
  provider?: AiProviderId;
  geminiApiKey?: string;
  apiKeys?: Partial<Record<AiProviderId, string>>;
  models?: Partial<Record<AiProviderId, string>>;
}

function normalizeApiKey(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isAiProviderId(value: unknown): value is AiProviderId {
  return AI_PROVIDER_PRESETS.some((preset) => preset.id === value);
}

export function getAiProviderPreset(
  provider: AiProviderId
): AiProviderPreset {
  return (
    AI_PROVIDER_PRESETS.find((preset) => preset.id === provider) ||
    AI_PROVIDER_PRESETS[0]
  );
}

async function getStoredAiSettings(): Promise<StoredAiSettings> {
  const result = await chrome.storage.local.get(AI_SETTINGS_KEY);
  const value = result[AI_SETTINGS_KEY];
  return value && typeof value === "object"
    ? (value as StoredAiSettings)
    : {};
}

function providerApiKey(
  settings: StoredAiSettings,
  provider: AiProviderId
): string {
  const migratedGeminiKey =
    provider === "gemini" ? settings.geminiApiKey : undefined;
  return normalizeApiKey(settings.apiKeys?.[provider] || migratedGeminiKey);
}

function providerModel(
  settings: StoredAiSettings,
  provider: AiProviderId
): string {
  return (
    normalizeApiKey(settings.models?.[provider]) ||
    getAiProviderPreset(provider).defaultModel
  );
}

export async function getGeminiApiKey(): Promise<string | undefined> {
  const settings = await getStoredAiSettings();
  return providerApiKey(settings, "gemini") || undefined;
}

export async function getAiRuntimeSettings(): Promise<{
  provider: AiProviderId;
  model: string;
  apiKey?: string;
}> {
  const settings = await getStoredAiSettings();
  const provider = isAiProviderId(settings.provider)
    ? settings.provider
    : "gemini";
  const apiKey = providerApiKey(settings, provider);
  return {
    provider,
    model: providerModel(settings, provider),
    apiKey: apiKey || undefined
  };
}

export async function getAiSettingsStatus(): Promise<AiSettingsStatus> {
  const stored = await getStoredAiSettings();
  const provider = isAiProviderId(stored.provider)
    ? stored.provider
    : "gemini";
  const preset = getAiProviderPreset(provider);
  const key = providerApiKey(stored, provider);
  const configuredProviders = AI_PROVIDER_PRESETS.flatMap((item) =>
    providerApiKey(stored, item.id) ? [item.id] : []
  );
  const providerModels = Object.fromEntries(
    AI_PROVIDER_PRESETS.map((item) => [
      item.id,
      providerModel(stored, item.id)
    ])
  ) as Record<AiProviderId, string>;
  return {
    provider,
    providerName: preset.name,
    model: providerModel(stored, provider),
    apiKeyConfigured: Boolean(key),
    apiKeySuffix: key ? key.slice(-4) : undefined,
    configuredProviders,
    providerModels,
    usingBuiltInService: false
  };
}

async function apiErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as {
      error?: { message?: string };
      message?: string;
    };
    return body.error?.message || body.message || "";
  } catch {
    return "";
  }
}

function modelPath(model: string): string {
  return encodeURIComponent(model.trim());
}

export async function validateAiApiKey(
  provider: AiProviderId,
  apiKey: string,
  model: string
): Promise<void> {
  const normalized = normalizeApiKey(apiKey);
  const preset = getAiProviderPreset(provider);
  if (normalized.length < 12 || normalized.length > 512) {
    throw new Error(`请输入完整的 ${preset.name} API Key。`);
  }

  const request: { url: string; headers: Record<string, string> } =
    provider === "gemini"
      ? {
          url: `https://generativelanguage.googleapis.com/v1beta/models/${modelPath(model)}`,
          headers: { "x-goog-api-key": normalized }
        }
      : {
          url:
            provider === "openai"
              ? `https://api.openai.com/v1/models/${modelPath(model)}`
              : "https://api.deepseek.com/models",
          headers: { Authorization: `Bearer ${normalized}` }
        };
  const response = await fetch(request.url, { headers: request.headers });

  if (!response.ok) {
    const detail = await apiErrorMessage(response);
    if (
      response.status === 400 ||
      response.status === 401 ||
      response.status === 403
    ) {
      throw new Error(`这个 ${preset.name} API Key 无效或没有访问权限。`);
    }
    throw new Error(detail || "暂时无法验证 API Key，请稍后重试。");
  }

  if (provider === "deepseek") {
    const body = (await response.json()) as {
      data?: Array<{ id?: string }>;
    };
    const available = body.data?.some((item) => item.id === model);
    if (body.data?.length && !available) {
      throw new Error(
        `Key 有效，但当前账号无法使用模型 ${model}。请修改模型后重试。`
      );
    }
  }
}

export async function saveAiSettings(
  input: SaveAiSettingsInput
): Promise<AiSettingsStatus> {
  const preset = getAiProviderPreset(input.provider);
  const model = input.model.trim();
  if (
    model.length < 2 ||
    model.length > 128 ||
    !/^[a-zA-Z0-9._:/-]+$/.test(model)
  ) {
    throw new Error("请输入有效的模型名称。");
  }

  const stored = await getStoredAiSettings();
  const providedKey = normalizeApiKey(input.apiKey);
  const existingKey = providerApiKey(stored, input.provider);
  const apiKey = providedKey || existingKey;
  if (!apiKey) {
    throw new Error(`请先填写 ${preset.name} API Key。`);
  }
  await validateAiApiKey(input.provider, apiKey, model);

  await chrome.storage.local.set({
    [AI_SETTINGS_KEY]: {
      provider: input.provider,
      apiKeys: {
        ...stored.apiKeys,
        ...(stored.geminiApiKey
          ? { gemini: normalizeApiKey(stored.geminiApiKey) }
          : {}),
        ...(apiKey ? { [input.provider]: apiKey } : {})
      },
      models: {
        ...stored.models,
        [input.provider]: model
      }
    } satisfies StoredAiSettings
  });
  return getAiSettingsStatus();
}

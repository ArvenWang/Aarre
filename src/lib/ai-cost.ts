import type {
  AiProviderId,
  AiTokenUsage,
  AiUsageStats
} from "./types";

export const AI_PRICE_UPDATED_AT = "2026-07-30";
export const ESTIMATED_USD_TO_CNY = 7.2;

interface TokenPrice {
  inputUsdPerMillion: number;
  cachedInputUsdPerMillion: number;
  outputUsdPerMillion: number;
}

const DEFAULT_USAGE_PER_RESOURCE: AiTokenUsage = {
  inputTokens: 900,
  outputTokens: 180,
  cachedInputTokens: 0,
  estimated: true
};

export function tokenPriceForModel(
  provider: AiProviderId,
  model: string
): TokenPrice | null {
  const normalized = model.trim().toLocaleLowerCase();
  if (
    provider === "gemini" &&
    normalized.startsWith("gemini-2.5-flash-lite")
  ) {
    return {
      inputUsdPerMillion: 0.1,
      cachedInputUsdPerMillion: 0.01,
      outputUsdPerMillion: 0.4
    };
  }
  if (
    provider === "openai" &&
    normalized.startsWith("gpt-5.6-luna")
  ) {
    return {
      inputUsdPerMillion: 1,
      cachedInputUsdPerMillion: 0.1,
      outputUsdPerMillion: 6
    };
  }
  if (
    provider === "deepseek" &&
    (normalized === "deepseek-v4-flash" ||
      normalized === "deepseek-chat" ||
      normalized === "deepseek-reasoner")
  ) {
    return {
      inputUsdPerMillion: 0.14,
      cachedInputUsdPerMillion: 0.0028,
      outputUsdPerMillion: 0.28
    };
  }
  return null;
}

export function costCnyForUsage(
  provider: AiProviderId,
  model: string,
  usage: AiTokenUsage
): number | null {
  const price = tokenPriceForModel(provider, model);
  if (!price) return null;
  const cached = Math.min(
    Math.max(0, usage.cachedInputTokens),
    Math.max(0, usage.inputTokens)
  );
  const uncached = Math.max(0, usage.inputTokens - cached);
  const costUsd =
    (uncached / 1_000_000) * price.inputUsdPerMillion +
    (cached / 1_000_000) * price.cachedInputUsdPerMillion +
    (Math.max(0, usage.outputTokens) / 1_000_000) *
      price.outputUsdPerMillion;
  return Number((costUsd * ESTIMATED_USD_TO_CNY).toFixed(4));
}

export function estimateScanCost(
  count: number,
  provider: AiProviderId,
  model: string,
  concurrency = 4
): {
  estimatedMinutes: number;
  estimatedCostCny: number | null;
  pricingUpdatedAt: string;
} {
  const safeCount = Math.max(0, Math.floor(count));
  const usage: AiTokenUsage = {
    ...DEFAULT_USAGE_PER_RESOURCE,
    inputTokens: DEFAULT_USAGE_PER_RESOURCE.inputTokens * safeCount,
    outputTokens: DEFAULT_USAGE_PER_RESOURCE.outputTokens * safeCount
  };
  return {
    estimatedMinutes: safeCount
      ? Math.max(1, Math.ceil((safeCount * 18) / (60 * concurrency)))
      : 0,
    estimatedCostCny: costCnyForUsage(provider, model, usage),
    pricingUpdatedAt: AI_PRICE_UPDATED_AT
  };
}

export function emptyAiUsageStats(at = new Date()): AiUsageStats {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    estimatedTokens: 0,
    estimatedCostCny: 0,
    scanCount: 0,
    priceUpdatedAt: AI_PRICE_UPDATED_AT,
    updatedAt: at.toISOString()
  };
}


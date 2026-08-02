import {
  AI_PRICE_UPDATED_AT,
  costCnyForUsage,
  emptyAiUsageStats
} from "./ai-cost";
import type {
  AiProviderId,
  AiTokenUsage,
  AiUsageStats
} from "./types";

const AI_USAGE_KEY = "aarre:ai-usage:v1";

function nonNegativeNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, value)
    : 0;
}

export async function getAiUsageStats(): Promise<AiUsageStats> {
  const stored = (await chrome.storage.local.get(AI_USAGE_KEY))[
    AI_USAGE_KEY
  ] as Partial<AiUsageStats> | undefined;
  const empty = emptyAiUsageStats();
  return {
    inputTokens: nonNegativeNumber(stored?.inputTokens),
    outputTokens: nonNegativeNumber(stored?.outputTokens),
    cachedInputTokens: nonNegativeNumber(stored?.cachedInputTokens),
    estimatedTokens: nonNegativeNumber(stored?.estimatedTokens),
    estimatedCostCny: nonNegativeNumber(stored?.estimatedCostCny),
    scanCount: Math.floor(nonNegativeNumber(stored?.scanCount)),
    priceUpdatedAt:
      typeof stored?.priceUpdatedAt === "string"
        ? stored.priceUpdatedAt
        : empty.priceUpdatedAt,
    updatedAt:
      typeof stored?.updatedAt === "string"
        ? stored.updatedAt
        : empty.updatedAt
  };
}

export async function addScanAiUsage(
  provider: AiProviderId,
  model: string,
  usage: AiTokenUsage
): Promise<AiUsageStats> {
  const current = await getAiUsageStats();
  const next: AiUsageStats = {
    inputTokens: current.inputTokens + usage.inputTokens,
    outputTokens: current.outputTokens + usage.outputTokens,
    cachedInputTokens:
      current.cachedInputTokens + usage.cachedInputTokens,
    estimatedTokens:
      current.estimatedTokens +
      (usage.estimated
        ? usage.inputTokens + usage.outputTokens
        : 0),
    estimatedCostCny: Number(
      (
        current.estimatedCostCny +
        (costCnyForUsage(provider, model, usage) || 0)
      ).toFixed(4)
    ),
    scanCount: current.scanCount + 1,
    priceUpdatedAt: AI_PRICE_UPDATED_AT,
    updatedAt: new Date().toISOString()
  };
  await chrome.storage.local.set({ [AI_USAGE_KEY]: next });
  return next;
}

export async function mergeAiUsageStats(
  incoming: Partial<AiUsageStats>
): Promise<AiUsageStats> {
  const current = await getAiUsageStats();
  const next: AiUsageStats = {
    inputTokens: Math.max(current.inputTokens, nonNegativeNumber(incoming.inputTokens)),
    outputTokens: Math.max(current.outputTokens, nonNegativeNumber(incoming.outputTokens)),
    cachedInputTokens: Math.max(
      current.cachedInputTokens,
      nonNegativeNumber(incoming.cachedInputTokens)
    ),
    estimatedTokens: Math.max(
      current.estimatedTokens,
      nonNegativeNumber(incoming.estimatedTokens)
    ),
    estimatedCostCny: Math.max(
      current.estimatedCostCny,
      nonNegativeNumber(incoming.estimatedCostCny)
    ),
    scanCount: Math.max(current.scanCount, Math.floor(nonNegativeNumber(incoming.scanCount))),
    priceUpdatedAt:
      typeof incoming.priceUpdatedAt === "string"
        ? incoming.priceUpdatedAt
        : current.priceUpdatedAt,
    updatedAt:
      typeof incoming.updatedAt === "string" && incoming.updatedAt > current.updatedAt
        ? incoming.updatedAt
        : current.updatedAt
  };
  await chrome.storage.local.set({ [AI_USAGE_KEY]: next });
  return next;
}

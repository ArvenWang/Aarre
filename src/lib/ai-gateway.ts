import type {
  AiEntitlement,
  AiProviderId,
  AiTokenUsage,
  UserTier
} from "./types";

const ENTITLEMENT_KEY = "aarre:ai-entitlement:v1";
const GATEWAY_USAGE_KEY = "aarre:ai-gateway-usage:v1";

interface StoredEntitlement {
  tier?: UserTier;
  monthlyTokenQuota?: number | null;
}

export interface GatewayUsage {
  period: string;
  tokens: number;
  operations: Record<string, number>;
}

function currentPeriod(at = new Date()): string {
  return at.toISOString().slice(0, 7);
}

function validTier(value: unknown): value is UserTier {
  return value === "byok" || value === "free" || value === "pro";
}

export async function getAiGatewayUsage(): Promise<GatewayUsage> {
  const period = currentPeriod();
  const stored = (await chrome.storage.local.get(GATEWAY_USAGE_KEY))[
    GATEWAY_USAGE_KEY
  ] as Partial<GatewayUsage> | undefined;
  if (stored?.period !== period) {
    return { period, tokens: 0, operations: {} };
  }
  return {
    period,
    tokens:
      typeof stored.tokens === "number" && Number.isFinite(stored.tokens)
        ? Math.max(0, stored.tokens)
        : 0,
    operations:
      stored.operations && typeof stored.operations === "object"
        ? stored.operations
        : {}
  };
}

export async function getAiEntitlement(): Promise<AiEntitlement> {
  const [stored, usage] = await Promise.all([
    chrome.storage.local.get(ENTITLEMENT_KEY),
    getAiGatewayUsage()
  ]);
  const value = stored[ENTITLEMENT_KEY] as
    | StoredEntitlement
    | undefined;
  const tier = validTier(value?.tier) ? value.tier : "byok";
  const quota =
    value?.monthlyTokenQuota === null ||
    (typeof value?.monthlyTokenQuota === "number" &&
      Number.isFinite(value.monthlyTokenQuota) &&
      value.monthlyTokenQuota >= 0)
      ? value.monthlyTokenQuota
      : null;
  return {
    tier,
    monthlyTokenQuota: quota,
    usedTokensThisMonth: usage.tokens,
    period: usage.period,
    source: "local"
  };
}

async function assertQuotaAvailable(): Promise<AiEntitlement> {
  const entitlement = await getAiEntitlement();
  if (
    entitlement.monthlyTokenQuota !== null &&
    entitlement.usedTokensThisMonth >= entitlement.monthlyTokenQuota
  ) {
    throw new Error("本月 AI 配额已用完，请调整方案或下月再试。");
  }
  return entitlement;
}

async function recordGatewayUsage(
  operation: string,
  usage: AiTokenUsage
): Promise<void> {
  if (typeof chrome.storage.local.set !== "function") return;
  const current = await getAiGatewayUsage();
  const tokens = Math.max(
    0,
    usage.inputTokens + usage.outputTokens
  );
  await chrome.storage.local.set({
    [GATEWAY_USAGE_KEY]: {
      period: current.period,
      tokens: current.tokens + tokens,
      operations: {
        ...current.operations,
        [operation]: (current.operations[operation] || 0) + 1
      }
    } satisfies GatewayUsage
  });
}

export async function runAiGatewayCall<
  TResult extends { usage: AiTokenUsage }
>(input: {
  provider: AiProviderId;
  model: string;
  operation: "enrichment" | "agent" | "report";
  call: () => Promise<TResult>;
}): Promise<TResult> {
  await assertQuotaAvailable();
  const result = await input.call();
  await recordGatewayUsage(input.operation, result.usage);
  return result;
}

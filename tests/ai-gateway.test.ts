import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getAiEntitlement,
  runAiGatewayCall
} from "../src/lib/ai-gateway";

const values = new Map<string, unknown>();

beforeEach(() => {
  values.clear();
  vi.stubGlobal("chrome", {
    storage: {
      local: {
        get: async (key: string) => ({ [key]: values.get(key) }),
        set: async (input: Record<string, unknown>) => {
          for (const [key, value] of Object.entries(input)) {
            values.set(key, value);
          }
        }
      }
    }
  });
});

describe("AI gateway", () => {
  it("默认是 BYOK 层，并为未来配额保留统一检查点", async () => {
    expect(await getAiEntitlement()).toEqual(
      expect.objectContaining({
        tier: "byok",
        monthlyTokenQuota: null,
        source: "local"
      })
    );
    await runAiGatewayCall({
      provider: "gemini",
      model: "gemini-2.5-flash-lite",
      operation: "enrichment",
      call: async () => ({
        content: "{}",
        usage: {
          inputTokens: 100,
          outputTokens: 20,
          cachedInputTokens: 0,
          estimated: false
        }
      })
    });
    expect((await getAiEntitlement()).usedTokensThisMonth).toBe(120);
  });

  it("达到预留配额后会在服务商请求前拒绝", async () => {
    values.set("aarre:ai-entitlement:v1", {
      tier: "free",
      monthlyTokenQuota: 100
    });
    values.set("aarre:ai-gateway-usage:v1", {
      period: new Date().toISOString().slice(0, 7),
      tokens: 100,
      operations: {}
    });
    const call = vi.fn();
    await expect(
      runAiGatewayCall({
        provider: "openai",
        model: "gpt-5.6-luna",
        operation: "agent",
        call
      })
    ).rejects.toThrow("配额");
    expect(call).not.toHaveBeenCalled();
  });

  it("does not lose usage when provider calls finish concurrently", async () => {
    await Promise.all(
      Array.from({ length: 6 }, () =>
        runAiGatewayCall({
          provider: "deepseek" as const,
          model: "deepseek-v4-flash",
          operation: "agent" as const,
          call: async () => ({
            content: "{}",
            usage: {
              inputTokens: 10,
              outputTokens: 5,
              cachedInputTokens: 0,
              estimated: false
            }
          })
        })
      )
    );

    expect((await getAiEntitlement()).usedTokensThisMonth).toBe(90);
  });

  it("serializes finite-quota calls so concurrent requests cannot all pass stale usage", async () => {
    values.set("aarre:ai-entitlement:v1", {
      tier: "free",
      monthlyTokenQuota: 20
    });
    const call = vi.fn(async () => ({
      content: "{}",
      usage: {
        inputTokens: 15,
        outputTokens: 10,
        cachedInputTokens: 0,
        estimated: false
      }
    }));

    const results = await Promise.allSettled(
      Array.from({ length: 3 }, () =>
        runAiGatewayCall({
          provider: "gemini" as const,
          model: "gemini-2.5-flash-lite",
          operation: "agent" as const,
          call
        })
      )
    );

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(
      1
    );
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(
      2
    );
    expect(call).toHaveBeenCalledTimes(1);
  });
});

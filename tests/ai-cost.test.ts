import { describe, expect, it } from "vitest";
import {
  AI_PRICE_UPDATED_AT,
  costCnyForUsage,
  estimateScanCost,
  estimateScanTokens,
  tokenPriceForModel
} from "../src/lib/ai-cost";

describe("AI scan costs", () => {
  it("uses dated official rates for the three default models", () => {
    expect(
      tokenPriceForModel("gemini", "gemini-2.5-flash-lite")
    ).toMatchObject({
      inputUsdPerMillion: 0.1,
      outputUsdPerMillion: 0.4
    });
    expect(tokenPriceForModel("openai", "gpt-5.6-luna")).toMatchObject({
      inputUsdPerMillion: 1,
      outputUsdPerMillion: 6
    });
    expect(
      tokenPriceForModel("deepseek", "deepseek-v4-flash")
    ).toMatchObject({
      inputUsdPerMillion: 0.14,
      outputUsdPerMillion: 0.28
    });
    expect(AI_PRICE_UPDATED_AT).toBe("2026-07-30");
  });

  it("returns no price for an unknown custom model", () => {
    expect(tokenPriceForModel("openai", "custom-model")).toBeNull();
    expect(
      estimateScanCost(300, "openai", "custom-model").estimatedCostCny
    ).toBeNull();
  });

  it("estimates token volume for a scan regardless of pricing", () => {
    expect(estimateScanTokens(206)).toEqual({
      estimatedInputTokens: 185_400,
      estimatedOutputTokens: 37_080
    });
    expect(estimateScanCost(206, "deepseek", "deepseek-v4-flash")).toMatchObject(
      {
        estimatedInputTokens: 185_400,
        estimatedOutputTokens: 37_080
      }
    );
    expect(
      estimateScanCost(10, "openai", "custom-model")
    ).toMatchObject({
      estimatedInputTokens: 9_000,
      estimatedOutputTokens: 1_800
    });
  });

  it("accounts for cheaper cached input when calculating actual use", () => {
    const cost = costCnyForUsage("openai", "gpt-5.6-luna", {
      inputTokens: 1_000_000,
      cachedInputTokens: 500_000,
      outputTokens: 0,
      estimated: false
    });
    expect(cost).toBe(3.96);
  });
});


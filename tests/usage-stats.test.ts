import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  addScanAiUsage,
  getAiUsageStats
} from "../src/lib/usage-stats";

let values: Record<string, unknown>;

beforeEach(() => {
  values = {};
  vi.stubGlobal("chrome", {
    storage: {
      local: {
        async get(key: string) {
          return { [key]: values[key] };
        },
        async set(next: Record<string, unknown>) {
          Object.assign(values, next);
        }
      }
    }
  });
});

describe("AI usage statistics", () => {
  it("accumulates tokens, estimated cost and completed scans", async () => {
    await addScanAiUsage("gemini", "gemini-2.5-flash-lite", {
      inputTokens: 1_000,
      outputTokens: 200,
      cachedInputTokens: 100,
      estimated: false
    });
    await addScanAiUsage("gemini", "gemini-2.5-flash-lite", {
      inputTokens: 500,
      outputTokens: 100,
      cachedInputTokens: 0,
      estimated: true
    });

    expect(await getAiUsageStats()).toMatchObject({
      inputTokens: 1_500,
      outputTokens: 300,
      cachedInputTokens: 100,
      estimatedTokens: 600,
      scanCount: 2
    });
  });
});


import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAarreDataExport } from "../src/lib/data-export";

const localValues: Record<string, unknown> = {
  "bookmark-layer:ai-settings": {
    provider: "gemini",
    apiKeys: {
      gemini: "SECRET_API_KEY_SHOULD_NEVER_EXPORT"
    },
    models: { gemini: "gemini-2.5-flash-lite" }
  },
  "aarre:agent-conversations": [
    {
      id: "conversation-1",
      title: "RAG 调研",
      createdAt: "2026-07-30T00:00:00.000Z",
      updatedAt: "2026-07-30T00:00:00.000Z",
      messages: []
    }
  ],
  "aarre:library-scan": {
    id: "scan-1",
    state: "completed",
    resourceKeys: ["resource-1"]
  }
};

beforeEach(() => {
  vi.stubGlobal("chrome", {
    runtime: {
      getManifest: () => ({ version: "0.3.0" })
    },
    storage: {
      local: {
        get: async (key: string) => ({ [key]: localValues[key] })
      }
    }
  });
});

describe("data export privacy contract", () => {
  it("完整导出明确排除 API Key 和云端令牌", async () => {
    const result = await createAarreDataExport();
    const serialized = JSON.stringify(result);
    expect(result.privacy).toEqual({
      includesApiKeys: false,
      includesCloudTokens: false,
      includesLocalPageSnapshots: true
    });
    expect(serialized).not.toContain(
      "SECRET_API_KEY_SHOULD_NEVER_EXPORT"
    );
    expect(serialized).not.toContain("PORT");
    expect(result.settings.ai).not.toHaveProperty("apiKeySuffix");
    expect(result.settings.ai.apiKeyConfigured).toBe(true);
    expect(result.data.conversations).toHaveLength(1);
    expect(result.data.libraryScan).toEqual(
      expect.objectContaining({ id: "scan-1" })
    );
  });
});

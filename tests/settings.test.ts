import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from "vitest";
import {
  getAiSettingsStatus,
  getAiRuntimeSettings,
  getGeminiApiKey,
  saveAiSettings
} from "../src/lib/settings";

const stored = new Map<string, unknown>();

beforeEach(() => {
  stored.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.stubGlobal("chrome", {
    storage: {
      local: {
        async get(key: string) {
          return { [key]: stored.get(key) };
        },
        async set(values: Record<string, unknown>) {
          for (const [key, value] of Object.entries(values)) {
            stored.set(key, value);
          }
        }
      }
    }
  });
});

describe("AI settings", () => {
  it("validates and stores a Gemini key without returning the secret", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ name: "models/gemini-embedding-001" })
      } satisfies Partial<Response>)
    );

    const status = await saveAiSettings({
      provider: "gemini",
      model: "gemini-2.5-flash-lite",
      apiKey: "preview-api-key-1234"
    });

    expect(status).toMatchObject({
      provider: "gemini",
      providerName: "Gemini",
      model: "gemini-2.5-flash-lite",
      apiKeyConfigured: true,
      apiKeySuffix: "1234",
      configuredProviders: ["gemini"],
      usingBuiltInService: false
    });
    expect("apiKeys" in status).toBe(false);
    expect(await getGeminiApiKey()).toBe("preview-api-key-1234");
  });

  it("requires a Gemini key just like the other providers", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      saveAiSettings({
        provider: "gemini",
        model: "gemini-2.5-flash-lite"
      })
    ).rejects.toThrow("请先填写 Gemini API Key");
    expect((await getAiSettingsStatus()).usingBuiltInService).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("validates and activates an OpenAI preset", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: "gpt-5.6-luna" })
    } satisfies Partial<Response>);
    vi.stubGlobal("fetch", fetchMock);

    const status = await saveAiSettings({
      provider: "openai",
      model: "gpt-5.6-luna",
      apiKey: "openai-preview-key-1234"
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.openai.com/v1/models/gpt-5.6-luna",
      {
        headers: {
          Authorization: "Bearer openai-preview-key-1234"
        }
      }
    );
    expect(status).toMatchObject({
      provider: "openai",
      providerName: "OpenAI",
      model: "gpt-5.6-luna",
      apiKeyConfigured: true,
      apiKeySuffix: "1234",
      configuredProviders: ["openai"]
    });
    expect(await getAiRuntimeSettings()).toEqual({
      provider: "openai",
      model: "gpt-5.6-luna",
      apiKey: "openai-preview-key-1234"
    });
  });

  it("rejects a DeepSeek model that the key cannot access", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          data: [{ id: "deepseek-v4-pro" }]
        })
      } satisfies Partial<Response>)
    );

    await expect(
      saveAiSettings({
        provider: "deepseek",
        model: "deepseek-v4-flash",
        apiKey: "deepseek-preview-key-1234"
      })
    ).rejects.toThrow("当前账号无法使用模型");
    expect((await getAiSettingsStatus()).provider).toBe("gemini");
  });

  it("does not store a rejected key", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({
          error: { message: "API key not valid" }
        })
      } satisfies Partial<Response>)
    );

    await expect(
      saveAiSettings({
        provider: "gemini",
        model: "gemini-2.5-flash-lite",
        apiKey: "rejected-api-key-1234"
      })
    ).rejects.toThrow("无效或没有访问权限");
    expect((await getAiSettingsStatus()).apiKeyConfigured).toBe(false);
  });
});

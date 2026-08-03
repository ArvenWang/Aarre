// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("side panel preview AI", () => {
  it("validates the configured key and routes chat through the real provider path", async () => {
    let bodyRequest: RequestInit | undefined;
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
      bodyRequest = init;
      const url = String(input);
      if (url === "https://api.deepseek.com/models") {
        return new Response(
          JSON.stringify({ data: [{ id: "deepseek-v4-flash" }] }),
          { status: 200 }
        );
      }
      if (url === "https://api.deepseek.com/chat/completions") {
        const request = bodyRequest as RequestInit;
        const body = JSON.parse(String(request.body)) as {
          messages?: Array<{ content?: string }>;
        };
        const prompt = body.messages?.[1]?.content || "";
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: prompt.includes("- steps：")
                    ? JSON.stringify({
                        steps: ["先定位相关收藏", "再核对用途"]
                      })
                    : JSON.stringify({
                        answer: "这是来自真实 Provider 路径的回答。",
                        source_ids: ["r1"],
                        actions: []
                      })
                }
              }
            ],
            usage: {
              prompt_tokens: 120,
              completion_tokens: 24,
              prompt_cache_hit_tokens: 0
            }
          }),
          { status: 200 }
        );
      }
      throw new Error(`Unexpected URL: ${url}`);
      }
    );
    vi.stubGlobal("fetch", fetchMock);

    const { installSidePanelPreview } = await import(
      "../src/ui/sidepanel/preview"
    );
    installSidePanelPreview();

    const saveResponse = (await chrome.runtime.sendMessage({
      type: "SAVE_AI_SETTINGS",
      payload: {
        provider: "deepseek",
        model: "deepseek-v4-flash",
        apiKey: "deepseek-live-preview-test-key"
      }
    })) as { ok: boolean; error?: string };
    expect(saveResponse).toEqual(expect.objectContaining({ ok: true }));

    const progress: string[] = [];
    const thinkingEvents: string[][] = [];
    chrome.runtime.onMessage.addListener((message: unknown) => {
      const event = message as {
        type?: string;
        stage?: string;
        steps?: unknown;
      };
      if (event.type === "BOOKMARK_AGENT_PROGRESS" && event.stage) {
        progress.push(event.stage);
      }
      if (
        event.type === "BOOKMARK_AGENT_THINKING" &&
        Array.isArray(event.steps)
      ) {
        thinkingEvents.push(event.steps.map(String));
      }
    });
    const agentResponse = (await chrome.runtime.sendMessage({
      type: "ASK_BOOKMARK_AGENT",
      requestId: "preview-live-request",
      query: "GitHub",
      history: []
    })) as {
      ok: boolean;
      data?: {
        answer: string;
        sources: Array<{ title: string }>;
      };
      error?: string;
    };

    expect(agentResponse).toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          answer: "这是来自真实 Provider 路径的回答。",
          thinking: ["先定位相关收藏", "再核对用途"],
          sources: [expect.objectContaining({ title: "GitHub — 代码仓库" })]
        })
      })
    );
    expect(progress).toEqual([
      "preparing",
      "selecting",
      "thinking",
      "synthesizing"
    ]);
    expect(thinkingEvents).toEqual([["先定位相关收藏", "再核对用途"]]);
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      "https://api.deepseek.com/models",
      "https://api.deepseek.com/chat/completions",
      "https://api.deepseek.com/chat/completions"
    ]);
  });
});

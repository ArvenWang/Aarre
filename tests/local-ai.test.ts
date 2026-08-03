import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from "vitest";
import {
  askBookmarkAgent,
  enrichResourceLocally,
  parseJsonObject
} from "../src/lib/local-ai";
import type {
  BookmarkAgentCatalog,
  PageCapture,
  ResourceRecord
} from "../src/lib/types";

const settingsKey = "bookmark-layer:ai-settings";
let storedSettings: Record<string, unknown>;

const resource: ResourceRecord = {
  resourceKey: "deepseek-local-test",
  canonicalUrl: "https://example.com/article",
  url: "https://example.com/article",
  title: "本地 AI 收藏测试",
  userNote: "以后写产品方案时使用",
  summary: "",
  tags: [],
  topics: [],
  contentExcerpt: "一篇介绍书签信息架构的文章",
  contentHash: "hash",
  selectedText: "",
  author: "Example",
  siteName: "Example",
  language: "zh-CN",
  imageUrl: "",
  faviconUrl: "",
  nativeBookmarkIds: ["1"],
  nativeFolderPath: ["书签栏"],
  aiStatus: "pending",
  syncStatus: "local",
  createdAt: "2026-07-29T00:00:00.000Z",
  updatedAt: "2026-07-29T00:00:00.000Z"
};

const capture: PageCapture = {
  url: resource.url,
  canonicalUrl: resource.canonicalUrl,
  title: resource.title,
  description: "",
  content:
    "这是一篇用于测试的长文章正文。".repeat(20),
  excerpt: resource.contentExcerpt,
  selectedText: "",
  author: resource.author,
  siteName: resource.siteName,
  language: resource.language,
  imageUrl: "",
  faviconUrl: ""
};

const actionCatalog: BookmarkAgentCatalog = {
  bookmarks: [
    {
      id: "1",
      parentId: "folder-1",
      title: resource.title,
      url: resource.url,
      path: ["书签栏", "产品"],
      writable: true
    }
  ],
  folders: [
    {
      id: "root-1",
      parentId: "0",
      title: "书签栏",
      path: ["书签栏"],
      writable: true
    },
    {
      id: "folder-1",
      parentId: "root-1",
      title: "产品",
      path: ["书签栏", "产品"],
      writable: true
    }
  ]
};

/** 同时响应「思考路径」和「最终回答」两次调用的 mock：
 * 思考提示词以 `- steps：` 开头约定结构，最终回答提示词走 answer JSON。 */
function agentFetchMock(options: {
  answer?: Record<string, unknown>;
  thinkingSteps?: string[];
} = {}) {
  const answer = options.answer ?? {
    answer: "这是回答。",
    source_ids: []
  };
  const thinkingSteps = options.thinkingSteps ?? [
    "先检查候选收藏的实际内容",
    "按用途和主题组织回答"
  ];
  return vi.fn().mockImplementation(
    async (_url: RequestInfo | URL, request?: RequestInit) => {
      const body = JSON.parse(String((request as RequestInit)?.body)) as {
        messages?: Array<{ content?: string }>;
      };
      const prompt = body.messages?.[1]?.content || "";
      const content = prompt.includes("- steps：")
        ? JSON.stringify({ steps: thinkingSteps })
        : JSON.stringify(answer);
      return new Response(
        JSON.stringify({ choices: [{ message: { content } }] }),
        { status: 200 }
      );
    }
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  storedSettings = {
    provider: "deepseek",
    apiKeys: { deepseek: "deepseek-test-key-1234" },
    models: { deepseek: "deepseek-v4-flash" }
  };
  vi.stubGlobal("chrome", {
    storage: {
      local: {
        async get(key: string) {
          return { [key]: key === settingsKey ? storedSettings : undefined };
        }
      }
    }
  });
});

describe("local AI enrichment", () => {
  it("uses the configured DeepSeek key directly and returns local metadata", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  summary: "这篇文章介绍了书签信息架构。",
                  tags: ["书签", "# 信息架构", "产品设计"],
                  topics: ["知识管理"],
                  aliases: ["bookmark architecture", "收藏整理", "知识库设计"],
                  useCases: ["设计收藏夹结构时参考"],
                  contentType: "文章",
                  questions: ["书签应该怎么分类"],
                  entities: []
                })
              }
            }
          ]
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const enriched = await enrichResourceLocally(resource, capture);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, request] = fetchMock.mock.calls[0] as [
      string,
      RequestInit
    ];
    expect(url).toBe("https://api.deepseek.com/chat/completions");
    expect(request.headers).toMatchObject({
      Authorization: "Bearer deepseek-test-key-1234"
    });
    expect(enriched).toMatchObject({
      summary: "这篇文章介绍了书签信息架构。",
      tags: ["书签", "信息架构", "产品设计"],
      tagsSource: "ai",
      topics: ["知识管理"],
      aliases: ["bookmark architecture", "收藏整理", "知识库设计"],
      aiSchemaVersion: 2,
      aiStatus: "ready",
      syncStatus: "local"
    });
  });

  it("records the four retrieval fields and feeds headings into the prompt", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  summary: "这篇文章介绍了书签信息架构。",
                  tags: ["书签"],
                  topics: ["知识管理"],
                  aliases: ["bookmark architecture"],
                  useCases: ["设计收藏夹结构时参考"],
                  contentType: "文章",
                  questions: ["书签应该怎么分类"],
                  entities: ["Aarre"],
                  // 不在白名单里的类型必须被丢掉，而不是原样落库。
                  extra: "ignored"
                })
              }
            }
          ]
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const enriched = await enrichResourceLocally(resource, {
      ...capture,
      headings: ["书签信息架构", "为什么要分类"]
    });

    expect(enriched).toMatchObject({
      useCases: ["设计收藏夹结构时参考"],
      contentType: "文章",
      questions: ["书签应该怎么分类"],
      entities: ["Aarre"]
    });
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const prompt = (
      JSON.parse(String(request.body)) as {
        messages: Array<{ content: string }>;
      }
    ).messages[1].content;
    expect(prompt).toContain("页面标题层级：\n书签信息架构；为什么要分类");
    expect(prompt).toContain("网址路径词：\narticle");
  });

  it("retries an incomplete enrichment instead of storing a false ready state", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    summary: "这篇文章介绍了书签信息架构。",
                    tags: ["书签"],
                    topics: ["知识管理"],
                    aliases: ["bookmark architecture"],
                    useCases: ["设计收藏夹结构时参考"],
                    contentType: "随便编的类型",
                    questions: ["书签应该怎么分类"],
                    entities: []
                  })
                }
              }
            ]
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    summary: "这篇文章介绍了书签信息架构。",
                    tags: ["书签"],
                    topics: ["知识管理"],
                    aliases: ["bookmark architecture"],
                    useCases: ["设计收藏夹结构时参考"],
                    contentType: "文章",
                    questions: ["书签应该怎么分类"],
                    entities: []
                  })
                }
              }
            ]
          }),
          { status: 200 }
        )
      );
    vi.stubGlobal(
      "fetch",
      fetchMock
    );

    const enriched = await enrichResourceLocally(resource, capture);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(enriched.contentType).toBe("文章");
    expect(enriched.aiStatus).toBe("ready");
  });

  it("keeps user-adjusted tags when AI refreshes the analysis", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    summary: "AI 更新后的完整简介。",
                    tags: ["AI 新标签"],
                    topics: ["新主题"],
                    aliases: ["更新别名", "refresh alias", "主题检索"],
                    useCases: ["更新收藏信息时参考"],
                    contentType: "文章",
                    questions: ["如何更新收藏信息"],
                    entities: []
                  })
                }
              }
            ]
          }),
          { status: 200 }
        )
      )
    );

    const enriched = await enrichResourceLocally(
      {
        ...resource,
        tags: ["用户保留", "稍后阅读"],
        tagsSource: "user"
      },
      capture
    );

    expect(enriched).toMatchObject({
      summary: "AI 更新后的完整简介。",
      tags: ["用户保留", "稍后阅读"],
      tagsSource: "user",
      topics: ["新主题"],
      aliases: ["更新别名", "refresh alias", "主题检索"]
    });
  });

  it("reports an actionable error when DeepSeek rejects the key", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ error: { message: "invalid key" } }),
          { status: 401 }
        )
      )
    );

    await expect(
      enrichResourceLocally(resource, capture)
    ).rejects.toThrow("DeepSeek API Key 无效");
  });

  it("does not call an AI provider when no key is configured", async () => {
    storedSettings = {
      provider: "deepseek",
      models: { deepseek: "deepseek-v4-flash" }
    };
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      enrichResourceLocally(resource, capture)
    ).rejects.toThrow("请先在设置中填写 DeepSeek API Key");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("parseJsonObject strict parsing", () => {
  it("parses a valid JSON object", () => {
    expect(parseJsonObject('{"answer":"a\\nb","steps":["x"]}')).toEqual({
      answer: "a\nb",
      steps: ["x"]
    });
  });

  it("rejects prose, code fences, and malformed string newlines", () => {
    expect(() => parseJsonObject('```json\n{"answer":"ok"}\n```')).toThrow();
    expect(() => parseJsonObject('{"answer":"line1\nline2"}')).toThrow();
  });
});

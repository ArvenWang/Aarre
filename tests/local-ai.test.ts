import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from "vitest";
import {
  askBookmarkAgent,
  enrichResourceLocally
} from "../src/lib/local-ai";
import type {
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
                  topics: ["知识管理"]
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
      aiStatus: "ready",
      syncStatus: "local"
    });
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
                    topics: ["新主题"]
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
      topics: ["新主题"]
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

  it("answers from local bookmarks with DeepSeek and returns real sources", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  answer: "可以先参考这篇书签的信息架构方法。",
                  source_ids: ["r1"]
                })
              }
            }
          ]
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await askBookmarkAgent(
      "我该怎么整理书签？",
      [resource]
    );

    expect(result).toMatchObject({
      query: "我该怎么整理书签？",
      answer: "可以先参考这篇书签的信息架构方法。",
      providerName: "DeepSeek",
      sources: [
        {
          resourceKey: resource.resourceKey,
          title: resource.title,
          url: resource.url
        }
      ]
    });
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(String(request.body)).toContain("Aarre");
    expect(String(request.body)).toContain("信息架构");
  });

  it("gives the model the whole compact catalog instead of only keyword matches", async () => {
    const resources = Array.from({ length: 30 }, (_, index) => ({
      ...resource,
      resourceKey: `catalog-${index + 1}`,
      url: `https://example.com/item-${index + 1}`,
      canonicalUrl: `https://example.com/item-${index + 1}`,
      title: `收藏 ${index + 1}`,
      summary: `第 ${index + 1} 条收藏的用途说明`
    }));
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  answer: "相关内容在目录末尾。",
                  source_ids: ["r30"]
                })
              }
            }
          ]
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await askBookmarkAgent("寻找另一种用途", resources);

    expect(result.catalogSize).toBe(30);
    expect(result.examinedCount).toBe(30);
    expect(result.sources[0]?.resourceKey).toBe("catalog-30");
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(String(request.body)).toContain("收藏 30");
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

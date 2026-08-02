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

  it("proposes Aarre-only metadata edits that never touch Chrome", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    answer: "已准备好标签更新。",
                    source_ids: [],
                    actions: [
                      {
                        type: "update_metadata",
                        target_id: "1",
                        group_label: "产品设计类收藏",
                        tags: ["产品设计", "# 信息架构"],
                        note: "写方案时的参考"
                      }
                    ]
                  })
                }
              }
            ]
          }),
          { status: 200 }
        )
      )
    );

    const result = await askBookmarkAgent(
      "把这条收藏的标签改成产品设计",
      [resource],
      [],
      actionCatalog
    );

    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]).toMatchObject({
      type: "update_metadata",
      resourceKey: resource.resourceKey,
      groupLabel: "产品设计类收藏",
      tags: ["产品设计", "信息架构"],
      userNote: "写方案时的参考",
      destructive: false,
      status: "pending"
    });
    expect(result.actions[0]?.summary).toBeUndefined();
  });

  it("ignores a metadata edit aimed at a bookmark Aarre does not track", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    answer: "无法定位这条收藏。",
                    source_ids: [],
                    actions: [
                      {
                        type: "update_metadata",
                        target_id: "999",
                        tags: ["随便"]
                      }
                    ]
                  })
                }
              }
            ]
          }),
          { status: 200 }
        )
      )
    );

    const result = await askBookmarkAgent(
      "修改标签",
      [resource],
      [],
      actionCatalog
    );

    expect(result.actions).toHaveLength(0);
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

  it("reports only the stages a quick query really executes", async () => {
    const resources = Array.from({ length: 120 }, (_, index) => ({
      ...resource,
      resourceKey: `quick-${index}`,
      url: `https://example.com/quick-${index}`,
      canonicalUrl: `https://example.com/quick-${index}`
    }));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    answer: "这是一次快速回答。",
                    source_ids: []
                  })
                }
              }
            ]
          }),
          { status: 200 }
        )
      )
    );
    const progress: Array<{
      stage: string;
      stages: string[];
      completedStages: string[];
    }> = [];

    await askBookmarkAgent(
      "概括一下最近的内容",
      resources,
      [],
      { bookmarks: [], folders: [] },
      { onProgress: (update) => progress.push(update) }
    );

    expect(progress.map((item) => item.stage)).toEqual([
      "preparing",
      "selecting",
      "synthesizing"
    ]);
    expect(progress.every((item) => !item.stages.includes("scanning"))).toBe(
      true
    );
    expect(
      progress.every((item) => !item.completedStages.includes("scanning"))
    ).toBe(true);
  });

  it("does not turn an informational delete question into a mutation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    answer: "可以在收藏菜单中选择删除。",
                    source_ids: [],
                    actions: []
                  })
                }
              }
            ]
          }),
          { status: 200 }
        )
      )
    );

    const result = await askBookmarkAgent("怎么删除书签？", [resource]);

    expect(result.answer).toBe("可以在收藏菜单中选择删除。");
    expect(result.actions).toEqual([]);
  });

  it("uses the current OpenAI completion limit parameter", async () => {
    storedSettings = {
      provider: "openai",
      apiKeys: { openai: "openai-test-key-1234" },
      models: { openai: "gpt-5.6-luna" }
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  answer: "OpenAI 回答。",
                  source_ids: []
                })
              }
            }
          ]
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await askBookmarkAgent("概括一下", [resource]);

    const body = JSON.parse(
      String((fetchMock.mock.calls[0]?.[1] as RequestInit).body)
    ) as Record<string, unknown>;
    expect(body.max_completion_tokens).toBe(4_096);
    expect(body).not.toHaveProperty("max_tokens");
    expect(body.reasoning_effort).toBe("minimal");
  });

  it("accepts a provider response wrapped in prose or a JSON code fence", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  "下面是结果：\n```json\n" +
                  JSON.stringify({
                    answer: "可以先参考这篇书签。",
                    source_ids: ["r1"]
                  }) +
                  "\n```"
              }
            }
          ]
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await askBookmarkAgent("怎么整理书签？", [resource]);

    expect(result.answer).toBe("可以先参考这篇书签。");
    expect(result.sources[0]?.resourceKey).toBe(resource.resourceKey);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries only the agent response when its JSON shape is malformed", async () => {
    const validResponse = JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify({
              answer: "重试后得到的回答。",
              source_ids: []
            })
          }
        }
      ]
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "这不是 JSON" } }]
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(new Response(validResponse, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await askBookmarkAgent("怎么整理书签？", [resource]);

    expect(result.answer).toBe("重试后得到的回答。");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("checks a 2,000-item library in full batches before final synthesis", async () => {
    const resources = Array.from({ length: 2_000 }, (_, index) => ({
      ...resource,
      resourceKey: `catalog-${index + 1}`,
      url: `https://example.com/item-${index + 1}`,
      canonicalUrl: `https://example.com/item-${index + 1}`,
      title: `收藏 ${index + 1}`,
      summary: `第 ${index + 1} 条收藏的用途说明`
    }));
    const fetchMock = vi.fn().mockImplementation(async (_url, request) => {
      const body = JSON.parse(String((request as RequestInit).body)) as {
        messages?: Array<{ content?: string }>;
      };
      const prompt = body.messages?.[1]?.content || "";
      const content = prompt.includes("分批筛选器")
        ? JSON.stringify({
            relevant_ids: Array.from({ length: 60 }, (_, index) =>
              `b${index + 1}`
            )
          })
        : JSON.stringify({
            answer: "已完成全量检查。",
            source_ids: ["r80"]
          });
      return new Response(
        JSON.stringify({
          choices: [{ message: { content } }]
        }),
        { status: 200 }
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const progress: string[] = [];
    const result = await askBookmarkAgent(
      "帮我看一下所有的组件库",
      resources,
      [],
      { bookmarks: [], folders: [] },
      { onProgress: (update) => progress.push(update.stage) }
    );

    expect(result.catalogSize).toBe(2_000);
    expect(result.examinedCount).toBe(2_000);
    expect(result.catalogScanComplete).toBe(true);
    expect(result.sources[0]?.resourceKey).toBe("catalog-80");
    expect(progress[0]).toBe("preparing");
    expect(progress.filter((stage) => stage === "scanning")).toHaveLength(35);
    expect(progress.at(-2)).toBe("selecting");
    expect(progress.at(-1)).toBe("synthesizing");
    expect(fetchMock).toHaveBeenCalledTimes(35);
    const prompts = fetchMock.mock.calls.map((call) => {
      const request = call[1] as RequestInit;
      const body = JSON.parse(String(request.body)) as {
        messages: Array<{ content: string }>;
      };
      return body.messages[1]?.content || "";
    });
    const scanPrompts = prompts.filter((prompt) =>
      prompt.includes("分批筛选器")
    );
    expect(scanPrompts).toHaveLength(34);
    expect(scanPrompts.some((prompt) => prompt.includes("收藏 2000"))).toBe(
      true
    );
    const requestBody = prompts.at(-1) || "";
    expect(requestBody).toContain("收藏 80");
    expect(requestBody).not.toContain("收藏 81");
    expect(requestBody).toContain("全部 2000 条收藏");

    // 前 20 条给完整字段，其余只给一行摘要，这样候选翻倍而提示词只小幅变长。
    expect(requestBody).toContain("[r20] | 名称=收藏 20");
    expect(requestBody).toContain("[r21] | 收藏 21");
    expect(requestBody).not.toContain("[r21] | 名称=");
    expect(requestBody.length).toBeLessThanOrEqual(24_000);
  });

  it("does not refill an empty full-scan match set with unrelated bookmarks", async () => {
    const resources = Array.from({ length: 120 }, (_, index) => ({
      ...resource,
      resourceKey: `unrelated-${index + 1}`,
      url: `https://example.com/unrelated-${index + 1}`,
      canonicalUrl: `https://example.com/unrelated-${index + 1}`,
      title: `烹饪资料 ${index + 1}`,
      summary: "家常菜做法"
    }));
    const prompts: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (_url, request) => {
        const body = JSON.parse(String((request as RequestInit).body)) as {
          messages: Array<{ content: string }>;
        };
        const prompt = body.messages[1]?.content || "";
        prompts.push(prompt);
        const content = prompt.includes("分批筛选器")
          ? JSON.stringify({ relevant_ids: [] })
          : JSON.stringify({
              answer: "没有找到相关收藏。",
              source_ids: []
            });
        return new Response(
          JSON.stringify({ choices: [{ message: { content } }] }),
          { status: 200 }
        );
      })
    );

    const result = await askBookmarkAgent("搜索全部量子计算资料", resources);

    expect(result.catalogScanComplete).toBe(true);
    expect(result.examinedCount).toBe(120);
    expect(result.sources).toEqual([]);
    expect(prompts.at(-1)).toContain("收藏资料：\n（无）");
    expect(prompts.at(-1)).not.toContain("烹饪资料 1");
  });

  it("does not synthesize a partial answer when a full-scan batch fails", async () => {
    const resources = Array.from({ length: 120 }, (_, index) => ({
      ...resource,
      resourceKey: `failed-scan-${index + 1}`,
      url: `https://example.com/failed-scan-${index + 1}`,
      canonicalUrl: `https://example.com/failed-scan-${index + 1}`,
      title: `待检查收藏 ${index + 1}`
    }));
    const fetchMock = vi.fn().mockImplementation(async () =>
      new Response("暂时不可用", { status: 503 })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      askBookmarkAgent("搜索全部设计相关收藏", resources)
    ).rejects.toThrow("全量检查未完成");
    // 120 条会启动两个分批请求，各自只做一次短重试；最终合成请求绝不能发出。
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("prepares a real delete proposal without falsely claiming it already ran", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    answer: "已经帮你删掉了。",
                    source_ids: [],
                    actions: [
                      {
                        type: "delete_bookmark",
                        target_id: "1"
                      }
                    ]
                  })
                }
              }
            ]
          }),
          { status: 200 }
        )
      )
    );

    const result = await askBookmarkAgent(
      "删除本地 AI 收藏测试",
      [resource],
      [],
      actionCatalog
    );

    expect(result.answer).toContain("尚未执行");
    expect(result.answer).not.toContain("已经帮你删掉");
    expect(result.actions).toMatchObject([
      {
        type: "delete_bookmark",
        targetId: "1",
        destructive: true,
        status: "pending"
      }
    ]);
  });

  it("rejects hallucinated action ids and states that nothing changed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    answer: "已完成删除。",
                    source_ids: [],
                    actions: [
                      {
                        type: "delete_bookmark",
                        target_id: "missing-id"
                      }
                    ]
                  })
                }
              }
            ]
          }),
          { status: 200 }
        )
      )
    );

    const result = await askBookmarkAgent(
      "删除不存在的书签",
      [resource],
      [],
      actionCatalog
    );

    expect(result.actions).toEqual([]);
    expect(result.answer).toContain("我没有执行任何更改");
    expect(result.answer).not.toContain("已完成删除");
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

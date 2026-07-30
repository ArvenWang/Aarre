import { describe, expect, it } from "vitest";
import {
  buildLocalSearchIndex,
  searchLocalResources,
  searchLocalResourcesWithPinyin
} from "../src/lib/search";
import type { ResourceRecord } from "../src/lib/types";

function resource(
  overrides: Partial<ResourceRecord> & Pick<ResourceRecord, "resourceKey">
): ResourceRecord {
  return {
    canonicalUrl: "https://example.com",
    url: "https://example.com",
    title: "Example",
    userNote: "",
    summary: "",
    tags: [],
    topics: [],
    contentExcerpt: "",
    contentHash: "",
    selectedText: "",
    author: "",
    siteName: "Example",
    language: "zh-CN",
    imageUrl: "",
    faviconUrl: "",
    nativeBookmarkIds: [],
    nativeFolderPath: [],
    aiStatus: "ready",
    syncStatus: "synced",
    createdAt: "2026-07-29T00:00:00.000Z",
    updatedAt: "2026-07-29T00:00:00.000Z",
    ...overrides
  };
}

describe("searchLocalResources", () => {
  it("ranks title and tag matches above excerpt-only matches", () => {
    const results = searchLocalResources(
      [
        resource({
          resourceKey: "excerpt",
          title: "Visual experiments",
          contentExcerpt: "A fluid shader experiment"
        }),
        resource({
          resourceKey: "title",
          title: "Fluid shader collection",
          tags: ["WebGL", "shader"]
        })
      ],
      "shader"
    );

    expect(results.map((item) => item.resource.resourceKey)).toEqual([
      "title",
      "excerpt"
    ]);
  });

  it("returns all resources for an empty query", () => {
    const items = [
      resource({ resourceKey: "a" }),
      resource({ resourceKey: "b" })
    ];
    expect(searchLocalResources(items, "")).toHaveLength(2);
  });

  it("matches Chinese concepts through AI aliases when the title is English", () => {
    const results = searchLocalResources(
      [
        resource({
          resourceKey: "machine-learning",
          title: "Machine Learning Field Guide",
          aliases: ["机器学习", "ML", "模型训练"]
        })
      ],
      "机器学习"
    );

    expect(results[0]?.resource.resourceKey).toBe("machine-learning");
    expect(results[0]?.matchReason).toBe("检索别名");
  });

  it("loads pinyin only when an ASCII query needs it", async () => {
    const resources = [
      resource({
        resourceKey: "cn-ml",
        title: "机器学习实践"
      })
    ];
    const index = buildLocalSearchIndex(resources);
    expect(index[0]?.pinyinReady).toBe(false);

    const results = await searchLocalResourcesWithPinyin(
      resources,
      "jqxx"
    );

    expect(results[0]?.resource.resourceKey).toBe("cn-ml");
    expect(results[0]?.matchReason).toBe("拼音首字母");
  });

  it("keeps lexical results when the optional pinyin chunk fails", async () => {
    const results = await searchLocalResourcesWithPinyin(
      [
        resource({
          resourceKey: "lexical",
          title: "JQXX reference"
        }),
        resource({
          resourceKey: "pinyin-only",
          title: "机器学习实践"
        })
      ],
      "jqxx",
      async () => {
        throw new Error("chunk-unavailable");
      }
    );

    expect(results.map((item) => item.resource.resourceKey)).toEqual([
      "lexical"
    ]);
  });

  it("recalls descriptive questions through generated aliases", () => {
    const results = searchLocalResources(
      [
        resource({
          resourceKey: "web-vitals",
          title: "Web Vitals 优化实践",
          aliases: ["怎么让页面加载更快", "网页性能优化", "加载速度"]
        })
      ],
      "怎么让页面加载更快"
    );

    expect(results[0]?.resource.resourceKey).toBe("web-vitals");
  });
});

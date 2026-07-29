import { describe, expect, it } from "vitest";
import {
  buildKnowledgeDashboard,
  resurfaceForContext
} from "../src/lib/knowledge-insights";
import type {
  BookmarkAgentCatalog,
  ResourceRecord
} from "../src/lib/types";

const DAY = 24 * 60 * 60 * 1_000;
const NOW = Date.parse("2026-07-30T00:00:00.000Z");

function item(
  id: string,
  title: string,
  topic: string,
  daysAgo: number
): ResourceRecord {
  return {
    resourceKey: id,
    canonicalUrl: `https://example.com/${id}`,
    url: `https://example.com/${id}`,
    title,
    userNote: "",
    summary: `${topic} 实践`,
    tags: [topic],
    topics: [topic],
    aliases: [],
    contentExcerpt: "",
    contentHash: "",
    selectedText: "",
    author: "",
    siteName: "Example",
    language: "zh",
    imageUrl: "",
    faviconUrl: "",
    nativeBookmarkIds: [id],
    nativeFolderPath: ["书签栏", topic],
    aiStatus: "ready",
    syncStatus: "local",
    createdAt: new Date(NOW - daysAgo * DAY).toISOString(),
    updatedAt: new Date(NOW).toISOString()
  };
}

function catalog(resources: ResourceRecord[]): BookmarkAgentCatalog {
  return {
    bookmarks: resources.map((resource) => ({
      id: resource.resourceKey,
      parentId: "f1",
      title: resource.title,
      url: resource.url,
      path: resource.nativeFolderPath,
      writable: true,
      dateAdded: Date.parse(resource.createdAt)
    })),
    folders: [
      {
        id: "f1",
        title: "技术",
        path: ["书签栏", "技术"],
        writable: true
      }
    ]
  };
}

describe("knowledge dashboard", () => {
  it("给出注意力迁移、90 天未重访和主题图谱", () => {
    const resources = [
      item("old", "旧的 React 实践", "react", 150),
      item("a", "Agent 工具", "ai agent", 2),
      item("b", "Agent 评测", "ai agent", 3),
      item("c", "React 状态", "react", 10)
    ];
    const dashboard = buildKnowledgeDashboard(
      resources,
      catalog(resources),
      NOW
    );
    expect(dashboard.weekly.attentionShift).toContain("ai agent");
    expect(dashboard.weekly.rarelyOpenedOver90Days).toBe(1);
    expect(dashboard.topicGraph.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "ai agent", count: 2 })
      ])
    );
    expect(dashboard.resurfacing[0]?.resourceKey).toBe("old");
  });

  it("按当前页面语义重新浮现老收藏", () => {
    const resources = [
      item("old", "Web Vitals 性能优化", "web performance", 180),
      item("new", "旅游地图", "travel", 4)
    ];
    expect(
      resurfaceForContext(
        resources,
        catalog(resources),
        "页面性能 Web Vitals",
        NOW
      )[0]?.resourceKey
    ).toBe("old");
  });

  it("用已有标题、摘要和标签指出具体缺少的知识角度", () => {
    const resources = [
      item("rag-1", "RAG 入门", "RAG", 1),
      item("rag-2", "RAG 原理", "RAG", 2),
      item("rag-3", "RAG 代码实践", "RAG", 3),
      item("rag-4", "RAG 教程", "RAG", 4)
    ];
    const gap = buildKnowledgeDashboard(
      resources,
      catalog(resources),
      NOW
    ).weekly.knowledgeGaps[0];
    expect(gap?.topic).toBe("rag");
    expect(gap?.message).toContain("评测与对比");
    expect(gap?.message).toContain("上线与运维");
    expect(gap?.message).toContain("风险与反例");
  });
});

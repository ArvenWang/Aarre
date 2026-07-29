import { describe, expect, it } from "vitest";
import {
  buildLibraryInsights,
  suggestFolders
} from "../src/lib/library-insights";
import type {
  BookmarkAgentCatalog,
  PageCapture,
  ResourceRecord
} from "../src/lib/types";

function resource(
  overrides: Partial<ResourceRecord> = {}
): ResourceRecord {
  return {
    resourceKey: "r1",
    canonicalUrl: "https://example.com/a",
    url: "https://example.com/a",
    title: "设计系统",
    userNote: "",
    summary: "设计组件与交互规范",
    tags: ["设计"],
    topics: ["设计"],
    contentExcerpt: "",
    contentHash: "",
    selectedText: "",
    author: "",
    siteName: "Example",
    language: "zh",
    imageUrl: "",
    faviconUrl: "",
    nativeBookmarkIds: ["1", "2"],
    nativeFolderPath: ["书签栏", "设计"],
    aiStatus: "ready",
    syncStatus: "local",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

const catalog: BookmarkAgentCatalog = {
  bookmarks: [
    {
      id: "1",
      parentId: "f1",
      title: "设计系统",
      url: "https://example.com/a",
      path: ["书签栏", "设计"],
      writable: true,
      dateAdded: 100
    },
    {
      id: "2",
      parentId: "f2",
      title: "设计系统",
      url: "https://example.com/a",
      path: ["书签栏", "稍后"],
      writable: true,
      dateAdded: 200
    }
  ],
  folders: [
    {
      id: "f1",
      title: "设计",
      path: ["书签栏", "设计"],
      writable: true
    },
    {
      id: "f2",
      title: "稍后",
      path: ["书签栏", "稍后"],
      writable: true
    }
  ]
};

describe("buildLibraryInsights", () => {
  it("保留最早重复项，并让删除操作保持默认未选中", () => {
    const insight = buildLibraryInsights([resource()], catalog);
    const proposal = insight.organizationPlan.proposals.find(
      (item) => item.kind === "duplicate"
    );
    expect(proposal?.selectedByDefault).toBe(false);
    expect(proposal?.afterPath).toContain("设计");
    expect(proposal?.actions).toEqual([
      expect.objectContaining({
        type: "delete_bookmark",
        targetId: "2",
        expectedTitle: "设计系统",
        expectedUrl: "https://example.com/a",
        expectedParentId: "f2"
      })
    ]);
  });

  it("只根据实际链接检查结果提出失效删除，不采信 AI 猜测", () => {
    expect(
      buildLibraryInsights([resource({ summary: "AI 说链接可能失效" })], catalog)
        .organizationPlan.proposals
    ).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "dead" })])
    );
    expect(
      buildLibraryInsights(
        [
          resource({
            linkHealth: {
              status: "dead",
              checkedAt: "2026-01-02T00:00:00.000Z",
              consecutiveFailures: 0,
              httpStatus: 404,
              reason: "服务器返回 404"
            }
          })
        ],
        catalog
      ).organizationPlan.proposals
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "dead",
          selectedByDefault: false
        })
      ])
    );
  });

  it("把从未通过书签打开的条目排在待读队列前面", () => {
    const withUsage: BookmarkAgentCatalog = {
      ...catalog,
      bookmarks: [
        { ...catalog.bookmarks[0], dateLastUsed: 500 },
        { ...catalog.bookmarks[1], dateLastUsed: undefined }
      ]
    };
    expect(buildLibraryInsights([resource()], withUsage).readingQueue[0]?.nodeId)
      .toBe("2");
  });
});

describe("suggestFolders", () => {
  it("依据相似收藏的现有目录给出本地建议", () => {
    const capture: PageCapture = {
      url: "https://new.example.com",
      canonicalUrl: "https://new.example.com/",
      title: "设计系统组件规范",
      description: "按钮与表单组件",
      content: "",
      excerpt: "",
      selectedText: "",
      author: "",
      siteName: "Design",
      language: "zh",
      imageUrl: "",
      faviconUrl: ""
    };
    const suggestions = suggestFolders(capture, [resource()], [
      { id: "f1", name: "设计", path: ["书签栏", "设计"], depth: 1 },
      { id: "f2", name: "旅游", path: ["书签栏", "旅游"], depth: 1 }
    ]);
    expect(suggestions[0]).toEqual(
      expect.objectContaining({
        folderId: "f1",
        reason: expect.stringContaining("相似收藏")
      })
    );
  });
});

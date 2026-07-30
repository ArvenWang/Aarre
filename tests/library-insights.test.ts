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
    expect(proposal?.previewLines).toEqual([
      "网页：「设计系统」",
      "保留位置：设计",
      "删除副本：稍后"
    ]);
    expect(proposal?.previewLines.join("\n")).not.toContain("书签栏");
  });

  it("把同一位置的完全相同副本合并成一条易懂说明", () => {
    const sameFolderCatalog: BookmarkAgentCatalog = {
      ...catalog,
      bookmarks: catalog.bookmarks.map((node) => ({
        ...node,
        parentId: "f1",
        path: ["书签栏", "设计"]
      }))
    };
    const proposal = buildLibraryInsights(
      [resource()],
      sameFolderCatalog
    ).organizationPlan.proposals.find(
      (item) => item.kind === "duplicate"
    );

    expect(proposal?.description).toContain(
      "同一位置存在 2 个完全相同的收藏"
    );
    expect(proposal?.previewLines).toEqual([
      "网页：「设计系统」",
      "位置：设计",
      "处理：保留 1 个，删除 1 个完全相同的副本"
    ]);
  });

  it("只根据实际链接检查结果提出失效删除，不采信 AI 猜测", () => {
    expect(
      buildLibraryInsights([resource({ summary: "AI 说链接可能失效" })], catalog)
        .organizationPlan.proposals
    ).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "dead" })])
    );
    const deadProposals =
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
      ).organizationPlan.proposals;
    expect(deadProposals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "dead",
          selectedByDefault: false
        })
      ])
    );
    expect(
      deadProposals.find((proposal) => proposal.kind === "dead")
        ?.recoveryLinks
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: expect.stringContaining("Web Archive"),
          url: expect.stringContaining("web.archive.org/web/*/")
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

  it("与整理提案对同一条收藏给出相同的首选文件夹", () => {
    const resources = [
      resource({
        resourceKey: "design-1",
        canonicalUrl: "https://example.com/design-1",
        url: "https://example.com/design-1",
        title: "设计系统组件",
        summary: "按钮组件规范",
        topics: ["设计系统"],
        nativeBookmarkIds: ["design-node-1"],
        nativeFolderPath: ["书签栏", "设计"]
      }),
      resource({
        resourceKey: "design-2",
        canonicalUrl: "https://example.com/design-2",
        url: "https://example.com/design-2",
        title: "设计系统规范",
        summary: "表单组件规范",
        topics: ["设计系统"],
        nativeBookmarkIds: ["design-node-2"],
        nativeFolderPath: ["书签栏", "设计"]
      }),
      resource({
        resourceKey: "design-3",
        canonicalUrl: "https://example.com/design-3",
        url: "https://example.com/design-3",
        title: "设计系统实践",
        summary: "组件与交互规范",
        topics: ["设计系统"],
        nativeBookmarkIds: ["design-node-3"],
        nativeFolderPath: ["书签栏", "稍后"]
      })
    ];
    const folders = [
      { id: "f1", name: "设计", path: ["书签栏", "设计"], depth: 1 },
      { id: "f2", name: "稍后", path: ["书签栏", "稍后"], depth: 1 }
    ];
    const sameCatalog: BookmarkAgentCatalog = {
      bookmarks: [
        {
          id: "design-node-1",
          parentId: "f1",
          title: resources[0].title,
          url: resources[0].url,
          path: folders[0].path,
          writable: true
        },
        {
          id: "design-node-2",
          parentId: "f1",
          title: resources[1].title,
          url: resources[1].url,
          path: folders[0].path,
          writable: true
        },
        {
          id: "design-node-3",
          parentId: "f2",
          title: resources[2].title,
          url: resources[2].url,
          path: folders[1].path,
          writable: true
        }
      ],
      folders: [
        {
          id: "f1",
          title: "设计",
          path: folders[0].path,
          writable: true
        },
        {
          id: "f2",
          title: "稍后",
          path: folders[1].path,
          writable: true
        }
      ]
    };
    const capture: PageCapture = {
      url: resources[2].url,
      canonicalUrl: resources[2].canonicalUrl,
      title: resources[2].title,
      description: resources[2].summary,
      content: "",
      excerpt: "",
      selectedText: "",
      author: "",
      siteName: "Example",
      language: "zh",
      imageUrl: "",
      faviconUrl: ""
    };

    const saveTarget = suggestFolders(
      capture,
      resources,
      folders
    )[0]?.folderId;
    const organizationPlan = buildLibraryInsights(
      resources,
      sameCatalog
    ).organizationPlan;
    const classification = organizationPlan.proposals.find(
      (proposal) => proposal.kind === "classify"
    );
    const organizeTarget = classification?.actions.find(
      (action) => action.targetId === "design-node-3"
    )?.destinationId;

    expect(saveTarget).toBe("f1");
    expect(organizeTarget).toBe(saveTarget);
    expect(classification?.previewLines).toContain(
      "稍后 / 「设计系统实践」 → 设计"
    );
    expect(classification?.previewLines.join("\n")).not.toContain(
      "书签栏"
    );
  });
});

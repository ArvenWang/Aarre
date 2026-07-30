import { describe, expect, it } from "vitest";
import type {
  BookmarkBarSnapshot,
  ResourceRecord,
  SearchResult
} from "../src/lib/types";
import {
  ALL_LIBRARY_FOLDERS,
  buildLibraryCollection,
  filterAndSortLibraryResults,
  readLibraryControls,
  resourceFolderLabel,
  ROOT_LIBRARY_FOLDER,
  writeLibraryControls,
  writeLibraryQuery
} from "../src/ui/manager/library-collection";

function resource(
  resourceKey: string,
  nativeBookmarkIds: string[],
  overrides: Partial<ResourceRecord> = {}
): ResourceRecord {
  return {
    resourceKey,
    canonicalUrl: `https://example.com/${resourceKey}`,
    url: `https://example.com/${resourceKey}`,
    title: resourceKey,
    userNote: "",
    summary: "",
    tags: [],
    topics: [],
    contentExcerpt: "",
    contentHash: "",
    selectedText: "",
    author: "",
    siteName: "Example",
    language: "en",
    imageUrl: "",
    faviconUrl: "",
    nativeBookmarkIds,
    nativeFolderPath: [],
    aiStatus: "ready",
    syncStatus: "local",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-02T00:00:00.000Z",
    ...overrides
  };
}

const snapshot: BookmarkBarSnapshot = {
  root: {
    id: "bar",
    title: "书签栏",
    folderType: "bookmarks-bar"
  },
  roots: [
    {
      id: "bar",
      title: "书签栏",
      folderType: "bookmarks-bar",
      children: [
        {
          id: "design-bar",
          parentId: "bar",
          title: "设计",
          children: [
            {
              id: "frontend",
              parentId: "design-bar",
              title: "前端",
              children: [
                {
                  id: "bookmark-design-nested",
                  parentId: "frontend",
                  title: "Nested",
                  url: "https://example.com/shared",
                  dateAdded: 100,
                  dateLastUsed: 500
                }
              ]
            }
          ]
        },
        {
          id: "bookmark-root",
          parentId: "bar",
          title: "Root",
          url: "https://example.com/root",
          dateAdded: 300
        }
      ]
    },
    {
      id: "other",
      title: "其他书签",
      folderType: "other",
      children: [
        {
          id: "design-other",
          parentId: "other",
          title: "设计",
          children: [
            {
              id: "bookmark-design-direct",
              parentId: "design-other",
              title: "Shared",
              url: "https://example.com/shared",
              dateAdded: 200
            }
          ]
        },
        {
          id: "research",
          parentId: "other",
          title: "研究",
          children: []
        }
      ]
    }
  ],
  primaryRootId: "bar",
  bookmarkCount: 3,
  folderCount: 4,
  syncing: true
};

describe("manager library folder collection", () => {
  it("merges hidden Chrome roots, includes descendants and deduplicates resources", () => {
    const shared = resource("shared", [
      "bookmark-design-nested",
      "bookmark-design-direct"
    ]);
    const root = resource("root", ["bookmark-root"]);
    const fallback = resource("fallback", ["not-indexed-yet"], {
      nativeFolderPath: ["书签栏", "研究"]
    });
    const collection = buildLibraryCollection(
      [shared, root, fallback],
      snapshot
    );

    expect(collection.folders.map((folder) => folder.label)).toEqual([
      "设计",
      "设计 / 前端",
      "根目录",
      "研究"
    ]);
    expect(
      collection.folders.find((folder) => folder.label === "设计")
        ?.count
    ).toBe(1);
    expect(
      collection.folders.find(
        (folder) => folder.label === "设计 / 前端"
      )?.count
    ).toBe(1);
    expect(
      collection.locations.get(shared.resourceKey)?.folderIds.size
    ).toBe(2);
    expect(
      resourceFolderLabel(collection.locations.get(shared.resourceKey))
    ).toBe("设计 / 前端 +1");
    expect(
      collection.locations.get(root.resourceKey)?.folderIds
    ).toContain(ROOT_LIBRARY_FOLDER);
    expect(
      resourceFolderLabel(collection.locations.get(root.resourceKey))
    ).toBe("根目录");
    expect(
      resourceFolderLabel(collection.locations.get(fallback.resourceKey))
    ).toBe("研究");
    expect(
      collection.folders.some((folder) =>
        folder.label.includes("书签栏")
      )
    ).toBe(false);
    expect(
      collection.folders.some((folder) =>
        folder.label.includes("其他书签")
      )
    ).toBe(false);
  });

  it("filters a folder subtree and sorts by native bookmark metadata", () => {
    const shared = resource("shared", ["bookmark-design-nested"]);
    const root = resource("root", ["bookmark-root"]);
    const results: SearchResult[] = [
      { resource: shared },
      { resource: root }
    ];
    const collection = buildLibraryCollection(
      results.map((item) => item.resource),
      snapshot
    );
    const designFolder = collection.folders.find(
      (folder) => folder.label === "设计"
    )!;

    expect(
      filterAndSortLibraryResults(
        results,
        {
          filter: "all",
          folderId: designFolder.id,
          sort: "default"
        },
        collection.locations
      ).map((item) => item.resource.resourceKey)
    ).toEqual(["shared"]);

    expect(
      filterAndSortLibraryResults(
        [...results].reverse(),
        {
          filter: "all",
          folderId: ALL_LIBRARY_FOLDERS,
          sort: "default"
        },
        collection.locations
      ).map((item) => item.resource.resourceKey)
    ).toEqual(["shared", "root"]);

    expect(
      filterAndSortLibraryResults(
        results,
        {
          filter: "all",
          folderId: ALL_LIBRARY_FOLDERS,
          sort: "bookmarked-desc"
        },
        collection.locations
      ).map((item) => item.resource.resourceKey)
    ).toEqual(["root", "shared"]);

    expect(
      filterAndSortLibraryResults(
        [...results].reverse(),
        {
          filter: "all",
          folderId: ALL_LIBRARY_FOLDERS,
          sort: "used-desc"
        },
        collection.locations
      ).map((item) => item.resource.resourceKey)
    ).toEqual(["shared", "root"]);
  });

  it("keeps relevance order for a search and applies processing filters", () => {
    const ready = resource("ready", [], {
      aiStatus: "ready"
    });
    const pending = resource("pending", [], {
      aiStatus: "pending"
    });
    const results = [
      { resource: pending, score: 0.9 },
      { resource: ready, score: 0.8 }
    ];
    const collection = buildLibraryCollection(
      [ready, pending],
      null
    );

    expect(
      filterAndSortLibraryResults(
        results,
        {
          filter: "all",
          folderId: ALL_LIBRARY_FOLDERS,
          sort: "default"
        },
        collection.locations,
        "example"
      )
    ).toEqual(results);
    expect(
      filterAndSortLibraryResults(
        results,
        {
          filter: "pending",
          folderId: ALL_LIBRARY_FOLDERS,
          sort: "default"
        },
        collection.locations,
        "example"
      ).map((item) => item.resource.resourceKey)
    ).toEqual(["pending"]);
  });
});

describe("manager library control persistence", () => {
  it("round-trips folder, status and sort through the manager URL", () => {
    const updated = writeLibraryControls(
      new URL("chrome-extension://aarre/manager.html?view=library&q=设计"),
      {
        filter: "pending",
        folderId: "folder:path:design",
        sort: "title-asc"
      }
    );

    expect(updated.searchParams.get("q")).toBe("设计");
    expect(
      readLibraryControls(updated.searchParams)
    ).toEqual({
      filter: "pending",
      folderId: "folder:path:design",
      sort: "title-asc"
    });
  });

  it("falls back safely when persisted values are invalid", () => {
    expect(
      readLibraryControls(
        new URLSearchParams("status=broken&sort=broken")
      )
    ).toEqual({
      filter: "all",
      folderId: ALL_LIBRARY_FOLDERS,
      sort: "default"
    });
  });

  it("updates or clears the collection query without losing filters", () => {
    const source = new URL(
      "chrome-extension://aarre/manager.html?status=pending&folder=design&sort=title-asc"
    );
    const searched = writeLibraryQuery(source, "  设计 灵感  ");
    expect(searched.searchParams.get("q")).toBe("设计 灵感");
    expect(readLibraryControls(searched.searchParams)).toEqual({
      filter: "pending",
      folderId: "design",
      sort: "title-asc"
    });

    const cleared = writeLibraryQuery(searched, "   ");
    expect(cleared.searchParams.has("q")).toBe(false);
    expect(readLibraryControls(cleared.searchParams)).toEqual({
      filter: "pending",
      folderId: "design",
      sort: "title-asc"
    });
  });
});

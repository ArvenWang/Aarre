import { describe, expect, it } from "vitest";
import { searchLocalResources } from "../src/lib/search";
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
});

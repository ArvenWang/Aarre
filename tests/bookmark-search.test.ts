import { describe, expect, it } from "vitest";
import {
  bookmarkMatchUrls,
  bookmarkNodesByUrl,
  collectFolderIds,
  filterBookmarkTree
} from "../src/lib/bookmark-search";
import type { NativeBookmarkNode } from "../src/lib/types";

const tree: NativeBookmarkNode[] = [
  {
    id: "folder-design",
    parentId: "root",
    index: 0,
    title: "设计资料",
    children: [
      {
        id: "bookmark-figma",
        parentId: "folder-design",
        index: 0,
        title: "Figma",
        url: "https://figma.com/file/one"
      }
    ]
  },
  {
    id: "bookmark-ml",
    parentId: "root",
    index: 1,
    title: "Machine Learning",
    url: "https://example.com/ml"
  }
];

describe("bookmark tree search", () => {
  it("keeps ancestor folders for metadata-only matches", () => {
    const result = filterBookmarkTree(
      tree,
      "界面设计",
      bookmarkMatchUrls(["https://figma.com/file/one"])
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("folder-design");
    expect(result[0]?.children?.[0]?.id).toBe("bookmark-figma");
    expect([...collectFolderIds(result)]).toEqual(["folder-design"]);
  });

  it("keeps every child when a folder title matches", () => {
    const result = filterBookmarkTree(tree, "设计", new Set());
    expect(result[0]?.children).toHaveLength(1);
  });

  it("indexes native nodes by literal and canonical URLs", () => {
    const byUrl = bookmarkNodesByUrl(tree);
    expect(byUrl.get("https://example.com/ml")?.id).toBe("bookmark-ml");
    expect(byUrl.get("https://example.com/ml/")?.id).toBe("bookmark-ml");
  });
});

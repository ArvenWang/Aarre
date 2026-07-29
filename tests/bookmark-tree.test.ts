import { describe, expect, it } from "vitest";
import { findBookmarkByUrl } from "../src/lib/bookmark-tree";
import type { NativeBookmarkNode } from "../src/lib/types";

const tree: NativeBookmarkNode[] = [
  {
    id: "root",
    title: "书签栏",
    children: [
      {
        id: "folder",
        parentId: "root",
        title: "资料",
        children: [
          {
            id: "bookmark",
            parentId: "folder",
            title: "Example",
            url: "https://example.com/article"
          }
        ]
      }
    ]
  }
];

describe("findBookmarkByUrl", () => {
  it("finds an existing bookmark in nested folders", () => {
    expect(
      findBookmarkByUrl(tree, "https://example.com/article")
    ).toMatchObject({
      id: "bookmark",
      parentId: "folder"
    });
  });

  it("can ignore managed bookmarks when an editable target is required", () => {
    const managed: NativeBookmarkNode[] = [
      {
        ...tree[0],
        children: [
          {
            ...tree[0].children![0],
            children: [
              {
                ...tree[0].children![0].children![0],
                unmodifiable: true
              }
            ]
          }
        ]
      }
    ];

    expect(
      findBookmarkByUrl(
        managed,
        "https://example.com/article",
        true
      )
    ).toBeNull();
  });
});

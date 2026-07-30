import { describe, expect, it } from "vitest";
import {
  findBookmarkByUrl,
  visibleBookmarkRootChildren
} from "../src/lib/bookmark-tree";
import type {
  BookmarkBarSnapshot,
  NativeBookmarkNode
} from "../src/lib/types";

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

describe("visibleBookmarkRootChildren", () => {
  it("hides every Chrome system root while preserving their contents", () => {
    const snapshot: BookmarkBarSnapshot = {
      root: {
        id: "bar",
        title: "书签栏",
        folderType: "bookmarks-bar",
        children: [{ id: "bar-folder", title: "设计" }]
      },
      roots: [
        {
          id: "bar",
          title: "书签栏",
          folderType: "bookmarks-bar",
          children: [{ id: "bar-folder", title: "设计" }]
        },
        {
          id: "other",
          title: "其他书签",
          folderType: "other",
          children: [{ id: "other-folder", title: "待复查" }]
        },
        {
          id: "local-bar",
          title: "书签栏",
          folderType: "bookmarks-bar",
          children: [{ id: "local-folder", title: "本机资料" }]
        }
      ],
      primaryRootId: "bar",
      bookmarkCount: 0,
      folderCount: 3,
      syncing: true
    };

    expect(visibleBookmarkRootChildren(snapshot)).toEqual([
      expect.objectContaining({ id: "bar-folder" }),
      expect.objectContaining({ id: "other-folder" }),
      expect.objectContaining({ id: "local-folder" })
    ]);
  });
});

import { describe, expect, it } from "vitest";
import { buildBookmarkBarSnapshot } from "../src/lib/bookmark-tree";

describe("native bookmark snapshot", () => {
  it("preserves Chrome root ordering while counting all visible folders and bookmarks", () => {
    const snapshot = buildBookmarkBarSnapshot([
      {
        id: "0",
        title: "根",
        children: [
          {
            id: "other",
            title: "其他书签",
            index: 2,
            children: [
              { id: "other-bookmark", parentId: "other", title: "其他", url: "https://other.example" },
            ],
          },
          {
            id: "bar",
            title: "书签栏",
            folderType: "bookmarks-bar",
            syncing: true,
            index: 1,
            children: [
              { id: "bar-bookmark", parentId: "bar", title: "栏内", url: "https://bar.example" },
              {
                id: "nested",
                parentId: "bar",
                title: "文件夹",
                children: [
                  { id: "nested-bookmark", parentId: "nested", title: "嵌套", url: "https://nested.example" },
                ],
              },
            ],
          },
        ],
      },
    ] as chrome.bookmarks.BookmarkTreeNode[]);

    expect(snapshot.primaryRootId).toBe("bar");
    expect(snapshot.roots.map((root) => root.id)).toEqual(["bar", "other"]);
    expect(snapshot.bookmarkCount).toBe(3);
    expect(snapshot.folderCount).toBe(1);
    expect(snapshot.root.children?.[1]?.unmodifiable).toBe(false);
  });
});

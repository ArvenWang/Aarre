import { describe, expect, it } from "vitest";
import type {
  BookmarkBarSnapshot,
  ResourceRecord
} from "../src/lib/types";
import {
  buildLibraryBookmarkEditorModel,
  mergeLibraryEditorTags,
  parseLibraryEditorTags
} from "../src/ui/manager/bookmark-editor";

const resource: ResourceRecord = {
  resourceKey: "shared",
  canonicalUrl: "https://example.com/shared",
  url: "https://example.com/shared",
  title: "Shared",
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
  nativeBookmarkIds: ["bookmark-a", "bookmark-b"],
  nativeFolderPath: [],
  aiStatus: "ready",
  syncStatus: "local",
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z"
};

const snapshot: BookmarkBarSnapshot = {
  root: { id: "bar", title: "书签栏" },
  roots: [
    {
      id: "bar",
      title: "书签栏",
      children: [
        {
          id: "design",
          parentId: "bar",
          title: "设计",
          children: [
            {
              id: "bookmark-a",
              parentId: "design",
              title: "Design copy",
              url: resource.url
            }
          ]
        }
      ]
    },
    {
      id: "other",
      title: "其他书签",
      children: [
        {
          id: "bookmark-b",
          parentId: "other",
          title: "Other copy",
          url: resource.url
        }
      ]
    }
  ],
  primaryRootId: "bar",
  bookmarkCount: 2,
  folderCount: 1,
  syncing: true
};

describe("library bookmark editor model", () => {
  it("keeps duplicate Chrome locations separate for safe editing and deletion", () => {
    const model = buildLibraryBookmarkEditorModel(resource, snapshot);

    expect(model.locations).toEqual([
      expect.objectContaining({
        bookmarkId: "bookmark-a",
        parentId: "design",
        label: "设计"
      }),
      expect.objectContaining({
        bookmarkId: "bookmark-b",
        parentId: "other",
        label: "根目录"
      })
    ]);
    expect(model.folders.map((folder) => folder.id)).toEqual([
      "bar",
      "design",
      "other"
    ]);
    expect(model.folders.map((folder) => folder.label)).toEqual([
      "根目录（位置 1）",
      "设计",
      "根目录（位置 2）"
    ]);
    expect(
      model.folders.some(
        (folder) =>
          folder.label.includes("书签栏") ||
          folder.label.includes("其他书签")
      )
    ).toBe(false);
  });

  it("normalizes, deduplicates and bounds user tags", () => {
    expect(parseLibraryEditorTags("#设计， 前端,设计\n 动效")).toEqual([
      "设计",
      "前端",
      "动效"
    ]);
    expect(mergeLibraryEditorTags(["已有"], "已有, 新增")).toEqual([
      "已有",
      "新增"
    ]);
  });
});

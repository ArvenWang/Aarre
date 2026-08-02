import { describe, expect, it } from "vitest";
import {
  bookmarkPageMenuPresentation,
  bookmarkSnapshotMenuPresentation,
  buildBookmarkSaveState
} from "../src/lib/bookmark-save-state";
import type { NativeBookmarkNode } from "../src/lib/types";

const roots: NativeBookmarkNode[] = [
  {
    id: "bar",
    title: "书签栏",
    folderType: "bookmarks-bar",
    children: [
      {
        id: "one",
        parentId: "bar",
        title: "One",
        url: "https://example.com/article?utm_source=test"
      },
      {
        id: "folder",
        parentId: "bar",
        title: "资料",
        children: [
          {
            id: "two",
            parentId: "folder",
            title: "Two",
            url: "https://example.com/article",
            unmodifiable: true
          }
        ]
      }
    ]
  }
];

describe("buildBookmarkSaveState", () => {
  it("returns none for an unbookmarked page", () => {
    expect(
      buildBookmarkSaveState(roots, "https://example.com/new")
    ).toEqual({ status: "none", matches: [] });
  });

  it("surfaces all canonical duplicates instead of silently merging", () => {
    const state = buildBookmarkSaveState(
      roots,
      "https://example.com/article?utm_source=test"
    );
    expect(state.status).toBe("multiple");
    expect(state.matches.map((match) => match.id)).toEqual([
      "one",
      "two"
    ]);
    expect(state.matches[1]?.folderPath).toEqual(["资料"]);
  });

  it("distinguishes an editable canonical-only match", () => {
    const state = buildBookmarkSaveState(
      [
        {
          id: "bar",
          title: "书签栏",
          folderType: "bookmarks-bar",
          children: [
            {
              id: "one",
              parentId: "bar",
              title: "One",
              url: "https://example.com/article?utm_source=test"
            }
          ]
        }
      ],
      "https://example.com/article"
    );
    expect(state.status).toBe("canonical");
    expect(state.matches[0]?.matchKind).toBe("canonical");
  });

  it("automatically recognizes one exact editable match", () => {
    const state = buildBookmarkSaveState(
      [
        {
          id: "bar",
          title: "书签栏",
          children: [
            {
              id: "one",
              parentId: "bar",
              title: "One",
              url: "https://example.com/article"
            }
          ]
        }
      ],
      "https://example.com/article"
    );
    expect(state.status).toBe("exact");
  });

  it("keeps a managed match read-only instead of treating it as absent", () => {
    const state = buildBookmarkSaveState(
      [
        {
          id: "managed",
          title: "组织书签",
          children: [
            {
              id: "one",
              parentId: "managed",
              title: "Policy",
              url: "https://example.com/policy",
              unmodifiable: true
            }
          ]
        }
      ],
      "https://example.com/policy"
    );
    expect(state.status).toBe("readonly");
    expect(state.matches[0]?.unmodifiable).toBe(true);
  });
});

describe("bookmarkPageMenuPresentation", () => {
  it("uses the product wording for absent, present and unknown states", () => {
    expect(
      bookmarkPageMenuPresentation({ status: "none", matches: [] })
    ).toEqual({ title: "添加到收藏…", enabled: true });
    expect(
      bookmarkPageMenuPresentation({
        status: "exact",
        matches: [
          {
            id: "one",
            parentId: "bar",
            title: "One",
            url: "https://example.com",
            folderPath: [],
            unmodifiable: false,
            matchKind: "exact"
          }
        ]
      })
    ).toEqual({ title: "管理此收藏…", enabled: true });
    expect(bookmarkPageMenuPresentation(null)).toEqual({
      title: "暂时无法确认收藏状态",
      enabled: false
    });
  });
});

describe("bookmarkSnapshotMenuPresentation", () => {
  it("only exposes manual cover refresh for a confirmed bookmark", () => {
    expect(
      bookmarkSnapshotMenuPresentation({ status: "none", matches: [] })
    ).toEqual({ title: "更新封面", enabled: false, visible: false });
    expect(bookmarkSnapshotMenuPresentation(null)).toEqual({
      title: "更新封面",
      enabled: false,
      visible: false
    });
    expect(
      bookmarkSnapshotMenuPresentation({ status: "readonly", matches: [] })
    ).toEqual({ title: "更新封面", enabled: true, visible: true });
    expect(
      bookmarkSnapshotMenuPresentation(
        { status: "exact", matches: [] },
        false
      )
    ).toEqual({ title: "更新封面", enabled: false, visible: false });
  });
});

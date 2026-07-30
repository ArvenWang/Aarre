import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createRemovedNodeUndoBatch,
  undoBookmarkBatch
} from "../src/lib/bookmark-undo";
import type { UndoSnapshotBatch } from "../src/lib/types";

const get = vi.fn();
const getChildren = vi.fn();
const create = vi.fn();
const update = vi.fn();
const move = vi.fn();
const remove = vi.fn();
const removeTree = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("chrome", {
    bookmarks: {
      get,
      getChildren,
      create,
      update,
      move,
      remove,
      removeTree
    }
  });
});

function batch(
  mutations: UndoSnapshotBatch["mutations"]
): UndoSnapshotBatch {
  return {
    batchId: "batch-1",
    source: "agent",
    label: "AI 批量操作",
    destructive: true,
    createdAt: "2026-07-30T00:00:00.000Z",
    expiresAt: "2099-07-30T00:00:00.000Z",
    status: "ready",
    mutations
  };
}

describe("bookmark undo", () => {
  it("turns a Chrome folder removal event into one restorable subtree batch", async () => {
    const removed = createRemovedNodeUndoBatch({
      parentId: "bookmarks-bar",
      index: 3,
      at: new Date("2026-07-30T00:00:00.000Z"),
      node: {
        id: "old-folder",
        title: "资料",
        syncing: true,
        children: Array.from({ length: 5 }, (_, index) => ({
          id: `old-${index}`,
          parentId: "old-folder",
          index,
          title: `资料 ${index + 1}`,
          url: `https://example.com/${index + 1}`,
          syncing: true
        }))
      }
    });

    expect(removed).toMatchObject({
      source: "chrome",
      status: "ready",
      destructive: true,
      createdAt: "2026-07-30T00:00:00.000Z",
      expiresAt: "2026-08-29T00:00:00.000Z"
    });
    expect(removed.mutations).toHaveLength(1);
    expect(removed.mutations[0]).toMatchObject({
      kind: "restore_subtree",
      applied: true,
      node: {
        parentId: "bookmarks-bar",
        index: 3,
        title: "资料"
      }
    });
    expect(removed.mutations[0]?.node?.children).toHaveLength(5);

    get.mockResolvedValue([
      {
        id: "bookmarks-bar",
        title: "书签栏",
        syncing: true
      }
    ]);
    let createdIndex = 0;
    create.mockImplementation(async (input) => ({
      id: `restored-${++createdIndex}`,
      syncing: true,
      ...input
    }));
    const restored = await undoBookmarkBatch(
      removed,
      async () => "fallback"
    );
    expect(restored).toMatchObject({ restored: 1, failed: 0 });
    expect(create).toHaveBeenCalledTimes(6);
  });

  it("recreates a deleted folder subtree in its original order", async () => {
    get.mockImplementation(async (id: string) =>
      id === "parent"
        ? [{ id: "parent", title: "书签栏", index: 0 }]
        : []
    );
    let createdIndex = 0;
    create.mockImplementation(async (input) => ({
      id: `new-${++createdIndex}`,
      ...input
    }));

    const result = await undoBookmarkBatch(
      batch([
        {
          id: "mutation-1",
          kind: "restore_subtree",
          label: "删除资料",
          destructive: true,
          applied: true,
          node: {
            id: "old-folder",
            parentId: "parent",
            index: 2,
            title: "资料",
            children: [
              {
                id: "old-a",
                parentId: "old-folder",
                index: 0,
                title: "A",
                url: "https://example.com/a"
              },
              {
                id: "old-b",
                parentId: "old-folder",
                index: 1,
                title: "B",
                url: "https://example.com/b"
              }
            ]
          }
        }
      ]),
      async () => "fallback"
    );

    expect(result).toMatchObject({ restored: 1, failed: 0 });
    expect(create).toHaveBeenNthCalledWith(1, {
      parentId: "parent",
      index: 2,
      title: "资料"
    });
    expect(create).toHaveBeenNthCalledWith(2, {
      parentId: "new-1",
      index: 0,
      title: "A",
      url: "https://example.com/a"
    });
    expect(create).toHaveBeenNthCalledWith(3, {
      parentId: "new-1",
      index: 1,
      title: "B",
      url: "https://example.com/b"
    });
  });

  it("finds and removes a created node even when its generated id was not persisted", async () => {
    get.mockRejectedValue(new Error("missing"));
    getChildren.mockResolvedValue([
      { id: "before", parentId: "parent", title: "旧项目" },
      {
        id: "created",
        parentId: "parent",
        title: "新项目",
        url: "https://example.com/new"
      }
    ]);

    const onBeforeRemove = vi.fn();
    const onAfterRemove = vi.fn();
    const result = await undoBookmarkBatch(
      batch([
        {
          id: "mutation-2",
          kind: "remove_created",
          label: "创建新项目",
          destructive: false,
          applied: true,
          parentId: "parent",
          beforeChildIds: ["before"],
          expectedTitle: "新项目",
          expectedUrl: "https://example.com/new"
        }
      ]),
      async () => "fallback",
      { onBeforeRemove, onAfterRemove }
    );

    expect(result.failed).toBe(0);
    expect(onBeforeRemove).toHaveBeenCalledWith("created");
    expect(onAfterRemove).toHaveBeenCalledWith("created");
    expect(remove).toHaveBeenCalledWith("created");
  });
});

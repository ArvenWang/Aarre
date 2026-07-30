import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  snapshotNodeMutation,
  undoBookmarkBatch
} from "../src/lib/bookmark-undo";
import { executeProtectedBookmarkMutation } from "../src/lib/protected-bookmark-mutation";
import {
  deleteUndoSnapshot,
  getUndoSnapshots,
  putUndoSnapshot
} from "../src/lib/storage";
import type {
  UndoMutation,
  UndoSnapshotBatch
} from "../src/lib/types";

const get = vi.fn();
const getSubTree = vi.fn();
const create = vi.fn();
const remove = vi.fn();
const removeTree = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("chrome", {
    bookmarks: {
      get,
      getSubTree,
      create,
      remove,
      removeTree
    }
  });
});

async function storedBatch(label: string): Promise<UndoSnapshotBatch> {
  const stored = (await getUndoSnapshots()).find(
    (batch) => batch.label === label
  );
  expect(stored).toBeDefined();
  return stored as UndoSnapshotBatch;
}

async function removeStoredBatch(label: string): Promise<void> {
  const stored = (await getUndoSnapshots()).find(
    (batch) => batch.label === label
  );
  if (stored) await deleteUndoSnapshot(stored.batchId);
}

function createMutation(label: string): UndoMutation {
  return {
    id: crypto.randomUUID(),
    kind: "remove_created",
    label,
    destructive: false,
    applied: false,
    parentId: "bookmarks-bar",
    beforeChildIds: [],
    expectedTitle: "新书签",
    expectedUrl: "https://example.com/new"
  };
}

describe("protected bookmark mutation integration", () => {
  it("does not execute the Chrome write when the initial snapshot cannot be stored", async () => {
    const perform = vi.fn(async () => ({ id: "never-created" }));

    await expect(
      executeProtectedBookmarkMutation(
        {
          label: "快照失败",
          destructive: false,
          mutation: createMutation("快照失败"),
          perform
        },
        {
          putSnapshot: async () => {
            throw new Error("IndexedDB unavailable");
          },
          deleteSnapshot: deleteUndoSnapshot,
          rollback: async () => null
        }
      )
    ).rejects.toThrow("IndexedDB unavailable");

    expect(perform).not.toHaveBeenCalled();
  });

  it("automatically rolls back when the ready-state write fails", async () => {
    const label = `状态回写失败-${crypto.randomUUID()}`;
    let writeCount = 0;
    let createdExists = false;
    create.mockImplementation(async (input) => {
      createdExists = true;
      return { id: "created-node", ...input };
    });
    get.mockImplementation(async (nodeId: string) =>
      nodeId === "created-node" && createdExists
        ? [
            {
              id: "created-node",
              parentId: "bookmarks-bar",
              title: "新书签",
              url: "https://example.com/new"
            }
          ]
        : []
    );
    remove.mockImplementation(async () => {
      createdExists = false;
    });

    await expect(
      executeProtectedBookmarkMutation(
        {
          label,
          destructive: false,
          mutation: createMutation(label),
          perform: () =>
            chrome.bookmarks.create({
              parentId: "bookmarks-bar",
              title: "新书签",
              url: "https://example.com/new"
            }),
          createdNodeId: (node) => node.id
        },
        {
          putSnapshot: async (batch) => {
            writeCount += 1;
            if (writeCount === 2) {
              throw new Error("ready-state write failed");
            }
            await putUndoSnapshot(batch);
          },
          deleteSnapshot: deleteUndoSnapshot,
          rollback: (batch) =>
            undoBookmarkBatch(batch, async () => "bookmarks-bar")
        }
      )
    ).rejects.toThrow("本次修改已自动回滚");

    expect(create).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith("created-node");
    expect(createdExists).toBe(false);
    expect(await storedBatch(label)).toMatchObject({
      status: "undone",
      mutations: [{ createdNodeId: "created-node" }]
    });
    await removeStoredBatch(label);
  });

  it("serializes a complete folder subtree before deleting it", async () => {
    const label = `删除整棵子树-${crypto.randomUUID()}`;
    getSubTree.mockResolvedValue([
      {
        id: "folder",
        parentId: "bookmarks-bar",
        index: 2,
        title: "资料",
        children: [
          {
            id: "child-a",
            parentId: "folder",
            index: 0,
            title: "A",
            url: "https://example.com/a"
          },
          {
            id: "nested",
            parentId: "folder",
            index: 1,
            title: "子文件夹",
            children: [
              {
                id: "child-b",
                parentId: "nested",
                index: 0,
                title: "B",
                url: "https://example.com/b"
              }
            ]
          }
        ]
      }
    ]);
    const mutation = await snapshotNodeMutation({
      nodeId: "folder",
      kind: "restore_subtree",
      label,
      destructive: true
    });

    await executeProtectedBookmarkMutation(
      {
        label,
        destructive: true,
        mutation,
        perform: async () => {
          await chrome.bookmarks.removeTree("folder");
        }
      },
      {
        putSnapshot: putUndoSnapshot,
        deleteSnapshot: deleteUndoSnapshot,
        rollback: async () => null
      }
    );

    expect(removeTree).toHaveBeenCalledWith("folder");
    expect(await storedBatch(label)).toMatchObject({
      status: "ready",
      mutations: [
        {
          kind: "restore_subtree",
          node: {
            id: "folder",
            children: [
              { id: "child-a" },
              {
                id: "nested",
                children: [{ id: "child-b" }]
              }
            ]
          }
        }
      ]
    });
    await removeStoredBatch(label);
  });
});

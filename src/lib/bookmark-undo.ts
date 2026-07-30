import type {
  NativeBookmarkNode,
  UndoBatchResult,
  UndoMutation,
  UndoSnapshotBatch
} from "./types";

const UNDO_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;

function serializeBookmarkNode(
  node: chrome.bookmarks.BookmarkTreeNode
): NativeBookmarkNode {
  return {
    id: node.id,
    parentId: node.parentId,
    index: node.index,
    title: node.title || "未命名",
    url: node.url,
    dateAdded: node.dateAdded,
    dateLastUsed: node.dateLastUsed,
    folderType: node.folderType,
    syncing: node.syncing,
    unmodifiable: node.unmodifiable === "managed",
    children: node.children?.map(serializeBookmarkNode)
  };
}

export function createUndoBatch(input: {
  source: UndoSnapshotBatch["source"];
  label: string;
  destructive: boolean;
  mutations: UndoMutation[];
  at?: Date;
}): UndoSnapshotBatch {
  const at = input.at || new Date();
  return {
    batchId: crypto.randomUUID(),
    source: input.source,
    label: input.label,
    destructive: input.destructive,
    createdAt: at.toISOString(),
    expiresAt: new Date(at.getTime() + UNDO_RETENTION_MS).toISOString(),
    status: "pending",
    mutations: input.mutations
  };
}

export function createRemovedNodeUndoBatch(input: {
  node: chrome.bookmarks.BookmarkTreeNode;
  parentId: string;
  index: number;
  at?: Date;
}): UndoSnapshotBatch {
  const node = serializeBookmarkNode({
    ...input.node,
    parentId: input.parentId,
    index: input.index
  });
  const label = `Chrome 书签管理器删除“${node.title || node.url || "未命名项目"}”`;
  const batch = createUndoBatch({
    source: "chrome",
    label,
    destructive: true,
    at: input.at,
    mutations: [
      {
        id: crypto.randomUUID(),
        kind: "restore_subtree",
        label,
        destructive: true,
        applied: true,
        node
      }
    ]
  });
  return { ...batch, status: "ready" };
}

export async function snapshotCreatedMutation(input: {
  parentId: string;
  label: string;
  actionId?: string;
  title: string;
  url?: string;
  destructive?: boolean;
}): Promise<UndoMutation> {
  const children = await chrome.bookmarks.getChildren(input.parentId);
  return {
    id: crypto.randomUUID(),
    actionId: input.actionId,
    kind: "remove_created",
    label: input.label,
    destructive: Boolean(input.destructive),
    applied: false,
    parentId: input.parentId,
    beforeChildIds: children.map((child) => child.id),
    expectedTitle: input.title,
    expectedUrl: input.url
  };
}

export async function snapshotNodeMutation(input: {
  nodeId: string;
  kind: "restore_subtree" | "restore_update" | "restore_move";
  label: string;
  actionId?: string;
  destructive?: boolean;
}): Promise<UndoMutation> {
  const nodes =
    input.kind === "restore_subtree"
      ? await chrome.bookmarks.getSubTree(input.nodeId)
      : await chrome.bookmarks.get(input.nodeId);
  const node = nodes[0];
  if (!node || node.unmodifiable === "managed" || node.folderType) {
    throw new Error("无法为这个 Chrome 管理项目创建撤销快照。");
  }
  return {
    id: crypto.randomUUID(),
    actionId: input.actionId,
    kind: input.kind,
    label: input.label,
    destructive: Boolean(input.destructive),
    applied: false,
    node: serializeBookmarkNode(node)
  };
}

async function existingNode(
  nodeId: string
): Promise<chrome.bookmarks.BookmarkTreeNode | undefined> {
  try {
    return (await chrome.bookmarks.get(nodeId))[0];
  } catch {
    return undefined;
  }
}

async function writableParentId(
  requestedParentId: string | undefined,
  fallbackParentId: () => Promise<string>
): Promise<{ parentId: string; fellBack: boolean }> {
  if (requestedParentId) {
    const parent = await existingNode(requestedParentId);
    if (
      parent &&
      !parent.url &&
      parent.unmodifiable !== "managed" &&
      !parent.folderType
    ) {
      return { parentId: parent.id, fellBack: false };
    }
  }
  return { parentId: await fallbackParentId(), fellBack: true };
}

async function recreateSubtree(
  node: NativeBookmarkNode,
  parentId: string,
  index?: number
): Promise<chrome.bookmarks.BookmarkTreeNode> {
  const created = await chrome.bookmarks.create({
    parentId,
    ...(typeof index === "number" ? { index } : {}),
    title: node.title,
    ...(node.url ? { url: node.url } : {})
  });
  if (!node.url) {
    for (const child of node.children || []) {
      await recreateSubtree(child, created.id, child.index);
    }
  }
  return created;
}

async function removeCreatedNode(
  mutation: UndoMutation,
  onBeforeRemove?: (nodeId: string) => void,
  onAfterRemove?: (nodeId: string) => void
): Promise<string> {
  let target = mutation.createdNodeId
    ? await existingNode(mutation.createdNodeId)
    : undefined;
  if (!target && mutation.parentId) {
    const before = new Set(mutation.beforeChildIds || []);
    const children = await chrome.bookmarks.getChildren(mutation.parentId);
    target = children.find(
      (child) =>
        !before.has(child.id) &&
        child.title === mutation.expectedTitle &&
        (mutation.expectedUrl === undefined ||
          child.url === mutation.expectedUrl)
    );
  }
  if (!target) {
    throw new Error(`未找到“${mutation.label}”创建的项目，未删除任何内容。`);
  }
  onBeforeRemove?.(target.id);
  try {
    if (target.url) {
      await chrome.bookmarks.remove(target.id);
    } else {
      await chrome.bookmarks.removeTree(target.id);
    }
  } finally {
    onAfterRemove?.(target.id);
  }
  return `已撤销：${mutation.label}`;
}

async function restoreMutation(
  mutation: UndoMutation,
  fallbackParentId: () => Promise<string>,
  onBeforeRemove?: (nodeId: string) => void,
  onAfterRemove?: (nodeId: string) => void
): Promise<string> {
  if (!mutation.applied) return "";
  if (mutation.kind === "remove_created") {
    return removeCreatedNode(
      mutation,
      onBeforeRemove,
      onAfterRemove
    );
  }
  if (!mutation.node) {
    throw new Error(`“${mutation.label}”缺少恢复数据。`);
  }
  if (mutation.kind === "restore_subtree") {
    const parent = await writableParentId(
      mutation.node.parentId,
      fallbackParentId
    );
    await recreateSubtree(
      mutation.node,
      parent.parentId,
      parent.fellBack ? undefined : mutation.node.index
    );
    return parent.fellBack
      ? `已恢复“${mutation.node.title}”，原文件夹不存在，已放回主书签栏。`
      : `已恢复“${mutation.node.title}”及其全部内容。`;
  }

  const current = await existingNode(mutation.node.id);
  if (!current) {
    throw new Error(`“${mutation.node.title}”已不存在，无法恢复原状态。`);
  }
  if (mutation.kind === "restore_update") {
    await chrome.bookmarks.update(current.id, {
      title: mutation.node.title,
      ...(current.url && mutation.node.url ? { url: mutation.node.url } : {})
    });
    return `已恢复“${mutation.node.title}”的原名称和网址。`;
  }

  const parent = await writableParentId(
    mutation.node.parentId,
    fallbackParentId
  );
  await chrome.bookmarks.move(current.id, {
    parentId: parent.parentId,
    ...(parent.fellBack || typeof mutation.node.index !== "number"
      ? {}
      : { index: mutation.node.index })
  });
  return parent.fellBack
    ? `已恢复“${mutation.node.title}”，原文件夹不存在，已移到主书签栏。`
    : `已将“${mutation.node.title}”移回原位置。`;
}

export async function undoBookmarkBatch(
  batch: UndoSnapshotBatch,
  fallbackParentId: () => Promise<string>,
  options: {
    onBeforeRemove?: (nodeId: string) => void;
    onAfterRemove?: (nodeId: string) => void;
  } = {}
): Promise<UndoBatchResult> {
  if (batch.status === "undone") {
    throw new Error("这批更改已经撤销过了。");
  }
  if (Date.parse(batch.expiresAt) <= Date.now()) {
    throw new Error("这批更改已超过 30 天保留期，无法撤销。");
  }

  const messages: string[] = [];
  let restored = 0;
  let failed = 0;
  for (const mutation of [...batch.mutations].reverse()) {
    if (!mutation.applied) continue;
    try {
      const message = await restoreMutation(
        mutation,
        fallbackParentId,
        options.onBeforeRemove,
        options.onAfterRemove
      );
      if (message) messages.push(message);
      restored += 1;
    } catch (error) {
      failed += 1;
      messages.push(
        error instanceof Error ? error.message : `“${mutation.label}”恢复失败。`
      );
    }
  }

  const updated: UndoSnapshotBatch = {
    ...batch,
    status: failed ? "partial" : "undone",
    undoneAt: new Date().toISOString(),
    resultMessages: messages
  };
  return { batch: updated, restored, failed, messages };
}

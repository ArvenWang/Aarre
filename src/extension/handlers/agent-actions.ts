import { countBookmarkNodes, serializeBookmarkNode } from "../../lib/bookmark-tree";
import {
  cleanupExpiredUndoSnapshots,
  deleteUndoSnapshot,
  getLocalResource,
  getUndoSnapshot,
  getUndoSnapshots,
  putUndoSnapshot
} from "../../lib/storage";
import {
  createUndoBatch,
  snapshotCreatedMutation,
  snapshotMetadataMutation,
  snapshotNodeMutation,
  undoBookmarkBatch
} from "../../lib/bookmark-undo";
import {
  AGENT_PLAN_BATCH_SIZE,
  orderAgentPlanActions
} from "../../lib/agent/plan-execution";
import type {
  BookmarkAgentActionExecutionResult,
  BookmarkAgentActionProposal,
  BookmarkSaveState,
  ImportResult,
  NativeBookmarkNode,
  ResourceRecord,
  UndoMutation,
  UndoSnapshotBatch
} from "../../lib/types";

interface AgentActionDependencies {
  getBookmarkSaveState(url: string): Promise<BookmarkSaveState>;
  markNativeBookmarksDirty(): void;
  createNativeFolder(input: { parentId: string; title: string }, skipUndo?: boolean): Promise<NativeBookmarkNode>;
  deleteNativeBookmark(input: { id: string; recursive: boolean }, skipUndo?: boolean): Promise<{ deleted: true }>;
  updateNativeBookmark(input: { id: string; title: string; url?: string }, skipUndo?: boolean): Promise<NativeBookmarkNode>;
  moveNativeBookmark(input: { id: string; parentId: string }, skipUndo?: boolean): Promise<NativeBookmarkNode>;
  upsertLocalResource(resource: ResourceRecord): Promise<void>;
  importNativeBookmarks(): Promise<ImportResult>;
  defaultFolderId(): Promise<string>;
  markInternalBookmarkRemoval(id: string): void;
  releaseInternalBookmarkRemoval(id: string): void;
  errorMessage(error: unknown): string;
}

export function createAgentActionHandlers(dependencies: AgentActionDependencies) {
  const {
    getBookmarkSaveState,
    markNativeBookmarksDirty,
    createNativeFolder,
    deleteNativeBookmark,
    updateNativeBookmark,
    moveNativeBookmark,
    upsertLocalResource,
    importNativeBookmarks,
    defaultFolderId,
    markInternalBookmarkRemoval,
    releaseInternalBookmarkRemoval,
    errorMessage
  } = dependencies;
  const activeExecutions = new Map<string, AbortController>();
function validateAgentBookmarkUrl(value: string | undefined): string {
  const text = value?.trim() || "";
  try {
    const parsed = new URL(text);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error("unsupported protocol");
    }
    return parsed.href;
  } catch {
    throw new Error("AI 操作中的书签网址无效，未执行任何写入。");
  }
}

async function createNativeBookmarkFromAgent(input: {
  parentId: string;
  title: string;
  url: string;
}): Promise<NativeBookmarkNode> {
  const title = input.title.trim();
  if (!title) {
    throw new Error("书签名称不能为空。");
  }
  const url = validateAgentBookmarkUrl(input.url);
  const saveState = await getBookmarkSaveState(url);
  if (saveState.status !== "none") {
    throw new Error(
      "这个网址已经存在于 Chrome 收藏中。为避免重复，Aarre 没有再创建一条。"
    );
  }
  const [parent] = await chrome.bookmarks.get(input.parentId);
  if (
    !parent ||
    parent.url ||
    parent.unmodifiable === "managed"
  ) {
    throw new Error("目标文件夹不可写入。");
  }
  markNativeBookmarksDirty();
  const created = await chrome.bookmarks.create({
    parentId: parent.id,
    title: title.slice(0, 200),
    url
  });
  const [verified] = await chrome.bookmarks.get(created.id);
  if (!verified?.url || verified.url !== url) {
    throw new Error("Chrome 没有保存这个书签，请重试。");
  }
  return serializeBookmarkNode(verified);
}

async function getAgentActionTarget(
  id: string | undefined,
  kind: "bookmark" | "folder"
): Promise<chrome.bookmarks.BookmarkTreeNode> {
  if (!id) {
    throw new Error("AI 操作缺少明确目标，未执行。");
  }
  const [node] = await chrome.bookmarks.get(id);
  if (
    !node ||
    node.unmodifiable === "managed" ||
    (kind === "bookmark" ? !node.url : Boolean(node.url)) ||
    (kind === "folder" && Boolean(node.folderType))
  ) {
    throw new Error("目标已不存在或不可修改，请刷新后重新确认。");
  }
  return node;
}

function verifyAgentActionTargetUnchanged(
  action: BookmarkAgentActionProposal,
  node: chrome.bookmarks.BookmarkTreeNode
): void {
  if (
    (action.expectedTitle !== undefined &&
      node.title !== action.expectedTitle) ||
    (action.expectedUrl !== undefined &&
      node.url !== action.expectedUrl) ||
    (action.expectedParentId !== undefined &&
      node.parentId !== action.expectedParentId)
  ) {
    throw new Error(
      "目标在确认前已发生变化。为避免误操作，本次没有执行，请重新发起请求。"
    );
  }
}

async function verifyAgentActionTargetMissing(id: string): Promise<void> {
  let exists = false;
  try {
    exists = Boolean((await chrome.bookmarks.get(id))[0]);
  } catch {
    exists = false;
  }
  if (exists) {
    throw new Error("Chrome 仍返回这个项目，删除未完成。");
  }
}

async function executeBookmarkAgentAction(
  action: BookmarkAgentActionProposal
): Promise<BookmarkAgentActionExecutionResult> {
  if (!action.id || action.status !== "pending") {
    throw new Error("这项操作已经处理或状态无效。");
  }

  switch (action.type) {
    case "create_bookmark": {
      if (!action.parentId || !action.title || !action.url) {
        throw new Error("添加书签所需信息不完整。");
      }
      const created = await createNativeBookmarkFromAgent({
        parentId: action.parentId,
        title: action.title,
        url: action.url
      });
      return {
        actionId: action.id,
        success: true,
        message: `已创建书签「${created.title}」，并从 Chrome 重新读取确认。`,
        createdNodeId: created.id
      };
    }
    case "create_folder": {
      if (!action.parentId || !action.title) {
        throw new Error("新建文件夹所需信息不完整。");
      }
      const created = await createNativeFolder({
        parentId: action.parentId,
        title: action.title
      }, true);
      const [verified] = await chrome.bookmarks.get(created.id);
      if (!verified || verified.url) {
        throw new Error("Chrome 没有保存这个文件夹，请重试。");
      }
      return {
        actionId: action.id,
        success: true,
        message: `已创建文件夹「${verified.title}」，并从 Chrome 重新读取确认。`,
        createdNodeId: verified.id
      };
    }
    case "delete_bookmark": {
      const target = await getAgentActionTarget(
        action.targetId,
        "bookmark"
      );
      verifyAgentActionTargetUnchanged(action, target);
      await deleteNativeBookmark({
        id: target.id,
        recursive: false
      }, true);
      await verifyAgentActionTargetMissing(target.id);
      return {
        actionId: action.id,
        success: true,
        message: `已从 Chrome 删除书签「${target.title || target.url}」。`
      };
    }
    case "delete_folder": {
      const target = await getAgentActionTarget(
        action.targetId,
        "folder"
      );
      verifyAgentActionTargetUnchanged(action, target);
      const count = countBookmarkNodes(target).bookmarkCount;
      await deleteNativeBookmark({
        id: target.id,
        recursive: true
      }, true);
      await verifyAgentActionTargetMissing(target.id);
      return {
        actionId: action.id,
        success: true,
        message: `已从 Chrome 删除文件夹「${target.title}」及其中 ${count} 个书签。`
      };
    }
    case "update_bookmark": {
      const target = await getAgentActionTarget(
        action.targetId,
        "bookmark"
      );
      verifyAgentActionTargetUnchanged(action, target);
      const updated = await updateNativeBookmark({
        id: target.id,
        title: action.title || target.title,
        url: validateAgentBookmarkUrl(action.url || target.url)
      }, true);
      const [verified] = await chrome.bookmarks.get(updated.id);
      if (
        !verified ||
        verified.title !== updated.title ||
        verified.url !== updated.url
      ) {
        throw new Error("Chrome 返回的书签与修改结果不一致。");
      }
      return {
        actionId: action.id,
        success: true,
        message: `已修改书签「${verified.title}」，并从 Chrome 重新读取确认。`
      };
    }
    case "rename_folder": {
      const target = await getAgentActionTarget(
        action.targetId,
        "folder"
      );
      verifyAgentActionTargetUnchanged(action, target);
      const updated = await updateNativeBookmark({
        id: target.id,
        title: action.title || ""
      }, true);
      const [verified] = await chrome.bookmarks.get(updated.id);
      if (!verified || verified.title !== updated.title) {
        throw new Error("Chrome 返回的文件夹名称与修改结果不一致。");
      }
      return {
        actionId: action.id,
        success: true,
        message: `已将文件夹重命名为「${verified.title}」。`
      };
    }
    case "update_metadata": {
      if (!action.resourceKey) {
        throw new Error("这项操作没有对应的 Aarre 收藏。");
      }
      const resource = await getLocalResource(action.resourceKey);
      if (!resource) {
        throw new Error("这条收藏已不存在，没有修改任何信息。");
      }
      const updated: ResourceRecord = {
        ...resource,
        ...(action.tags ? { tags: action.tags, tagsSource: "user" } : {}),
        ...(action.userNote === undefined
          ? {}
          : { userNote: action.userNote }),
        ...(action.summary === undefined ? {} : { summary: action.summary }),
        updatedAt: new Date().toISOString()
      };
      await upsertLocalResource(updated);
      return {
        actionId: action.id,
        success: true,
        message: `已更新「${updated.title}」的 Aarre 信息，Chrome 书签未改动。`
      };
    }
    case "move_bookmark":
    case "move_folder": {
      const target = await getAgentActionTarget(
        action.targetId,
        action.type === "move_bookmark" ? "bookmark" : "folder"
      );
      verifyAgentActionTargetUnchanged(action, target);
      if (!action.destinationId) {
        throw new Error("移动操作缺少目标文件夹。");
      }
      const [destination] = await chrome.bookmarks.get(
        action.destinationId
      );
      if (
        !destination ||
        destination.url ||
        destination.unmodifiable === "managed"
      ) {
        throw new Error("目标文件夹已不存在或不可写入。");
      }
      const moved = await moveNativeBookmark({
        id: target.id,
        parentId: destination.id
      }, true);
      const [verified] = await chrome.bookmarks.get(moved.id);
      if (!verified || verified.parentId !== destination.id) {
        throw new Error("Chrome 返回的位置与移动结果不一致。");
      }
      return {
        actionId: action.id,
        success: true,
        message: `已将「${verified.title}」移动到「${destination.title}」。`
      };
    }
  }
}

async function prepareAgentUndoBatch(
  actions: BookmarkAgentActionProposal[],
  label = `AI 批量操作（${actions.length} 项）`
): Promise<UndoSnapshotBatch> {
  const mutations: UndoMutation[] = [];
  for (const action of actions) {
    if (action.type === "create_bookmark" || action.type === "create_folder") {
      if (!action.title) {
        throw new Error("AI 操作缺少创建目标，无法建立撤销快照。");
      }
      mutations.push(action.parentId
        ? await snapshotCreatedMutation({
          parentId: action.parentId,
          actionId: action.id,
          label: action.label,
          title: action.title,
          url: action.type === "create_bookmark" ? action.url : undefined,
          destructive: action.destructive
        })
        : {
            id: crypto.randomUUID(),
            actionId: action.id,
            kind: "remove_created",
            label: action.label,
            destructive: action.destructive,
            applied: false,
            expectedTitle: action.title,
            expectedUrl: action.type === "create_bookmark" ? action.url : undefined
          });
      continue;
    }
    if (action.type === "update_metadata") {
      if (!action.resourceKey) {
        throw new Error("AI 操作缺少收藏标识，无法建立撤销快照。");
      }
      const resource = await getLocalResource(action.resourceKey);
      if (!resource) {
        throw new Error("这条收藏已不存在，无法建立撤销快照。");
      }
      mutations.push(
        snapshotMetadataMutation({
          resourceKey: resource.resourceKey,
          actionId: action.id,
          label: action.label,
          before: {
            tags: resource.tags,
            tagsSource: resource.tagsSource,
            userNote: resource.userNote,
            summary: resource.summary
          }
        })
      );
      continue;
    }
    if (!action.targetId) {
      throw new Error("AI 操作缺少明确目标，无法建立撤销快照。");
    }
    mutations.push(
      await snapshotNodeMutation({
        nodeId: action.targetId,
        actionId: action.id,
        kind:
          action.type === "delete_bookmark" || action.type === "delete_folder"
            ? "restore_subtree"
            : action.type === "move_bookmark" || action.type === "move_folder"
              ? "restore_move"
              : "restore_update",
        label: action.label,
        destructive: action.destructive
      })
    );
  }
  const batch = createUndoBatch({
    source: "agent",
    label,
    destructive: actions.some((action) => action.destructive),
    mutations
  });
  await putUndoSnapshot(batch);
  return batch;
}

async function folderIdForPath(path: string): Promise<string | undefined> {
  const wanted = path.split("/").filter(Boolean);
  const tree = await chrome.bookmarks.getTree();
  let found: string | undefined;
  const visit = (node: chrome.bookmarks.BookmarkTreeNode, parentPath: string[]) => {
    if (found || node.url) return;
    const currentPath = node.id === "0"
      ? parentPath
      : [...parentPath, node.title || "未命名文件夹"];
    if (currentPath.join("/") === wanted.join("/")) {
      found = node.id;
      return;
    }
    for (const child of node.children || []) visit(child, currentPath);
  };
  for (const root of tree) visit(root, []);
  return found;
}

async function resolvePlannedAction(
  action: BookmarkAgentActionProposal
): Promise<BookmarkAgentActionProposal> {
  if (
    (action.type === "create_folder" || action.type === "create_bookmark") &&
    !action.parentId &&
    action.plannedPath
  ) {
    const parentPath = action.plannedPath.split("/").filter(Boolean).slice(0, -1).join("/");
    const parentId = await folderIdForPath(parentPath);
    if (!parentId) throw new Error(`计划中的父文件夹“${parentPath}”尚不存在。`);
    return { ...action, parentId };
  }
  if (
    (action.type === "move_bookmark" || action.type === "move_folder") &&
    !action.destinationId &&
    action.targetFolderPath
  ) {
    const destinationId = await folderIdForPath(action.targetFolderPath);
    if (!destinationId) throw new Error(`计划中的目标文件夹“${action.targetFolderPath}”尚不存在。`);
    return { ...action, destinationId };
  }
  return action;
}

async function executeBookmarkAgentActions(
  actions: BookmarkAgentActionProposal[],
  options: { maxActions?: number; label?: string; requestId?: string } = {}
): Promise<{
  results: BookmarkAgentActionExecutionResult[];
  batchId?: string;
  requestId: string;
  cancelled: boolean;
}> {
  const maxActions = options.maxActions ?? 1_000;
  if (
    !Array.isArray(actions) ||
    !actions.length ||
    actions.length > maxActions ||
    actions.some((action) => action.status !== "pending")
  ) {
    throw new Error("没有可执行的已确认操作。");
  }
  const orderedActions = orderAgentPlanActions(actions);
  let batch = await prepareAgentUndoBatch(orderedActions, options.label);
  const results: BookmarkAgentActionExecutionResult[] = [];
  const requestId = options.requestId || crypto.randomUUID();
  const controller = new AbortController();
  activeExecutions.set(requestId, controller);
  for (let index = 0; index < orderedActions.length; index += 1) {
    if (controller.signal.aborted) break;
    const action = orderedActions[index];
    const mutationIndex = batch.mutations.findIndex(
      (mutation) => mutation.actionId === action.id
    );
    let executed = false;
    let executionResult: BookmarkAgentActionExecutionResult | null = null;
    try {
      if (mutationIndex < 0) {
        throw new Error("这项操作没有对应的撤销快照，已拒绝执行。");
      }
      batch.mutations[mutationIndex] = {
        ...batch.mutations[mutationIndex],
        applied: true
      };
      await putUndoSnapshot(batch);
      executionResult = await executeBookmarkAgentAction(
        await resolvePlannedAction(action)
      );
      executed = true;
      if (executionResult.createdNodeId) {
        batch.mutations[mutationIndex] = {
          ...batch.mutations[mutationIndex],
          createdNodeId: executionResult.createdNodeId
        };
      }
      await putUndoSnapshot(batch);
      results.push(executionResult);
    } catch (error) {
      if (mutationIndex >= 0 && !executed) {
        batch.mutations[mutationIndex] = {
          ...batch.mutations[mutationIndex],
          applied: false
        };
        await putUndoSnapshot(batch).catch(() => undefined);
      }
      results.push(
        executed && executionResult
          ? {
              ...executionResult,
              message: `${executionResult.message} 撤销记录的状态更新失败，但执行前快照仍保留。`
            }
          : {
              actionId: action?.id || "",
              success: false,
              message: errorMessage(error)
            }
      );
    }
    const done = index + 1;
    if (done % AGENT_PLAN_BATCH_SIZE === 0 || done === orderedActions.length) {
      void chrome.runtime.sendMessage({
        type: "BOOKMARK_AGENT_EXECUTION_PROGRESS",
        requestId,
        done,
        total: orderedActions.length
      }).catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  activeExecutions.delete(requestId);
  const succeeded = results.filter((result) => result.success).length;
  if (succeeded) {
    batch = { ...batch, status: "ready" };
    await putUndoSnapshot(batch);
  } else {
    await deleteUndoSnapshot(batch.batchId);
  }
  await importNativeBookmarks();
  return {
    results,
    ...(succeeded ? { batchId: batch.batchId } : {}),
    requestId,
    cancelled: controller.signal.aborted
  };
}

function cancelAgentPlanExecution(requestId: string): void {
  activeExecutions.get(requestId)?.abort();
}

async function getRecentUndoSnapshots(): Promise<UndoSnapshotBatch[]> {
  await cleanupExpiredUndoSnapshots();
  return (await getUndoSnapshots()).filter(
    (batch) => batch.status !== "undone"
  );
}

async function restoreResourceMetadata(
  mutation: UndoMutation
): Promise<string> {
  const before = mutation.beforeMetadata;
  if (!mutation.resourceKey || !before) {
    throw new Error(`“${mutation.label}”缺少恢复数据。`);
  }
  const resource = await getLocalResource(mutation.resourceKey);
  if (!resource) {
    throw new Error(`“${mutation.label}”对应的收藏已不存在。`);
  }
  await upsertLocalResource({
    ...resource,
    ...(before.tags ? { tags: before.tags } : {}),
    ...(before.tagsSource ? { tagsSource: before.tagsSource } : {}),
    ...(before.userNote === undefined ? {} : { userNote: before.userNote }),
    ...(before.summary === undefined ? {} : { summary: before.summary }),
    updatedAt: new Date().toISOString()
  });
  return `已恢复“${resource.title}”的原标签、备注和摘要。`;
}

async function undoStoredBookmarkBatch(batchId: string) {
  const batch = await getUndoSnapshot(batchId);
  if (!batch) {
    throw new Error("没有找到这批更改，可能已超过 30 天保留期。");
  }
  const result = await undoBookmarkBatch(batch, defaultFolderId, {
    onBeforeRemove: markInternalBookmarkRemoval,
    onAfterRemove: releaseInternalBookmarkRemoval,
    restoreMetadata: restoreResourceMetadata
  });
  await putUndoSnapshot(result.batch);
  await importNativeBookmarks();
  return result;
}

  return {
    executeBookmarkAgentActions,
    cancelAgentPlanExecution,
    getRecentUndoSnapshots,
    undoStoredBookmarkBatch
  };
}

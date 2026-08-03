import { getAuthState } from "../../lib/auth";
import {
  deleteLocalResource,
  enqueueOutbox,
  getLocalResource,
  putUndoSnapshot,
  removeOutboxItem
} from "../../lib/storage";
import { serializeBookmarkNode } from "../../lib/bookmark-tree";
import {
  bookmarkEditTags,
  bookmarkUrlEditPlan,
  rehomeResourceAfterBookmarkUrlChange,
  runBookmarkEditRecoverySteps
} from "../../lib/bookmark-edit";
import {
  createUndoBatch,
  snapshotCreatedMutation,
  snapshotNodeMutation,
  undoBookmarkBatch
} from "../../lib/bookmark-undo";
import type { ProtectedBookmarkMutationInput } from "../../lib/protected-bookmark-mutation";
import { categoryCoverForResource } from "../../lib/cover-registry";
import { canonicalizeUrl, resourceKeyForUrl } from "../../lib/url";
import type {
  BookmarkSaveState,
  ImportResult,
  NativeBookmarkNode,
  ResourceRecord,
  UndoMutation,
  UndoSnapshotBatch,
  UpdateBookmarkDetailsInput,
  UpdateBookmarkDetailsResult
} from "../../lib/types";

interface BookmarkEditDependencies {
  getBookmarkSaveState(url: string): Promise<BookmarkSaveState>;
  markNativeBookmarksDirty(): void;
  runProtectedBookmarkMutation<T>(input: ProtectedBookmarkMutationInput<T>): Promise<T>;
  upsertLocalResource(resource: ResourceRecord): Promise<void>;
  syncPendingIfReady(): Promise<unknown>;
  importNativeBookmarks(force?: boolean): Promise<ImportResult>;
  folderPathForId(folderId: string): Promise<string[]>;
  cancelEnhancementForResource(resourceKey: string): Promise<void>;
  reconcileProtectionRules(): Promise<void>;
  queueEnhancementsUntilVisit(resource: ResourceRecord, trigger?: "recovery"): Promise<void>;
  defaultFolderId(): Promise<string>;
  markInternalBookmarkRemoval(id: string): void;
  releaseInternalBookmarkRemoval(id: string): void;
  markInternalBookmarkId(id: string): void;
  forgetInternalBookmarkId(id: string): void;
}

export function createBookmarkEditHandlers(dependencies: BookmarkEditDependencies) {
  const {
    getBookmarkSaveState,
    markNativeBookmarksDirty,
    runProtectedBookmarkMutation,
    upsertLocalResource,
    syncPendingIfReady,
    importNativeBookmarks,
    folderPathForId,
    cancelEnhancementForResource,
    reconcileProtectionRules,
    queueEnhancementsUntilVisit,
    defaultFolderId,
    markInternalBookmarkRemoval,
    releaseInternalBookmarkRemoval,
    markInternalBookmarkId,
    forgetInternalBookmarkId
  } = dependencies;
  const now = () => new Date().toISOString();
async function updateNativeBookmark(input: {
  id: string;
  title: string;
  url?: string;
}, skipUndo = false): Promise<NativeBookmarkNode> {
  const title = input.title.trim();
  if (!title) {
    throw new Error("名称不能为空。");
  }
  const [current] = await chrome.bookmarks.get(input.id);
  if (!current || current.unmodifiable === "managed") {
    throw new Error("这个书签由 Chrome 或组织管理，无法修改。");
  }
  const requestedUrl =
    current.url && input.url !== undefined
      ? validateEditableBookmarkUrl(input.url)
      : undefined;
  if (
    current.url &&
    requestedUrl &&
    canonicalizeUrl(requestedUrl) !== canonicalizeUrl(current.url)
  ) {
    const saveState = await getBookmarkSaveState(requestedUrl);
    if (saveState.matches.some((match) => match.id !== input.id)) {
      throw new Error(
        "这个网址已经存在于 Chrome 收藏中。请直接编辑已有收藏，避免合并时覆盖智能信息。"
      );
    }
  }
  const perform = async () => {
    markNativeBookmarksDirty();
    return serializeBookmarkNode(
      await chrome.bookmarks.update(input.id, {
        title,
        ...(current.url && requestedUrl
          ? { url: requestedUrl }
          : {})
      })
    );
  };
  if (skipUndo) return perform();
  const mutation = await snapshotNodeMutation({
    nodeId: input.id,
    kind: "restore_update",
    label: `修改“${current.title || current.url}”`
  });
  return runProtectedBookmarkMutation({
    label: mutation.label,
    destructive: false,
    mutation,
    perform
  });
}

function validateEditableBookmarkUrl(value: string): string {
  const text = value.trim();
  try {
    const parsed = new URL(text);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error("unsupported protocol");
    }
    return parsed.href;
  } catch {
    throw new Error("请输入以 http:// 或 https:// 开头的有效网址。");
  }
}

function normalizeUserTags(tags: string[]): string[] {
  return [
    ...new Set(
      tags
        .map((tag) => tag.trim().replace(/^#+\s*/, ""))
        .filter(Boolean)
        .map((tag) => tag.slice(0, 40))
    )
  ].slice(0, 16);
}

async function updateResourceTags(input: {
  resourceKey: string;
  tags: string[];
}): Promise<ResourceRecord> {
  const resource = await getLocalResource(input.resourceKey);
  if (!resource) {
    throw new Error("没有找到这个书签的智能信息，请刷新后再试。");
  }
  const auth = await getAuthState();
  const next: ResourceRecord = {
    ...resource,
    tags: normalizeUserTags(input.tags),
    tagsSource: "user",
    syncStatus:
      auth.signedIn && auth.accountMatches === true ? "pending" : "local",
    updatedAt: now()
  };
  await upsertLocalResource(next);
  if (auth.signedIn && auth.accountMatches === true) {
    await enqueueOutbox(next, "");
    void syncPendingIfReady();
  }
  return next;
}

async function updateBookmarkDetails(
  input: UpdateBookmarkDetailsInput
): Promise<UpdateBookmarkDetailsResult> {
  if (input.userNote.length > 2_000) {
    throw new Error("备注不能超过 2,000 个字符。");
  }

  let sourceResource = await getLocalResource(input.resourceKey);
  if (!sourceResource?.nativeBookmarkIds.includes(input.bookmarkId)) {
    await importNativeBookmarks();
    sourceResource = await getLocalResource(input.resourceKey);
  }
  if (!sourceResource?.nativeBookmarkIds.includes(input.bookmarkId)) {
    throw new Error(
      "这个收藏位置已经变化。请刷新收藏库后重新编辑，Aarre 没有写入任何内容。"
    );
  }

  const current = await chrome.bookmarks
    .get(input.bookmarkId)
    .then(([node]) => node);
  if (!current?.url) {
    throw new Error("这条 Chrome 收藏已经不存在，请刷新后再试。");
  }
  const managed = current.unmodifiable === "managed";
  const requestedTitle = input.title.trim();
  if (!managed && !requestedTitle) {
    throw new Error("名称不能为空。");
  }
  if (!managed && requestedTitle.length > 240) {
    throw new Error("名称不能超过 240 个字符。");
  }
  // 受组织管理的原生字段可能含历史空格或超过当前表单限制。
  // 元数据编辑必须完全忽略这些禁用字段，不能把它误判成 Chrome 修改。
  const title = managed ? current.title : requestedTitle;
  const url = managed
    ? current.url
    : validateEditableBookmarkUrl(input.url);
  const parentId = managed
    ? current.parentId || input.parentId
    : input.parentId;
  const parent = await chrome.bookmarks
    .get(parentId)
    .then(([node]) => node);
  // Chrome 保存的是用户输入的完整地址，不能用去追踪参数/普通 hash
  // 后的 canonical URL 来判断“是否需要写回”。否则用户只修改
  // utm、锚点或尾斜杠时，界面会提示成功，但 Chrome 里的网址没有变化。
  const urlPlan = bookmarkUrlEditPlan({
    source: sourceResource,
    currentUrl: current.url,
    nextUrl: url,
    ...(url !== current.url
      ? { changedUrlResourceKey: await resourceKeyForUrl(url) }
      : {})
  });
  const { bookmarkUrlChanged, targetResourceKey, resourceIdentityChanged } =
    urlPlan;
  const titleChanged = title !== current.title;
  const folderChanged = parentId !== current.parentId;
  if (
    folderChanged &&
    (!parent || parent.url || parent.unmodifiable === "managed")
  ) {
    throw new Error("目标文件夹不可写入，请选择其他文件夹。");
  }
  if (
    managed &&
    (bookmarkUrlChanged || titleChanged || folderChanged)
  ) {
    throw new Error(
      "这条收藏由 Chrome 或组织管理，只能修改 Aarre 标签和备注。"
    );
  }
  if (resourceIdentityChanged) {
    const saveState = await getBookmarkSaveState(url);
    if (
      saveState.matches.some(
        (match) => match.id !== input.bookmarkId
      )
    ) {
      throw new Error(
        "这个网址已经存在于 Chrome 收藏中。请编辑已有收藏，避免覆盖它的智能信息。"
      );
    }
  }

  const auth = await getAuthState();
  const timestamp = now();
  const requestedTags = normalizeUserTags(input.tags);
  const resolvedTags = bookmarkEditTags({
    sourceTags: sourceResource.tags,
    sourceTagsSource: sourceResource.tagsSource,
    requestedTags,
    tagsChanged: input.tagsChanged,
    resourceIdentityChanged
  });
  // 已有资源可能使用页面声明的 canonical URL，不能在仅编辑标题、备注
  // 或同 canonical URL 的细微地址变化时重新计算 key。
  const previousTarget =
    targetResourceKey === sourceResource.resourceKey
      ? undefined
      : await getLocalResource(targetResourceKey);
  const chromeMutations: UndoMutation[] = [];
  if (titleChanged || bookmarkUrlChanged) {
    chromeMutations.push(
      await snapshotNodeMutation({
        nodeId: input.bookmarkId,
        kind: "restore_update",
        label: `恢复“${current.title || current.url}”的名称和网址`
      })
    );
  }
  if (folderChanged) {
    chromeMutations.push(
      await snapshotNodeMutation({
        nodeId: input.bookmarkId,
        kind: "restore_move",
        label: `将“${current.title || current.url}”移回原文件夹`
      })
    );
  }

  let batch = chromeMutations.length
    ? createUndoBatch({
        source: "manual",
        label: `编辑“${current.title || current.url}”`,
        destructive: false,
        mutations: chromeMutations
      })
    : null;
  if (batch) {
    await putUndoSnapshot(batch);
  }

  let updatedNode = current;
  let storageChanged = false;
  markNativeBookmarksDirty();
  markInternalBookmarkId(input.bookmarkId);
  try {
    if (titleChanged || bookmarkUrlChanged) {
      if (batch) {
        batch = {
          ...batch,
          mutations: batch.mutations.map((mutation) =>
            mutation.kind === "restore_update"
              ? { ...mutation, applied: true }
              : mutation
          )
        };
        await putUndoSnapshot(batch);
      }
      updatedNode = await chrome.bookmarks.update(input.bookmarkId, {
        title,
        url
      });
    }
    if (folderChanged) {
      if (batch) {
        batch = {
          ...batch,
          mutations: batch.mutations.map((mutation) =>
            mutation.kind === "restore_move"
              ? { ...mutation, applied: true }
              : mutation
          )
        };
        await putUndoSnapshot(batch);
      }
      updatedNode = await chrome.bookmarks.move(input.bookmarkId, {
        parentId
      });
    }

    if (resourceIdentityChanged) {
      const { remainingSource, nextResource } =
        rehomeResourceAfterBookmarkUrlChange({
          source: sourceResource,
          ...(previousTarget ? { previousTarget } : {}),
          targetResourceKey,
          bookmarkId: input.bookmarkId,
          url,
          canonicalUrl: canonicalizeUrl(url),
          title,
          userNote: input.userNote.trim(),
          tags: resolvedTags.tags,
          categoryCoverId: categoryCoverForResource({
            url,
            title,
            topics: [],
            tags: resolvedTags.tags,
            summary: ""
          }),
          nativeFolderPath: await folderPathForId(
            updatedNode.parentId || parentId
          ),
          syncStatus:
            auth.signedIn && auth.accountMatches === true ? "pending" : "local",
          timestamp
        });
      await upsertLocalResource(remainingSource);
      storageChanged = true;
      await upsertLocalResource(nextResource);
      if (!remainingSource.nativeBookmarkIds.length) {
        await cancelEnhancementForResource(sourceResource.resourceKey);
      }
    } else {
      await upsertLocalResource({
        ...sourceResource,
        title,
        url,
        userNote: input.userNote.trim(),
        tags: resolvedTags.tags,
        tagsSource: resolvedTags.tagsSource,
        nativeFolderPath: await folderPathForId(
          updatedNode.parentId || parentId
        ),
        syncStatus:
          auth.signedIn && auth.accountMatches === true ? "pending" : "local",
        updatedAt: timestamp
      });
      storageChanged = true;
    }

    await importNativeBookmarks();
    let finalResource = await getLocalResource(targetResourceKey);
    if (!finalResource?.nativeBookmarkIds.includes(input.bookmarkId)) {
      throw new Error(
        "Chrome 已完成修改，但 Aarre 未能确认新的绑定状态。"
      );
    }
    await reconcileProtectionRules();
    finalResource = await getLocalResource(targetResourceKey);
    if (!finalResource?.nativeBookmarkIds.includes(input.bookmarkId)) {
      throw new Error(
        "保护规则更新后无法确认收藏状态，请刷新后再试。"
      );
    }
    if (auth.signedIn && auth.accountMatches === true) {
      await enqueueOutbox(finalResource, "");
      void syncPendingIfReady();
    }
    if (resourceIdentityChanged) {
      await queueEnhancementsUntilVisit(finalResource, "recovery");
    }
    if (batch) {
      batch = { ...batch, status: "ready" };
      await putUndoSnapshot(batch);
    }
    return {
      bookmark: serializeBookmarkNode(updatedNode),
      resource: finalResource,
      // 供界面决定是否提示“重新生成摘要和封面”；仅完整地址的
      // 细微变化已经写入 Chrome，但不会错误触发跨资源增强。
      urlChanged: resourceIdentityChanged
    };
  } catch (error) {
    const storageRecoverySteps: Array<{
      name: string;
      run: () => Promise<unknown>;
    }> = [];
    if (storageChanged) {
      if (targetResourceKey !== sourceResource.resourceKey) {
        storageRecoverySteps.push(
          {
            name: "cancel-target-enhancement",
            run: () => cancelEnhancementForResource(targetResourceKey)
          },
          {
            name: "remove-target-outbox",
            run: () => removeOutboxItem(targetResourceKey)
          }
        );
      }
      storageRecoverySteps.push({
        name: "restore-source-resource",
        run: () => upsertLocalResource(sourceResource)
      });
      if (targetResourceKey !== sourceResource.resourceKey) {
        if (previousTarget) {
          storageRecoverySteps.push({
            name: "restore-previous-target",
            run: () => upsertLocalResource(previousTarget)
          });
        } else {
          storageRecoverySteps.push({
            name: "remove-created-target",
            run: () => deleteLocalResource(targetResourceKey)
          });
        }
      }
      if (auth.signedIn && auth.accountMatches === true) {
        storageRecoverySteps.push({
          name: "restore-source-outbox",
          run: () => enqueueOutbox(sourceResource, "")
        });
      }
    }
    const failedRecoverySteps =
      await runBookmarkEditRecoverySteps(storageRecoverySteps);
    let chromeRollbackFailed = false;
    let rolledBackBatch: UndoSnapshotBatch | undefined;
    if (batch) {
      const rolledBack = await undoBookmarkBatch(
        batch,
        defaultFolderId,
        {
          onBeforeRemove: markInternalBookmarkRemoval,
          onAfterRemove: releaseInternalBookmarkRemoval
        }
      ).catch(() => null);
      if (rolledBack) {
        rolledBackBatch = rolledBack.batch;
      }
      chromeRollbackFailed = !rolledBack || rolledBack.failed > 0;
    }
    const finalRecoverySteps: Array<{
      name: string;
      run: () => Promise<unknown>;
    }> = [];
    if (rolledBackBatch) {
      finalRecoverySteps.push({
        name: "persist-undo-result",
        run: () => putUndoSnapshot(rolledBackBatch)
      });
    }
    finalRecoverySteps.push({
      name: "reimport-native-bookmarks",
      run: () => importNativeBookmarks()
    });
    if (sourceResource.nativeBookmarkIds.length) {
      finalRecoverySteps.push({
        name: "restore-source-enhancement",
        run: () => queueEnhancementsUntilVisit(sourceResource)
      });
    }
    failedRecoverySteps.push(
      ...(await runBookmarkEditRecoverySteps(finalRecoverySteps))
    );
    if (failedRecoverySteps.length || chromeRollbackFailed) {
      throw new Error(
        "编辑未完整完成，自动恢复也未能全部完成。请立即刷新并检查这条 Chrome 收藏。"
      );
    }
    const message =
      error instanceof Error ? error.message : "收藏信息更新失败";
    throw new Error(
      batch ? `${message} 本次修改已自动回滚。` : message
    );
  } finally {
    releaseInternalBookmarkRemoval(input.bookmarkId);
  }
}

async function createNativeFolder(input: {
  parentId: string;
  title: string;
}, skipUndo = false): Promise<NativeBookmarkNode> {
  const title = input.title.trim();
  if (!title) {
    throw new Error("文件夹名称不能为空。");
  }
  const [parent] = await chrome.bookmarks.get(input.parentId);
  if (!parent || parent.url || parent.unmodifiable === "managed") {
    throw new Error("目标文件夹不可写入。");
  }
  const perform = async () => {
    markNativeBookmarksDirty();
    return serializeBookmarkNode(
      await chrome.bookmarks.create({ parentId: input.parentId, title })
    );
  };
  if (skipUndo) return perform();
  const mutation = await snapshotCreatedMutation({
    parentId: input.parentId,
    label: `创建文件夹“${title}”`,
    title
  });
  return runProtectedBookmarkMutation({
    label: mutation.label,
    destructive: false,
    mutation,
    perform,
    createdNodeId: (node) => node.id
  });
}

async function moveNativeBookmark(input: {
  id: string;
  parentId: string;
  index?: number;
}, skipUndo = false): Promise<NativeBookmarkNode> {
  if (input.id === input.parentId) {
    throw new Error("不能把文件夹移动到自身。");
  }
  const perform = async () => {
    markNativeBookmarksDirty();
    return serializeBookmarkNode(
      await chrome.bookmarks.move(input.id, {
        parentId: input.parentId,
        index: input.index
      })
    );
  };
  if (skipUndo) return perform();
  const mutation = await snapshotNodeMutation({
    nodeId: input.id,
    kind: "restore_move",
    label: "移动书签或文件夹"
  });
  mutation.label = `移动“${mutation.node?.title || "书签"}”`;
  return runProtectedBookmarkMutation({
    label: mutation.label,
    destructive: false,
    mutation,
    perform
  });
}

async function deleteNativeBookmark(input: {
  id: string;
  recursive: boolean;
}, skipUndo = false): Promise<{ deleted: true }> {
  const [node] = await chrome.bookmarks.get(input.id);
  if (!node || node.unmodifiable === "managed" || node.folderType) {
    throw new Error("这个项目由 Chrome 管理，无法删除。");
  }
  const perform = async () => {
    markNativeBookmarksDirty();
    markInternalBookmarkRemoval(input.id);
    try {
      if (node.url) {
        await chrome.bookmarks.remove(input.id);
      } else if (input.recursive) {
        await chrome.bookmarks.removeTree(input.id);
      } else {
        await chrome.bookmarks.remove(input.id);
      }
      releaseInternalBookmarkRemoval(input.id);
    } catch (error) {
      forgetInternalBookmarkId(input.id);
      throw error;
    }
    return { deleted: true as const };
  };
  if (skipUndo) return perform();
  const mutation = await snapshotNodeMutation({
    nodeId: input.id,
    kind: "restore_subtree",
    label: `删除“${node.title || node.url}”`,
    destructive: true
  });
  return runProtectedBookmarkMutation({
    label: mutation.label,
    destructive: true,
    mutation,
    perform
  });
}

  return {
    updateNativeBookmark,
    updateResourceTags,
    updateBookmarkDetails,
    createNativeFolder,
    moveNativeBookmark,
    deleteNativeBookmark
  };
}

import { enqueueOutbox, getLocalResources, putUndoSnapshot } from "../../lib/storage";
import { createRemovedNodeUndoBatch } from "../../lib/bookmark-undo";
import { removeFolderProtections } from "../../lib/protection";
import { requestSync } from "../../lib/sync-request";
import type { ImportResult, ResourceRecord } from "../../lib/types";

interface BookmarkEventDependencies {
  markNativeBookmarksDirty(): void;
  refreshContextMenu(): Promise<void>;
  internalBookmarkIds: Set<string>;
  internalBookmarkTargets: Set<string>;
  bookmarkTarget(parentId: string, url: string): string;
  indexNativeBookmark(id: string, node: chrome.bookmarks.BookmarkTreeNode, options?: { enhance?: boolean; seed?: ResourceRecord }): Promise<void>;
  importNativeBookmarks(force?: boolean): Promise<ImportResult>;
  reconcileProtectionRules(): Promise<void>;
  queueIndexedResourcesUntilVisit(): Promise<void>;
  resourceMatchesLoadedUrl(resource: ResourceRecord, url: string): boolean;
  upsertLocalResource(resource: ResourceRecord): Promise<void>;
  cancelEnhancementForResource(resourceKey: string): Promise<void>;
}

export function createResourceTombstone(
  resource: ResourceRecord,
  deletedAt = new Date().toISOString()
): ResourceRecord {
  return {
    ...resource,
    nativeBookmarkIds: [],
    deletedAt,
    updatedAt: deletedAt,
    syncStatus: "pending"
  };
}

export function registerBookmarkEvents(dependencies: BookmarkEventDependencies): void {
  const {
    markNativeBookmarksDirty,
    refreshContextMenu,
    internalBookmarkIds,
    internalBookmarkTargets,
    bookmarkTarget,
    indexNativeBookmark,
    importNativeBookmarks,
    reconcileProtectionRules,
    queueIndexedResourcesUntilVisit,
    resourceMatchesLoadedUrl,
    upsertLocalResource,
    cancelEnhancementForResource
  } = dependencies;
  let nativeBookmarkImportInProgress = false;
  const now = () => new Date().toISOString();
chrome.bookmarks.onCreated.addListener((id, node) => {
  markNativeBookmarksDirty();
  void refreshContextMenu();
  if (nativeBookmarkImportInProgress) return;
  if (
    internalBookmarkIds.has(id) ||
    (node.url &&
      internalBookmarkTargets.has(
        bookmarkTarget(node.parentId || "", node.url)
      ))
  ) {
    return;
  }
  void indexNativeBookmark(id, node, { enhance: true });
});

chrome.bookmarks.onImportBegan.addListener(() => {
  markNativeBookmarksDirty();
  nativeBookmarkImportInProgress = true;
});

chrome.bookmarks.onImportEnded.addListener(() => {
  markNativeBookmarksDirty();
  nativeBookmarkImportInProgress = false;
  void importNativeBookmarks()
    .then(async () => {
      await reconcileProtectionRules();
      await queueIndexedResourcesUntilVisit();
    })
    .catch(() => undefined);
  void refreshContextMenu();
});

async function reindexChangedNativeBookmark(
  id: string,
  node: chrome.bookmarks.BookmarkTreeNode,
  urlChanged: boolean
): Promise<void> {
  let sourceForNewUrl: ResourceRecord | undefined;
  if (urlChanged) {
    const resources = await getLocalResources();
    sourceForNewUrl = resources.find((resource) =>
      resource.nativeBookmarkIds.includes(id)
    );
    await Promise.all(
      resources
        .filter(
          (resource) =>
            resource.nativeBookmarkIds.includes(id) &&
            (!node.url || !resourceMatchesLoadedUrl(resource, node.url))
        )
        .map(async (resource) => {
          const next = {
            ...resource,
            nativeBookmarkIds: resource.nativeBookmarkIds.filter(
              (bookmarkId) => bookmarkId !== id
            ),
            updatedAt: now()
          };
          await upsertLocalResource(next);
          if (!next.nativeBookmarkIds.length) {
            await cancelEnhancementForResource(resource.resourceKey);
          }
        })
    );
  }
  await indexNativeBookmark(id, node, {
    enhance: urlChanged,
    ...(sourceForNewUrl ? { seed: sourceForNewUrl } : {})
  });
}

chrome.bookmarks.onChanged.addListener((id, changeInfo) => {
  markNativeBookmarksDirty();
  void refreshContextMenu();
  if (internalBookmarkIds.has(id)) {
    return;
  }
  void chrome.bookmarks
    .get(id)
    .then(
      ([node]) =>
        node &&
        reindexChangedNativeBookmark(
          id,
          node,
          typeof changeInfo.url === "string"
        )
    )
    .catch(() => undefined);
});

chrome.bookmarks.onMoved.addListener((id) => {
  markNativeBookmarksDirty();
  void refreshContextMenu();
  if (internalBookmarkIds.has(id)) {
    return;
  }
  void chrome.bookmarks
    .get(id)
    .then(async ([node]) => {
      if (node) await indexNativeBookmark(id, node);
      await reconcileProtectionRules();
    })
    .catch(() => undefined);
});

function bookmarkSubtreeIds(
  node: chrome.bookmarks.BookmarkTreeNode
): Set<string> {
  const ids = new Set<string>();
  const visit = (current: chrome.bookmarks.BookmarkTreeNode) => {
    ids.add(current.id);
    for (const child of current.children || []) visit(child);
  };
  visit(node);
  return ids;
}

async function handleRemovedNativeBookmark(
  id: string,
  removeInfo: {
    parentId: string;
    index: number;
    node: chrome.bookmarks.BookmarkTreeNode;
  }
): Promise<void> {
  const internal = internalBookmarkIds.has(id);
  if (!internal) {
    await putUndoSnapshot(
      createRemovedNodeUndoBatch({
        node: removeInfo.node,
        parentId: removeInfo.parentId,
        index: removeInfo.index
      })
    );
  }

  const removedIds = bookmarkSubtreeIds(removeInfo.node);
  await removeFolderProtections(removedIds);
  const resources = await getLocalResources();
  await Promise.all(
    resources
      .filter((resource) =>
        resource.nativeBookmarkIds.some((bookmarkId) =>
          removedIds.has(bookmarkId)
        )
      )
      .map(async (resource) => {
        const next = {
          ...resource,
          nativeBookmarkIds: resource.nativeBookmarkIds.filter(
            (bookmarkId) => !removedIds.has(bookmarkId)
          ),
          updatedAt: now()
        };
        if (!next.nativeBookmarkIds.length) {
          const tombstoned = createResourceTombstone(next, now());
          await upsertLocalResource(tombstoned);
          await enqueueOutbox(tombstoned, "");
          requestSync("bookmark-removed");
          await cancelEnhancementForResource(resource.resourceKey);
        } else {
          await upsertLocalResource(next);
        }
      })
  );
  await reconcileProtectionRules();
}

chrome.bookmarks.onRemoved.addListener((id, removeInfo) => {
  markNativeBookmarksDirty();
  void refreshContextMenu();
  void handleRemovedNativeBookmark(id, removeInfo).catch(() => undefined);
});

}

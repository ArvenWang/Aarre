import { getAuthState } from "../../lib/auth";
import { enqueueOutbox, getLocalResources } from "../../lib/storage";
import { preservedAiRetrievalFields } from "../../lib/ai-fields";
import { categoryCoverForResource } from "../../lib/cover-registry";
import { canonicalizeUrl, isSupportedPageUrl, resourceKeyForUrl } from "../../lib/url";
import type {
  ImportResult,
  NativeFolderOption,
  ResourceRecord,
  RestoreResult
} from "../../lib/types";

interface BookmarkImportDependencies {
  upsertLocalResource(resource: ResourceRecord): Promise<void>;
  resourceMatchesLoadedUrl(resource: ResourceRecord, loadedUrl: string): boolean;
  reconcileProtectionRules(): Promise<void>;
  getPrivacyProtectionContext(): Promise<unknown>;
  queueEnhancementsUntilVisit(resource: ResourceRecord, trigger?: "recovery", context?: unknown): Promise<void>;
  getFolderOptions(): Promise<NativeFolderOption[]>;
  defaultFolderId(): Promise<string>;
  pullCloudResources(): Promise<ResourceRecord[]>;
  beginInternalBookmarkTarget(target: string): void;
  cancelInternalBookmarkTarget(target: string): void;
  markInternalBookmarkId(id: string): void;
  releaseInternalBookmarkWrite(id: string, target: string): void;
}

export function createBookmarkImportHandlers(dependencies: BookmarkImportDependencies) {
  const {
    upsertLocalResource,
    resourceMatchesLoadedUrl,
    reconcileProtectionRules,
    getPrivacyProtectionContext,
    queueEnhancementsUntilVisit,
    getFolderOptions,
    defaultFolderId,
    pullCloudResources,
    beginInternalBookmarkTarget,
    cancelInternalBookmarkTarget,
    markInternalBookmarkId,
    releaseInternalBookmarkWrite
  } = dependencies;
  let nativeBookmarkImportPromise: Promise<ImportResult> | null = null;
  let nativeBookmarkRevision = 0;
  let importedNativeBookmarkRevision = -1;
  let lastNativeBookmarkImport: ImportResult | undefined;
  const now = () => new Date().toISOString();
  const bookmarkTarget = (parentId: string, url: string) => `${parentId}\n${url}`;
function walkBookmarkTree(
  nodes: chrome.bookmarks.BookmarkTreeNode[],
  parentPath: string[],
  result: Array<{ node: chrome.bookmarks.BookmarkTreeNode; path: string[] }>
) {
  for (const node of nodes) {
    if (node.url) {
      result.push({ node, path: parentPath });
      continue;
    }

    const nextPath =
      node.id === "0" ? parentPath : [...parentPath, node.title || "未命名"];
    walkBookmarkTree(node.children || [], nextPath, result);
  }
}

function markNativeBookmarksDirty(): void {
  nativeBookmarkRevision += 1;
}

async function importNativeBookmarks(
  force = false
): Promise<ImportResult> {
  if (
    !force &&
    importedNativeBookmarkRevision === nativeBookmarkRevision &&
    lastNativeBookmarkImport
  ) {
    return lastNativeBookmarkImport;
  }
  if (nativeBookmarkImportPromise) return nativeBookmarkImportPromise;

  const revisionAtStart = nativeBookmarkRevision;
  nativeBookmarkImportPromise = performNativeBookmarkImport()
    .then((result) => {
      lastNativeBookmarkImport = result;
      if (nativeBookmarkRevision === revisionAtStart) {
        importedNativeBookmarkRevision = revisionAtStart;
      }
      return result;
    })
    .finally(() => {
      nativeBookmarkImportPromise = null;
    });
  return nativeBookmarkImportPromise;
}

async function performNativeBookmarkImport(): Promise<ImportResult> {
  const auth = await getAuthState();
  const tree = await chrome.bookmarks.getTree();
  const native: Array<{
    node: chrome.bookmarks.BookmarkTreeNode;
    path: string[];
  }> = [];
  walkBookmarkTree(tree, [], native);

  const current = await getLocalResources();
  const known = new Map(current.map((item) => [item.resourceKey, item]));
  const grouped = new Map<
    string,
    Array<{
      node: chrome.bookmarks.BookmarkTreeNode;
      path: string[];
      canonicalUrl: string;
    }>
  >();
  let imported = 0;
  let alreadyKnown = 0;

  for (const { node, path } of native) {
    if (!node.url || !isSupportedPageUrl(node.url)) {
      continue;
    }

    const canonicalUrl = canonicalizeUrl(node.url);
    const resourceKey = await resourceKeyForUrl(canonicalUrl);
    const group = grouped.get(resourceKey) || [];
    group.push({ node, path, canonicalUrl });
    grouped.set(resourceKey, group);
  }

  for (const [resourceKey, group] of grouped) {
    const primary = group[0];
    const existing =
      known.get(resourceKey) ||
      current.find((resource) =>
        group.some(
          ({ node }) =>
            resource.nativeBookmarkIds.includes(node.id) ||
            (node.url && resourceMatchesLoadedUrl(resource, node.url))
        )
      );
    const resolvedResourceKey = existing?.resourceKey || resourceKey;
    const timestamp = now();
    const nativeBookmarkIds = group.map((item) => item.node.id);
    const baseChanged =
      !existing ||
      existing.title !== primary.node.title ||
      existing.url !== primary.node.url ||
      (!existing.canonicalUrl && existing.canonicalUrl !== primary.canonicalUrl) ||
      existing.nativeFolderPath.join("\n") !== primary.path.join("\n") ||
      existing.nativeBookmarkIds.join("\n") !==
        nativeBookmarkIds.join("\n");

    const resource: ResourceRecord = {
      resourceKey: resolvedResourceKey,
      canonicalUrl: existing?.canonicalUrl || primary.canonicalUrl,
      url: primary.node.url!,
      title:
        primary.node.title || new URL(primary.node.url!).hostname,
      userNote: existing?.userNote || "",
      summary: existing?.summary || "",
      tags: existing?.tags || [],
      tagsSource: existing?.tagsSource,
      topics: existing?.topics || [],
      ...preservedAiRetrievalFields(existing),
      contentExcerpt: existing?.contentExcerpt || "",
      contentHash: existing?.contentHash || "",
      selectedText: existing?.selectedText || "",
      author: existing?.author || "",
      siteName:
        existing?.siteName || new URL(primary.node.url!).hostname,
      language: existing?.language || "",
      imageUrl: existing?.imageUrl || "",
      ...(existing?.thumbnailDataUrl
        ? { thumbnailDataUrl: existing.thumbnailDataUrl }
        : {}),
      coverSource: existing?.coverSource,
      coverUpdatedAt: existing?.coverUpdatedAt,
      categoryCoverId:
        existing?.categoryCoverId ||
        categoryCoverForResource({
          url: primary.node.url!,
          title:
            primary.node.title || new URL(primary.node.url!).hostname,
          topics: existing?.topics || [],
          tags: existing?.tags || [],
          summary: existing?.summary || ""
        }),
      snapshotAt: existing?.snapshotAt,
      enhancementBlockReason: existing?.enhancementBlockReason,
      enhancementBlockMessage: existing?.enhancementBlockMessage,
      faviconUrl: existing?.faviconUrl || "",
      nativeBookmarkIds,
      nativeFolderPath: primary.path,
      aiStatus: existing?.aiStatus || "not_requested",
      syncStatus: baseChanged
        ? auth.signedIn && auth.accountMatches === true
          ? "pending"
          : "local"
        : existing?.syncStatus || "local",
      createdAt:
        existing?.createdAt ||
        (primary.node.dateAdded
          ? new Date(primary.node.dateAdded).toISOString()
          : timestamp),
      updatedAt: baseChanged ? timestamp : existing!.updatedAt,
      lastSyncedAt: existing?.lastSyncedAt
    };

    if (baseChanged) {
      await upsertLocalResource(resource);
      if (auth.signedIn && auth.accountMatches === true) {
        await enqueueOutbox(resource, "");
      }
    }
    if (existing) alreadyKnown += group.length;
    else imported += group.length;
  }

  for (const resource of current) {
    if (
      resource.nativeBookmarkIds.length &&
      !grouped.has(resource.resourceKey)
    ) {
      await upsertLocalResource({
        ...resource,
        nativeBookmarkIds: [],
        updatedAt: now()
      });
    }
  }

  return { scanned: native.length, imported, alreadyKnown };
}

async function queueIndexedResourcesUntilVisit(): Promise<void> {
  await reconcileProtectionRules();
  const [resources, privacyContext] = await Promise.all([
    getLocalResources(),
    getPrivacyProtectionContext()
  ]);
  for (const resource of resources) {
    if (resource.nativeBookmarkIds.length) {
      await queueEnhancementsUntilVisit(
        resource,
        "recovery",
        privacyContext
      );
    }
  }
}

async function ensureFolderPath(path: string[]): Promise<string> {
  const options = await getFolderOptions();
  const bar =
    options.find((item) => item.depth === 0 && item.name.includes("书签")) ||
    options.find((item) => item.depth === 0) ||
    null;

  if (!bar) {
    return defaultFolderId();
  }

  const relativePath =
    path[0] === bar.name || path[0]?.toLowerCase().includes("bookmark")
      ? path.slice(1)
      : path;
  let parentId = bar.id;

  for (const segment of relativePath) {
    const children = await chrome.bookmarks.getChildren(parentId);
    const existing = children.find(
      (item) => !item.url && item.title === segment && !item.unmodifiable
    );
    if (existing) {
      parentId = existing.id;
      continue;
    }

    markNativeBookmarksDirty();
    const created = await chrome.bookmarks.create({
      parentId,
      title: segment
    });
    parentId = created.id;
  }

  return parentId;
}

async function restoreMissingNativeBookmarks(): Promise<RestoreResult> {
  const resources = await pullCloudResources();
  const tree = await chrome.bookmarks.getTree();
  const native: Array<{
    node: chrome.bookmarks.BookmarkTreeNode;
    path: string[];
  }> = [];
  walkBookmarkTree(tree, [], native);

  const nativeKeys = new Set<string>();
  for (const { node } of native) {
    if (node.url && isSupportedPageUrl(node.url)) {
      nativeKeys.add(await resourceKeyForUrl(node.url));
    }
  }

  let restored = 0;
  let alreadyPresent = 0;

  for (const resource of resources) {
    if (nativeKeys.has(resource.resourceKey)) {
      alreadyPresent += 1;
      continue;
    }

    const parentId = await ensureFolderPath(resource.nativeFolderPath);
    const target = bookmarkTarget(parentId, resource.url);
    beginInternalBookmarkTarget(target);
    let bookmark: chrome.bookmarks.BookmarkTreeNode;
    markNativeBookmarksDirty();
    try {
      bookmark = await chrome.bookmarks.create({
        parentId,
        title: resource.title,
        url: resource.url
      });
    } catch (error) {
      cancelInternalBookmarkTarget(target);
      throw error;
    }
    markInternalBookmarkId(bookmark.id);
    releaseInternalBookmarkWrite(bookmark.id, target);
    const updated = {
      ...resource,
      nativeBookmarkIds: [
        ...new Set([...resource.nativeBookmarkIds, bookmark.id])
      ],
      updatedAt: now()
    };
    await upsertLocalResource(updated);
    await queueEnhancementsUntilVisit(updated, "recovery");
    restored += 1;
  }

  return { restored, alreadyPresent };
}

  return {
    markNativeBookmarksDirty,
    importNativeBookmarks,
    queueIndexedResourcesUntilVisit,
    restoreMissingNativeBookmarks
  };
}

import type {
  BookmarkBarSnapshot,
  NativeBookmarkNode,
  ResourceRecord,
  SearchResult
} from "../../lib/types";
import { visibleFolderPath } from "../../lib/folder-options";
import type {
  LibraryFilter,
  LibrarySort
} from "./types";

export const ALL_LIBRARY_FOLDERS = "all";
export const ROOT_LIBRARY_FOLDER = "folder:root";

export interface LibraryFolderFacet {
  id: string;
  label: string;
  path: string[];
  depth: number;
  count: number;
}

export interface LibraryResourceLocation {
  folderIds: Set<string>;
  folderPaths: string[][];
  treeOrder?: number;
  dateAdded?: number;
  dateLastUsed?: number;
}

export interface LibraryCollection {
  folders: LibraryFolderFacet[];
  locations: Map<string, LibraryResourceLocation>;
}

export interface LibraryControls {
  filter: LibraryFilter;
  folderId: string;
  sort: LibrarySort;
}

interface BookmarkLocation {
  folderIds: string[];
  folderPath: string[];
  treeOrder: number;
  dateAdded?: number;
  dateLastUsed?: number;
}

interface FolderDraft {
  id: string;
  label: string;
  path: string[];
  depth: number;
  resourceKeys: Set<string>;
}

const LIBRARY_FILTERS = new Set<LibraryFilter>([
  "all",
  "ready",
  "pending"
]);
const LIBRARY_SORTS = new Set<LibrarySort>([
  "default",
  "bookmarked-desc",
  "bookmarked-asc",
  "used-desc",
  "updated-desc",
  "title-asc"
]);
const titleCollator = new Intl.Collator("zh-CN", {
  numeric: true,
  sensitivity: "base"
});

function folderFacetId(path: string[]): string {
  if (!path.length) return ROOT_LIBRARY_FOLDER;
  return `folder:path:${encodeURIComponent(JSON.stringify(path))}`;
}

function folderLabel(path: string[]): string {
  return path.join(" / ") || "根目录";
}

function timestamp(value: string | number | undefined): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function latestTimestamp(
  current: number | undefined,
  candidate: number | undefined
): number | undefined {
  if (!candidate || !Number.isFinite(candidate)) return current;
  return Math.max(current || 0, candidate);
}

function pathKey(path: string[]): string {
  return JSON.stringify(path);
}

/**
 * Chrome 允许同一个 URL 在多个目录中各保存一份书签。这里以真实书签 ID
 * 关联资源，再以去掉 Chrome 系统根目录后的路径聚合分类，既不会丢掉重复
 * 位置，也不会把“书签栏 / 其他书签”重新暴露给用户。
 */
export function buildLibraryCollection(
  resources: ResourceRecord[],
  snapshot: BookmarkBarSnapshot | null
): LibraryCollection {
  const bookmarks = new Map<string, BookmarkLocation>();
  const folderDrafts = new Map<string, FolderDraft>();
  const folderIdsByPath = new Map<string, string[]>();
  let treeOrder = 0;

  function ensureFolder(path: string[]): FolderDraft {
    const id = folderFacetId(path);
    const existing = folderDrafts.get(id);
    if (existing) return existing;
    const created: FolderDraft = {
      id,
      label: folderLabel(path),
      path,
      depth: Math.max(0, path.length - 1),
      resourceKeys: new Set()
    };
    folderDrafts.set(id, created);
    return created;
  }

  function visit(
    node: NativeBookmarkNode,
    currentPath: string[],
    ancestorFolderIds: string[]
  ) {
    if (node.url) {
      const directPath = currentPath;
      const ids = directPath.length
        ? ancestorFolderIds
        : [ensureFolder([]).id];
      bookmarks.set(node.id, {
        folderIds: ids,
        folderPath: directPath,
        treeOrder: treeOrder++,
        dateAdded: node.dateAdded,
        dateLastUsed: node.dateLastUsed
      });
      return;
    }

    const nextPath = [...currentPath, node.title || "未命名文件夹"];
    const folder = ensureFolder(nextPath);
    const nextAncestors = [...ancestorFolderIds, folder.id];
    folderIdsByPath.set(pathKey(nextPath), nextAncestors);
    for (const child of node.children || []) {
      visit(child, nextPath, nextAncestors);
    }
  }

  for (const systemRoot of snapshot?.roots || []) {
    for (const child of systemRoot.children || []) {
      visit(child, [], []);
    }
  }

  const locations = new Map<string, LibraryResourceLocation>();
  for (const resource of resources) {
    const folderIds = new Set<string>();
    const directPaths = new Map<string, string[]>();
    let resourceTreeOrder: number | undefined;
    let dateAdded: number | undefined;
    let dateLastUsed: number | undefined;

    for (const bookmarkId of resource.nativeBookmarkIds) {
      const bookmark = bookmarks.get(bookmarkId);
      if (!bookmark) continue;
      for (const id of bookmark.folderIds) folderIds.add(id);
      directPaths.set(pathKey(bookmark.folderPath), bookmark.folderPath);
      resourceTreeOrder =
        resourceTreeOrder === undefined
          ? bookmark.treeOrder
          : Math.min(resourceTreeOrder, bookmark.treeOrder);
      dateAdded = latestTimestamp(dateAdded, bookmark.dateAdded);
      dateLastUsed = latestTimestamp(
        dateLastUsed,
        bookmark.dateLastUsed
      );
    }

    // 兼容刚同步、树与本地索引短暂不同步的瞬间。只用路径补位，不生成
    // 任何虚假的目录；路径存在于当前 Chrome 树时才允许参与目录筛选。
    if (!folderIds.size && resource.nativeFolderPath.length) {
      const fallbackPath = visibleFolderPath(
        resource.nativeFolderPath
      );
      const fallbackIds =
        folderIdsByPath.get(pathKey(fallbackPath)) ||
        (!fallbackPath.length && folderDrafts.has(ROOT_LIBRARY_FOLDER)
          ? [ROOT_LIBRARY_FOLDER]
          : []);
      for (const id of fallbackIds) folderIds.add(id);
      if (fallbackIds.length) {
        directPaths.set(pathKey(fallbackPath), fallbackPath);
      }
    }

    for (const id of folderIds) {
      folderDrafts.get(id)?.resourceKeys.add(resource.resourceKey);
    }
    locations.set(resource.resourceKey, {
      folderIds,
      folderPaths: [...directPaths.values()],
      treeOrder: resourceTreeOrder,
      dateAdded,
      dateLastUsed
    });
  }

  return {
    folders: [...folderDrafts.values()]
      .filter(
        (folder) =>
          folder.id !== ROOT_LIBRARY_FOLDER ||
          folder.resourceKeys.size > 0
      )
      .map(({ resourceKeys, ...folder }) => ({
        ...folder,
        count: resourceKeys.size
      })),
    locations
  };
}

export function resourceFolderLabel(
  location: LibraryResourceLocation | undefined
): string {
  if (!location?.folderPaths.length) return "根目录";
  const [first, ...rest] = location.folderPaths;
  const label = folderLabel(first || []);
  return rest.length ? `${label} +${rest.length}` : label;
}

export function filterAndSortLibraryResults(
  results: SearchResult[],
  controls: LibraryControls,
  locations: Map<string, LibraryResourceLocation>,
  query = ""
): SearchResult[] {
  const filtered = results.filter(({ resource }) => {
    if (
      controls.filter === "ready" &&
      resource.aiStatus !== "ready"
    ) {
      return false;
    }
    if (
      controls.filter === "pending" &&
      resource.aiStatus === "ready"
    ) {
      return false;
    }
    return (
      controls.folderId === ALL_LIBRARY_FOLDERS ||
      locations
        .get(resource.resourceKey)
        ?.folderIds.has(controls.folderId) === true
    );
  });

  if (controls.sort === "default" && query.trim()) {
    return filtered;
  }

  return filtered
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const leftResource = left.item.resource;
      const rightResource = right.item.resource;
      const leftLocation = locations.get(leftResource.resourceKey);
      const rightLocation = locations.get(rightResource.resourceKey);
      let comparison = 0;

      switch (controls.sort) {
        case "bookmarked-asc":
          comparison =
            (leftLocation?.dateAdded ||
              timestamp(leftResource.createdAt)) -
            (rightLocation?.dateAdded ||
              timestamp(rightResource.createdAt));
          break;
        case "used-desc":
          comparison =
            (rightLocation?.dateLastUsed || 0) -
            (leftLocation?.dateLastUsed || 0);
          if (!comparison) {
            comparison =
              (rightLocation?.dateAdded ||
                timestamp(rightResource.createdAt)) -
              (leftLocation?.dateAdded ||
                timestamp(leftResource.createdAt));
          }
          break;
        case "updated-desc":
          comparison =
            timestamp(rightResource.updatedAt) -
            timestamp(leftResource.updatedAt);
          break;
        case "title-asc":
          comparison = titleCollator.compare(
            leftResource.title,
            rightResource.title
          );
          break;
        case "default":
          comparison =
            (leftLocation?.treeOrder ?? Number.MAX_SAFE_INTEGER) -
            (rightLocation?.treeOrder ?? Number.MAX_SAFE_INTEGER);
          break;
        case "bookmarked-desc":
          comparison =
            (rightLocation?.dateAdded ||
              timestamp(rightResource.createdAt)) -
            (leftLocation?.dateAdded ||
              timestamp(leftResource.createdAt));
          break;
      }

      return comparison || left.index - right.index;
    })
    .map(({ item }) => item);
}

export function readLibraryControls(
  params: URLSearchParams
): LibraryControls {
  const filter = params.get("status") as LibraryFilter | null;
  const sort = params.get("sort") as LibrarySort | null;
  return {
    filter: filter && LIBRARY_FILTERS.has(filter) ? filter : "all",
    folderId: params.get("folder") || ALL_LIBRARY_FOLDERS,
    sort: sort && LIBRARY_SORTS.has(sort) ? sort : "default"
  };
}

export function writeLibraryControls(
  url: URL,
  controls: LibraryControls
): URL {
  const next = new URL(url.toString());
  if (controls.filter === "all") next.searchParams.delete("status");
  else next.searchParams.set("status", controls.filter);
  if (controls.folderId === ALL_LIBRARY_FOLDERS) {
    next.searchParams.delete("folder");
  } else {
    next.searchParams.set("folder", controls.folderId);
  }
  if (controls.sort === "default") next.searchParams.delete("sort");
  else next.searchParams.set("sort", controls.sort);
  return next;
}

export function writeLibraryQuery(url: URL, query: string): URL {
  const next = new URL(url.toString());
  const normalized = query.trim();
  if (normalized) next.searchParams.set("q", normalized);
  else next.searchParams.delete("q");
  return next;
}

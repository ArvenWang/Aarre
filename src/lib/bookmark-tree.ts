import type {
  BookmarkBarSnapshot,
  NativeBookmarkNode
} from "./types";

export function serializeBookmarkNode(
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

export function countBookmarkNodes(node: chrome.bookmarks.BookmarkTreeNode): {
  bookmarkCount: number;
  folderCount: number;
} {
  if (node.url) {
    return { bookmarkCount: 1, folderCount: 0 };
  }

  return (node.children || []).reduce(
    (total, child) => {
      const count = countBookmarkNodes(child);
      total.bookmarkCount += count.bookmarkCount;
      total.folderCount += count.folderCount + (child.url ? 0 : 1);
      return total;
    },
    { bookmarkCount: 0, folderCount: 0 }
  );
}

/** Build the UI snapshot directly from Chrome's native tree. */
export function buildBookmarkBarSnapshot(
  tree: chrome.bookmarks.BookmarkTreeNode[]
): BookmarkBarSnapshot {
  const root = tree[0];
  const topLevel = root?.children || [];
  const primary =
    topLevel.find(
      (node) =>
        node.folderType === "bookmarks-bar" && node.syncing === true
    ) ||
    topLevel.find((node) => node.folderType === "bookmarks-bar") ||
    topLevel.find((node) => !node.url && node.unmodifiable !== "managed");

  if (!primary) {
    throw new Error("没有找到当前 Chrome 配置文件的书签目录。");
  }

  const roots = topLevel
    .filter((node) => !node.url)
    .sort((left, right) => {
      if (left.id === primary.id) return -1;
      if (right.id === primary.id) return 1;
      if (left.syncing !== right.syncing) return left.syncing ? -1 : 1;
      return (left.index || 0) - (right.index || 0);
    });
  const counts = roots.reduce(
    (total, node) => {
      const count = countBookmarkNodes(node);
      total.bookmarkCount += count.bookmarkCount;
      total.folderCount += count.folderCount;
      return total;
    },
    { bookmarkCount: 0, folderCount: 0 }
  );

  return {
    root: serializeBookmarkNode(primary),
    roots: roots.map(serializeBookmarkNode),
    primaryRootId: primary.id,
    ...counts,
    syncing:
      typeof primary.syncing === "boolean" ? primary.syncing : null
  };
}

/**
 * Chrome 可能同时返回账号、本机、其他和移动设备等多个系统根目录。
 * Aarre 读取其中的内容，但界面只展示这些根目录的子节点。
 */
export function visibleBookmarkRootChildren(
  snapshot: BookmarkBarSnapshot
): NativeBookmarkNode[] {
  const roots = snapshot.roots?.length
    ? snapshot.roots
    : [snapshot.root];
  return roots.flatMap((root) => root.children || []);
}

export function findBookmarkByUrl(
  nodes: NativeBookmarkNode[],
  url: string,
  writableOnly = false
): NativeBookmarkNode | null {
  for (const node of nodes) {
    if (
      node.url === url &&
      (!writableOnly || (!node.unmodifiable && Boolean(node.parentId)))
    ) {
      return node;
    }

    const nested = findBookmarkByUrl(
      node.children || [],
      url,
      writableOnly
    );
    if (nested) {
      return nested;
    }
  }

  return null;
}

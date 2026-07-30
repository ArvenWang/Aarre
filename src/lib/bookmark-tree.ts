import type {
  BookmarkBarSnapshot,
  NativeBookmarkNode
} from "./types";

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

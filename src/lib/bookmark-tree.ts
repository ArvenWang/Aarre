import type { NativeBookmarkNode } from "./types";

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

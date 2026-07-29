import type { NativeBookmarkNode } from "./types";
import { canonicalizeUrl } from "./url";

function normalized(value: string): string {
  return value.toLocaleLowerCase().normalize("NFKC").trim();
}

function urlKeys(url: string): string[] {
  const keys = [url];
  try {
    const canonical = canonicalizeUrl(url);
    keys.push(canonical);
    const parsed = new URL(canonical);
    if (parsed.pathname !== "/") {
      parsed.pathname = `${parsed.pathname.replace(/\/+$/, "")}/`;
      keys.push(parsed.toString());
    }
  } catch {
    // Chrome can contain non-http bookmark targets. Their literal URL is still
    // searchable even when canonicalization is not applicable.
  }
  return keys;
}

export function bookmarkMatchUrls(urls: string[]): Set<string> {
  return new Set(urls.flatMap(urlKeys));
}

export function filterBookmarkTree(
  nodes: NativeBookmarkNode[],
  query: string,
  matchedUrls: Set<string>
): NativeBookmarkNode[] {
  const needle = normalized(query);
  if (!needle) return nodes;

  return nodes.flatMap((node) => {
    if (node.url) {
      const directlyMatches =
        normalized(`${node.title} ${node.url}`).includes(needle) ||
        urlKeys(node.url).some((url) => matchedUrls.has(url));
      return directlyMatches ? [node] : [];
    }

    const children = filterBookmarkTree(
      node.children || [],
      query,
      matchedUrls
    );
    const folderMatches = normalized(node.title).includes(needle);
    if (!folderMatches && !children.length) return [];
    return [
      {
        ...node,
        children: folderMatches ? node.children || [] : children
      }
    ];
  });
}

export function collectFolderIds(
  nodes: NativeBookmarkNode[]
): Set<string> {
  const result = new Set<string>();
  const visit = (items: NativeBookmarkNode[]) => {
    for (const item of items) {
      if (item.url) continue;
      result.add(item.id);
      visit(item.children || []);
    }
  };
  visit(nodes);
  return result;
}

export function bookmarkNodesByUrl(
  nodes: NativeBookmarkNode[]
): Map<string, NativeBookmarkNode> {
  const result = new Map<string, NativeBookmarkNode>();
  const visit = (items: NativeBookmarkNode[]) => {
    for (const item of items) {
      if (item.url) {
        for (const key of urlKeys(item.url)) result.set(key, item);
      } else {
        visit(item.children || []);
      }
    }
  };
  visit(nodes);
  return result;
}

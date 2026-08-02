import type {
  BookmarkBarSnapshot,
  NativeBookmarkNode,
} from "./types";

export interface BookmarkEditorLocation {
  bookmarkId: string;
  parentId: string;
  title: string;
  url: string;
  label: string;
  writable: boolean;
}

export interface BookmarkEditorFolder {
  id: string;
  label: string;
  depth: number;
  writable: boolean;
}

export interface BookmarkEditorModel {
  locations: BookmarkEditorLocation[];
  folders: BookmarkEditorFolder[];
}

function folderLabel(path: string[]): string {
  return path.length ? path.join(" / ") : "根目录";
}

function disambiguateLabels<T extends { label: string }>(items: T[]): T[] {
  const totals = new Map<string, number>();
  const positions = new Map<string, number>();
  for (const item of items) {
    totals.set(item.label, (totals.get(item.label) || 0) + 1);
  }
  return items.map((item) => {
    if ((totals.get(item.label) || 0) < 2) return item;
    const position = (positions.get(item.label) || 0) + 1;
    positions.set(item.label, position);
    return { ...item, label: `${item.label}（位置 ${position}）` };
  });
}

/**
 * Build the location/folder choices from the same Chrome snapshot used by
 * both editor surfaces. The editor should never invent a second folder list
 * from the local index because Chrome remains the source of truth.
 */
export function buildBookmarkEditorModel(
  bookmarkIds: readonly string[],
  snapshot: BookmarkBarSnapshot,
): BookmarkEditorModel {
  const bookmarkIdSet = new Set(bookmarkIds);
  const locations: BookmarkEditorLocation[] = [];
  const folders: BookmarkEditorFolder[] = [];

  function visit(node: NativeBookmarkNode, currentPath: string[]) {
    if (node.url) {
      if (bookmarkIdSet.has(node.id) && node.parentId) {
        locations.push({
          bookmarkId: node.id,
          parentId: node.parentId,
          title: node.title,
          url: node.url,
          label: folderLabel(currentPath),
          writable: !node.unmodifiable && !node.folderType,
        });
      }
      return;
    }

    const nextPath = [...currentPath, node.title || "未命名文件夹"];
    folders.push({
      id: node.id,
      label: folderLabel(nextPath),
      depth: nextPath.length,
      writable: !node.unmodifiable,
    });
    for (const child of node.children || []) {
      visit(child, nextPath);
    }
  }

  for (const root of snapshot.roots || [snapshot.root]) {
    folders.push({
      id: root.id,
      label: folderLabel([]),
      depth: 0,
      writable: !root.unmodifiable,
    });
    for (const child of root.children || []) {
      visit(child, []);
    }
  }

  return {
    locations: disambiguateLabels(locations),
    folders: disambiguateLabels(
      folders.filter(
        (folder, index) =>
          folders.findIndex((candidate) => candidate.id === folder.id) ===
          index,
      ),
    ),
  };
}

export function parseBookmarkEditorTags(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[,，;；\n]/)
        .map((tag) => tag.trim().replace(/^#+\s*/, "").slice(0, 40))
        .filter(Boolean),
    ),
  ].slice(0, 16);
}

export function mergeBookmarkEditorTags(
  current: string[],
  value: string,
): string[] {
  const seen = new Set(current.map((tag) => tag.toLocaleLowerCase()));
  const next = [...current];
  for (const tag of parseBookmarkEditorTags(value)) {
    const key = tag.toLocaleLowerCase();
    if (seen.has(key) || next.length >= 16) continue;
    seen.add(key);
    next.push(tag);
  }
  return next;
}

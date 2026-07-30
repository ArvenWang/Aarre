import type {
  BookmarkBarSnapshot,
  NativeBookmarkNode,
  ResourceRecord
} from "../../lib/types";

export interface LibraryBookmarkLocation {
  bookmarkId: string;
  parentId: string;
  title: string;
  url: string;
  label: string;
  writable: boolean;
}

export interface LibraryBookmarkFolder {
  id: string;
  label: string;
  depth: number;
  writable: boolean;
}

export interface LibraryBookmarkEditorModel {
  locations: LibraryBookmarkLocation[];
  folders: LibraryBookmarkFolder[];
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

export function buildLibraryBookmarkEditorModel(
  resource: ResourceRecord,
  snapshot: BookmarkBarSnapshot
): LibraryBookmarkEditorModel {
  const bookmarkIds = new Set(resource.nativeBookmarkIds);
  const locations: LibraryBookmarkLocation[] = [];
  const folders: LibraryBookmarkFolder[] = [];

  function visit(
    node: NativeBookmarkNode,
    currentPath: string[]
  ) {
    if (node.url) {
      if (bookmarkIds.has(node.id) && node.parentId) {
        locations.push({
          bookmarkId: node.id,
          parentId: node.parentId,
          title: node.title,
          url: node.url,
          label: folderLabel(currentPath),
          writable: !node.unmodifiable && !node.folderType
        });
      }
      return;
    }

    const nextPath = [...currentPath, node.title || "未命名文件夹"];
    folders.push({
      id: node.id,
      label: folderLabel(nextPath),
      depth: nextPath.length,
      writable: !node.unmodifiable
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
      writable: !root.unmodifiable
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
          folders.findIndex(
            (candidate) => candidate.id === folder.id
          ) === index
      )
    )
  };
}

export function parseLibraryEditorTags(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[,，\n]/)
        .map((tag) => tag.trim().replace(/^#+\s*/, "").slice(0, 40))
        .filter(Boolean)
    )
  ].slice(0, 16);
}

export function mergeLibraryEditorTags(
  current: string[],
  value: string
): string[] {
  return [...new Set([...current, ...parseLibraryEditorTags(value)])].slice(
    0,
    16
  );
}

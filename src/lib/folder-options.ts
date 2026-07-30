import type { NativeFolderOption } from "./types";

interface BookmarkFolderTreeNode {
  id: string;
  title?: string;
  url?: string;
  unmodifiable?: string;
  children?: BookmarkFolderTreeNode[];
}

/**
 * Chrome 的书签树包含两层非用户目录：最外层虚拟根节点，以及书签栏、
 * 其他书签、移动设备书签等系统根目录。收藏弹窗只应提供用户自己创建的目录。
 */
export function buildSelectableFolderOptions(
  tree: BookmarkFolderTreeNode[]
): NativeFolderOption[] {
  const options: NativeFolderOption[] = [];

  function visit(
    node: BookmarkFolderTreeNode,
    parentPath: string[],
    depth: number,
    role: "synthetic-root" | "system-root" | "user-folder"
  ) {
    if (node.url) return;

    const path =
      role === "synthetic-root"
        ? parentPath
        : [...parentPath, node.title || "未命名文件夹"];

    if (
      role === "user-folder" &&
      node.unmodifiable !== "managed"
    ) {
      options.push({
        id: node.id,
        name: node.title || "未命名文件夹",
        path,
        depth
      });
    }

    const childRole =
      role === "synthetic-root" ? "system-root" : "user-folder";
    const childDepth =
      role === "user-folder" ? depth + 1 : depth;

    for (const child of node.children || []) {
      visit(child, path, childDepth, childRole);
    }
  }

  for (const root of tree) {
    visit(root, [], 0, "synthetic-root");
  }

  return options;
}

export function initialSaveFolderId(
  options: NativeFolderOption[],
  preferredId?: string
): string {
  if (
    preferredId &&
    options.some((option) => option.id === preferredId)
  ) {
    return preferredId;
  }
  return options[0]?.id || "";
}

export function visibleFolderPath(path: string[]): string[] {
  return path.length > 1 ? path.slice(1) : path;
}

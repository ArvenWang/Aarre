import type {
  BookmarkSaveMatch,
  BookmarkSaveState,
  NativeBookmarkNode
} from "./types";
import { canonicalizeUrl } from "./url";

function normalizedLiteralUrl(input: string): string {
  try {
    return new URL(input).toString();
  } catch {
    return input.trim();
  }
}

export function buildBookmarkSaveState(
  roots: NativeBookmarkNode[],
  targetUrl: string
): BookmarkSaveState {
  const literalTarget = normalizedLiteralUrl(targetUrl);
  const canonicalTarget = canonicalizeUrl(targetUrl);
  const matches: BookmarkSaveMatch[] = [];

  const visit = (node: NativeBookmarkNode, folderPath: string[]) => {
    if (node.url) {
      let canonicalMatch = false;
      try {
        canonicalMatch = canonicalizeUrl(node.url) === canonicalTarget;
      } catch {
        canonicalMatch = false;
      }
      if (canonicalMatch) {
        matches.push({
          id: node.id,
          parentId: node.parentId || "",
          title: node.title,
          url: node.url,
          folderPath,
          unmodifiable: Boolean(node.unmodifiable),
          matchKind:
            normalizedLiteralUrl(node.url) === literalTarget
              ? "exact"
              : "canonical"
        });
      }
      return;
    }

    const nextPath =
      node.title && node.parentId && !node.folderType
      ? [...folderPath, node.title]
      : folderPath;
    for (const child of node.children || []) {
      visit(child, nextPath);
    }
  };

  for (const root of roots) visit(root, []);

  matches.sort((left, right) => {
    if (left.matchKind !== right.matchKind) {
      return left.matchKind === "exact" ? -1 : 1;
    }
    return left.folderPath.join("/").localeCompare(
      right.folderPath.join("/")
    );
  });

  if (!matches.length) return { status: "none", matches: [] };
  if (matches.length > 1) return { status: "multiple", matches };
  if (matches[0].unmodifiable) {
    return { status: "readonly", matches };
  }
  return {
    status:
      matches[0].matchKind === "exact" ? "exact" : "canonical",
    matches
  };
}

export function bookmarkPageMenuPresentation(
  state: BookmarkSaveState | null
): { title: string; enabled: boolean } {
  if (!state) {
    return { title: "暂时无法确认收藏状态", enabled: false };
  }
  return {
    title:
      state.status === "none"
        ? "添加到收藏…"
        : "管理此收藏…",
    enabled: true
  };
}

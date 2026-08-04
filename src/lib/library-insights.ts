import {
  buildLocalSearchIndex,
  searchLocalIndex,
  type LocalSearchIndexItem
} from "./search";
import { visibleFolderLabel } from "./folder-options";
import type {
  BookmarkAgentActionProposal,
  BookmarkAgentCatalog,
  BookmarkAgentCatalogBookmark,
  FolderSuggestion,
  LibraryInsights,
  NativeFolderOption,
  OrganizationProposal,
  PageCapture,
  ResourceRecord
} from "./types";

const LARGE_FOLDER_THRESHOLD = 150;

function pathLabel(path: string[], title?: string): string {
  const folder = visibleFolderLabel(path);
  return title ? `${folder} / ${title}` : folder;
}

function actionId(prefix: string, nodeId: string): string {
  return `${prefix}:${nodeId}`;
}

function deleteAction(
  node: BookmarkAgentCatalogBookmark,
  reason: string
): BookmarkAgentActionProposal {
  return {
    id: actionId("delete", node.id),
    type: "delete_bookmark",
    label: `删除「${node.title}」`,
    description: reason,
    destructive: true,
    status: "pending",
    targetId: node.id,
    expectedTitle: node.title,
    expectedUrl: node.url,
    expectedParentId: node.parentId
  };
}

function bookmarkDateOrder(
  left: BookmarkAgentCatalogBookmark,
  right: BookmarkAgentCatalogBookmark
): number {
  const leftDate = left.dateAdded ?? Number.MAX_SAFE_INTEGER;
  const rightDate = right.dateAdded ?? Number.MAX_SAFE_INTEGER;
  return leftDate - rightDate || left.id.localeCompare(right.id);
}

function duplicateProposal(
  resource: ResourceRecord,
  nodes: BookmarkAgentCatalogBookmark[]
): OrganizationProposal | null {
  const writableNodes = nodes.filter((node) => node.writable);
  if (nodes.length < 2 || !writableNodes.length) return null;
  const ordered = [...nodes].sort(bookmarkDateOrder);
  const keep = ordered[0];
  const removable = ordered.filter(
    (node) => node.id !== keep.id && node.writable
  );
  if (!removable.length) return null;
  const keepFolder = pathLabel(keep.path);
  const sameFolder = removable.every(
    (node) => pathLabel(node.path) === keepFolder
  );
  return {
    id: `duplicate:${resource.resourceKey}`,
    kind: "duplicate",
    title: `合并 ${nodes.length} 个重复收藏`,
    description: sameFolder
      ? `同一位置存在 ${nodes.length} 个完全相同的收藏。将保留较早的 1 个，删除 ${removable.length} 个副本。`
      : `同一网页收藏了 ${nodes.length} 次。将保留较早的一条，其余副本需你确认后才会删除。`,
    destructive: true,
    selectedByDefault: false,
    actions: removable.map((node) =>
      deleteAction(
        node,
        `保留较早副本；删除 ${pathLabel(node.path)} 中的重复记录`
      )
    ),
    resourceKeys: [resource.resourceKey],
    beforePaths: ordered.map((node) => pathLabel(node.path, node.title)),
    afterPath: pathLabel(keep.path, keep.title),
    previewLines: sameFolder
      ? [
          `网页：「${keep.title}」`,
          `位置：${keepFolder}`,
          `处理：保留 1 个，删除 ${removable.length} 个完全相同的副本`
        ]
      : [
          `网页：「${keep.title}」`,
          `保留位置：${keepFolder}`,
          ...removable.map(
            (node) => `删除副本：${pathLabel(node.path)}`
          )
        ]
  };
}

function deadLinkProposal(
  resource: ResourceRecord,
  nodes: BookmarkAgentCatalogBookmark[]
): OrganizationProposal | null {
  const health = resource.linkHealth;
  if (!health || !["dead", "soft_404"].includes(health.status)) return null;
  const writableNodes = nodes.filter((node) => node.writable);
  if (!writableNodes.length) return null;
  const isConfirmedDead = health.status === "dead";
  const archiveUrl = `https://web.archive.org/web/*/${resource.url.replaceAll(
    "#",
    "%23"
  )}`;
  return {
    id: `dead:${resource.resourceKey}`,
    kind: "dead",
    title: isConfirmedDead ? "失效链接待确认" : "疑似内容已删除",
    description: `${health.reason || "链接检查未通过"}。删除项默认不勾选，建议先打开原网址或网页时光机复核。`,
    destructive: true,
    selectedByDefault: false,
    actions: writableNodes.map((node) =>
      deleteAction(node, health.reason || "链接检查未通过")
    ),
    resourceKeys: [resource.resourceKey],
    beforePaths: writableNodes.map((node) =>
      pathLabel(node.path, node.title)
    ),
    previewLines: [
      `网址：${resource.url}`,
      `检测：${health.reason || health.status}`,
      ...writableNodes.map(
        (node) => `待删除：${pathLabel(node.path, node.title)}`
      )
    ],
    recoveryLinks: [
      { label: "打开原网址", url: resource.url },
      { label: "在 Web Archive 中查找历史版本", url: archiveUrl }
    ]
  };
}

interface ScoredFolderCandidate extends FolderSuggestion {
  similarCount: number;
  lexicalMatch: boolean;
}

function folderQuery(parts: Array<string | string[] | undefined>): string {
  return parts
    .flatMap((part) => (Array.isArray(part) ? part : [part || ""]))
    .filter(Boolean)
    .join(" ")
    .slice(0, 1_500);
}

function folderQueryForCapture(capture: PageCapture): string {
  return folderQuery([
    capture.title,
    capture.description,
    capture.excerpt,
    capture.selectedText,
    capture.siteName
  ]);
}

/**
 * 保存时建议和批量整理必须共用这一层评分，避免同一条收藏在两个入口
 * 得到互相冲突的目标文件夹。
 */
export function scoreFolderCandidates(input: {
  query: string;
  resources: ResourceRecord[];
  folders: NativeFolderOption[];
  excludedResourceKeys?: Set<string>;
  searchIndex?: LocalSearchIndexItem[];
  limit?: number;
}): ScoredFolderCandidate[] {
  const excluded = input.excludedResourceKeys || new Set<string>();
  const searchIndex =
    input.searchIndex || buildLocalSearchIndex(input.resources);
  const similar = searchLocalIndex(
    searchIndex,
    input.query
  )
    .filter(({ resource }) => !excluded.has(resource.resourceKey))
    .slice(0, 20);
  const folderCounts = new Map<string, number>();
  for (const { resource } of similar) {
    const key = resource.nativeFolderPath.join("\n");
    if (key) folderCounts.set(key, (folderCounts.get(key) || 0) + 1);
  }
  const normalizedQuery = input.query
    .toLocaleLowerCase()
    .normalize("NFKC");
  return input.folders
    .map((folder) => {
      const key = folder.path.join("\n");
      const similarCount = folderCounts.get(key) || 0;
      const lexicalMatch = folder.path.some((part) =>
        normalizedQuery.includes(
          part.toLocaleLowerCase().normalize("NFKC")
        )
      );
      return {
        folderId: folder.id,
        name: folder.name,
        path: folder.path,
        score:
          similarCount * 10 +
          (lexicalMatch ? 6 : 0) -
          folder.depth * 0.1,
        reason: similarCount
          ? `与 ${similarCount} 条相似收藏同目录`
          : "目录名称与页面主题匹配",
        similarCount,
        lexicalMatch
      };
    })
    .filter((folder) => folder.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.path.join("/").localeCompare(right.path.join("/"))
    )
    .slice(0, input.limit ?? input.folders.length);
}

function largeFolderProposals(
  catalog: BookmarkAgentCatalog
): OrganizationProposal[] {
  const counts = new Map<string, number>();
  for (const bookmark of catalog.bookmarks) {
    counts.set(bookmark.parentId, (counts.get(bookmark.parentId) || 0) + 1);
  }
  const folderById = new Map(
    catalog.folders.map((folder) => [folder.id, folder])
  );
  return [...counts.entries()]
    .filter(([, count]) => count > LARGE_FOLDER_THRESHOLD)
    .map(([folderId, count]) => {
      const folder = folderById.get(folderId);
      return {
        id: `large-folder:${folderId}`,
        kind: "large_folder" as const,
        title: `大文件夹容量提醒`,
        description: `「${pathLabel(folder?.path || [])}」有 ${count} 条收藏。Aarre 只提醒容量问题，不会自动移动或拆分。`,
        destructive: false,
        selectedByDefault: false,
        actions: [],
        resourceKeys: [],
        beforePaths: [pathLabel(folder?.path || [])],
        previewLines: [
          `位置：${pathLabel(folder?.path || [])}`,
          `收藏数量：${count} 条`
        ]
      };
    });
}

export function buildLibraryInsights(
  resources: ResourceRecord[],
  catalog: BookmarkAgentCatalog,
  generatedAt = new Date().toISOString()
): LibraryInsights {
  const nodeById = new Map(
    catalog.bookmarks.map((node) => [node.id, node])
  );
  const proposals: OrganizationProposal[] = [];
  for (const resource of resources) {
    const nodes = resource.nativeBookmarkIds
      .map((id) => nodeById.get(id))
      .filter((node): node is BookmarkAgentCatalogBookmark => Boolean(node));
    const duplicate = duplicateProposal(resource, nodes);
    if (duplicate) proposals.push(duplicate);
    const dead = deadLinkProposal(resource, nodes);
    if (dead) proposals.push(dead);
  }
  proposals.push(...largeFolderProposals(catalog));
  return {
    organizationPlan: {
      generatedAt,
      proposalCount: proposals.length,
      actionableCount: proposals.filter(
        (proposal) => proposal.actions.length > 0
      ).length,
      proposals
    }
  };
}

export function suggestFolders(
  capture: PageCapture,
  resources: ResourceRecord[],
  folders: NativeFolderOption[],
  limit = 3
): FolderSuggestion[] {
  const excludedResourceKeys = new Set(
    resources
      .filter(
        (resource) =>
          resource.canonicalUrl === capture.canonicalUrl ||
          resource.url === capture.url
      )
      .map((resource) => resource.resourceKey)
  );
  return scoreFolderCandidates({
    query: folderQueryForCapture(capture),
    resources,
    folders,
    excludedResourceKeys,
    limit
  });
}

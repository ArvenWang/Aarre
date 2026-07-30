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
  ReadingQueueItem,
  ResourceRecord
} from "./types";

const LARGE_FOLDER_THRESHOLD = 150;
const MAX_READING_QUEUE = 200;

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

function normalizeTopic(value: string): string {
  return value.toLocaleLowerCase().normalize("NFKC").trim();
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

function folderQueryForResource(resource: ResourceRecord): string {
  return folderQuery([
    resource.title,
    resource.summary,
    resource.contentExcerpt,
    resource.userNote,
    resource.siteName,
    resource.tags,
    resource.topics,
    resource.aliases
  ]);
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

function classificationProposals(
  resources: ResourceRecord[],
  catalog: BookmarkAgentCatalog,
  nodeById: Map<string, BookmarkAgentCatalogBookmark>
): OrganizationProposal[] {
  const folderById = new Map(
    catalog.folders.map((folder) => [folder.id, folder])
  );
  const topicGroups = new Map<
    string,
    Array<{ resource: ResourceRecord; node: BookmarkAgentCatalogBookmark }>
  >();
  for (const resource of resources) {
    const node = resource.nativeBookmarkIds
      .map((id) => nodeById.get(id))
      .find(Boolean);
    if (!node) continue;
    for (const rawTopic of resource.topics) {
      const topic = normalizeTopic(rawTopic);
      if (!topic) continue;
      const group = topicGroups.get(topic) || [];
      group.push({ resource, node });
      topicGroups.set(topic, group);
    }
  }

  const candidates: OrganizationProposal[] = [];
  const alreadyMoved = new Set<string>();
  const searchIndex = buildLocalSearchIndex(resources);
  const selectableFolders = catalog.folders
    .filter((folder) => folder.writable && folder.path.length > 1)
    .map((folder) => ({
      id: folder.id,
      name: folder.title,
      path: folder.path,
      depth: folder.path.length - 1
    }));
  for (const [topic, group] of topicGroups) {
    if (group.length < 3) continue;
    const movesByDestination = new Map<
      string,
      {
        destination: NativeFolderOption;
        support: number;
        moves: Array<{
          resource: ResourceRecord;
          node: BookmarkAgentCatalogBookmark;
        }>;
      }
    >();
    for (const { resource, node } of group) {
      if (!node.writable || alreadyMoved.has(resource.resourceKey)) continue;
      const preferred = scoreFolderCandidates({
        query: folderQueryForResource(resource),
        resources,
        folders: selectableFolders,
        excludedResourceKeys: new Set([resource.resourceKey]),
        searchIndex,
        limit: 1
      })[0];
      if (
        !preferred ||
        preferred.folderId === node.parentId ||
        preferred.similarCount < 2
      ) {
        continue;
      }
      const destination = folderById.get(preferred.folderId);
      if (!destination) continue;
      const moveGroup = movesByDestination.get(preferred.folderId) || {
        destination: {
          id: destination.id,
          name: destination.title,
          path: destination.path,
          depth: destination.path.length - 1
        },
        support: 0,
        moves: []
      };
      moveGroup.support = Math.max(
        moveGroup.support,
        preferred.similarCount
      );
      moveGroup.moves.push({ resource, node });
      movesByDestination.set(preferred.folderId, moveGroup);
    }

    for (const [destinationId, moveGroup] of movesByDestination) {
      const moves = moveGroup.moves.filter(
        ({ resource }) => !alreadyMoved.has(resource.resourceKey)
      );
      if (!moves.length) continue;
      for (const { resource } of moves) alreadyMoved.add(resource.resourceKey);
      const destination = moveGroup.destination;
      candidates.push({
        id: `classify:${topic}:${destinationId}`,
        kind: "classify",
        title: `把“${topic}”主题归到一起`,
        description: `${moveGroup.support} 条相似收藏已在「${pathLabel(destination.path)}」，建议移动 ${moves.length} 条散落收藏。`,
        destructive: false,
        selectedByDefault: true,
        actions: moves.map(({ resource, node }) => ({
          id: actionId(`move:${destinationId}`, node.id),
          type: "move_bookmark",
          label: `移动「${resource.title}」`,
          description: `从 ${pathLabel(node.path)} 移到 ${pathLabel(destination.path)}`,
          destructive: false,
          status: "pending",
          targetId: node.id,
          destinationId,
          expectedTitle: node.title,
          expectedUrl: node.url,
          expectedParentId: node.parentId
        })),
        resourceKeys: moves.map(({ resource }) => resource.resourceKey),
        beforePaths: moves.map(({ node }) =>
          pathLabel(node.path, node.title)
        ),
        afterPath: pathLabel(destination.path),
        previewLines: moves.map(
          ({ node }) =>
            `${pathLabel(node.path)} / 「${node.title}」 → ${pathLabel(destination.path)}`
        )
      });
    }
  }
  return candidates;
}

function largeFolderProposals(
  resources: ResourceRecord[],
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
      const topicCounts = new Map<string, number>();
      const bookmarkIds = new Set(
        catalog.bookmarks
          .filter((bookmark) => bookmark.parentId === folderId)
          .map((bookmark) => bookmark.id)
      );
      for (const resource of resources) {
        if (!resource.nativeBookmarkIds.some((id) => bookmarkIds.has(id))) {
          continue;
        }
        for (const topic of resource.topics.slice(0, 2)) {
          topicCounts.set(topic, (topicCounts.get(topic) || 0) + 1);
        }
      }
      const leadingTopics = [...topicCounts.entries()]
        .sort((left, right) => right[1] - left[1])
        .slice(0, 5)
        .map(([topic, topicCount]) => `${topic} ${topicCount} 条`);
      return {
        id: `large-folder:${folderId}`,
        kind: "large_folder" as const,
        title: `大文件夹需要拆分`,
        description: `「${pathLabel(folder?.path || [])}」有 ${count} 条收藏。为避免错误批量移动，Aarre 只提示主题分布，不会自动执行。`,
        destructive: false,
        selectedByDefault: false,
        actions: [],
        resourceKeys: [],
        beforePaths: [pathLabel(folder?.path || [])],
        previewLines: leadingTopics.length
          ? leadingTopics
          : ["现有收藏尚无足够主题信息，建议先完成本地扫描。"]
      };
    });
}

function readingQueue(
  resources: ResourceRecord[],
  catalog: BookmarkAgentCatalog
): ReadingQueueItem[] {
  const resourceByNodeId = new Map<string, ResourceRecord>();
  for (const resource of resources) {
    for (const nodeId of resource.nativeBookmarkIds) {
      resourceByNodeId.set(nodeId, resource);
    }
  }
  return catalog.bookmarks
    .map((node) => ({ node, resource: resourceByNodeId.get(node.id) }))
    .filter(
      (
        item
      ): item is {
        node: BookmarkAgentCatalogBookmark;
        resource: ResourceRecord;
      } => Boolean(item.resource)
    )
    .sort(
      (left, right) =>
        (left.node.dateLastUsed ?? 0) -
          (right.node.dateLastUsed ?? 0) ||
        (left.node.dateAdded ?? 0) - (right.node.dateAdded ?? 0)
    )
    .slice(0, MAX_READING_QUEUE)
    .map(({ node, resource }) => ({
      nodeId: node.id,
      resourceKey: resource.resourceKey,
      title: resource.title,
      url: resource.url,
      path: node.path,
      ...(node.dateAdded ? { dateAdded: node.dateAdded } : {}),
      ...(node.dateLastUsed ? { dateLastUsed: node.dateLastUsed } : {})
    }));
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
  proposals.push(
    ...classificationProposals(resources, catalog, nodeById),
    ...largeFolderProposals(resources, catalog)
  );
  return {
    organizationPlan: {
      generatedAt,
      proposalCount: proposals.length,
      actionableCount: proposals.filter(
        (proposal) => proposal.actions.length > 0
      ).length,
      proposals
    },
    readingQueue: readingQueue(resources, catalog)
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

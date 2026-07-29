import { searchLocalResources } from "./search";
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
  return [...path, ...(title ? [title] : [])].join(" / ") || "书签栏";
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
  return {
    id: `duplicate:${resource.resourceKey}`,
    kind: "duplicate",
    title: `合并 ${nodes.length} 个重复收藏`,
    description: `保留最早收藏的「${resource.title}」，其余副本默认不勾选，需你明确确认后才会删除。`,
    destructive: true,
    selectedByDefault: false,
    actions: removable.map((node) =>
      deleteAction(node, `保留 ${pathLabel(keep.path, keep.title)} 中更早的收藏`)
    ),
    resourceKeys: [resource.resourceKey],
    beforePaths: ordered.map((node) => pathLabel(node.path, node.title)),
    afterPath: pathLabel(keep.path, keep.title),
    previewLines: [
      `保留：${pathLabel(keep.path, keep.title)}`,
      ...removable.map(
        (node) => `待删除：${pathLabel(node.path, node.title)}`
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
  return {
    id: `dead:${resource.resourceKey}`,
    kind: "dead",
    title: isConfirmedDead ? "失效链接待确认" : "疑似内容已删除",
    description: `${health.reason || "链接检查未通过"}。删除项默认不勾选，建议先打开复核。`,
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
    ]
  };
}

function normalizeTopic(value: string): string {
  return value.toLocaleLowerCase().normalize("NFKC").trim();
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
  for (const [topic, group] of topicGroups) {
    if (group.length < 3) continue;
    const countByParent = new Map<string, number>();
    for (const { node } of group) {
      countByParent.set(
        node.parentId,
        (countByParent.get(node.parentId) || 0) + 1
      );
    }
    const [destinationId, dominantCount] = [...countByParent.entries()].sort(
      (left, right) => right[1] - left[1]
    )[0] || ["", 0];
    const destination = folderById.get(destinationId);
    if (!destination || dominantCount < 2 || countByParent.size < 2) continue;

    const moves = group.filter(
      ({ resource, node }) =>
        node.parentId !== destinationId &&
        node.writable &&
        !alreadyMoved.has(resource.resourceKey)
    );
    if (!moves.length) continue;
    for (const { resource } of moves) alreadyMoved.add(resource.resourceKey);
    candidates.push({
      id: `classify:${topic}:${destinationId}`,
      kind: "classify",
      title: `把“${topic}”主题归到一起`,
      description: `${dominantCount} 条同主题收藏已在「${pathLabel(destination.path)}」，建议移动 ${moves.length} 条散落收藏。`,
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
      beforePaths: moves.map(({ node }) => pathLabel(node.path, node.title)),
      afterPath: pathLabel(destination.path),
      previewLines: moves.map(
        ({ node }) =>
          `${pathLabel(node.path, node.title)} → ${pathLabel(destination.path, node.title)}`
      )
    });
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
  const query = [
    capture.title,
    capture.description,
    capture.excerpt,
    capture.siteName
  ]
    .filter(Boolean)
    .join(" ")
    .slice(0, 1_500);
  const similar = searchLocalResources(resources, query).slice(0, 20);
  const folderCounts = new Map<string, number>();
  for (const { resource } of similar) {
    const key = resource.nativeFolderPath.join("\n");
    if (key) folderCounts.set(key, (folderCounts.get(key) || 0) + 1);
  }
  const normalizedQuery = query.toLocaleLowerCase().normalize("NFKC");
  return folders
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
        score: similarCount * 10 + (lexicalMatch ? 6 : 0) - folder.depth * 0.1,
        reason: similarCount
          ? `与 ${similarCount} 条相似收藏同目录`
          : "目录名称与页面主题匹配"
      };
    })
    .filter((folder) => folder.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.path.join("/").localeCompare(right.path.join("/"))
    )
    .slice(0, limit);
}

import { z } from "zod";
import { buildLibraryInsights } from "../library-insights";
import { searchLocalResourcesWithPinyin } from "../search";
import type {
  BookmarkAgentCatalog,
  BookmarkAgentCatalogBookmark,
  BookmarkAgentActionProposal,
  ResourceRecord
} from "../types";

export interface AgentToolContext {
  resources: ResourceRecord[];
  catalog: BookmarkAgentCatalog;
}

const listFoldersSchema = z.object({});
const searchBookmarksSchema = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(100).default(30),
  folderPath: z.string().optional()
});
const folderContentsSchema = z.object({
  folderPath: z.string(),
  cursor: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(100).default(50)
});
const getBookmarksSchema = z.object({ ids: z.array(z.string()).max(200) });
const libraryStatsSchema = z.object({});
const duplicatesSchema = z.object({
  threshold: z.number().min(0).max(1).default(0.9)
});
const deadLinksSchema = z.object({ limit: z.number().int().min(1).max(500).default(100) });

export const writeToolSchemas = {
  plan_create_folders: z.object({
    folders: z.array(z.object({ path: z.string().min(1), reason: z.string().max(100) })).max(100)
  }),
  plan_move_bookmarks: z.object({
    moves: z.array(z.object({ bookmarkId: z.string(), targetFolderPath: z.string().min(1) })).max(1000)
  }),
  plan_rename: z.object({
    renames: z.array(z.object({
      id: z.string(),
      kind: z.enum(["bookmark", "folder"]),
      newTitle: z.string().min(1).max(200)
    })).max(1000)
  }),
  plan_delete: z.object({
    deletions: z.array(z.object({
      id: z.string(),
      kind: z.enum(["bookmark", "folder"]),
      reason: z.string().min(1).max(200)
    })).max(500)
  }),
  plan_update_metadata: z.object({
    updates: z.array(z.object({
      resourceKey: z.string(),
      tags: z.array(z.string()).optional(),
      userNote: z.string().max(2000).optional(),
      summary: z.string().max(2000).optional()
    })).max(1000)
  })
} as const;

function pathLabel(path: string[]): string {
  return path.filter(Boolean).join("/");
}

function resourceForBookmark(
  resources: ResourceRecord[],
  bookmark: BookmarkAgentCatalogBookmark
): ResourceRecord | undefined {
  return resources.find((resource) => resource.nativeBookmarkIds.includes(bookmark.id));
}

export function createReadTools(context: AgentToolContext) {
  const insights = () => buildLibraryInsights(context.resources, context.catalog);
  return {
    list_folders: {
      description: "列出完整文件夹树及每个文件夹的直接条目数量。",
      parameters: listFoldersSchema,
      execute: async () => ({
        folders: context.catalog.folders.map((folder) => ({
          id: folder.id,
          path: pathLabel(folder.path),
          count: context.catalog.bookmarks.filter((bookmark) => bookmark.parentId === folder.id).length
        }))
      })
    },
    search_bookmarks: {
      description: "按关键词搜索书签，支持中文、拼音、标签、摘要和文件夹。",
      parameters: searchBookmarksSchema,
      execute: async (raw: z.output<typeof searchBookmarksSchema>) => {
        const args = searchBookmarksSchema.parse(raw);
        const results = await searchLocalResourcesWithPinyin(context.resources, args.query);
        return {
          results: results
            .filter(({ resource }) => !args.folderPath || pathLabel(resource.nativeFolderPath).startsWith(args.folderPath))
            .slice(0, args.limit)
            .map(({ resource, score }) => ({
              resourceKey: resource.resourceKey,
              bookmarkIds: resource.nativeBookmarkIds,
              title: resource.title,
              url: resource.url,
              folderPath: pathLabel(resource.nativeFolderPath),
              tags: resource.tags,
              summary: resource.summary,
              score
            }))
        };
      }
    },
    get_folder_contents: {
      description: "分页读取某个文件夹的直接内容。",
      parameters: folderContentsSchema,
      execute: async (raw: z.output<typeof folderContentsSchema>) => {
        const args = folderContentsSchema.parse(raw);
        const items = context.catalog.bookmarks.filter(
          (bookmark) => pathLabel(bookmark.path) === args.folderPath
        );
        const page = items.slice(args.cursor, args.cursor + args.limit);
        return {
          items: page,
          nextCursor: args.cursor + page.length < items.length ? args.cursor + page.length : null
        };
      }
    },
    get_bookmarks: {
      description: "按 Chrome 书签 ID 批量获取详情。",
      parameters: getBookmarksSchema,
      execute: async (raw: z.output<typeof getBookmarksSchema>) => {
        const args = getBookmarksSchema.parse(raw);
        const wanted = new Set(args.ids);
        return {
          bookmarks: context.catalog.bookmarks
            .filter((bookmark) => wanted.has(bookmark.id))
            .map((bookmark) => ({
              ...bookmark,
              resource: resourceForBookmark(context.resources, bookmark)
            }))
        };
      }
    },
    get_library_stats: {
      description: "获取收藏库总数、文件夹、无标签、重复与失效链接统计。",
      parameters: libraryStatsSchema,
      execute: async () => {
        const result = insights();
        const proposals = result.organizationPlan.proposals;
        return {
          bookmarks: context.catalog.bookmarks.length,
          folders: context.catalog.folders.length,
          untagged: context.resources.filter((resource) => !resource.tags.length).length,
          duplicateGroups: proposals.filter((proposal) => proposal.kind === "duplicate").length,
          deadLinks: proposals.filter((proposal) => proposal.kind === "dead").length,
          largestFolder: context.catalog.folders
            .map((folder) => ({ path: pathLabel(folder.path), count: context.catalog.bookmarks.filter((item) => item.parentId === folder.id).length }))
            .sort((left, right) => right.count - left.count)[0] || null
        };
      }
    },
    find_duplicates: {
      description: "从现有收藏洞察中读取真实重复组。",
      parameters: duplicatesSchema,
      execute: async (raw: z.output<typeof duplicatesSchema>) => {
        duplicatesSchema.parse(raw);
        return { groups: insights().organizationPlan.proposals.filter((proposal) => proposal.kind === "duplicate") };
      }
    },
    find_dead_links: {
      description: "读取已有真实网络检测确认的失效链接。",
      parameters: deadLinksSchema,
      execute: async (raw: z.output<typeof deadLinksSchema>) => {
        const args = deadLinksSchema.parse(raw);
        return { links: insights().organizationPlan.proposals.filter((proposal) => proposal.kind === "dead").slice(0, args.limit) };
      }
    }
  };
}

export function toolDefinitions(context: AgentToolContext) {
  const readTools = createReadTools(context);
  return [
    ...Object.entries(readTools).map(([name, tool]) => ({
      name,
      description: tool.description,
      parameters: z.toJSONSchema(tool.parameters)
    })),
    ...Object.entries(writeToolSchemas).map(([name, parameters]) => ({
      name,
      description: `把 ${name} 加入待确认计划；不得直接执行。`,
      parameters: z.toJSONSchema(parameters)
    }))
  ];
}

function folderByPath(context: AgentToolContext, path: string) {
  return context.catalog.folders.find((folder) => pathLabel(folder.path) === path);
}

export function proposalsFromWriteTool(
  context: AgentToolContext,
  name: keyof typeof writeToolSchemas,
  rawArguments: unknown
): BookmarkAgentActionProposal[] {
  const id = () => crypto.randomUUID();
  if (name === "plan_create_folders") {
    const { folders } = writeToolSchemas[name].parse(rawArguments);
    const planned = new Map<string, string>();
    for (const folder of folders) {
      const segments = folder.path.split("/").filter(Boolean);
      for (let depth = 1; depth <= segments.length; depth += 1) {
        const path = segments.slice(0, depth).join("/");
        if (!folderByPath(context, path)) {
          planned.set(path, depth === segments.length ? folder.reason : "创建上级文件夹");
        }
      }
    }
    return [...planned].map(([path, reason]) => {
      const segments = path.split("/");
      const parentPath = segments.slice(0, -1).join("/");
      const parent = folderByPath(context, parentPath);
      return {
        id: id(), type: "create_folder", label: `新建「${path}」`,
        description: reason, destructive: false, status: "pending",
        parentId: parent?.id, title: segments.at(-1), plannedPath: path,
        groupLabel: "新建文件夹", selected: true
      };
    });
  }
  if (name === "plan_move_bookmarks") {
    const { moves } = writeToolSchemas[name].parse(rawArguments);
    return moves.map((move) => {
      const bookmark = context.catalog.bookmarks.find((item) => item.id === move.bookmarkId);
      const folder = folderByPath(context, move.targetFolderPath);
      return {
        id: id(), type: "move_bookmark", label: `移动「${bookmark?.title || move.bookmarkId}」`,
        description: `移动到 ${move.targetFolderPath}`, destructive: false, status: "pending",
        targetId: move.bookmarkId, destinationId: folder?.id,
        targetFolderPath: move.targetFolderPath,
        expectedTitle: bookmark?.title, expectedUrl: bookmark?.url,
        expectedParentId: bookmark?.parentId, groupLabel: "移动书签", selected: true
      };
    });
  }
  if (name === "plan_rename") {
    const { renames } = writeToolSchemas[name].parse(rawArguments);
    return renames.map((rename) => ({
      id: id(), type: rename.kind === "folder" ? "rename_folder" : "update_bookmark",
      label: `重命名为「${rename.newTitle}」`, description: "Agent 整理计划",
      destructive: false, status: "pending", targetId: rename.id, title: rename.newTitle,
      groupLabel: "重命名", selected: true
    }));
  }
  if (name === "plan_delete") {
    const { deletions } = writeToolSchemas[name].parse(rawArguments);
    return deletions.map((deletion) => ({
      id: id(), type: deletion.kind === "folder" ? "delete_folder" : "delete_bookmark",
      label: `删除 ${deletion.id}`, description: deletion.reason,
      destructive: true, status: "pending", targetId: deletion.id, groupLabel: "删除",
      selected: false
    }));
  }
  const { updates } = writeToolSchemas.plan_update_metadata.parse(rawArguments);
  return updates.map((update) => ({
    id: id(), type: "update_metadata", label: "更新收藏信息", description: "Agent 整理计划",
    destructive: false, status: "pending", resourceKey: update.resourceKey,
    tags: update.tags, userNote: update.userNote, summary: update.summary,
    groupLabel: "更新信息", selected: true
  }));
}

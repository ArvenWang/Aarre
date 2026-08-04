import { buildLibraryInsights } from "../library-insights";
import {
  buildLocalSearchIndex,
  searchLocalIndex,
  type LocalSearchIndexItem
} from "../search";
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

type JsonSchema = Record<string, unknown>;
interface RuntimeSchema<T> {
  parse(value: unknown): T;
  jsonSchema: JsonSchema;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} 必须是对象`);
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string, maximum = 2_000): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) {
    throw new Error(`${label} 必须是 1-${maximum} 个字符`);
  }
  return value.trim();
}

function integer(value: unknown, fallback: number, minimum: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || Number(value) < minimum || Number(value) > maximum) throw new Error("数值参数超出范围");
  return Number(value);
}

function list(value: unknown, label: string, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) throw new Error(`${label} 必须是最多 ${maximum} 项的数组`);
  return value;
}

function schema<T>(jsonSchema: JsonSchema, parse: (value: unknown) => T): RuntimeSchema<T> {
  return { jsonSchema, parse };
}

const emptyObjectSchema = { type: "object", properties: {}, additionalProperties: false };
const listFoldersSchema = schema(emptyObjectSchema, (value) => { record(value, "参数"); return {}; });
const searchBookmarksSchema = schema({
  type: "object",
  properties: {
    query: { type: "string", minLength: 1 },
    queries: { type: "array", minItems: 1, maxItems: 12, items: { type: "string", minLength: 1 } },
    limit: { type: "integer", minimum: 1, maximum: 100, default: 30 },
    folderPath: { type: "string" }
  },
  additionalProperties: false
}, (value) => {
  const input = record(value, "搜索参数");
  const query = input.query === undefined ? undefined : text(input.query, "query");
  const queries = input.queries === undefined ? undefined : list(input.queries, "queries", 12).map((item) => text(item, "queries[]"));
  if (!query && !queries?.length) throw new Error("query 或 queries 至少提供一个");
  return {
    query,
    queries,
    limit: integer(input.limit, 30, 1, 100),
    folderPath: input.folderPath === undefined ? undefined : text(input.folderPath, "folderPath")
  };
});
const folderContentsSchema = schema({
  type: "object",
  properties: {
    folderPath: { type: "string", minLength: 1 },
    cursor: { type: "integer", minimum: 0, default: 0 },
    limit: { type: "integer", minimum: 1, maximum: 100, default: 50 }
  },
  required: ["folderPath"], additionalProperties: false
}, (value) => {
  const input = record(value, "文件夹参数");
  return { folderPath: text(input.folderPath, "folderPath"), cursor: integer(input.cursor, 0, 0, 1_000_000), limit: integer(input.limit, 50, 1, 100) };
});
const getBookmarksSchema = schema({
  type: "object", properties: { ids: { type: "array", maxItems: 200, items: { type: "string", minLength: 1 } } }, required: ["ids"], additionalProperties: false
}, (value) => {
  const input = record(value, "书签参数");
  return { ids: list(input.ids, "ids", 200).map((item) => text(item, "ids[]", 200)) };
});
const libraryStatsSchema = schema(emptyObjectSchema, (value) => { record(value, "参数"); return {}; });
const duplicatesSchema = schema({
  type: "object", properties: { threshold: { type: "number", minimum: 0, maximum: 1, default: 0.9 } }, additionalProperties: false
}, (value) => {
  const input = record(value, "重复项参数");
  const threshold = input.threshold === undefined ? 0.9 : Number(input.threshold);
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) throw new Error("threshold 超出范围");
  return { threshold };
});
const deadLinksSchema = schema({
  type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 500, default: 100 } }, additionalProperties: false
}, (value) => {
  const input = record(value, "失效链接参数");
  return { limit: integer(input.limit, 100, 1, 500) };
});

const objectArraySchema = (name: string, maximum: number, properties: JsonSchema) => ({
  type: "object", properties: { [name]: { type: "array", maxItems: maximum, items: { type: "object", properties, additionalProperties: false } } }, required: [name], additionalProperties: false
});

export const writeToolSchemas = {
  plan_create_folders: schema(objectArraySchema("folders", 100, { path: { type: "string", minLength: 1 }, reason: { type: "string", maxLength: 100 } }), (value) => {
    const input = record(value, "新建文件夹参数");
    return { folders: list(input.folders, "folders", 100).map((item) => { const row = record(item, "folder"); return { path: text(row.path, "path"), reason: text(row.reason, "reason", 100) }; }) };
  }),
  plan_move_bookmarks: schema(objectArraySchema("moves", 1000, { bookmarkId: { type: "string", minLength: 1 }, targetFolderPath: { type: "string", minLength: 1 } }), (value) => {
    const input = record(value, "移动参数");
    return { moves: list(input.moves, "moves", 1000).map((item) => { const row = record(item, "move"); return { bookmarkId: text(row.bookmarkId, "bookmarkId", 200), targetFolderPath: text(row.targetFolderPath, "targetFolderPath") }; }) };
  }),
  plan_rename: schema(objectArraySchema("renames", 1000, { id: { type: "string", minLength: 1 }, kind: { type: "string", enum: ["bookmark", "folder"] }, newTitle: { type: "string", minLength: 1, maxLength: 200 } }), (value) => {
    const input = record(value, "重命名参数");
    return { renames: list(input.renames, "renames", 1000).map((item) => { const row = record(item, "rename"); const kind = text(row.kind, "kind") as "bookmark" | "folder"; if (kind !== "bookmark" && kind !== "folder") throw new Error("kind 无效"); return { id: text(row.id, "id", 200), kind, newTitle: text(row.newTitle, "newTitle", 200) }; }) };
  }),
  plan_delete: schema(objectArraySchema("deletions", 500, { id: { type: "string", minLength: 1 }, kind: { type: "string", enum: ["bookmark", "folder"] }, reason: { type: "string", minLength: 1, maxLength: 200 } }), (value) => {
    const input = record(value, "删除参数");
    return { deletions: list(input.deletions, "deletions", 500).map((item) => { const row = record(item, "deletion"); const kind = text(row.kind, "kind") as "bookmark" | "folder"; if (kind !== "bookmark" && kind !== "folder") throw new Error("kind 无效"); return { id: text(row.id, "id", 200), kind, reason: text(row.reason, "reason", 200) }; }) };
  }),
  plan_update_metadata: schema(objectArraySchema("updates", 1000, { resourceKey: { type: "string", minLength: 1 }, tags: { type: "array", items: { type: "string" } }, userNote: { type: "string", maxLength: 2000 }, summary: { type: "string", maxLength: 2000 } }), (value) => {
    const input = record(value, "元数据参数");
    return { updates: list(input.updates, "updates", 1000).map((item) => { const row = record(item, "update"); return {
      resourceKey: text(row.resourceKey, "resourceKey", 200),
      tags: row.tags === undefined ? undefined : list(row.tags, "tags", 80).map((tag) => text(tag, "tag", 240)),
      userNote: row.userNote === undefined ? undefined : String(row.userNote).slice(0, 2000),
      summary: row.summary === undefined ? undefined : String(row.summary).slice(0, 2000)
    }; }) };
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
  let searchIndex: LocalSearchIndexItem[] | undefined;
  let insightCache: ReturnType<typeof buildLibraryInsights> | undefined;
  const index = () => searchIndex ||= buildLocalSearchIndex(context.resources);
  const insights = () => insightCache ||= buildLibraryInsights(context.resources, context.catalog);
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
      description: "一次按一个或多个关键词搜索书签，支持中文、拼音、标签、摘要和文件夹；尽量把同一问题的关键词放进 queries 一次查询。",
      parameters: searchBookmarksSchema,
      execute: async (raw: unknown) => {
        const args = searchBookmarksSchema.parse(raw);
        const queries = [...new Set([args.query, ...(args.queries || [])].filter((value): value is string => Boolean(value?.trim())).map((value) => value.trim()))];
        const localIndex = index();
        const combined = new Map<string, ReturnType<typeof searchLocalIndex>[number]>();
        for (const query of queries) {
          for (const result of searchLocalIndex(localIndex, query)) {
            const previous = combined.get(result.resource.resourceKey);
            if (!previous || (result.score || 0) > (previous.score || 0)) {
              combined.set(result.resource.resourceKey, result);
            }
          }
        }
        const results = [...combined.values()].sort((left, right) => (right.score || 0) - (left.score || 0));
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
      execute: async (raw: unknown) => {
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
      execute: async (raw: unknown) => {
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
      execute: async (raw: unknown) => {
        duplicatesSchema.parse(raw);
        return { groups: insights().organizationPlan.proposals.filter((proposal) => proposal.kind === "duplicate") };
      }
    },
    find_dead_links: {
      description: "读取已有真实网络检测确认的失效链接。",
      parameters: deadLinksSchema,
      execute: async (raw: unknown) => {
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
      parameters: tool.parameters.jsonSchema
    })),
    ...Object.entries(writeToolSchemas).map(([name, parameters]) => ({
      name,
      description: `把 ${name} 加入待确认计划；不得直接执行。`,
      parameters: parameters.jsonSchema
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

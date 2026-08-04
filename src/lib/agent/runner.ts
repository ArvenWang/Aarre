import {
  createReadTools,
  proposalsFromWriteTool,
  toolDefinitions,
  writeToolSchemas,
  type AgentToolContext
} from "./tools";
import type {
  BookmarkAgentSource,
  ResourceRecord
} from "../types";
import { canonicalizeUrl } from "../url";
import type {
  AgentProviderMessage,
  AgentProviderResponse,
  AgentRunResult
} from "./types";

export const MAX_TOOL_ROUNDS = 12;
const MAX_TOOL_RESULT_CHARS = 8_000;

export interface AgentProvider {
  call(input: {
    messages: AgentProviderMessage[];
    tools: ReturnType<typeof toolDefinitions>;
    signal?: AbortSignal;
  }): Promise<AgentProviderResponse>;
  streamFinal?(input: {
    messages: AgentProviderMessage[];
    signal?: AbortSignal;
    onDelta(text: string): void;
  }): Promise<{ text: string; providerName?: string }>;
}

export interface RunAgentInput {
  query: string;
  history?: AgentProviderMessage[];
  context: AgentToolContext;
  provider: AgentProvider;
  signal?: AbortSignal;
  onProgress?: (progress: { round: number; calls: string[] }) => void;
  onDelta?: (text: string) => void;
}

function toolResultContent(value: unknown): string {
  const serialized = JSON.stringify(value);
  if (serialized.length <= MAX_TOOL_RESULT_CHARS) return serialized;
  return `${serialized.slice(0, MAX_TOOL_RESULT_CHARS - 80)}…\n[结果已截断，请缩小查询范围]`;
}

function systemPrompt(context: AgentToolContext): string {
  const directCounts = new Map<string, number>();
  for (const bookmark of context.catalog.bookmarks) {
    directCounts.set(bookmark.parentId, (directCounts.get(bookmark.parentId) || 0) + 1);
  }
  const folders = context.catalog.folders
    .map((folder) => `${folder.path.filter(Boolean).join("/") || folder.title}（${directCounts.get(folder.id) || 0}）`)
    .slice(0, 60)
    .join("；");
  return [
    "你是 Aarre 收藏助手。所有结论必须来自工具返回的真实本地数据。",
    `当前收藏库：${context.catalog.bookmarks.length} 条收藏，${context.catalog.folders.length} 个文件夹。`,
    `文件夹概览：${folders || "暂无文件夹"}。这些信息已预置，不要再调用 list_folders 或 get_library_stats，除非用户明确要求完整统计。`,
    "检索时优先一次调用 search_bookmarks，并把相关关键词放入 queries 数组；仅在确有必要时继续缩小范围。",
    "只读工具用于核实；plan_* 只生成待用户确认的计划，绝不能表述为已经执行。删除计划必须明确提醒风险。",
    "最终用简洁中文回答。最多使用三级标题，不堆叠 emoji，不使用装饰性标题。",
    "提到收藏库里的具体条目时，必须写成 Markdown 链接 [标题](该收藏的原始网址)，界面会自动渲染成可点击的书签卡片。",
    "只为真正讨论到的条目加链接，不要为了凑数把搜索结果全部列出。"
  ].join("\n");
}

export function sourcesCitedIn(
  answer: string,
  all: BookmarkAgentSource[]
): BookmarkAgentSource[] {
  const citedUrls = [...answer.matchAll(/\]\((https?:\/\/[^\s)]+)(?:\s+[^)]*)?\)/g)]
    .map((match) => match[1]);
  const canonicalCitations = new Set(
    citedUrls.map((url) => {
      try { return canonicalizeUrl(url); } catch { return url; }
    })
  );
  return all.filter((source) => {
    if (answer.includes(source.url)) return true;
    try { return canonicalCitations.has(canonicalizeUrl(source.url)); } catch { return false; }
  });
}

function sourceForResource(resource: ResourceRecord): BookmarkAgentSource {
  return {
    resourceKey: resource.resourceKey,
    title: resource.title,
    url: resource.url,
    siteName: resource.siteName || "",
    faviconUrl: resource.faviconUrl || ""
  };
}

function collectToolSources(
  context: AgentToolContext,
  toolName: string,
  result: unknown
): BookmarkAgentSource[] {
  if (toolName !== "search_bookmarks" && toolName !== "get_bookmarks") return [];
  const keys = new Set<string>();
  const visit = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    if (typeof record.resourceKey === "string") keys.add(record.resourceKey);
    if (record.resource && typeof record.resource === "object") visit(record.resource);
    for (const child of Object.values(record)) {
      if (Array.isArray(child)) child.forEach(visit);
    }
  };
  visit(result);
  return [...keys]
    .map((key) => context.resources.find((resource) => resource.resourceKey === key))
    .filter((resource): resource is ResourceRecord => Boolean(resource))
    .map(sourceForResource);
}

export async function runAgent(input: RunAgentInput): Promise<AgentRunResult> {
  const readTools = createReadTools(input.context);
  const definitions = toolDefinitions(input.context);
  const messages: AgentProviderMessage[] = [
    {
      role: "system",
      content: systemPrompt(input.context)
    },
    ...(input.history || []).slice(-10),
    { role: "user", content: input.query.trim().slice(0, 1_000) }
  ];
  const actions = [] as AgentRunResult["plan"]["actions"];
  const sources = new Map<string, BookmarkAgentSource>();
  let providerName = "";

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    if (input.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const response = await input.provider.call({
      messages,
      tools: definitions,
      signal: input.signal
    });
    providerName = response.providerName || providerName;
    if (!response.toolCalls.length) {
      if (response.text) {
        input.onDelta?.(response.text);
        return {
          answer: response.text,
          plan: { actions },
          sources: sourcesCitedIn(response.text, [...sources.values()]),
          rounds: round + 1,
          providerName,
          stoppedByLimit: false
        };
      }
      const streamed = input.onDelta && input.provider.streamFinal
        ? await input.provider.streamFinal({
            messages,
            signal: input.signal,
            onDelta: input.onDelta
          })
        : null;
      const answer = streamed?.text || response.text || (actions.length ? "计划已准备好，请核对后执行。" : "分析完成。");
      return {
        answer,
        plan: { actions },
        sources: sourcesCitedIn(answer, [...sources.values()]),
        rounds: round + 1,
        providerName: streamed?.providerName || providerName,
        stoppedByLimit: false
      };
    }
    messages.push(response.assistantMessage);
    input.onProgress?.({ round: round + 1, calls: response.toolCalls.map((call) => call.name) });
    const results = await Promise.all(response.toolCalls.map(async (call) => {
      if (call.name in writeToolSchemas) {
        const name = call.name as keyof typeof writeToolSchemas;
        const added = proposalsFromWriteTool(input.context, name, call.arguments);
        return { actions: added, sources: [] as BookmarkAgentSource[], message: {
          role: "tool",
          toolCallId: call.id,
          toolName: call.name,
          content: toolResultContent({ accepted: true, queued: added.length })
        } satisfies AgentProviderMessage };
      }
      const tool = readTools[call.name as keyof typeof readTools];
      if (!tool) {
        return { actions: [], sources: [], message: { role: "tool", toolCallId: call.id, toolName: call.name, content: "未知工具" } satisfies AgentProviderMessage };
      }
      try {
        const result = await tool.execute(call.arguments as never);
        return { actions: [], sources: collectToolSources(input.context, call.name, result), message: {
          role: "tool",
          toolCallId: call.id,
          toolName: call.name,
          content: toolResultContent(result)
        } satisfies AgentProviderMessage };
      } catch (error) {
        return { actions: [], sources: [], message: {
          role: "tool",
          toolCallId: call.id,
          toolName: call.name,
          content: toolResultContent({ error: error instanceof Error ? error.message : "工具执行失败" })
        } satisfies AgentProviderMessage };
      }
    }));
    for (const result of results) {
      actions.push(...result.actions);
      for (const source of result.sources) {
        if (sources.size >= 10 && !sources.has(source.resourceKey)) break;
        sources.set(source.resourceKey, source);
      }
      messages.push(result.message);
    }
  }
  return {
    answer: "分析步骤过多，已停在当前结果。",
    plan: { actions },
    sources: [],
    rounds: MAX_TOOL_ROUNDS,
    providerName,
    stoppedByLimit: true
  };
}

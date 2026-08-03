import {
  createReadTools,
  proposalsFromWriteTool,
  toolDefinitions,
  writeToolSchemas,
  type AgentToolContext
} from "./tools";
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

export async function runAgent(input: RunAgentInput): Promise<AgentRunResult> {
  const readTools = createReadTools(input.context);
  const definitions = toolDefinitions(input.context);
  const messages: AgentProviderMessage[] = [
    {
      role: "system",
      content: "你是 Aarre 收藏助手。先用只读工具核实，再用 plan_* 工具生成待确认计划。写工具绝不代表已经执行。最终用中文简洁回答。"
    },
    ...(input.history || []).slice(-10),
    { role: "user", content: input.query.trim().slice(0, 1_000) }
  ];
  const actions = [] as AgentRunResult["plan"]["actions"];
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
      const streamed = input.onDelta && input.provider.streamFinal
        ? await input.provider.streamFinal({
            messages,
            signal: input.signal,
            onDelta: input.onDelta
          })
        : null;
      return {
        answer: streamed?.text || response.text || (actions.length ? "计划已准备好，请核对后执行。" : "分析完成。"),
        plan: { actions },
        rounds: round + 1,
        providerName: streamed?.providerName || providerName,
        stoppedByLimit: false
      };
    }
    messages.push(response.assistantMessage);
    input.onProgress?.({ round: round + 1, calls: response.toolCalls.map((call) => call.name) });
    for (const call of response.toolCalls) {
      if (call.name in writeToolSchemas) {
        const name = call.name as keyof typeof writeToolSchemas;
        const added = proposalsFromWriteTool(input.context, name, call.arguments);
        actions.push(...added);
        messages.push({
          role: "tool",
          toolCallId: call.id,
          toolName: call.name,
          content: toolResultContent({ accepted: true, queued: added.length })
        });
        continue;
      }
      const tool = readTools[call.name as keyof typeof readTools];
      if (!tool) {
        messages.push({ role: "tool", toolCallId: call.id, toolName: call.name, content: "未知工具" });
        continue;
      }
      try {
        const result = await tool.execute(call.arguments as never);
        messages.push({
          role: "tool",
          toolCallId: call.id,
          toolName: call.name,
          content: toolResultContent(result)
        });
      } catch (error) {
        messages.push({
          role: "tool",
          toolCallId: call.id,
          toolName: call.name,
          content: toolResultContent({ error: error instanceof Error ? error.message : "工具执行失败" })
        });
      }
    }
  }
  return {
    answer: "分析步骤过多，已停在当前结果。",
    plan: { actions },
    rounds: MAX_TOOL_ROUNDS,
    providerName,
    stoppedByLimit: true
  };
}

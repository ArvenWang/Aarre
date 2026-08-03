import { runAiGatewayCall } from "../ai-gateway";
import { getAiProviderPreset, getAiRuntimeSettings } from "../settings";
import type { AiTokenUsage } from "../types";
import type { AgentProvider } from "./runner";
import type {
  AgentProviderMessage,
  AgentProviderResponse,
  AgentToolCall
} from "./types";

const REQUEST_TIMEOUT_MS = 5 * 60_000;
const IDLE_TIMEOUT_MS = 20_000;

function usage(input = 0, output = 0): AiTokenUsage {
  return {
    inputTokens: Math.max(0, input),
    outputTokens: Math.max(0, output),
    cachedInputTokens: 0,
    estimated: input === 0 && output === 0
  };
}

function parseArguments(value: unknown): unknown {
  if (typeof value !== "string") return value || {};
  return JSON.parse(value);
}

async function fetchProvider(url: string, init: RequestInit, signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const response = await fetch(url, { ...init, signal: combined });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`AI 服务返回 ${response.status}${detail ? `：${detail.slice(0, 300)}` : ""}`);
  }
  return response;
}

async function* sseData(response: Response, signal?: AbortSignal): AsyncGenerator<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("AI 流式响应不可读取。");
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      let timer: ReturnType<typeof setTimeout> | undefined;
      const result = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("AI 流式响应 20 秒没有新内容。")), IDLE_TIMEOUT_MS);
        })
      ]).finally(() => { if (timer) clearTimeout(timer); });
      if (result.done) break;
      buffer += decoder.decode(result.value, { stream: true });
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() || "";
      for (const event of events) {
        const data = event.split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
          .join("\n");
        if (data && data !== "[DONE]") yield data;
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

function openAiMessages(messages: AgentProviderMessage[]) {
  return messages.map((message) => {
    if (message.role === "tool") {
      return { role: "tool", tool_call_id: message.toolCallId, content: message.content };
    }
    if (message.role === "assistant" && message.toolCalls?.length) {
      return {
        role: "assistant",
        content: message.content || null,
        tool_calls: message.toolCalls.map((call) => ({
          id: call.id,
          type: "function",
          function: { name: call.name, arguments: JSON.stringify(call.arguments) }
        }))
      };
    }
    return { role: message.role, content: message.content };
  });
}

async function callOpenAiCompatible(input: Parameters<AgentProvider["call"]>[0], settings: Awaited<ReturnType<typeof getAiRuntimeSettings>>): Promise<AgentProviderResponse & { usage: AiTokenUsage }> {
  const response = await fetchProvider(
    settings.provider === "openai"
      ? "https://api.openai.com/v1/chat/completions"
      : "https://api.deepseek.com/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: settings.model,
        messages: openAiMessages(input.messages),
        tools: input.tools.map((tool) => ({
          type: "function",
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
            strict: true
          }
        })),
        tool_choice: "auto",
        ...(settings.provider === "openai" ? { max_completion_tokens: 4_096 } : { max_tokens: 4_096 })
      })
    },
    input.signal
  );
  const body = await response.json() as {
    choices?: Array<{ message?: { content?: string | null; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const message = body.choices?.[0]?.message;
  if (!message) throw new Error("AI 没有返回可用内容。");
  const toolCalls: AgentToolCall[] = (message.tool_calls || []).map((call) => ({
    id: call.id,
    name: call.function.name,
    arguments: parseArguments(call.function.arguments)
  }));
  const text = message.content || "";
  return {
    text,
    toolCalls,
    assistantMessage: { role: "assistant", content: text, toolCalls },
    providerName: getAiProviderPreset(settings.provider).name,
    usage: usage(body.usage?.prompt_tokens, body.usage?.completion_tokens)
  };
}

function geminiContents(messages: AgentProviderMessage[]) {
  return messages
    .filter((message) => message.role !== "system")
    .map((message) => {
      if (message.role === "tool") {
        return {
          role: "user",
          parts: [{ functionResponse: { name: message.toolName || "tool", response: { content: message.content } } }]
        };
      }
      const parts: unknown[] = message.content ? [{ text: message.content }] : [];
      for (const call of message.toolCalls || []) {
        parts.push({ functionCall: { name: call.name, args: call.arguments } });
      }
      return { role: message.role === "assistant" ? "model" : "user", parts };
    });
}

async function callGemini(input: Parameters<AgentProvider["call"]>[0], settings: Awaited<ReturnType<typeof getAiRuntimeSettings>>): Promise<AgentProviderResponse & { usage: AiTokenUsage }> {
  const response = await fetchProvider(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(settings.model)}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": settings.apiKey || "" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: input.messages.find((message) => message.role === "system")?.content || "" }] },
        contents: geminiContents(input.messages),
        tools: [{ functionDeclarations: input.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters
        })) }],
        toolConfig: { functionCallingConfig: { mode: "AUTO" } },
        generationConfig: { maxOutputTokens: 4_096 }
      })
    },
    input.signal
  );
  const body = await response.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string; functionCall?: { name: string; args?: unknown } }> } }>;
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  };
  const parts = body.candidates?.[0]?.content?.parts || [];
  const toolCalls = parts.flatMap((part, index) => part.functionCall ? [{
    id: `gemini-${crypto.randomUUID()}-${index}`,
    name: part.functionCall.name,
    arguments: part.functionCall.args || {}
  }] : []);
  const text = parts.map((part) => part.text || "").join("");
  return {
    text,
    toolCalls,
    assistantMessage: { role: "assistant", content: text, toolCalls },
    providerName: getAiProviderPreset("gemini").name,
    usage: usage(body.usageMetadata?.promptTokenCount, body.usageMetadata?.candidatesTokenCount)
  };
}

async function streamFinalAnswer(
  input: Parameters<NonNullable<AgentProvider["streamFinal"]>>[0],
  settings: Awaited<ReturnType<typeof getAiRuntimeSettings>>
): Promise<{ text: string; providerName: string; usage: AiTokenUsage }> {
  let text = "";
  if (settings.provider === "gemini") {
    const response = await fetchProvider(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(settings.model)}:streamGenerateContent?alt=sse`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": settings.apiKey || "" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: "基于已经核实的工具结果给出最终中文回答。不要再调用工具。" }] },
          contents: geminiContents(input.messages),
          generationConfig: { maxOutputTokens: 4_096 }
        })
      },
      input.signal
    );
    for await (const data of sseData(response, input.signal)) {
      const event = JSON.parse(data) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
      const delta = event.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("") || "";
      if (delta) {
        text += delta;
        input.onDelta(delta);
      }
    }
  } else {
    const response = await fetchProvider(
      settings.provider === "openai"
        ? "https://api.openai.com/v1/chat/completions"
        : "https://api.deepseek.com/chat/completions",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${settings.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: settings.model,
          messages: [
            ...openAiMessages(input.messages),
            { role: "user", content: "基于已经核实的工具结果给出最终中文回答。不要再调用工具。" }
          ],
          stream: true,
          stream_options: { include_usage: true },
          ...(settings.provider === "openai" ? { max_completion_tokens: 4_096 } : { max_tokens: 4_096 })
        })
      },
      input.signal
    );
    for await (const data of sseData(response, input.signal)) {
      const event = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> };
      const delta = event.choices?.[0]?.delta?.content || "";
      if (delta) {
        text += delta;
        input.onDelta(delta);
      }
    }
  }
  return {
    text,
    providerName: getAiProviderPreset(settings.provider).name,
    usage: usage(0, Math.ceil(text.length / 2.5))
  };
}

export const configuredAgentProvider: AgentProvider = {
  async call(input) {
    const settings = await getAiRuntimeSettings();
    if (!settings.apiKey) {
      throw new Error(`请先在设置中填写 ${getAiProviderPreset(settings.provider).name} API Key。`);
    }
    return runAiGatewayCall({
      provider: settings.provider,
      model: settings.model,
      operation: "agent",
      call: () => settings.provider === "gemini"
        ? callGemini(input, settings)
        : callOpenAiCompatible(input, settings)
    });
  },
  async streamFinal(input) {
    const settings = await getAiRuntimeSettings();
    if (!settings.apiKey) throw new Error("AI Key 未配置。");
    return runAiGatewayCall({
      provider: settings.provider,
      model: settings.model,
      operation: "agent",
      call: () => streamFinalAnswer(input, settings)
    });
  }
};

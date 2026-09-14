import type { BookmarkAgentResponse, BookmarkAgentTurn } from "./types";

/** A terminated worker or silent provider must settle the turn and release its UI. */
export function streamAgentTurn(input: {
  query: string;
  requestId: string;
  history: BookmarkAgentTurn[];
  onPort(port: chrome.runtime.Port): void;
  onDelta(text: string): void;
  idleTimeoutMs?: number;
  totalTimeoutMs?: number;
}): Promise<BookmarkAgentResponse> {
  return new Promise((resolve, reject) => {
    const port = chrome.runtime.connect({ name: "agent-stream" });
    input.onPort(port);
    let settled = false;
    let idle: ReturnType<typeof setTimeout>;
    const finish = (error?: Error, response?: BookmarkAgentResponse) => {
      if (settled) return;
      settled = true;
      clearTimeout(idle);
      clearTimeout(total);
      port.onMessage.removeListener(onMessage);
      port.onDisconnect.removeListener(onDisconnect);
      try { port.disconnect(); } catch { /* Already disconnected. */ }
      if (error) reject(error);
      else resolve(response!);
    };
    const resetIdle = () => {
      clearTimeout(idle);
      idle = setTimeout(() => finish(new Error("AI 长时间没有响应，请重试。已收到的内容已保留。")), input.idleTimeoutMs ?? 90_000);
    };
    const total = setTimeout(() => finish(new Error("本次回答超时，请重试。已收到的内容已保留。")), input.totalTimeoutMs ?? 300_000);
    const onDisconnect = () => {
      // Reading lastError handles Chrome's diagnostic without exposing internal errors.
      void chrome.runtime.lastError;
      finish(new Error("AI 连接已中断，请重试。已收到的内容已保留。"));
    };
    const onMessage = (raw: unknown) => {
      if (!raw || typeof raw !== "object") return;
      const event = raw as { type?: string; text?: string; response?: BookmarkAgentResponse; error?: string };
      if (event.type === "delta" && typeof event.text === "string") {
        resetIdle();
        input.onDelta(event.text);
      } else if (event.type === "progress") {
        resetIdle();
      } else if (event.type === "done" && event.response) {
        finish(undefined, event.response);
      } else if (event.type === "error") {
        finish(new Error(event.error || "AI 暂时无法回答。"));
      }
    };
    port.onMessage.addListener(onMessage);
    port.onDisconnect.addListener(onDisconnect);
    resetIdle();
    try { port.postMessage({ type: "start", query: input.query, requestId: input.requestId, history: input.history }); }
    catch { finish(new Error("未能连接 AI 服务，请重试。")); }
  });
}

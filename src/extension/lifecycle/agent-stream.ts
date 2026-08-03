import type { BookmarkAgentTurn } from "../../lib/types";

interface AgentStreamRequest {
  type: "start";
  query: string;
  requestId: string;
  history?: BookmarkAgentTurn[];
}

export function registerAgentStream(
  run: (
    query: string,
    history: BookmarkAgentTurn[],
    requestId: string,
    onDelta: (text: string) => void
  ) => Promise<unknown>,
  cancel: (requestId: string) => boolean
): void {
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== "agent-stream") return;
    let activeRequestId = "";
    port.onMessage.addListener((message: unknown) => {
      const request = message as Partial<AgentStreamRequest>;
      if (
        request.type !== "start" ||
        typeof request.query !== "string" ||
        typeof request.requestId !== "string"
      ) return;
      activeRequestId = request.requestId;
      void run(
        request.query,
        Array.isArray(request.history) ? request.history : [],
        request.requestId,
        (text) => port.postMessage({ type: "delta", text })
      ).then(
        (response) => port.postMessage({ type: "done", response }),
        (error) => port.postMessage({
          type: "error",
          error: error instanceof Error ? error.message : "AI 暂时无法回答。"
        })
      ).finally(() => {
        if (activeRequestId === request.requestId) activeRequestId = "";
      });
    });
    port.onDisconnect.addListener(() => {
      if (activeRequestId) cancel(activeRequestId);
      activeRequestId = "";
    });
  });
}

import { authorizeUiMessage } from "../floating/session";
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
    const authorized = port.sender ? authorizeUiMessage(port.sender) : Promise.reject(new Error("无法验证 AI 菜单来源。"));
    void authorized.catch(() => undefined);
    let activeRequestId = "";
    let connected = true;
    let started = false;
    const post = (message: unknown) => {
      if (!connected) return;
      try { port.postMessage(message); } catch { connected = false; }
    };
    port.onMessage.addListener((message: unknown) => {
      const request = message as Partial<AgentStreamRequest>;
      if (
        started || request.type !== "start" ||
        typeof request.query !== "string" ||
        typeof request.requestId !== "string"
      ) return;
      started = true;
      activeRequestId = request.requestId;
      void authorized.then(() => {
        if (!connected) throw new Error("连接已关闭。");
        return run(
        request.query!,
        Array.isArray(request.history) ? request.history : [],
        request.requestId!,
        (text) => post({ type: "delta", text })
      ); }).then(
        (response) => post({ type: "done", response }),
        (error) => post({
          type: "error",
          error: error instanceof Error ? error.message : "AI 暂时无法回答。"
        })
      ).finally(() => {
        if (activeRequestId === request.requestId) activeRequestId = "";
      });
    });
    port.onDisconnect.addListener(() => {
      connected = false;
      if (activeRequestId) cancel(activeRequestId);
      activeRequestId = "";
    });
  });
}

import { describe, expect, it, vi } from "vitest";
import { registerAgentStream } from "../src/extension/lifecycle/agent-stream";

function event<T extends (...args: any[]) => void>() {
  const listeners: T[] = [];
  return {
    addListener(listener: T) { listeners.push(listener); },
    emit(...args: Parameters<T>) { for (const listener of listeners) listener(...args); }
  };
}

describe("agent stream port", () => {
  it("is initiated by UI, emits deltas, and cancels when disconnected", async () => {
    const onConnect = event<(port: any) => void>();
    vi.stubGlobal("chrome", { runtime: { onConnect } });
    const run = vi.fn(async (_query, _history, _requestId, onDelta) => {
      onDelta("A");
      onDelta("B");
      return { answer: "AB" };
    });
    const cancel = vi.fn(() => true);
    registerAgentStream(run, cancel);
    const onMessage = event<(message: unknown) => void>();
    const onDisconnect = event<() => void>();
    const postMessage = vi.fn();
    const port = { name: "agent-stream", onMessage, onDisconnect, postMessage };

    onConnect.emit(port);
    onMessage.emit({ type: "start", query: "hello", requestId: "request-1", history: [] });
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith({ type: "done", response: { answer: "AB" } }));
    expect(postMessage).toHaveBeenCalledWith({ type: "delta", text: "A" });
    expect(postMessage).toHaveBeenCalledWith({ type: "delta", text: "B" });
    onDisconnect.emit();
    expect(cancel).not.toHaveBeenCalled();
  });

  it("immediately cancels the active request when the UI port closes", () => {
    const onConnect = event<(port: any) => void>();
    vi.stubGlobal("chrome", { runtime: { onConnect } });
    const run = vi.fn(() => new Promise(() => undefined));
    const cancel = vi.fn(() => true);
    registerAgentStream(run, cancel);
    const onMessage = event<(message: unknown) => void>();
    const onDisconnect = event<() => void>();
    onConnect.emit({ name: "agent-stream", onMessage, onDisconnect, postMessage: vi.fn() });
    onMessage.emit({ type: "start", query: "hello", requestId: "active-request" });

    onDisconnect.emit();

    expect(cancel).toHaveBeenCalledWith("active-request");
  });
});

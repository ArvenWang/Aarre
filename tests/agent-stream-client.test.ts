import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { streamAgentTurn } from "../src/lib/agent-stream-client";

function event() {
  const listeners = new Set<(...args: any[]) => void>();
  return { addListener: (fn: (...args: any[]) => void) => listeners.add(fn), removeListener: (fn: (...args: any[]) => void) => listeners.delete(fn), emit: (value?: unknown) => [...listeners].forEach((fn) => fn(value)), listeners };
}
function harness() {
  const port = { onMessage: event(), onDisconnect: event(), postMessage: vi.fn(), disconnect: vi.fn() };
  vi.stubGlobal("chrome", { runtime: { connect: () => port } });
  const onDelta = vi.fn();
  const promise = streamAgentTurn({ query: "查找收藏", requestId: "request", history: [], onPort: vi.fn(), onDelta, idleTimeoutMs: 100, totalTimeoutMs: 500 });
  return { port, promise, onDelta };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe("AI stream recovery", () => {
  it("settles a disconnected worker and removes listeners", async () => {
    const { port, promise, onDelta } = harness();
    const result = expect(promise).rejects.toThrow("连接已中断");
    port.onMessage.emit({ type: "delta", text: "部分回答" });
    port.onDisconnect.emit();
    await result;
    expect(onDelta).toHaveBeenCalledWith("部分回答");
    expect(port.onMessage.listeners.size + port.onDisconnect.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("times out a silent provider", async () => {
    const { promise } = harness();
    const result = expect(promise).rejects.toThrow("长时间没有响应");
    await vi.advanceTimersByTimeAsync(101);
    await result;
  });
  it("bounds a never-ending stream even when chunks keep arriving", async () => {
    const { promise, port } = harness();
    const result = expect(promise).rejects.toThrow("本次回答超时");
    for (let i = 0; i < 6; i++) {
      port.onMessage.emit({ type: "delta", text: "续" });
      await vi.advanceTimersByTimeAsync(90);
    }
    await result;
  });
  it("keeps a completed answer when disconnect follows done", async () => {
    const { port, promise } = harness();
    const response = { answer: "完成", sources: [], actions: [] };
    port.onMessage.emit({ type: "done", response });
    port.onDisconnect.emit();
    await expect(promise).resolves.toEqual(response);
    expect(vi.getTimerCount()).toBe(0);
  });
});

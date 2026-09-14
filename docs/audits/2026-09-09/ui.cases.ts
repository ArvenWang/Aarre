// @vitest-environment jsdom
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { useAgentChat, type SidePanelView } from "../../../src/ui/sidepanel/hooks/use-agent-chat";
import { SettingsMoreContent } from "../../../src/ui/sidepanel/components/settings/SettingsMoreContent";
import type { UndoSnapshotBatch } from "../../../src/lib/types";

function event() {
  const listeners = new Set<(...args: any[]) => void>();
  return {
    addListener: (listener: (...args: any[]) => void) => listeners.add(listener),
    removeListener: (listener: (...args: any[]) => void) => listeners.delete(listener),
    emit: (...args: any[]) => listeners.forEach(listener => listener(...args)),
    size: () => listeners.size
  };
}

it("A08 releases the chat UI after the service worker port disconnects", async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const onMessage = event();
  const onDisconnect = event();
  const port = { onMessage, onDisconnect, postMessage: vi.fn(), disconnect: vi.fn(() => onDisconnect.emit()) };
  vi.stubGlobal("chrome", { runtime: {
    connect: vi.fn(() => port), onMessage: event(),
    sendMessage: vi.fn(async (request) => ({ ok: true, data: request.conversation || [] }))
  } });
  let current: { busy: string; chat: ReturnType<typeof useAgentChat> };
  function Harness() {
    const [busy, setBusy] = useState("");
    const [panelView, setPanelView] = useState<SidePanelView>("library");
    const chat = useAgentChat({ busy, setBusy, setError: () => {}, setNotice: () => {}, aiConfigured: true, panelView, setPanelView, refresh: async () => {} });
    current = { busy, chat };
    return createElement("div", { "data-busy": busy }, chat.activeConversation?.messages.at(-1)?.status || "idle");
  }
  const element = document.createElement("div");
  const root = createRoot(element);
  try {
    await act(async () => root.render(createElement(Harness)));
    await act(async () => current!.chat.submit("Find my bookmarks"));
    expect(port.postMessage).toHaveBeenCalled();
    await act(async () => onDisconnect.emit());
    console.log("A08", { disconnectListeners: onDisconnect.size(), busyAfterDisconnect: current!.busy, messageStatus: element.textContent });
    expect(current!.busy).toBe("");
  } finally {
    await act(async () => root.unmount());
  }
});

it("A09 exposes every retained undo batch or provides pagination", () => {
  const batches: UndoSnapshotBatch[] = Array.from({ length: 13 }, (_, index) => ({
    batchId: `audit-undo-${index}`, source: "manual", label: `Retained action ${index + 1}`,
    destructive: true, createdAt: "2026-09-09T00:00:00.000Z", expiresAt: "2099-01-01T00:00:00.000Z",
    status: "ready", mutations: []
  }));
  const html = renderToStaticMarkup(createElement(SettingsMoreContent, { action: "", undoBatches: batches, onUndo: () => {} }));
  const element = document.createElement("div");
  element.innerHTML = html;
  const count = element.querySelectorAll("article").length;
  console.log("A09", { retainedBatches: 13, renderedBatches: count, controlLabels: [...element.querySelectorAll("button")].map(button => button.textContent) });
  expect(element.textContent?.includes("Retained action 13") || /加载更多|下一页|查看全部/.test(element.textContent || "")).toBe(true);
});

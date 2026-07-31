// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SnapshotBackfillStatus } from "../src/lib/types";
import { SnapshotBackfillControl } from "../src/ui/manager/components/SnapshotBackfillControl";

(globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean;
}).IS_REACT_ACT_ENVIRONMENT = true;

const mountedRoots: Array<ReturnType<typeof createRoot>> = [];

function backfillStatus(
  values: Partial<SnapshotBackfillStatus> = {}
): SnapshotBackfillStatus {
  return {
    id: "",
    state: "idle",
    total: 0,
    processed: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    currentTitle: "",
    errors: [],
    concurrency: 1,
    requiresForeground: false,
    ...values
  };
}

function buttonWithText(container: ParentNode, text: string) {
  return [...container.querySelectorAll("button")].find(
    (button) => button.textContent?.trim() === text
  ) as HTMLButtonElement | undefined;
}

function installChromeMock(
  handler: (request: { type: string }) => SnapshotBackfillStatus
) {
  const listeners = new Set<(message: unknown) => void>();
  const sendMessage = vi.fn(async (request: { type: string }) => ({
    ok: true,
    data: handler(request)
  }));
  vi.stubGlobal("chrome", {
    runtime: {
      sendMessage,
      onMessage: {
        addListener: (listener: (message: unknown) => void) =>
          listeners.add(listener),
        removeListener: (listener: (message: unknown) => void) =>
          listeners.delete(listener)
      }
    }
  });
  return {
    sendMessage,
    broadcast(message: unknown) {
      for (const listener of listeners) listener(message);
    }
  };
}

async function renderControl(
  missingCount: number,
  onCollectionChanged = vi.fn()
) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mountedRoots.push(root);
  await act(async () => {
    root.render(
      <SnapshotBackfillControl
        missingCount={missingCount}
        onCollectionChanged={onCollectionChanged}
      />
    );
    await Promise.resolve();
  });
  return { container, onCollectionChanged };
}

afterEach(async () => {
  await act(async () => {
    for (const root of mountedRoots.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("SnapshotBackfillControl", () => {
  it("requires an explicit, fully explained confirmation before starting", async () => {
    const running = backfillStatus({
      id: "job-started",
      state: "running",
      total: 5,
      currentTitle: "第一篇网页",
      updatedAt: "2026-07-31T01:00:00.000Z"
    });
    const { sendMessage } = installChromeMock((request) =>
      request.type === "START_SNAPSHOT_BACKFILL"
        ? running
        : backfillStatus()
    );
    const { container } = await renderControl(7);

    expect(buttonWithText(container, "补齐缺失封面")).toBeDefined();
    expect(
      sendMessage.mock.calls.some(
        ([request]) => request.type === "START_SNAPSHOT_BACKFILL"
      )
    ).toBe(false);

    await act(async () => {
      buttonWithText(container, "补齐缺失封面")?.click();
    });

    const dialog = container.querySelector(
      '[role="dialog"]'
    ) as HTMLElement;
    expect(dialog).not.toBeNull();
    expect(dialog.textContent).toContain("约 7 项");
    expect(dialog.textContent).toContain("加载完成并稳定后才截图");
    expect(dialog.textContent).toContain(
      "任务在后台运行，不占用当前页面"
    );
    expect(dialog.textContent).toContain("后台专用标签页");
    expect(dialog.textContent).toContain("不调用 AI");
    expect(dialog.textContent).toContain("不会上传网页或截图");

    const close = container.querySelector(
      '[aria-label="关闭批量补拍确认"]'
    ) as HTMLButtonElement;
    const start = buttonWithText(container, "开始补拍")!;
    start.focus();
    await act(async () => {
      dialog.dispatchEvent(
        new window.KeyboardEvent("keydown", {
          key: "Tab",
          bubbles: true
        })
      );
    });
    expect(document.activeElement).toBe(close);

    close.focus();
    await act(async () => {
      dialog.dispatchEvent(
        new window.KeyboardEvent("keydown", {
          key: "Tab",
          shiftKey: true,
          bubbles: true
        })
      );
    });
    expect(document.activeElement).toBe(start);

    await act(async () => {
      start.click();
      await Promise.resolve();
    });

    expect(sendMessage).toHaveBeenCalledWith({
      type: "START_SNAPSHOT_BACKFILL"
    });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(container.textContent).toContain("0 / 5");
    expect(container.textContent).toContain("正在后台补拍");
  });

  it("shows only real background progress and supports pause, resume and cancel", async () => {
    let current = backfillStatus({
      id: "job-active",
      state: "running",
      total: 9,
      processed: 4,
      succeeded: 3,
      skipped: 1,
      failed: 0,
      currentTitle: "组件资料库",
      updatedAt: "2026-07-31T01:00:00.000Z"
    });
    const { sendMessage } = installChromeMock((request) => {
      if (request.type === "PAUSE_SNAPSHOT_BACKFILL") {
        current = {
          ...current,
          state: "paused",
          updatedAt: "2026-07-31T01:00:01.000Z"
        };
      } else if (request.type === "RESUME_SNAPSHOT_BACKFILL") {
        current = {
          ...current,
          state: "running",
          updatedAt: "2026-07-31T01:00:02.000Z"
        };
      } else if (request.type === "CANCEL_SNAPSHOT_BACKFILL") {
        current = {
          ...current,
          state: "cancelled",
          completedAt: "2026-07-31T01:00:03.000Z",
          updatedAt: "2026-07-31T01:00:03.000Z"
        };
      }
      return current;
    });
    const { container } = await renderControl(0);

    expect(container.textContent).toContain("4 / 9");
    expect(container.textContent).toContain("成功 3");
    expect(container.textContent).toContain("跳过 1");
    expect(container.textContent).toContain("失败 0");
    expect(container.textContent).toContain("组件资料库");

    await act(async () => {
      buttonWithText(container, "暂停")?.click();
      await Promise.resolve();
    });
    expect(sendMessage).toHaveBeenCalledWith({
      type: "PAUSE_SNAPSHOT_BACKFILL"
    });
    expect(container.textContent).toContain("任务已暂停");

    await act(async () => {
      buttonWithText(container, "继续")?.click();
      await Promise.resolve();
    });
    expect(sendMessage).toHaveBeenCalledWith({
      type: "RESUME_SNAPSHOT_BACKFILL"
    });

    await act(async () => {
      buttonWithText(container, "取消任务")?.click();
      await Promise.resolve();
    });
    expect(sendMessage).toHaveBeenCalledWith({
      type: "CANCEL_SNAPSHOT_BACKFILL"
    });
    expect(container.textContent).toContain("任务已取消");
  });

  it("accepts broadcast completion, refreshes the collection and can be dismissed", async () => {
    const active = backfillStatus({
      id: "job-completes",
      state: "running",
      total: 2,
      processed: 1,
      succeeded: 1,
      currentTitle: "第二页",
      updatedAt: "2026-07-31T01:00:00.000Z"
    });
    const chromeMock = installChromeMock(() => active);
    const onCollectionChanged = vi.fn();
    const { container } = await renderControl(0, onCollectionChanged);

    await act(async () => {
      chromeMock.broadcast({
        type: "SNAPSHOT_BACKFILL_UPDATED",
        status: {
          ...active,
          state: "completed",
          processed: 2,
          succeeded: 2,
          currentTitle: "",
          completedAt: "2026-07-31T01:00:03.000Z",
          updatedAt: "2026-07-31T01:00:03.000Z"
        }
      });
    });

    expect(container.textContent).toContain("2 / 2");
    expect(container.textContent).toContain("补拍任务已完成");
    expect(onCollectionChanged).toHaveBeenCalledTimes(1);

    await act(async () => {
      buttonWithText(container, "关闭")?.click();
    });
    expect(container.textContent).toBe("");
  });

  it("stays out of the toolbar when there is no missing screenshot or active job", async () => {
    installChromeMock(() => backfillStatus());
    const { container } = await renderControl(0);
    expect(container.textContent).toBe("");
  });

  it("uses the stored snapshot candidate count when resource snapshotAt is stale", async () => {
    installChromeMock((request) =>
      request.type === "GET_SNAPSHOT_BACKFILL"
        ? backfillStatus({ candidateCount: 3 })
        : backfillStatus()
    );
    const { container } = await renderControl(0);

    expect(buttonWithText(container, "补齐缺失封面")).toBeDefined();
    await act(async () => {
      buttonWithText(container, "补齐缺失封面")?.click();
    });
    expect(container.textContent).toContain("约 3 项");
  });
});

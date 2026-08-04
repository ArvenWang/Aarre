// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CloudStatusRow } from "../src/ui/sidepanel/components/CloudStatusRow";
import type { SyncStatus } from "../src/lib/sync-engine";

const idle: SyncStatus = {
  phase: "idle",
  current: 0,
  total: 0,
  lastSyncedAt: "2026-08-04T00:00:00.000Z",
  error: null,
  nextRetryAt: null,
};

afterEach(() => {
  document.body.innerHTML = "";
});

async function renderStatus(status: SyncStatus, usageRatio = 0.1) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <CloudStatusRow
        status={status}
        usage={{
          quotaBytes: 100,
          usedBytes: usageRatio * 100,
          metadataBytes: 1,
          assetBytes: usageRatio * 100 - 1,
          assetCount: 1,
          resourceCount: 1,
          usageRatio,
        }}
        onSync={vi.fn()}
        onDisconnect={vi.fn()}
      />,
    );
  });
  return container;
}

describe("cloud status row states", () => {
  it("keeps both actions visible and enabled while idle", async () => {
    const container = await renderStatus(idle);
    const buttons = [...container.querySelectorAll("button")];
    expect(buttons.map((button) => button.textContent)).toEqual([
      "立即同步",
      "断开账号",
    ]);
    expect(buttons.every((button) => !button.disabled)).toBe(true);
    expect(container.querySelector("[aria-expanded]")).toBeNull();
  });

  it("shows progress and disables only the duplicate sync action", async () => {
    const container = await renderStatus({
      ...idle,
      phase: "assets-up",
      current: 7,
      total: 24,
      lastSyncedAt: null,
    });
    const buttons = [...container.querySelectorAll("button")];
    expect(container.querySelector("progress")?.getAttribute("value")).toBe("7");
    expect(buttons[0]?.textContent).toBe("同步中…");
    expect(buttons[0]?.disabled).toBe(true);
    expect(buttons[1]?.disabled).toBe(false);
  });

  it("shows a persistent recoverable error without hiding actions", async () => {
    const message = "很长的同步错误".repeat(30);
    const container = await renderStatus({
      ...idle,
      phase: "error",
      lastSyncedAt: null,
      error: message,
      nextRetryAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const alert = container.querySelector<HTMLElement>("[role=alert]");
    expect(alert?.textContent).toBe(message);
    expect(alert?.title).toBe(message);
    expect([...container.querySelectorAll("button")]).toHaveLength(2);
  });

  it("only reveals storage usage at the established 80 percent threshold", async () => {
    expect((await renderStatus(idle, 0.79)).textContent).not.toContain("云端用量");
    expect((await renderStatus(idle, 0.8)).textContent).toContain("云端用量 80%");
  });
});

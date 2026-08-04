import { describe, expect, it, vi } from "vitest";
import { createSyncEngine, type SyncStatus } from "../src/lib/sync-engine";

function harness(overrides: Partial<Parameters<typeof createSyncEngine>[0]> = {}) {
  let now = Date.parse("2026-08-04T00:00:00.000Z");
  let current: SyncStatus = {
    phase: "idle",
    current: 0,
    total: 0,
    lastSyncedAt: null,
    error: null,
    nextRetryAt: null,
  };
  const writes: SyncStatus[] = [];
  const dependencies: Parameters<typeof createSyncEngine>[0] = {
    isReady: vi.fn(async () => true),
    pullResources: vi.fn(async () => undefined),
    pullEntities: vi.fn(async () => undefined),
    countOutbox: vi.fn(async () => 0),
    pushOutboxBatch: vi.fn(async () => ({ attempted: 0, synced: 0, failed: 0 })),
    pushEntities: vi.fn(async () => undefined),
    uploadAssets: vi.fn(async () => ({ uploaded: 0, processed: 0, total: 0, remaining: false })),
    downloadAssets: vi.fn(async () => ({ restored: 0, processed: 0, total: 0, remaining: false })),
    readStatus: vi.fn(async () => current),
    writeStatus: vi.fn(async (status) => {
      current = status;
      writes.push(status);
      return status;
    }),
    now: () => now,
    ...overrides,
  };
  return {
    engine: createSyncEngine(dependencies),
    dependencies,
    writes,
    status: () => current,
    advance: (milliseconds: number) => { now += milliseconds; },
  };
}

describe("sync engine", () => {
  it("coalesces five concurrent calls into one complete cycle", async () => {
    const test = harness();
    await Promise.all(Array.from({ length: 5 }, () => test.engine.sync("concurrent")));
    expect(test.dependencies.pullResources).toHaveBeenCalledTimes(1);
    expect(test.dependencies.pullEntities).toHaveBeenCalledTimes(1);
    expect(test.dependencies.pushEntities).toHaveBeenCalledTimes(1);
    expect(test.dependencies.uploadAssets).toHaveBeenCalledTimes(1);
    expect(test.dependencies.downloadAssets).toHaveBeenCalledTimes(1);
  });

  it("does not retry before the exponential backoff deadline", async () => {
    const pullResources = vi.fn()
      .mockRejectedValueOnce(new Error("network timeout"))
      .mockResolvedValue(undefined);
    const test = harness({ pullResources });
    await expect(test.engine.sync("first")).rejects.toThrow("network timeout");
    expect(test.status()).toMatchObject({ phase: "error", error: "network timeout" });
    await test.engine.sync("too-early");
    expect(pullResources).toHaveBeenCalledTimes(1);
    test.advance(30_000);
    await test.engine.sync("retry-due");
    expect(pullResources).toHaveBeenCalledTimes(2);
    expect(test.status().phase).toBe("idle");
  });

  it("persists every ordered stage and finishes idle", async () => {
    const test = harness();
    await test.engine.sync("stages");
    const phases = test.writes.map((status) => status.phase);
    expect(phases).toEqual(expect.arrayContaining([
      "pulling", "pushing", "assets-up", "assets-down", "idle",
    ]));
    expect(phases.indexOf("pulling")).toBeLessThan(phases.indexOf("pushing"));
    expect(phases.indexOf("pushing")).toBeLessThan(phases.indexOf("assets-up"));
    expect(phases.indexOf("assets-up")).toBeLessThan(phases.indexOf("assets-down"));
    expect(test.status().lastSyncedAt).toBe("2026-08-04T00:00:00.000Z");
  });

  it("reports a fixed asset total instead of growing the denominator by one", async () => {
    const uploadAssets = vi.fn()
      .mockResolvedValueOnce({ uploaded: 12, processed: 12, total: 121, remaining: true })
      .mockResolvedValueOnce({ uploaded: 12, processed: 24, total: 121, remaining: true })
      .mockResolvedValueOnce({ uploaded: 0, processed: 121, total: 121, remaining: false });
    const test = harness({ uploadAssets });
    await test.engine.sync("asset-progress");
    expect(
      test.writes
        .filter((status) => status.phase === "assets-up" && status.total > 0)
        .map(({ current, total }) => [current, total]),
    ).toEqual([[12, 121], [24, 121], [121, 121]]);
  });

  it("pauses without making cloud requests when the account is unavailable", async () => {
    const test = harness({ isReady: vi.fn(async () => false) });
    await test.engine.sync("signed-out");
    expect(test.status().phase).toBe("paused");
    expect(test.dependencies.pullResources).not.toHaveBeenCalled();
    expect(test.dependencies.pushOutboxBatch).not.toHaveBeenCalled();
    expect(test.dependencies.uploadAssets).not.toHaveBeenCalled();
  });
});

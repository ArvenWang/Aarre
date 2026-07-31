import { describe, expect, it } from "vitest";
import {
  emptySnapshotBackfillStatus,
  recordSnapshotBackfillOutcome,
  snapshotBackfillCaptureAllowed,
  snapshotBackfillCandidates,
  snapshotBackfillLeaseAllowsCapture,
  snapshotBackfillStateAfterFocusCheck
} from "../src/lib/snapshot-backfill";
import type { ResourceRecord } from "../src/lib/types";

function resource(
  id: string,
  url: string,
  nativeBookmarkIds: string[] = [id]
): ResourceRecord {
  return {
    resourceKey: id,
    canonicalUrl: url,
    url,
    title: id,
    userNote: "",
    summary: "",
    tags: [],
    topics: [],
    contentExcerpt: "",
    contentHash: "",
    selectedText: "",
    author: "",
    siteName: "",
    language: "",
    imageUrl: "",
    faviconUrl: "",
    nativeBookmarkIds,
    nativeFolderPath: [],
    aiStatus: "not_requested",
    syncStatus: "local",
    createdAt: "2026-07-31T00:00:00.000Z",
    updatedAt: "2026-07-31T00:00:00.000Z"
  };
}

describe("snapshot backfill planning", () => {
  it("only selects linked, supported, missing and privacy-safe pages", () => {
    const candidates = snapshotBackfillCandidates(
      [
        resource("missing", "https://public.example/missing"),
        resource("existing", "https://public.example/existing"),
        resource("removed", "https://public.example/removed", []),
        resource("internal", "http://127.0.0.1/dashboard"),
        resource("excluded", "https://private.example/account"),
        resource("unsupported", "chrome://settings")
      ],
      new Set(["https://public.example/existing"]),
      ["private.example"]
    );

    expect(candidates.map((item) => item.resourceKey)).toEqual([
      "missing"
    ]);
  });

  it("round-robins hosts while keeping screenshot concurrency at one", () => {
    const candidates = snapshotBackfillCandidates(
      [
        resource("a1", "https://a.example/a1"),
        resource("a2", "https://a.example/a2"),
        resource("b1", "https://b.example/b1")
      ],
      new Set(),
      []
    );

    expect(candidates.map((item) => item.resourceKey)).toEqual([
      "a1",
      "b1",
      "a2"
    ]);
    expect(emptySnapshotBackfillStatus()).toMatchObject({
      concurrency: 1,
      requiresForeground: false
    });
  });

  it("records isolated failures and completes without losing earlier counts", () => {
    const started = {
      ...emptySnapshotBackfillStatus(),
      id: "job-1",
      state: "running" as const,
      total: 2
    };
    const first = recordSnapshotBackfillOutcome(
      started,
      "failed",
      {
        resourceKey: "a",
        title: "A",
        message: "加载超时"
      },
      "2026-07-31T01:00:00.000Z"
    );
    const second = recordSnapshotBackfillOutcome(
      first,
      "succeeded",
      undefined,
      "2026-07-31T01:01:00.000Z"
    );

    expect(second).toMatchObject({
      state: "completed",
      processed: 2,
      succeeded: 1,
      failed: 1,
      skipped: 0,
      completedAt: "2026-07-31T01:01:00.000Z"
    });
    expect(second.errors).toEqual([
      {
        resourceKey: "a",
        title: "A",
        message: "加载超时"
      }
    ]);
  });

  it("counts privacy or removed-bookmark skips without presenting them as failures", () => {
    const started = {
      ...emptySnapshotBackfillStatus(),
      id: "job-2",
      state: "running" as const,
      total: 1
    };
    const skipped = recordSnapshotBackfillOutcome(
      started,
      "skipped",
      {
        resourceKey: "private",
        title: "Private",
        message: "隐私页面不截图"
      }
    );

    expect(skipped).toMatchObject({
      state: "completed",
      processed: 1,
      failed: 0,
      skipped: 1,
      errors: []
    });
  });

  it("allows storage only for the running job's exact resource and tab", () => {
    const exact = {
      currentResourceKey: "resource-a",
      expectedTabId: 42,
      resourceKey: "resource-a",
      tabId: 42
    };
    expect(
      snapshotBackfillCaptureAllowed({
        ...exact,
        state: "running"
      })
    ).toBe(true);
    for (const state of [
      "waiting_focus",
      "paused",
      "cancelled",
      "completed",
      "failed"
    ] as const) {
      expect(
        snapshotBackfillCaptureAllowed({ ...exact, state })
      ).toBe(false);
    }
    expect(
      snapshotBackfillCaptureAllowed({
        ...exact,
        state: "running",
        resourceKey: "resource-b"
      })
    ).toBe(false);
    expect(
      snapshotBackfillCaptureAllowed({
        ...exact,
        state: "running",
        tabId: 43
      })
    ).toBe(false);
  });

  it("waits on focus loss without reviving paused or cancelled work", () => {
    expect(
      snapshotBackfillStateAfterFocusCheck("running", false)
    ).toBe("waiting_focus");
    expect(
      snapshotBackfillStateAfterFocusCheck("waiting_focus", true)
    ).toBe("running");
    expect(
      snapshotBackfillStateAfterFocusCheck("paused", true)
    ).toBe("paused");
    expect(
      snapshotBackfillStateAfterFocusCheck("cancelled", true)
    ).toBe("cancelled");
  });

  it("requires the exact job and attempt lease before a capture may commit", () => {
    const lease = {
      jobId: "job-a",
      resourceKey: "resource-a",
      tabId: 42,
      token: "lease-a"
    };
    const running = {
      state: "running" as const,
      jobId: "job-a",
      currentResourceKey: "resource-a",
      expectedTabId: 42,
      currentLease: "lease-a"
    };

    expect(snapshotBackfillLeaseAllowsCapture(running, lease)).toBe(true);
    expect(
      snapshotBackfillLeaseAllowsCapture(
        { ...running, jobId: "job-b" },
        lease
      )
    ).toBe(false);
    expect(
      snapshotBackfillLeaseAllowsCapture(
        { ...running, currentLease: "lease-b" },
        lease
      )
    ).toBe(false);
  });

  it("does not revive an old in-flight capture after focus or pause recovery", () => {
    const oldLease = {
      jobId: "job-a",
      resourceKey: "resource-a",
      tabId: 42,
      token: "lease-before-focus-loss"
    };
    const resumed = {
      state: "running" as const,
      jobId: "job-a",
      currentResourceKey: "resource-a",
      expectedTabId: 42,
      currentLease: "lease-after-focus-loss"
    };

    expect(
      snapshotBackfillLeaseAllowsCapture(resumed, oldLease)
    ).toBe(false);
    expect(
      snapshotBackfillLeaseAllowsCapture(resumed, {
        ...oldLease,
        token: "lease-after-focus-loss"
      })
    ).toBe(true);
    expect(
      snapshotBackfillLeaseAllowsCapture(
        { ...resumed, state: "paused" },
        {
          ...oldLease,
          token: "lease-after-focus-loss"
        }
      )
    ).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import {
  acceptsSnapshotNavigationCommit,
  completeEnhancementPart,
  deferEnhancementJob,
  isEnhancementJobDue,
  mergeEnhancementJob,
  snapshotCapturePolicy,
  updateAiProgress,
  updateSnapshotProgress
} from "../src/lib/bookmark-enhancement";

describe("bookmark enhancement jobs", () => {
  it("keeps first capture silent, confirms old-bookmark recovery, and refreshes stale covers silently", () => {
    expect(
      snapshotCapturePolicy({
        hasSnapshot: false,
        snapshotIsStale: true,
        trigger: "chrome_bookmark"
      })
    ).toEqual({
      capture: true,
      refreshExisting: false,
      showToast: false
    });
    expect(
      snapshotCapturePolicy({
        hasSnapshot: false,
        snapshotIsStale: true,
        trigger: "aarre_save"
      })
    ).toEqual({
      capture: true,
      refreshExisting: false,
      showToast: false
    });
    expect(
      snapshotCapturePolicy({
        hasSnapshot: false,
        snapshotIsStale: true,
        trigger: "normal_browse"
      })
    ).toEqual({
      capture: true,
      refreshExisting: false,
      showToast: true
    });
    expect(
      snapshotCapturePolicy({
        hasSnapshot: true,
        snapshotIsStale: false,
        trigger: "normal_browse"
      })
    ).toEqual({
      capture: false,
      refreshExisting: false,
      showToast: false
    });
    expect(
      snapshotCapturePolicy({
        hasSnapshot: true,
        snapshotIsStale: true,
        trigger: "normal_browse"
      })
    ).toEqual({
      capture: true,
      refreshExisting: true,
      showToast: false
    });
  });

  it("accepts only direct navigation or an explicit Chrome redirect lineage", () => {
    expect(
      acceptsSnapshotNavigationCommit({
        directMatch: true,
        redirectSourceMatches: false,
        transitionQualifiers: []
      })
    ).toBe(true);
    expect(
      acceptsSnapshotNavigationCommit({
        directMatch: false,
        redirectSourceMatches: true,
        transitionQualifiers: ["server_redirect"]
      })
    ).toBe(true);
    expect(
      acceptsSnapshotNavigationCommit({
        directMatch: false,
        redirectSourceMatches: true,
        transitionQualifiers: ["client_redirect"]
      })
    ).toBe(true);
    expect(
      acceptsSnapshotNavigationCommit({
        directMatch: false,
        redirectSourceMatches: true,
        transitionQualifiers: []
      })
    ).toBe(false);
    expect(
      acceptsSnapshotNavigationCommit({
        directMatch: false,
        redirectSourceMatches: false,
        transitionQualifiers: ["server_redirect"]
      })
    ).toBe(false);
  });

  it("deduplicates work while preserving unfinished parts", () => {
    const first = mergeEnhancementJob(
      undefined,
      { resourceKey: "key", url: "https://example.com", pending: ["ai"] },
      "2026-07-31T00:00:00.000Z"
    );
    const merged = mergeEnhancementJob(
      first,
      {
        resourceKey: "key",
        url: "https://example.com",
        pending: ["ai", "snapshot"]
      },
      "2026-07-31T00:01:00.000Z"
    );
    expect(merged.pending).toEqual(["ai", "snapshot"]);
    expect(merged.createdAt).toBe(first.createdAt);
  });

  it("persists an observable snapshot state with exact tab and document", () => {
    const job = mergeEnhancementJob(
      undefined,
      {
        resourceKey: "resource",
        url: "https://example.com/article",
        pending: ["snapshot"]
      },
      "2026-07-31T00:00:00.000Z"
    );
    expect(
      updateSnapshotProgress(
        job,
        {
          state: "stabilizing",
          trigger: "normal_browse",
          tabId: 42,
          documentId: "document-1",
          loadedUrl: "https://example.com/article",
          refreshExisting: true
        },
        "2026-07-31T00:00:01.000Z"
      ).snapshot
    ).toEqual({
      state: "stabilizing",
      trigger: "normal_browse",
      tabId: 42,
      documentId: "document-1",
      loadedUrl: "https://example.com/article",
      refreshExisting: true,
      updatedAt: "2026-07-31T00:00:01.000Z"
    });
  });

  it("persists AI waiting and processing against the current document", () => {
    const job = mergeEnhancementJob(
      undefined,
      {
        resourceKey: "resource",
        url: "https://example.com/article",
        pending: ["ai"]
      },
      "2026-07-31T00:00:00.000Z"
    );
    expect(
      updateAiProgress(
        job,
        {
          state: "processing",
          tabId: 42,
          documentId: "document-2"
        },
        "2026-07-31T00:00:02.000Z"
      ).ai
    ).toEqual({
      state: "processing",
      tabId: 42,
      documentId: "document-2",
      updatedAt: "2026-07-31T00:00:02.000Z"
    });
  });

  it("keeps the other part after one enhancement completes", () => {
    const job = mergeEnhancementJob(undefined, {
      resourceKey: "key",
      url: "https://example.com",
      pending: ["ai", "snapshot"]
    });
    expect(completeEnhancementPart(job, "ai")?.pending).toEqual([
      "snapshot"
    ]);
    expect(completeEnhancementPart(job, "snapshot")?.pending).toEqual([
      "ai"
    ]);
  });

  it("backs off failed work and makes it due later", () => {
    const job = mergeEnhancementJob(
      undefined,
      { resourceKey: "key", url: "https://example.com", pending: ["ai"] },
      "2026-07-31T00:00:00.000Z"
    );
    const deferred = deferEnhancementJob(
      job,
      "AI unavailable",
      Date.parse("2026-07-31T00:00:00.000Z")
    );
    expect(isEnhancementJobDue(deferred, Date.parse(deferred.nextAttemptAt) - 1))
      .toBe(false);
    expect(isEnhancementJobDue(deferred, Date.parse(deferred.nextAttemptAt)))
      .toBe(true);
  });
});

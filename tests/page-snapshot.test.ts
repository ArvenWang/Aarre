// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isLoadedSnapshotTab,
  isPageSnapshotStale,
  isSnapshotSensitiveUrl,
  matchesSnapshotTargetUrl,
  mergePageSnapshotSchedule,
  PAGE_SNAPSHOT_REFRESH_INTERVAL_MS,
  PAGE_SNAPSHOT_WIDTH,
  showSnapshotUpdatedToastInDocument
} from "../src/lib/page-snapshot";
import { normalizeSnapshotExcludedHost } from "../src/lib/display-settings";

afterEach(() => {
  vi.useRealTimers();
  document.getElementById("aarre-snapshot-updated-toast")?.remove();
});

describe("page snapshot privacy", () => {
  it("blocks non-web, private, banking, payment and medical pages", () => {
    expect(isSnapshotSensitiveUrl("chrome://settings")).toBe(true);
    expect(isSnapshotSensitiveUrl("http://192.168.1.5/admin")).toBe(true);
    expect(isSnapshotSensitiveUrl("https://secure.example.bank/login")).toBe(
      true
    );
    expect(isSnapshotSensitiveUrl("https://www.paypal.com/activity")).toBe(
      true
    );
    expect(isSnapshotSensitiveUrl("https://patient.example.com/record")).toBe(
      true
    );
    expect(isSnapshotSensitiveUrl("https://secure.chase.com/account")).toBe(
      true
    );
    expect(isSnapshotSensitiveUrl("https://health.example.org/report")).toBe(
      true
    );
  });

  it("supports user-defined host exclusions without blocking normal pages", () => {
    expect(
      isSnapshotSensitiveUrl("https://docs.example.com/secret", [
        "example.com"
      ])
    ).toBe(true);
    expect(isSnapshotSensitiveUrl("https://developer.mozilla.org/docs")).toBe(
      false
    );
  });

  it("normalizes domain, wildcard and URL-shaped custom exclusions", () => {
    expect(normalizeSnapshotExcludedHost("*.Private.Example.com")).toBe(
      "private.example.com"
    );
    expect(
      normalizeSnapshotExcludedHost("https://Work.Example.com/private")
    ).toBe("work.example.com");
    expect(normalizeSnapshotExcludedHost("not a host")).toBe("");
  });

  it("matches an Aarre-opened target only after the intended URL finishes loading", () => {
    expect(
      matchesSnapshotTargetUrl(
        "https://example.com/guide#overview",
        "https://example.com/guide"
      )
    ).toBe(true);
    expect(
      matchesSnapshotTargetUrl(
        "https://example.com/guide",
        "https://example.com/login"
      )
    ).toBe(false);
    expect(matchesSnapshotTargetUrl("not a url", "https://example.com")).toBe(
      false
    );
  });

  it("never treats a loading, background, incognito or changed tab as capture-ready", () => {
    const readyTab = {
      active: true,
      incognito: false,
      status: "complete" as const,
      url: "https://example.com/guide"
    };
    expect(
      isLoadedSnapshotTab(readyTab, "https://example.com/guide#overview")
    ).toBe(true);
    expect(
      isLoadedSnapshotTab({ ...readyTab, status: "loading" })
    ).toBe(false);
    expect(isLoadedSnapshotTab({ ...readyTab, active: false })).toBe(false);
    expect(isLoadedSnapshotTab({ ...readyTab, incognito: true })).toBe(false);
    expect(
      isLoadedSnapshotTab(readyTab, "https://example.com/another-page")
    ).toBe(false);
  });

  it("does not let a silent background retry suppress the Aarre-open success toast", () => {
    expect(
      mergePageSnapshotSchedule(
        {
          delayMs: 1_500,
          showToast: true,
          completedUrl: "https://example.com/guide"
        },
        {
          delayMs: 250,
          showToast: false
        }
      )
    ).toEqual({
      delayMs: 1_500,
      showToast: true,
      completedUrl: "https://example.com/guide"
    });
  });

  it("stores enough pixels for a Retina masonry cover", () => {
    expect(PAGE_SNAPSHOT_WIDTH).toBe(960);
  });

  it("refreshes an existing screenshot only after the seven-day freshness window", () => {
    const capturedAt = Date.parse("2026-07-01T00:00:00.000Z");
    expect(
      isPageSnapshotStale(
        { capturedAt: new Date(capturedAt).toISOString() },
        capturedAt + PAGE_SNAPSHOT_REFRESH_INTERVAL_MS - 1
      )
    ).toBe(false);
    expect(
      isPageSnapshotStale(
        { capturedAt: new Date(capturedAt).toISOString() },
        capturedAt + PAGE_SNAPSHOT_REFRESH_INTERVAL_MS
      )
    ).toBe(true);
    expect(isPageSnapshotStale(null, capturedAt)).toBe(true);
  });

  it("reuses one isolated toast host and removes it after success feedback", () => {
    vi.useFakeTimers();
    showSnapshotUpdatedToastInDocument();
    showSnapshotUpdatedToastInDocument();
    expect(
      document.querySelectorAll("#aarre-snapshot-updated-toast")
    ).toHaveLength(1);
    vi.advanceTimersByTime(3_500);
    expect(
      document.querySelector("#aarre-snapshot-updated-toast")
    ).toBeNull();
  });
});

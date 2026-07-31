// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  detectBotChallengeInDocument,
  imageIsReadyForCapture,
  isLoadedSnapshotTab,
  isPageSnapshotStale,
  isSnapshotSensitiveUrl,
  matchesSnapshotTargetUrl,
  mergePageSnapshotSchedule,
  PAGE_SNAPSHOT_REFRESH_INTERVAL_MS,
  PAGE_SNAPSHOT_WIDTH,
  prepareBackgroundPageForCaptureInDocument,
  showSnapshotUpdatedToastInDocument,
  waitForStablePageInDocument
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

  it("allows a background tab when the batch backfill path opts in", () => {
    const readyTab = {
      active: false,
      incognito: false,
      status: "complete" as const,
      url: "https://example.com/guide"
    };
    expect(isLoadedSnapshotTab(readyTab, "", false)).toBe(true);
    expect(
      isLoadedSnapshotTab(
        { ...readyTab, status: "loading" },
        "",
        false
      )
    ).toBe(false);
    expect(
      isLoadedSnapshotTab({ ...readyTab, incognito: true }, "", false)
    ).toBe(false);
  });

  it("detects Cloudflare-style challenge pages before wasting a capture", () => {
    document.title = "请稍候…";
    document.body.innerHTML =
      "<main><h1>whatismyipaddress.com</h1><p>正在进行安全验证</p></main>" +
      "<div class='footer'><code>Ray ID: abc123</code></div>";
    expect(detectBotChallengeInDocument()).toBe(true);

    document.title = "Normal Page";
    document.body.innerHTML =
      "<p>Ray ID appears in an article body only, not a challenge.</p>";
    expect(detectBotChallengeInDocument()).toBe(false);

    document.title = "Example";
    document.body.innerHTML = "<p>完全正常的网页内容。</p>";
    expect(detectBotChallengeInDocument()).toBe(false);
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

  it("treats unstarted lazy images as pending instead of capture-ready", () => {
    const loaded = document.createElement("img");
    loaded.setAttribute("src", "https://example.com/loaded.png");
    // jsdom 不执行真实加载：complete 为 false 时必须视为未就绪。
    expect(imageIsReadyForCapture(loaded)).toBe(false);

    const empty = document.createElement("img");
    expect(imageIsReadyForCapture(empty)).toBe(true);

    const lazyPlaceholder = document.createElement("img");
    lazyPlaceholder.setAttribute(
      "data-src",
      "https://example.com/lazy.png"
    );
    // 懒加载库的 data-src 占位：虽然当前没有 src，也必须等待真实地址加载。
    expect(imageIsReadyForCapture(lazyPlaceholder)).toBe(false);
  });

  it("forces lazy images and content-visibility before a background capture", async () => {
    document.body.innerHTML =
      '<img loading="lazy" src="https://example.com/a.png" />' +
      '<img data-src="https://example.com/b.png" />' +
      '<img data-srcset="https://example.com/c.png 1x" />' +
      '<img alt="empty" />' +
      '<div style="content-visibility: auto">card</div>';
    const result = await prepareBackgroundPageForCaptureInDocument({
      scrollSteps: 2
    });
    const images = Array.from(document.querySelectorAll("img"));
    expect(images[0]!.loading).toBe("eager");
    expect(images[0]!.decoding).toBe("async");
    expect(images[1]!.getAttribute("src")).toBe(
      "https://example.com/b.png"
    );
    expect(images[2]!.getAttribute("srcset")).toBe(
      "https://example.com/c.png 1x"
    );
    // 只有 3 张真正需要加载的图被强制触发，空占位图不算。
    expect(result.forcedImages).toBe(3);
    expect(
      document.getElementById("aarre-capture-force-visibility")
    ).not.toBeNull();
  });

  it("resolves the batch stability wait when no content is pending", async () => {
    vi.useFakeTimers();
    Object.defineProperty(document, "readyState", {
      value: "complete",
      configurable: true
    });
    const pending = waitForStablePageInDocument(600, 4_000, {
      fontTimeoutMs: 1_500,
      imageTimeoutMs: 1_000,
      rAFTimeoutMs: 1_000,
      waitForPendingImages: true,
      resourceQuietMs: 600,
      resourceQuietMaxMs: 6_000
    });
    await vi.advanceTimersByTimeAsync(8_000);
    await expect(pending).resolves.toBe(true);
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

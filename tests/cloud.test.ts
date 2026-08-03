import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CLOUD_SYNC_SETTINGS_KEY,
  defaultCloudSyncSettings,
  getCloudSyncSettings
} from "../src/lib/cloud-settings";
import { retryAfterMilliseconds } from "../src/lib/auth";
import {
  resourceCloudPayload,
  shouldQueueResourceForCloud
} from "../src/lib/cloud";
import { usagePeriodCloudPayload } from "../src/lib/cloud-state";
import {
  cloudAssetIdentity,
  cloudSiteIconBindingIsCurrent,
  reconcileCloudAssetState
} from "../src/lib/cloud-assets";
import {
  beginCloudSyncProgress,
  CLOUD_SYNC_PROGRESS_KEY,
  completeCloudSyncProgress,
  getCloudSyncProgress,
  updateCloudSyncProgress
} from "../src/lib/cloud-progress";
import type { ResourceRecord } from "../src/lib/types";

let values: Record<string, unknown>;

beforeEach(() => {
  values = {};
  vi.stubGlobal("chrome", {
    storage: {
      local: {
        get: async (key: string) => ({ [key]: values[key] }),
        set: async (next: Record<string, unknown>) => Object.assign(values, next)
      }
    }
  });
});

function privateLocalResource(): ResourceRecord {
  return {
    resourceKey: "a".repeat(64),
    canonicalUrl: "https://example.com/article",
    url: "https://example.com/article?local-binding=1",
    title: "Local Chrome title",
    userNote: "用户备注",
    summary: "摘要",
    tags: ["标签"],
    topics: ["主题"],
    contentExcerpt: "自动提取的网页正文绝不能进入云端",
    contentHash: "content-hash",
    selectedText: "x".repeat(9_000),
    author: "Author",
    siteName: "Example",
    language: "zh-CN",
    imageUrl: "https://private.example/screenshot.png?token=secret",
    thumbnailDataUrl: "data:image/webp;base64,PRIVATE",
    faviconUrl: "data:image/png;base64,PRIVATE",
    nativeBookmarkIds: ["123"],
    nativeFolderPath: ["1", "2"],
    aiStatus: "ready",
    syncStatus: "pending",
    createdAt: "2026-08-02T00:00:00.000Z",
    updatedAt: "2026-08-02T01:00:00.000Z"
  };
}

describe("cloud privacy contract", () => {
  it("seeds local and account-untracked resources during the first full sync", () => {
    const local = privateLocalResource();
    local.syncStatus = "local";
    expect(shouldQueueResourceForCloud(local, new Set())).toBe(true);

    const legacySynced = { ...local, syncStatus: "synced" as const };
    expect(shouldQueueResourceForCloud(legacySynced, new Set())).toBe(true);
    expect(
      shouldQueueResourceForCloud(
        legacySynced,
        new Set([legacySynced.resourceKey])
      )
    ).toBe(false);
    expect(
      shouldQueueResourceForCloud(
        { ...legacySynced, nativeBookmarkIds: [] },
        new Set()
      )
    ).toBe(false);
  });

  it("rejects stale pinned GitHub icon assets while allowing current bindings", () => {
    expect(
      cloudSiteIconBindingIsCurrent({
        host: "github.com",
        iconRenderVersion: 6,
      }),
    ).toBe(false);
    expect(
      cloudSiteIconBindingIsCurrent({
        host: "github.com",
        iconRenderVersion: 6,
        iconAssetUrl:
          "https://github.githubassets.com/favicons/favicon.svg",
      }),
    ).toBe(true);
    expect(
      cloudSiteIconBindingIsCurrent({
        host: "example.com",
        iconRenderVersion: 6,
      }),
    ).toBe(true);
  });

  it("keeps cloud sync explicitly disabled until the user enables it", async () => {
    expect(defaultCloudSyncSettings()).toEqual({ enabled: false, scope: "complete", updatedAt: "" });
    await expect(getCloudSyncSettings()).resolves.toEqual({ enabled: false, scope: "complete", updatedAt: "" });
  });

  it("maps asset kinds to the same identity keys the uploader uses", () => {
    expect(cloudAssetIdentity({
      kind: "cover",
      resourceKey: "r1",
      binding: { canonicalUrl: "https://example.com/a" }
    })).toBe("cover:r1");
    expect(cloudAssetIdentity({
      kind: "snapshot",
      resourceKey: "r2",
      binding: { canonicalUrl: "https://example.com/b" }
    })).toBe("snapshot:r2");
    expect(cloudAssetIdentity({
      kind: "site-icon",
      resourceKey: "r3",
      binding: { host: "example.com" }
    })).toBe("site-icon:example.com");
  });

  it("drops local uploaded marks whose assets no longer exist on the server", () => {
    const state = {
      "cover:r1": { assetId: "a", sha256: "s1", revision: 1 },
      "snapshot:r2": { assetId: "b", sha256: "s2", revision: 1 },
      "site-icon:example.com": { assetId: "c", sha256: "s3", revision: 1 }
    };
    const remote = [{
      assetId: "a",
      resourceKey: "r1",
      kind: "cover" as const,
      sha256: "s1",
      byteSize: 10,
      width: null,
      height: null,
      mimeType: "image/webp",
      capturedAt: null,
      binding: { canonicalUrl: "https://example.com/a" },
      revision: 2
    }];
    expect(reconcileCloudAssetState(state, remote)).toEqual({
      "cover:r1": { assetId: "a", sha256: "s1", revision: 1 }
    });
    expect(reconcileCloudAssetState(state, [])).toEqual({});
  });

  it("migrates a legacy text-only setting to a complete backup", async () => {
    values[CLOUD_SYNC_SETTINGS_KEY] = {
      enabled: true,
      scope: "text",
      updatedAt: "2026-08-01T00:00:00.000Z"
    };
    await expect(getCloudSyncSettings()).resolves.toEqual({
      enabled: true,
      scope: "complete",
      updatedAt: "2026-08-01T00:00:00.000Z"
    });
    expect(values[CLOUD_SYNC_SETTINGS_KEY]).toEqual({
      enabled: true,
      scope: "complete",
      updatedAt: "2026-08-01T00:00:00.000Z"
    });
  });

  it("honors Retry-After while bounding malformed or excessive delays", () => {
    expect(retryAfterMilliseconds(new Headers({ "retry-after": "12" }))).toBe(12_000);
    expect(retryAfterMilliseconds(new Headers({ "retry-after": "0" }))).toBe(5_000);
    expect(retryAfterMilliseconds(new Headers({ "retry-after": "120" }))).toBe(65_000);
    expect(retryAfterMilliseconds(new Headers({ "retry-after": "invalid" }))).toBe(5_000);
  });

  it("serializes usage periods with explicit pricing provenance and no accidental local fields", () => {
    const payload = usagePeriodCloudPayload({
      period: "2026-08",
      provider: "deepseek",
      model: "deepseek-chat",
      usage: {
        inputTokens: 128_249,
        outputTokens: 157_976,
        cachedInputTokens: 0,
        estimatedTokens: 0,
        estimatedCostCny: 2.5,
        scanCount: 4,
        priceUpdatedAt: "2026-07-30",
        updatedAt: "2026-08-03T00:00:00.000Z"
      }
    });
    expect(payload).toEqual({
      period: "2026-08",
      provider: "deepseek",
      model: "deepseek-chat",
      inputTokens: 128_249,
      outputTokens: 157_976,
      cachedInputTokens: 0,
      estimatedTokens: 0,
      estimatedCostCny: 2.5,
      scanCount: 4,
      priceUpdatedAt: "2026-07-30",
      updatedAt: "2026-08-03T00:00:00.000Z"
    });
  });

  it("serializes only the resource whitelist and never embeds local images, native IDs, or extracted body", () => {
    const payload = resourceCloudPayload(privateLocalResource());
    expect(payload).toMatchObject({
      canonicalUrl: "https://example.com/article",
      userNote: "用户备注",
      summary: "摘要",
      tags: ["标签"],
      selectedText: "x".repeat(8_192)
    });
    expect(Object.keys(payload)).not.toEqual(expect.arrayContaining([
      "url",
      "title",
      "contentExcerpt",
      "imageUrl",
      "thumbnailDataUrl",
      "faviconUrl",
      "nativeBookmarkIds",
      "nativeFolderPath",
      "aiStatus",
      "syncStatus"
    ]));
  });

  it("persists real sync progress instead of treating cloud capacity as progress", async () => {
    await beginCloudSyncProgress({ scope: "complete", resourceTotal: 4 });
    await updateCloudSyncProgress({
      resourceProcessedDelta: 2,
      statusText: "正在同步收藏…"
    });
    await updateCloudSyncProgress({ resourceProcessedDelta: 1, resourceFailedDelta: 1 });

    await expect(getCloudSyncProgress()).resolves.toMatchObject({
      phase: "syncing",
      resourceTotal: 4,
      resourceProcessed: 3,
      resourceFailed: 1,
      statusText: "正在同步收藏…"
    });

    await completeCloudSyncProgress({ resourceFailed: 1 });
    await expect(getCloudSyncProgress()).resolves.toMatchObject({
      phase: "completed",
      resourceProcessed: 3,
      resourceFailed: 1
    });
  });

  it("translates a persisted refresh replay into a recoverable sign-in message", async () => {
    values[CLOUD_SYNC_PROGRESS_KEY] = {
      phase: "error",
      scope: "complete",
      error: "Refresh token replay was detected; this device must sign in again.",
      resourceTotal: 4,
      resourceProcessed: 2,
      resourceFailed: 0
    };
    await expect(getCloudSyncProgress()).resolves.toMatchObject({
      phase: "error",
      error: "云端登录会话已失效，请重新登录后继续同步。"
    });
  });
});

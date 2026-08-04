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
  cloudAssetDimension,
  cloudAssetIdentity,
  cloudAssetNeedsUpload,
  cloudSiteIconBindingIsCurrent,
  reconcileCloudAssetState
} from "../src/lib/cloud-assets";
import {
  readSyncStatus,
  SYNC_STATUS_KEY,
  writeSyncStatus
} from "../src/lib/sync-engine";
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
  it("normalizes SVG and legacy asset dimensions to the server integer contract", () => {
    expect(cloudAssetDimension(31.5)).toBe(32);
    expect(cloudAssetDimension(192.2)).toBe(192);
    expect(cloudAssetDimension(20_000)).toBe(16_384);
    expect(cloudAssetDimension(0)).toBeUndefined();
    expect(cloudAssetDimension(Number.NaN)).toBeUndefined();
    expect(cloudAssetDimension(undefined)).toBeUndefined();
  });

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
        iconRenderVersion: 7,
      }),
    ).toBe(false);
    expect(
      cloudSiteIconBindingIsCurrent({
        host: "github.com",
        iconRenderVersion: 7,
        iconAssetUrl:
          "https://github.githubassets.com/favicons/favicon.svg",
      }),
    ).toBe(true);
    expect(
      cloudSiteIconBindingIsCurrent({
        host: "example.com",
        iconRenderVersion: 7,
      }),
    ).toBe(true);
  });

  it("migrates cloud settings to login-implies-sync with complete backup", async () => {
    expect(defaultCloudSyncSettings()).toEqual({ enabled: true, scope: "complete", updatedAt: "" });
    await expect(getCloudSyncSettings()).resolves.toEqual({ enabled: true, scope: "complete", updatedAt: "" });
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

  it("rebuilds upload tracking from the active account's remote asset hashes", () => {
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
    const reconciled = reconcileCloudAssetState(state, remote);
    expect(reconciled).toEqual({
      "cover:r1": { assetId: "a", sha256: "s1", revision: 2 }
    });
    expect(cloudAssetNeedsUpload(reconciled, "cover:r1", "s1")).toBe(false);
    expect(cloudAssetNeedsUpload(reconciled, "cover:r1", "changed")).toBe(true);
    expect(reconcileCloudAssetState(state, [])).toEqual({});
  });

  it("uses the newest remote revision when an account contains a legacy duplicate", () => {
    const base = {
      resourceKey: "r1",
      kind: "cover" as const,
      byteSize: 10,
      width: null,
      height: null,
      mimeType: "image/webp",
      capturedAt: null,
      binding: { canonicalUrl: "https://example.com/a" },
    };
    expect(reconcileCloudAssetState({}, [
      { ...base, assetId: "old", sha256: "old", revision: 1 },
      { ...base, assetId: "new", sha256: "new", revision: 3 },
    ])).toEqual({
      "cover:r1": { assetId: "new", sha256: "new", revision: 3 },
    });
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

  it("persists the unified sync status", async () => {
    await writeSyncStatus({
      phase: "pushing",
      current: 3,
      total: 4,
      lastSyncedAt: null,
      error: null,
      nextRetryAt: null
    });
    await expect(readSyncStatus()).resolves.toMatchObject({
      phase: "pushing",
      current: 3,
      total: 4
    });
  });

  it("translates a persisted refresh replay into a recoverable sign-in message", async () => {
    values[SYNC_STATUS_KEY] = {
      phase: "error",
      error: "Refresh token replay was detected; this device must sign in again.",
      current: 2,
      total: 4
    };
    await expect(readSyncStatus()).resolves.toMatchObject({
      phase: "error",
      error: "云端登录会话已失效，请重新登录后继续同步。"
    });
  });
});

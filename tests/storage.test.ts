import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import {
  completeOutboxItem,
  countPageSnapshots,
  cleanupExpiredUndoSnapshots,
  deleteUndoSnapshot,
  deferOutboxItem,
  duplicateSnapshotGroups,
  enqueueOutbox,
  getLocalResource,
  getLocalResources,
  getOutbox,
  getPageSnapshot,
  getSiteBrand,
  getSiteBrands,
  getUndoSnapshot,
  getUndoSnapshots,
  invalidateStaleSiteBrandIcons,
  mergeLocalResources,
  normalizeResourceRecord,
  putUndoSnapshot,
  putSiteBrand,
  putPageSnapshot,
  removeOutboxItem,
  upsertLocalResource
} from "../src/lib/storage";
import type { ResourceRecord } from "../src/lib/types";

function resource(
  key: string,
  overrides: Partial<ResourceRecord> = {}
): ResourceRecord {
  return {
    resourceKey: key,
    canonicalUrl: `https://example.com/${key}`,
    url: `https://example.com/${key}`,
    title: key,
    userNote: "",
    summary: "",
    tags: [],
    topics: [],
    contentExcerpt: "",
    contentHash: "",
    selectedText: "",
    author: "",
    siteName: "Example",
    language: "en",
    imageUrl: "",
    faviconUrl: "",
    nativeBookmarkIds: [],
    nativeFolderPath: [],
    aiStatus: "not_requested",
    syncStatus: "local",
    createdAt: "2026-07-29T00:00:00.000Z",
    updatedAt: "2026-07-29T00:00:00.000Z",
    ...overrides
  };
}

describe("IndexedDB storage", () => {
  it("fills AI metadata arrays missing from legacy bookmark records", () => {
    const normalized = normalizeResourceRecord({
      resourceKey: "legacy",
      url: "https://example.com/legacy",
      title: "Legacy bookmark",
      createdAt: "2026-07-29T00:00:00.000Z",
      updatedAt: "2026-07-29T00:00:00.000Z"
    });

    expect(normalized).toMatchObject({
      resourceKey: "legacy",
      summary: "",
      tags: [],
      topics: [],
      nativeBookmarkIds: [],
      nativeFolderPath: [],
      aiStatus: "not_requested",
      syncStatus: "local"
    });
  });

  it("preserves a locally cached representative image", () => {
    const normalized = normalizeResourceRecord({
      resourceKey: "cover",
      url: "https://example.com/cover",
      thumbnailDataUrl: "data:image/webp;base64,AAAA"
    });

    expect(normalized.thumbnailDataUrl).toBe(
      "data:image/webp;base64,AAAA"
    );
  });

  it("preserves every retrieval field produced by AI", () => {
    const normalized = normalizeResourceRecord({
      resourceKey: "retrieval-fields",
      url: "https://example.com/retrieval-fields",
      aliases: ["component library"],
      useCases: ["搭建设计系统时参考"],
      contentType: "文档",
      questions: ["有哪些组件库"],
      entities: [],
      aiSchemaVersion: 2
    });

    expect(normalized).toMatchObject({
      aliases: ["component library"],
      useCases: ["搭建设计系统时参考"],
      contentType: "文档",
      questions: ["有哪些组件库"],
      entities: [],
      aiSchemaVersion: 2
    });
  });

  it("stores shared site-brand diagnostics independently of resources", async () => {
    await putSiteBrand({
      host: "Docs.Example.com",
      iconSource: "manifest",
      iconDataUrl: "data:image/webp;base64,BRAND",
      iconDataUrlLight: "data:image/webp;base64,LIGHT",
      iconDataUrlDark: "data:image/webp;base64,DARK",
      iconRenderVersion: 7,
      iconAssetUrl: "https://docs.example.com/manifest-icon.png",
      nativeWidth: 512,
      nativeHeight: 512,
      updatedAt: "2026-07-30T00:00:00.000Z"
    });

    expect(await getSiteBrand("docs.example.com")).toMatchObject({
      host: "docs.example.com",
      iconSource: "manifest",
      iconDataUrlLight: "data:image/webp;base64,LIGHT",
      iconDataUrlDark: "data:image/webp;base64,DARK",
      iconRenderVersion: 7,
      iconAssetUrl: "https://docs.example.com/manifest-icon.png",
      nativeWidth: 512
    });
    expect(
      (await getSiteBrands()).some(
        (brand) => brand.host === "docs.example.com"
      )
    ).toBe(true);
  });

  it("keeps accepted icon bytes and only bumps the render version for legacy caches", async () => {
    await putSiteBrand({
      host: "legacy.example.com",
      iconDataUrl: "data:image/webp;base64,LEGACY",
      iconDataUrlLight: "data:image/webp;base64,LEGACY_LIGHT",
      iconDataUrlDark: "data:image/webp;base64,LEGACY_DARK",
      iconRenderVersion: 1,
      iconSource: "svg-icon",
      nativeWidth: 192,
      nativeHeight: 192,
      skipPageImage: true,
      updatedAt: "2026-07-30T00:00:00.000Z",
    });

    expect(await invalidateStaleSiteBrandIcons(7)).toBe(1);
    expect(await getSiteBrand("legacy.example.com")).toMatchObject({
      host: "legacy.example.com",
      iconSource: "svg-icon",
      nativeWidth: 192,
      nativeHeight: 192,
      skipPageImage: true,
      iconRenderVersion: 7,
      iconDataUrl: "data:image/webp;base64,LEGACY",
      iconDataUrlLight: "data:image/webp;base64,LEGACY_LIGHT",
      iconDataUrlDark: "data:image/webp;base64,LEGACY_DARK",
    });
  });

  it("evicts the oldest page snapshot above the local capacity", async () => {
    for (const [index, day] of [1, 2, 3].entries()) {
      await putPageSnapshot(
        {
          canonicalUrl: `https://snapshot.example/${index}`,
          imageDataUrl: `data:image/webp;base64,${index}`,
          capturedAt: `2026-07-0${day}T00:00:00.000Z`,
          width: 680,
          height: 425
        },
        2
      );
    }
    expect(await countPageSnapshots()).toBe(2);
    expect(
      await getPageSnapshot("https://snapshot.example/0")
    ).toBeUndefined();
  });

  it("upserts resources and returns newest first", async () => {
    await upsertLocalResource(
      resource("storage-a", {
        updatedAt: "2026-07-29T00:00:00.000Z"
      })
    );
    await upsertLocalResource(
      resource("storage-b", {
        updatedAt: "2026-07-29T01:00:00.000Z"
      })
    );

    const resources = await getLocalResources();
    expect(resources.findIndex((item) => item.resourceKey === "storage-b")).toBeLessThan(
      resources.findIndex((item) => item.resourceKey === "storage-a")
    );
  });

  it("preserves device bookmark bindings when cloud rows have none", async () => {
    await upsertLocalResource(
      resource("storage-merge", {
        nativeBookmarkIds: ["chrome-id-1"]
      })
    );

    await mergeLocalResources([
      resource("storage-merge", {
        summary: "Cloud summary",
        syncStatus: "synced",
        nativeBookmarkIds: []
      })
    ]);

    const merged = await getLocalResource("storage-merge");
    expect(merged?.summary).toBe("Cloud summary");
    expect(merged?.nativeBookmarkIds).toEqual(["chrome-id-1"]);
  });

  it("keeps the local representative image when cloud metadata is merged", async () => {
    await upsertLocalResource(
      resource("storage-local-cover", {
        thumbnailDataUrl: "data:image/webp;base64,LOCAL",
        updatedAt: "2026-07-29T00:00:00.000Z"
      })
    );

    await mergeLocalResources([
      resource("storage-local-cover", {
        summary: "Cloud summary",
        syncStatus: "synced",
        updatedAt: "2026-07-29T01:00:00.000Z"
      })
    ]);

    expect(
      (await getLocalResource("storage-local-cover"))?.thumbnailDataUrl
    ).toBe("data:image/webp;base64,LOCAL");
  });

  it("does not overwrite newer pending local changes with stale cloud rows", async () => {
    await upsertLocalResource(
      resource("storage-pending-merge", {
        title: "Local rename",
        userNote: "Unsynced note",
        syncStatus: "pending",
        updatedAt: "2026-07-29T02:00:00.000Z"
      })
    );

    await mergeLocalResources([
      resource("storage-pending-merge", {
        title: "Old cloud title",
        userNote: "",
        summary: "Cloud summary",
        syncStatus: "synced",
        updatedAt: "2026-07-29T01:00:00.000Z"
      })
    ]);

    expect(await getLocalResource("storage-pending-merge")).toMatchObject({
      title: "Local rename",
      userNote: "Unsynced note",
      syncStatus: "pending",
      updatedAt: "2026-07-29T02:00:00.000Z"
    });
  });

  it("deduplicates outbox items by resource key", async () => {
    const first = resource("storage-outbox", { title: "First" });
    const second = resource("storage-outbox", { title: "Second" });

    await enqueueOutbox(first, "first content");
    await enqueueOutbox(second, "second content");

    const outbox = await getOutbox();
    const matching = outbox.filter(
      (item) => item.resource.resourceKey === "storage-outbox"
    );
    expect(matching).toHaveLength(1);
    expect(matching[0].resource.title).toBe("Second");
    expect(matching[0].content).toBe("second content");

    await removeOutboxItem("storage-outbox");
    expect(
      (await getOutbox()).some(
        (item) => item.resource.resourceKey === "storage-outbox"
      )
    ).toBe(false);
  });

  it("preserves queued page content when a metadata-only update arrives", async () => {
    const first = resource("storage-preserve-content", {
      title: "Original"
    });
    const second = resource("storage-preserve-content", {
      title: "Renamed"
    });

    const original = await enqueueOutbox(first, "page body");
    const revised = await enqueueOutbox(second, "");

    expect(revised.content).toBe("page body");
    expect(revised.resource.title).toBe("Renamed");
    expect(await completeOutboxItem(original)).toBe(false);
    expect(
      (await getOutbox()).find(
        (item) =>
          item.resource.resourceKey === "storage-preserve-content"
      )?.content
    ).toBe("page body");

    await removeOutboxItem("storage-preserve-content");
  });

  it("keeps oldest queued work first and defers failures with backoff", async () => {
    try {
      await enqueueOutbox(resource("storage-fifo-old"), "old");
      await new Promise((resolve) => setTimeout(resolve, 2));
      const newer = await enqueueOutbox(
        resource("storage-fifo-new"),
        "new"
      );

      const ordered = (await getOutbox()).filter((item) =>
        item.resource.resourceKey.startsWith("storage-fifo-")
      );
      expect(ordered.map((item) => item.resource.resourceKey)).toEqual([
        "storage-fifo-old",
        "storage-fifo-new"
      ]);

      const failedAt = new Date("2026-07-29T00:02:00.000Z");
      expect(
        await deferOutboxItem(newer, "offline", failedAt)
      ).toBe(true);
      expect(await completeOutboxItem(newer)).toBe(false);

      const deferred = (await getOutbox()).find(
        (item) => item.resource.resourceKey === "storage-fifo-new"
      );
      expect(deferred).toMatchObject({
        attempts: 1,
        lastError: "offline",
        lastAttemptAt: "2026-07-29T00:02:00.000Z",
        nextAttemptAt: "2026-07-29T00:07:00.000Z"
      });
    } finally {
      await removeOutboxItem("storage-fifo-old");
      await removeOutboxItem("storage-fifo-new");
    }
  });

  it("does not silently discard large offline queues", async () => {
    const keys = Array.from(
      { length: 55 },
      (_, index) => `storage-capacity-${index}`
    );
    for (const key of keys) {
      await enqueueOutbox(resource(key), `content for ${key}`);
    }

    const queuedKeys = new Set(
      (await getOutbox()).map((item) => item.resource.resourceKey)
    );
    expect(keys.every((key) => queuedKeys.has(key))).toBe(true);

    for (const key of keys) {
      await removeOutboxItem(key);
    }
  });

  it("stores undo batches and removes them after the 30 day retention window", async () => {
    const activeBatch = {
      batchId: "undo-active",
      source: "manual" as const,
      label: "移动书签",
      destructive: false,
      createdAt: "2026-07-29T00:00:00.000Z",
      expiresAt: "2026-08-28T00:00:00.000Z",
      status: "ready" as const,
      mutations: []
    };
    const expiredBatch = {
      ...activeBatch,
      batchId: "undo-expired",
      expiresAt: "2026-07-30T00:00:00.000Z"
    };
    await putUndoSnapshot(activeBatch);
    await putUndoSnapshot(expiredBatch);

    expect((await getUndoSnapshot(activeBatch.batchId))?.label).toBe("移动书签");
    expect(
      (await getUndoSnapshots()).map((batch) => batch.batchId)
    ).toEqual(expect.arrayContaining(["undo-active", "undo-expired"]));
    expect(
      await cleanupExpiredUndoSnapshots(new Date("2026-08-01T00:00:00.000Z"))
    ).toBe(1);
    expect(await getUndoSnapshot("undo-expired")).toBeUndefined();

    await deleteUndoSnapshot(activeBatch.batchId);
  });
});

describe("duplicateSnapshotGroups", () => {
  const snapshot = (canonicalUrl: string, image: string) => ({
    canonicalUrl,
    imageDataUrl: image,
    capturedAt: "2026-08-03T00:00:00.000Z",
    width: 1,
    height: 1
  });

  it("returns all snapshots when one image is bound to several urls", () => {
    const duplicated = duplicateSnapshotGroups([
      snapshot("https://a.example/", "data:image/webp;base64,AAAA"),
      snapshot("https://b.example/", "data:image/webp;base64,AAAA"),
      snapshot("https://c.example/", "data:image/webp;base64,BBBB")
    ]);
    expect(duplicated.map((s) => s.canonicalUrl).sort()).toEqual([
      "https://a.example/",
      "https://b.example/"
    ]);
  });

  it("returns nothing when every image belongs to one url", () => {
    expect(
      duplicateSnapshotGroups([
        snapshot("https://a.example/", "data:image/webp;base64,AAAA"),
        snapshot("https://b.example/", "data:image/webp;base64,BBBB")
      ])
    ).toEqual([]);
  });
});

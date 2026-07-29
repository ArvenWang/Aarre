import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import {
  completeOutboxItem,
  deferOutboxItem,
  enqueueOutbox,
  getLocalResource,
  getLocalResources,
  getOutbox,
  mergeLocalResources,
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
});

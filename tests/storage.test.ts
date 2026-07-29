import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import {
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

    await removeOutboxItem("storage-outbox");
    expect(
      (await getOutbox()).some(
        (item) => item.resource.resourceKey === "storage-outbox"
      )
    ).toBe(false);
  });
});

import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import {
  deleteVisual,
  getVisual,
  getVisuals,
  getVisualsByKind,
  putPageSnapshot,
  putSiteBrand,
  upsertLocalResource,
  writeVisual
} from "../src/lib/storage";
import { dataUrlToBlob, migrateLegacyVisualsBatch } from "../src/lib/visuals";
import type { ResourceRecord, VisualAsset } from "../src/lib/types";

function visual(key: string, kind: VisualAsset["kind"] = "cover"): VisualAsset {
  return {
    key,
    kind,
    identity: key.split(":").slice(1).join(":"),
    blob: new Blob(["visual-bytes"], { type: "image/webp" }),
    mime: "image/webp",
    width: 320,
    height: 180,
    origin: "auto",
    source: "test",
    contentHash: "hash",
    updatedAt: "2026-08-04T00:00:00.000Z",
    renderVersion: 1
  };
}

function resource(key: string, canonicalUrl: string): ResourceRecord {
  return {
    resourceKey: key,
    canonicalUrl,
    url: canonicalUrl,
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
    nativeBookmarkIds: [key],
    nativeFolderPath: [],
    aiStatus: "not_requested",
    syncStatus: "local",
    coverOrigin: "user",
    coverContentHash: "preserved-cover-hash",
    createdAt: "2026-08-04T00:00:00.000Z",
    updatedAt: "2026-08-04T00:00:00.000Z"
  };
}

describe("visuals store", () => {
  it("writes, reads, batches, and queries by kind", async () => {
    const suffix = crypto.randomUUID();
    const cover = visual(`cover:${suffix}`);
    const icon = visual(`site-icon:${suffix}`, "site-icon");
    await writeVisual(cover);
    await writeVisual(icon);

    await expect(getVisual(cover.key)).resolves.toMatchObject({ key: cover.key, kind: "cover" });
    expect(Object.keys(await getVisuals([cover.key, icon.key]))).toEqual(
      expect.arrayContaining([cover.key, icon.key])
    );
    expect((await getVisualsByKind("site-icon")).some((item) => item.key === icon.key)).toBe(true);

    await deleteVisual(cover.key);
    await deleteVisual(icon.key);
  });

  it("converts base64 data URLs to binary blobs without changing bytes", async () => {
    const { blob, mime } = dataUrlToBlob("data:image/png;base64,AAEC/w==");
    expect(mime).toBe("image/png");
    expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([0, 1, 2, 255]);
  });

  it("migrates legacy snapshots with user origin and remains idempotent", async () => {
    const suffix = crypto.randomUUID();
    const key = `migration-${suffix}`;
    const canonicalUrl = `https://example.com/${suffix}`;
    await upsertLocalResource(resource(key, canonicalUrl));
    await putPageSnapshot({
      canonicalUrl,
      imageDataUrl: "data:image/webp;base64,dmlzdWFs",
      capturedAt: "2026-08-04T01:00:00.000Z",
      width: 800,
      height: 450
    });
    await putSiteBrand({
      host: `${suffix}.example.com`,
      iconDataUrlLight: "data:image/png;base64,aWNvbg==",
      iconRenderVersion: 9,
      updatedAt: "2026-08-04T01:00:00.000Z"
    });

    const first = await migrateLegacyVisualsBatch(10_000);
    const migrated = await getVisual(`cover:${key}`);
    expect(first.migrated).toBeGreaterThanOrEqual(1);
    await expect(getVisual(`site-icon:${suffix}.example.com`)).resolves.toMatchObject({
      kind: "site-icon",
      origin: "auto"
    });
    expect(migrated).toMatchObject({
      origin: "user",
      contentHash: "preserved-cover-hash",
      width: 800,
      height: 450
    });
    expect(await migrated?.blob.text()).toBe("visual");

    const second = await migrateLegacyVisualsBatch(10_000);
    expect(second.migrated).toBe(0);
    expect(second.remaining).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import {
  bookmarkEditTags,
  bookmarkEditTargetResourceKey,
  bookmarkUrlEditPlan,
  rehomeResourceAfterBookmarkUrlChange,
  runBookmarkEditRecoverySteps
} from "../src/lib/bookmark-edit";
import type { ResourceRecord } from "../src/lib/types";

function resource(
  overrides: Partial<ResourceRecord> = {}
): ResourceRecord {
  return {
    resourceKey: "declared-canonical-key",
    canonicalUrl: "https://example.com/canonical",
    url: "https://example.com/article?source=bookmark",
    title: "Original",
    userNote: "keep this note",
    summary: "old AI summary",
    tags: ["manual"],
    tagsSource: "user",
    topics: ["old topic"],
    aliases: ["https://example.com/alias"],
    contentExcerpt: "old content",
    contentHash: "old hash",
    selectedText: "old selection",
    author: "Old author",
    siteName: "Old site",
    language: "en",
    imageUrl: "https://example.com/og.jpg",
    thumbnailDataUrl: "data:image/webp;base64,OLD",
    coverSource: "page-image",
    coverUpdatedAt: "2026-07-01T00:00:00.000Z",
    categoryCoverId: "design",
    snapshotAt: "2026-07-01T00:00:00.000Z",
    faviconUrl: "https://example.com/favicon.ico",
    nativeBookmarkIds: ["bookmark-a", "bookmark-b"],
    nativeFolderPath: ["书签栏", "旧目录"],
    aiStatus: "ready",
    syncStatus: "local",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides
  };
}

describe("bookmark edit resource migration", () => {
  it("keeps the stored resource key when the canonical URL did not change", () => {
    expect(
      bookmarkEditTargetResourceKey({
        sourceResourceKey: "declared-canonical-key",
        urlChanged: false,
        changedUrlResourceKey: "recomputed-from-address-bar"
      })
    ).toBe("declared-canonical-key");
  });

  it("writes a canonical-equivalent Chrome URL without migrating the resource", () => {
    const source = resource({
      url: "https://example.com/article",
      canonicalUrl: "https://example.com/article"
    });
    expect(
      bookmarkUrlEditPlan({
        source,
        currentUrl: "https://example.com/article",
        nextUrl:
          "https://example.com/article/?utm_source=aarre#details",
        changedUrlResourceKey: "address-derived-key"
      })
    ).toEqual({
      bookmarkUrlChanged: true,
      canonicalAddressChanged: false,
      targetResourceKey: "declared-canonical-key",
      resourceIdentityChanged: false
    });
  });

  it("keeps declared canonical and redirect aliases in the same resource", () => {
    const source = resource();
    expect(
      bookmarkUrlEditPlan({
        source,
        currentUrl: source.url,
        nextUrl: source.canonicalUrl,
        changedUrlResourceKey: source.resourceKey
      }).resourceIdentityChanged
    ).toBe(false);
    expect(
      bookmarkUrlEditPlan({
        source,
        currentUrl: source.url,
        nextUrl: source.aliases![0],
        changedUrlResourceKey: "alias-address-key"
      }).resourceIdentityChanged
    ).toBe(false);
  });

  it("migrates only when the edited URL belongs to a different resource", () => {
    expect(
      bookmarkUrlEditPlan({
        source: resource(),
        currentUrl: "https://example.com/article",
        nextUrl: "https://new.example/page",
        changedUrlResourceKey: "new-url-key"
      })
    ).toMatchObject({
      bookmarkUrlChanged: true,
      targetResourceKey: "new-url-key",
      resourceIdentityChanged: true
    });
  });

  it("preserves AI tag ownership unless the user edits tags", () => {
    expect(
      bookmarkEditTags({
        sourceTags: ["AI 标签"],
        sourceTagsSource: "ai",
        requestedTags: ["AI 标签"],
        tagsChanged: false,
        resourceIdentityChanged: false
      })
    ).toEqual({ tags: ["AI 标签"], tagsSource: "ai" });
    expect(
      bookmarkEditTags({
        sourceTags: ["AI 标签"],
        sourceTagsSource: "ai",
        requestedTags: ["AI 标签"],
        tagsChanged: false,
        resourceIdentityChanged: true
      })
    ).toEqual({ tags: [] });
    expect(
      bookmarkEditTags({
        sourceTags: ["用户标签"],
        sourceTagsSource: "user",
        requestedTags: ["用户标签"],
        tagsChanged: false,
        resourceIdentityChanged: true
      })
    ).toEqual({ tags: ["用户标签"], tagsSource: "user" });
  });

  it("keeps the old duplicate bound when one location changes URL", () => {
    const source = resource();
    const { remainingSource, nextResource } =
      rehomeResourceAfterBookmarkUrlChange({
        source,
        targetResourceKey: "new-url-key",
        bookmarkId: "bookmark-a",
        url: "https://new.example/page",
        canonicalUrl: "https://new.example/page",
        title: "New page",
        userNote: "new note",
        tags: ["new tag"],
        categoryCoverId: "reference",
        nativeFolderPath: ["书签栏", "新目录"],
        syncStatus: "pending",
        timestamp: "2026-07-31T00:00:00.000Z"
      });

    expect(remainingSource.nativeBookmarkIds).toEqual(["bookmark-b"]);
    expect(remainingSource.snapshotAt).toBe(
      "2026-07-01T00:00:00.000Z"
    );
    expect(nextResource.nativeBookmarkIds).toEqual(["bookmark-a"]);
    expect(nextResource.resourceKey).toBe("new-url-key");
    expect(nextResource.userNote).toBe("new note");
    expect(nextResource.tags).toEqual(["new tag"]);
    expect(nextResource.summary).toBe("");
    expect(nextResource.topics).toEqual([]);
    expect(nextResource.snapshotAt).toBeUndefined();
    expect(nextResource.thumbnailDataUrl).toBeUndefined();
    expect(nextResource.coverSource).toBeUndefined();
    expect(nextResource.aiStatus).toBe("pending");
  });

  it("unlinks the old resource when its only location changes URL", () => {
    const source = resource({
      nativeBookmarkIds: ["bookmark-a"]
    });
    const { remainingSource, nextResource } =
      rehomeResourceAfterBookmarkUrlChange({
        source,
        targetResourceKey: "new-url-key",
        bookmarkId: "bookmark-a",
        url: "https://new.example/page",
        canonicalUrl: "https://new.example/page",
        title: "New page",
        userNote: "new note",
        tags: ["new tag"],
        categoryCoverId: "reference",
        nativeFolderPath: ["书签栏", "新目录"],
        syncStatus: "pending",
        timestamp: "2026-07-31T00:00:00.000Z"
      });

    expect(remainingSource.resourceKey).toBe("declared-canonical-key");
    expect(remainingSource.nativeBookmarkIds).toEqual([]);
    expect(remainingSource.snapshotAt).toBe(
      "2026-07-01T00:00:00.000Z"
    );
    expect(nextResource.resourceKey).toBe("new-url-key");
    expect(nextResource.nativeBookmarkIds).toEqual(["bookmark-a"]);
    expect(nextResource.summary).toBe("");
    expect(nextResource.topics).toEqual([]);
    expect(nextResource.snapshotAt).toBeUndefined();
    expect(nextResource.thumbnailDataUrl).toBeUndefined();
    expect(nextResource.coverSource).toBeUndefined();
    expect(nextResource.aiStatus).toBe("pending");
  });

  it("refuses to rehome a resource onto its own key", () => {
    const source = resource();
    expect(() =>
      rehomeResourceAfterBookmarkUrlChange({
        source,
        targetResourceKey: source.resourceKey,
        bookmarkId: "bookmark-a",
        url: source.canonicalUrl,
        canonicalUrl: source.canonicalUrl,
        title: "Canonical",
        userNote: source.userNote,
        tags: source.tags,
        nativeFolderPath: source.nativeFolderPath,
        syncStatus: "local",
        timestamp: "2026-07-31T00:00:00.000Z"
      })
    ).toThrow("同一资源不得执行跨资源迁移");
  });

  it("runs every recovery step and reports any incomplete recovery", async () => {
    const completed: string[] = [];
    const failed = await runBookmarkEditRecoverySteps([
      {
        name: "restore-source",
        run: async () => {
          completed.push("restore-source");
        }
      },
      {
        name: "restore-target",
        run: async () => {
          completed.push("restore-target");
          throw new Error("IndexedDB quota");
        }
      },
      {
        name: "reimport-bookmarks",
        run: async () => {
          completed.push("reimport-bookmarks");
        }
      }
    ]);

    expect(completed).toEqual([
      "restore-source",
      "restore-target",
      "reimport-bookmarks"
    ]);
    expect(failed).toEqual(["restore-target"]);
  });
});

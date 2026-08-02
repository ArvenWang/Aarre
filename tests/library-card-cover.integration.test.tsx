// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import type { ResourceRecord } from "../src/lib/types";
import {
  LibraryCardCover,
  LibraryCardCoverImage
} from "../src/ui/manager/components/LibraryCardCover";
import { LibraryView } from "../src/ui/manager/views/LibraryView";

const resource: ResourceRecord = {
  resourceKey: "manager-cover-policy",
  canonicalUrl: "https://example.com/article",
  url: "https://example.com/article",
  title: "Example article",
  userNote: "",
  summary: "Example summary",
  tags: [],
  topics: [],
  contentExcerpt: "",
  contentHash: "",
  selectedText: "",
  author: "",
  siteName: "Example",
  language: "en",
  imageUrl: "https://example.com/og-image.jpg",
  thumbnailDataUrl: "data:image/webp;base64,OG_IMAGE_SHOULD_NOT_RENDER",
  categoryCoverId: "video",
  faviconUrl: "",
  nativeBookmarkIds: ["bookmark-1"],
  nativeFolderPath: [],
  aiStatus: "ready",
  syncStatus: "local",
  createdAt: "2026-07-30T00:00:00.000Z",
  updatedAt: "2026-07-30T00:00:00.000Z"
};

afterEach(() => {
  document.body.innerHTML = "";
});

describe("manager masonry cover policy", () => {
  it("uses a real page snapshot when one exists", () => {
    const markup = renderToStaticMarkup(
      createElement(LibraryCardCoverImage, {
        snapshotImageUrl: "data:image/webp;base64,REAL_PAGE_SNAPSHOT",
        label: "Example"
      })
    );

    expect(markup).toContain('data-cover-kind="page-snapshot"');
    expect(markup).toContain("REAL_PAGE_SNAPSHOT");
  });

  it("uses a selected local Aarre fallback when no snapshot exists", () => {
    const markup = renderToStaticMarkup(
      createElement(LibraryCardCoverImage, {
        fallbackImageUrl: "/assets/ai-automation-v1.webp",
        fallbackCoverId: "ai-automation",
        label: "Example"
      })
    );

    expect(markup).toContain('data-cover-kind="aarre-fallback"');
    expect(markup).toContain('data-fallback-cover-id="ai-automation"');
    expect(markup).toContain("ai-automation-v1.webp");
    expect(markup).toContain('style="background-color:#CBCADB"');
    expect(markup).not.toContain("data-cover-kind=\"category\"");
  });

  it("selects the semantic Aarre fallback without using og:image", () => {
    const markup = renderToStaticMarkup(
      createElement(LibraryCardCover, {
        canonicalUrl: resource.canonicalUrl,
        label: resource.title,
        fallbackResource: resource
      })
    );

    expect(markup).toContain('data-cover-kind="aarre-fallback"');
    expect(markup).toContain('data-fallback-cover-id="video"');
    expect(markup).toContain("video-v2");
    expect(markup).not.toContain("OG_IMAGE_SHOULD_NOT_RENDER");
  });

  it("falls back to the bundled generic cover if a selected asset fails", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <LibraryCardCoverImage
          fallbackImageUrl="/assets/missing-cover.webp"
          fallbackCoverId="video"
          label="Example"
        />
      );
    });

    const image = container.querySelector("img")!;
    expect(image.dataset.fallbackCoverId).toBe("video");
    await act(async () => {
      image.dispatchEvent(new Event("error", { bubbles: true }));
    });
    expect(image.dataset.fallbackCoverId).toBe("generic-webpage");
    expect(image.src).toContain("generic-webpage-v1.webp");
    await act(async () => root.unmount());
  });

  it("never passes og:image and uses the selected local Aarre fallback", () => {
    const markup = renderToStaticMarkup(
      createElement(LibraryView, {
        results: [{ resource }],
        visibleResults: [{ resource }],
        filter: "all",
        folderId: "all",
        folders: [],
        locations: new Map(),
        sort: "default",
        readyCount: 1,
        pendingCount: 0,
        scopeCount: 1,
        libraryCount: 1,
        bookmarkSnapshot: null,
        queryDraft: "",
        query: "",
        action: "",
        siteBrandByHost: new Map(),
        onFilterChange: () => undefined,
        onFolderChange: () => undefined,
        onSortChange: () => undefined,
        onClearFilters: () => undefined,
        onQueryDraftChange: () => undefined,
        onSearch: () => undefined,
        onClearSearch: () => undefined,
        onResourceChanged: () => undefined,
        onOpenResource: () => undefined,
        onRefresh: () => undefined
      })
    );
    const largeCover = markup.match(
      /<div class="library-card-cover-frame"[\s\S]*?<\/div>\s*<div class="library-card-copy"/
    )?.[0];

    expect(largeCover).toBeTruthy();
    expect(largeCover).toContain('data-cover-kind="aarre-fallback"');
    expect(largeCover).not.toContain("OG_IMAGE_SHOULD_NOT_RENDER");
    expect(largeCover).toContain("video-v2");
    expect(largeCover).toContain('style="background-color:#C46686"');
  });

  it("renders native folder filtering, sorting and the card location", () => {
    const markup = renderToStaticMarkup(
      createElement(LibraryView, {
        results: [{ resource }],
        visibleResults: [{ resource }],
        filter: "all",
        folderId: "folder:path:design",
        folders: [
          {
            id: "folder:path:design",
            label: "设计 / 灵感",
            path: ["设计", "灵感"],
            depth: 1,
            count: 1
          }
        ],
        locations: new Map([
          [
            resource.resourceKey,
            {
              folderIds: new Set(["folder:path:design"]),
              folderPaths: [["设计", "灵感"]]
            }
          ]
        ]),
        sort: "title-asc",
        readyCount: 1,
        pendingCount: 0,
        scopeCount: 1,
        libraryCount: 1,
        bookmarkSnapshot: null,
        queryDraft: "",
        query: "",
        action: "",
        siteBrandByHost: new Map(),
        onFilterChange: () => undefined,
        onFolderChange: () => undefined,
        onSortChange: () => undefined,
        onClearFilters: () => undefined,
        onQueryDraftChange: () => undefined,
        onSearch: () => undefined,
        onClearSearch: () => undefined,
        onResourceChanged: () => undefined,
        onOpenResource: () => undefined,
        onRefresh: () => undefined
      })
    );

    expect(markup).toContain("按 Chrome 书签文件夹筛选");
    expect(markup).toContain("收藏排序方式");
    expect(markup).toContain("设计 / 灵感");
    expect(markup).not.toContain("清除筛选");
  });
});

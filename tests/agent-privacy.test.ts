import { describe, expect, it } from "vitest";
import { privacySafeAgentLibrary } from "../src/lib/agent-privacy";
import { buildProtectionPolicy } from "../src/lib/protection";
import type { BookmarkAgentCatalog, ResourceRecord } from "../src/lib/types";

function resource(key: string, url: string): ResourceRecord {
  return {
    resourceKey: key,
    canonicalUrl: url,
    url,
    title: key,
    userNote: "",
    summary: "",
    tags: [],
    topics: [],
    contentExcerpt: "",
    contentHash: "",
    selectedText: "",
    author: "",
    siteName: "",
    language: "",
    imageUrl: "",
    faviconUrl: "",
    nativeBookmarkIds: [key],
    nativeFolderPath: ["书签栏"],
    aiStatus: "not_requested",
    syncStatus: "local",
    createdAt: "2026-08-02T00:00:00.000Z",
    updatedAt: "2026-08-02T00:00:00.000Z"
  };
}

describe("agent privacy boundary", () => {
  it("removes protected resources and action targets before a provider prompt", () => {
    const catalog: BookmarkAgentCatalog = {
      bookmarks: [
        {
          id: "public",
          parentId: "root",
          title: "公开文档",
          url: "https://docs.example.com/guide",
          path: ["书签栏"],
          writable: true
        },
        {
          id: "private",
          parentId: "root",
          title: "私人后台",
          url: "https://private.example.com/account",
          path: ["书签栏"],
          writable: true
        }
      ],
      folders: [
        {
          id: "root",
          title: "书签栏",
          path: ["书签栏"],
          writable: true
        }
      ]
    };

    const safe = privacySafeAgentLibrary(
      [
        resource("public", "https://docs.example.com/guide"),
        resource("private", "https://private.example.com/account")
      ],
      catalog,
      ["private.example.com"]
    );

    expect(safe.resources.map((item) => item.resourceKey)).toEqual([
      "public"
    ]);
    expect(safe.catalog.bookmarks.map((item) => item.id)).toEqual([
      "public"
    ]);
    expect(safe.catalog.folders).toEqual(catalog.folders);
    expect(safe.excludedCount).toBe(1);
  });

  it("removes explicit pages and protected folder descendants from every AI catalog", () => {
    const catalog: BookmarkAgentCatalog = {
      bookmarks: [
        {
          id: "explicit-page",
          parentId: "root",
          title: "显式保护",
          url: "https://explicit.example",
          path: ["书签栏"],
          writable: true
        },
        {
          id: "nested-page",
          parentId: "protected-folder",
          title: "文件夹继承",
          url: "https://nested.example",
          path: ["书签栏", "私人"],
          writable: true
        },
        {
          id: "public-page",
          parentId: "root",
          title: "公开",
          url: "https://public.example",
          path: ["书签栏"],
          writable: true
        }
      ],
      folders: [
        {
          id: "root",
          title: "书签栏",
          path: ["书签栏"],
          writable: true
        },
        {
          id: "protected-folder",
          parentId: "root",
          title: "私人",
          path: ["书签栏", "私人"],
          writable: true
        }
      ]
    };
    const policy = buildProtectionPolicy(
      [
        {
          id: "root",
          children: [
            { id: "explicit-page", url: "https://explicit.example" },
            {
              id: "protected-folder",
              children: [
                { id: "nested-page", url: "https://nested.example" }
              ]
            },
            { id: "public-page", url: "https://public.example" }
          ]
        }
      ],
      {
        resourceKeys: ["explicit-resource"],
        folderIds: ["protected-folder"]
      }
    );

    const safe = privacySafeAgentLibrary(
      [
        {
          ...resource("explicit-resource", "https://explicit.example"),
          nativeBookmarkIds: ["explicit-page"]
        },
        resource("nested-page", "https://nested.example"),
        resource("public-page", "https://public.example")
      ],
      catalog,
      [],
      policy
    );

    expect(safe.resources.map((item) => item.resourceKey)).toEqual([
      "public-page"
    ]);
    expect(safe.catalog.bookmarks.map((item) => item.id)).toEqual([
      "public-page"
    ]);
    expect(safe.catalog.folders.map((item) => item.id)).toEqual(["root"]);
    expect(safe.excludedCount).toBe(2);
  });
});

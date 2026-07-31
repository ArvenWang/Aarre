// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ResourceRecord } from "../src/lib/types";
import {
  LibrarySearchForm,
  LibraryView
} from "../src/ui/manager/views/LibraryView";

(globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean;
}).IS_REACT_ACT_ENVIRONMENT = true;

function SearchHarness({
  onSearch,
  onClear
}: {
  onSearch: (value: string) => void;
  onClear: () => void;
}) {
  const [draft, setDraft] = useState("旧查询");
  return (
    <LibrarySearchForm
      queryDraft={draft}
      appliedQuery="旧查询"
      onQueryDraftChange={setDraft}
      onSearch={() => onSearch(draft)}
      onClearSearch={onClear}
    />
  );
}

const resource: ResourceRecord = {
  resourceKey: "search-controls",
  canonicalUrl: "https://example.com/design",
  url: "https://example.com/design",
  title: "Design systems",
  userNote: "",
  summary: "Reusable interface guidance",
  tags: ["design"],
  topics: [],
  contentExcerpt: "",
  contentHash: "",
  selectedText: "",
  author: "",
  siteName: "Example",
  language: "en",
  imageUrl: "",
  faviconUrl: "",
  nativeBookmarkIds: ["bookmark-1"],
  nativeFolderPath: ["设计"],
  aiStatus: "ready",
  syncStatus: "local",
  createdAt: "2026-07-30T00:00:00.000Z",
  updatedAt: "2026-07-30T00:00:00.000Z"
};

afterEach(() => {
  document.body.innerHTML = "";
});

describe("manager library search controls", () => {
  it("keeps typing as a draft until the collection search is submitted", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onSearch = vi.fn();
    const onClear = vi.fn();

    await act(async () => {
      root.render(
        <SearchHarness onSearch={onSearch} onClear={onClear} />
      );
    });
    const input = container.querySelector("input")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      )?.set?.call(input, "  新查询  ");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onSearch).not.toHaveBeenCalled();

    await act(async () => {
      container
        .querySelector("form")!
        .dispatchEvent(
          new SubmitEvent("submit", { bubbles: true, cancelable: true })
        );
    });
    expect(onSearch).toHaveBeenCalledWith("  新查询  ");

    await act(async () => {
      (
        container.querySelector(
          "[aria-label='清除收藏搜索']"
        ) as HTMLButtonElement
      ).click();
    });
    expect(onClear).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
  });

  it("combines an applied query with its folder and exposes filters as pressed buttons", () => {
    const markup = renderToStaticMarkup(
      <LibraryView
        results={[{ resource }]}
        visibleResults={[{ resource }]}
        filter="ready"
        folderId="folder:design"
        folders={[
          {
            id: "folder:design",
            label: "设计",
            path: ["设计"],
            depth: 0,
            count: 1
          }
        ]}
        locations={
          new Map([
            [
              resource.resourceKey,
              {
                folderIds: new Set(["folder:design"]),
                folderPaths: [["设计"]]
              }
            ]
          ])
        }
        sort="default"
        readyCount={1}
        pendingCount={0}
        scopeCount={1}
        libraryCount={1}
        bookmarkSnapshot={null}
        queryDraft="Design draft"
        query="Design"
        action=""
        siteBrandByHost={new Map()}
        onFilterChange={() => undefined}
        onFolderChange={() => undefined}
        onSortChange={() => undefined}
        onClearFilters={() => undefined}
        onQueryDraftChange={() => undefined}
        onSearch={() => undefined}
        onClearSearch={() => undefined}
        onResourceChanged={() => undefined}
        onOpenResource={() => undefined}
        onRefresh={() => undefined}
      />
    );

    expect(markup).toContain("搜索收藏库");
    expect(markup).not.toContain("当前显示 1 项");
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).not.toContain('role="tablist"');
    expect(markup).toContain("<mark>Design</mark>");
  });

  it("offers a direct recovery action when a search has no results", () => {
    const markup = renderToStaticMarkup(
      <LibraryView
        results={[]}
        visibleResults={[]}
        filter="all"
        folderId="all"
        folders={[]}
        locations={new Map()}
        sort="default"
        readyCount={0}
        pendingCount={0}
        scopeCount={0}
        libraryCount={12}
        bookmarkSnapshot={null}
        queryDraft="missing"
        query="missing"
        action=""
        siteBrandByHost={new Map()}
        onFilterChange={() => undefined}
        onFolderChange={() => undefined}
        onSortChange={() => undefined}
        onClearFilters={() => undefined}
        onQueryDraftChange={() => undefined}
        onSearch={() => undefined}
        onClearSearch={() => undefined}
        onResourceChanged={() => undefined}
        onOpenResource={() => undefined}
        onRefresh={() => undefined}
      />
    );

    expect(markup).toContain("没有找到匹配内容");
    expect(markup).toContain("清除搜索");
  });
});

import {
  Fragment,
  useEffect,
  useState,
  type MouseEvent,
  type ReactNode
} from "react";
import type {
  BookmarkBarSnapshot,
  SearchResult,
  SiteBrandRecord
} from "../../../lib/types";
import {
  CloseIcon,
  RefreshIcon,
  SearchIcon
} from "../../components/Icons";
import { ResourceIdentity } from "../../components/ResourceIdentity";
import { LibraryCardEditor } from "../components/LibraryCardEditor";
import { LibraryCardCover } from "../components/LibraryCardCover";
import { SnapshotBackfillControl } from "../components/SnapshotBackfillControl";
import {
  ALL_LIBRARY_FOLDERS,
  resourceFolderLabel,
  type LibraryFolderFacet,
  type LibraryResourceLocation
} from "../library-collection";
import type {
  LibraryFilter,
  LibrarySort
} from "../types";
import {
  brandForUrl,
  displayDate,
  hostFromUrl
} from "../utils";

interface LibraryViewProps {
  results: SearchResult[];
  visibleResults: SearchResult[];
  filter: LibraryFilter;
  folderId: string;
  folders: LibraryFolderFacet[];
  locations: Map<string, LibraryResourceLocation>;
  sort: LibrarySort;
  readyCount: number;
  pendingCount: number;
  scopeCount: number;
  libraryCount: number;
  bookmarkSnapshot: BookmarkBarSnapshot | null;
  queryDraft: string;
  query: string;
  action: string;
  siteBrandByHost: Map<string, SiteBrandRecord>;
  missingSnapshotCount?: number;
  onFilterChange: (filter: LibraryFilter) => void;
  onFolderChange: (folderId: string) => void;
  onSortChange: (sort: LibrarySort) => void;
  onClearFilters: () => void;
  onQueryDraftChange: (value: string) => void;
  onSearch: () => void;
  onClearSearch: () => void;
  onResourceChanged: (message: string) => void;
  onSnapshotBackfillChanged?: () => void;
  onOpenResource: (url: string) => void;
  onRefresh: () => void;
}

function queryTerms(query: string): string[] {
  return query
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);
}

function highlightMatches(value: string, query: string): ReactNode {
  const terms = queryTerms(query);
  if (!terms.length) return value;
  const escaped = terms.map((term) =>
    term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  );
  const expression = new RegExp(`(${escaped.join("|")})`, "gi");
  return value.split(expression).map((part, index) =>
    terms.some(
      (term) => term.toLocaleLowerCase() === part.toLocaleLowerCase()
    ) ? (
      <mark key={`${part}:${index}`}>{part}</mark>
    ) : (
      <Fragment key={`${part}:${index}`}>{part}</Fragment>
    )
  );
}

function coverSize(index: number): "short" | "regular" | "tall" {
  if (index % 5 === 1 || index % 5 === 4) return "tall";
  if (index % 5 === 2) return "short";
  return "regular";
}

interface LibrarySearchFormProps {
  queryDraft: string;
  appliedQuery: string;
  onQueryDraftChange: (value: string) => void;
  onSearch: () => void;
  onClearSearch: () => void;
}

export function LibrarySearchForm({
  queryDraft,
  appliedQuery,
  onQueryDraftChange,
  onSearch,
  onClearSearch
}: LibrarySearchFormProps) {
  return (
    <form
      className="library-search"
      role="search"
      aria-label="搜索收藏库"
      onSubmit={(event) => {
        event.preventDefault();
        onSearch();
      }}
    >
      <SearchIcon aria-hidden="true" />
      <label className="visually-hidden" htmlFor="library-search">
        搜索收藏库
      </label>
      <input
        id="library-search"
        value={queryDraft}
        onChange={(event) =>
          onQueryDraftChange(event.currentTarget.value)
        }
        placeholder="搜索收藏标题、标签、摘要或文件夹"
      />
      {queryDraft || appliedQuery ? (
        <button
          type="button"
          className="library-search-clear"
          aria-label="清除收藏搜索"
          title="清除搜索"
          onClick={onClearSearch}
        >
          <CloseIcon />
        </button>
      ) : null}
      <button type="submit" className="button button-dark button-small">
        搜索
      </button>
    </form>
  );
}

export function LibraryView({
  results,
  visibleResults,
  filter,
  folderId,
  folders,
  locations,
  sort,
  readyCount,
  pendingCount,
  scopeCount,
  libraryCount,
  bookmarkSnapshot,
  queryDraft,
  query,
  action,
  siteBrandByHost,
  missingSnapshotCount = 0,
  onFilterChange,
  onFolderChange,
  onSortChange,
  onClearFilters,
  onQueryDraftChange,
  onSearch,
  onClearSearch,
  onResourceChanged,
  onSnapshotBackfillChanged,
  onOpenResource,
  onRefresh
}: LibraryViewProps) {
  const [snapshotRevisions, setSnapshotRevisions] = useState<
    Map<string, string>
  >(new Map());
  const [focusRevision, setFocusRevision] = useState(0);

  useEffect(() => {
    const handleSnapshotUpdated = (message: unknown) => {
      if (
        !message ||
        typeof message !== "object" ||
        (message as { type?: unknown }).type !== "PAGE_SNAPSHOT_UPDATED" ||
        typeof (message as { canonicalUrl?: unknown }).canonicalUrl !==
          "string" ||
        typeof (message as { capturedAt?: unknown }).capturedAt !== "string"
      ) {
        return;
      }
      const update = message as {
        canonicalUrl: string;
        capturedAt: string;
      };
      setSnapshotRevisions((current) => {
        const next = new Map(current);
        next.set(update.canonicalUrl, update.capturedAt);
        return next;
      });
    };
    const refreshAfterReturning = () => {
      if (document.visibilityState === "visible") {
        setFocusRevision((value) => value + 1);
      }
    };
    chrome.runtime.onMessage.addListener(handleSnapshotUpdated);
    document.addEventListener("visibilitychange", refreshAfterReturning);
    window.addEventListener("focus", refreshAfterReturning);
    return () => {
      chrome.runtime.onMessage.removeListener(handleSnapshotUpdated);
      document.removeEventListener(
        "visibilitychange",
        refreshAfterReturning
      );
      window.removeEventListener("focus", refreshAfterReturning);
    };
  }, []);

  function openResource(
    event: MouseEvent<HTMLAnchorElement>,
    url: string
  ) {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    event.preventDefault();
    onOpenResource(url);
  }

  const activeFolder = folders.find((folder) => folder.id === folderId);
  const hasControlFilters =
    filter !== "all" ||
    folderId !== ALL_LIBRARY_FOLDERS ||
    sort !== "default";
  const scopeParts = [
    ...(query ? [`“${query}”`] : []),
    ...(activeFolder ? [activeFolder.label] : [])
  ];

  return (
    <>
      <section className="library-toolbar">
        <div className="library-toolbar-primary">
          <LibrarySearchForm
            queryDraft={queryDraft}
            appliedQuery={query}
            onQueryDraftChange={onQueryDraftChange}
            onSearch={onSearch}
            onClearSearch={onClearSearch}
          />

          <div className="library-toolbar-actions">
            <div className="library-tabs" aria-label="收藏处理状态">
              {(
                [
                  ["all", "全部", scopeCount],
                  ["ready", "已理解", readyCount],
                  ["pending", "待处理", pendingCount]
                ] as const
              ).map(([value, label, count]) => (
                <button
                  type="button"
                  aria-pressed={filter === value}
                  data-active={filter === value}
                  key={value}
                  onClick={() => onFilterChange(value)}
                >
                  {label}
                  <span>{count}</span>
                </button>
              ))}
            </div>
            <button
              className="button button-quiet refresh-button"
              onClick={onRefresh}
              disabled={Boolean(action)}
            >
              <RefreshIcon />
              刷新
            </button>
          </div>
        </div>

        <div className="library-toolbar-secondary">
          <div className="library-controls" aria-label="收藏筛选与排序">
            <label className="library-select-control">
              <span>文件夹</span>
              <select
                value={folderId}
                onChange={(event) =>
                  onFolderChange(event.currentTarget.value)
                }
                aria-label="按 Chrome 书签文件夹筛选"
              >
                <option value={ALL_LIBRARY_FOLDERS}>
                  所有文件夹（{libraryCount}）
                </option>
                {folders.map((folder) => (
                  <option value={folder.id} key={folder.id}>
                    {folder.label}（{folder.count}）
                  </option>
                ))}
              </select>
            </label>

            <label className="library-select-control">
              <span>排序</span>
              <select
                value={sort}
                onChange={(event) =>
                  onSortChange(event.currentTarget.value as LibrarySort)
                }
                aria-label="收藏排序方式"
              >
                <option value="default">
                  {query ? "搜索相关度" : "Chrome 顺序"}
                </option>
                <option value="bookmarked-desc">最近收藏</option>
                <option value="bookmarked-asc">最早收藏</option>
                <option value="used-desc">最近使用</option>
                <option value="updated-desc">最近更新</option>
                <option value="title-asc">标题 A–Z</option>
              </select>
            </label>

            {hasControlFilters ? (
              <button
                type="button"
                className="text-button library-clear-filters"
                onClick={onClearFilters}
              >
                清除筛选
              </button>
            ) : null}

            <SnapshotBackfillControl
              missingCount={missingSnapshotCount}
              onCollectionChanged={onSnapshotBackfillChanged}
            />
          </div>

          <p className="library-scope-summary" aria-live="polite">
            {scopeParts.length
              ? `${scopeParts.join(" · ")} · 当前显示 ${visibleResults.length} 项`
              : `直接读取 Chrome 原生书签 · ${libraryCount} 项`}
          </p>
        </div>
      </section>

      {visibleResults.length ? (
        <section className="library-masonry" aria-label="收藏列表">
          {visibleResults.map(
            ({ resource, matchReason }, index) => {
              const brand = brandForUrl(siteBrandByHost, resource.url);
              const host = resource.siteName || hostFromUrl(resource.url);
              const location = locations.get(resource.resourceKey);
              const locationLabel = resourceFolderLabel(location);
              const summary =
                resource.summary ||
                resource.contentExcerpt ||
                "尚未读取网页正文。再次打开该网页，Aarre 会在页面稳定后自动补全。";
              return (
                <article
                  className="library-card"
                  data-cover-size={coverSize(index)}
                  key={resource.resourceKey}
                >
                  {bookmarkSnapshot ? (
                    <LibraryCardEditor
                      resource={resource}
                      bookmarkSnapshot={bookmarkSnapshot}
                      onChanged={onResourceChanged}
                    />
                  ) : null}
                  <a
                    className="library-card-cover"
                    href={resource.url}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`打开 ${resource.title}`}
                    onClick={(event) =>
                      openResource(event, resource.url)
                    }
                  >
                    <LibraryCardCover
                      canonicalUrl={resource.canonicalUrl}
                      label={resource.title}
                      fallbackResource={resource}
                      snapshotRevision={`${resource.snapshotAt || ""}:${snapshotRevisions.get(resource.canonicalUrl) || ""}:${focusRevision}`}
                    />
                  </a>

                  <div className="library-card-copy">
                    <h3>
                      <a
                        href={resource.url}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(event) =>
                          openResource(event, resource.url)
                        }
                      >
                        {highlightMatches(resource.title, query)}
                      </a>
                    </h3>
                    <ResourceIdentity
                      url={resource.url}
                      brandImageUrl={
                        brand?.iconDataUrlLight || brand?.iconDataUrl
                      }
                      brandImageUrlDark={brand?.iconDataUrlDark}
                      categoryCoverId={resource.categoryCoverId}
                      forceSiteBrand
                      label={host}
                      title={host}
                      meta={
                        query && matchReason
                          ? `${matchReason}匹配 · ${locationLabel}`
                          : locationLabel
                      }
                      className="library-card-site"
                      thumbnailClassName="library-card-favicon"
                    />
                  </div>

                  <div className="library-card-extra">
                    <p>{highlightMatches(summary, query)}</p>
                    <div>
                      <span>
                        {resource.tags.length
                          ? resource.tags
                              .slice(0, 3)
                              .map((tag) => `#${tag}`)
                              .join("  ")
                          : matchReason || "暂无标签"}
                      </span>
                      <time dateTime={resource.updatedAt}>
                        {displayDate(resource.updatedAt)}
                      </time>
                    </div>
                  </div>
                </article>
              );
            }
          )}
        </section>
      ) : (
        <div className="empty-state">
          <strong>
            {!libraryCount
              ? "收藏库还是空的"
              : query && !results.length
                ? "没有找到匹配内容"
                : !scopeCount
                  ? "这个文件夹还没有收藏"
                  : filter === "ready"
                    ? "这里还没有已完成理解的收藏"
                    : "这里没有待处理的收藏"}
          </strong>
          <p>
            {!libraryCount
              ? "Chrome 书签中的内容会自动出现在这里，无需导入。"
              : query && !results.length
                ? "换一种标题、标签、摘要或文件夹关键词再试。"
                : !scopeCount
                  ? "选择其他 Chrome 文件夹，或清除当前筛选。"
                  : "切换到“全部”查看当前范围内的收藏。"}
          </p>
          {query ? (
            <button
              type="button"
              className="button button-quiet"
              onClick={onClearSearch}
            >
              清除搜索
            </button>
          ) : libraryCount && hasControlFilters ? (
            <button
              type="button"
              className="button button-quiet"
              onClick={onClearFilters}
            >
              清除筛选
            </button>
          ) : null}
        </div>
      )}
    </>
  );
}

import { FluidInput, FluidTextarea, FluidSelect } from "../../components/FluidControls";
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
  SearchIcon
} from "../../components/Icons";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { Card } from "../../components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger
} from "../../../components/ui/select";
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
  /** Kept for compatibility with older test fixtures; no longer rendered. */
  onClearFilters?: () => void;
  onQueryDraftChange: (value: string) => void;
  onSearch: () => void;
  onClearSearch: () => void;
  onResourceChanged: (message: string) => void;
  onSnapshotBackfillChanged?: () => void;
  onOpenResource: (url: string) => void;
  /** Kept for compatibility with older test fixtures; no longer rendered. */
  onRefresh?: () => void;
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
      <FluidInput
        id="library-search"
        value={queryDraft}
        onChange={(event) =>
          onQueryDraftChange(event.currentTarget.value)
        }
        placeholder="搜索收藏标题、标签、摘要或文件夹"
      />
      {queryDraft || appliedQuery ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="library-search-clear"
          aria-label="清除收藏搜索"
          title="清除搜索"
          onClick={onClearSearch}
        >
          <CloseIcon />
        </Button>
      ) : null}
      <Button
        type="submit"
        variant="primary"
        size="sm"
        className="button button-dark button-small library-search-submit"
      >
        搜索
      </Button>
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
  onQueryDraftChange,
  onSearch,
  onClearSearch,
  onResourceChanged,
  onSnapshotBackfillChanged,
  onOpenResource
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
    const runtimeMessageEvent =
      typeof chrome !== "undefined" ? chrome.runtime?.onMessage : undefined;
    runtimeMessageEvent?.addListener(handleSnapshotUpdated);
    document.addEventListener("visibilitychange", refreshAfterReturning);
    window.addEventListener("focus", refreshAfterReturning);
    return () => {
      runtimeMessageEvent?.removeListener(handleSnapshotUpdated);
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
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  active={filter === value}
                  className="library-tab-button"
                  aria-pressed={filter === value}
                  data-active={filter === value}
                  key={value}
                  onClick={() => onFilterChange(value)}
                >
                  {label}
                  <span className="library-tab-count">{count}</span>
                </Button>
              ))}
            </div>
          </div>
        </div>

        <div className="library-toolbar-secondary">
          <div className="library-controls" aria-label="收藏筛选与排序">
            <label className="library-select-control">
              <span>文件夹</span>
              <Select
                value={folderId}
                onValueChange={onFolderChange}
              >
                <SelectTrigger
                  className="library-select-trigger"
                  aria-label="按 Chrome 书签文件夹筛选"
                  placeholder="所有文件夹"
                />
                <SelectContent className="library-select-content">
                  <SelectItem value={ALL_LIBRARY_FOLDERS} index={0}>
                    所有文件夹（{libraryCount}）
                  </SelectItem>
                  {folders.map((folder, index) => (
                    <SelectItem value={folder.id} key={folder.id} index={index + 1}>
                      {folder.label}（{folder.count}）
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>

            <label className="library-select-control">
              <span>排序</span>
              <Select
                value={sort}
                onValueChange={(value) => onSortChange(value as LibrarySort)}
              >
                <SelectTrigger
                  className="library-select-trigger"
                  aria-label="收藏排序方式"
                  placeholder={query ? "搜索相关度" : "Chrome 顺序"}
                />
                <SelectContent className="library-select-content">
                  <SelectItem value="default" index={0}>
                    {query ? "搜索相关度" : "Chrome 顺序"}
                  </SelectItem>
                  <SelectItem value="bookmarked-desc" index={1}>最近收藏</SelectItem>
                  <SelectItem value="bookmarked-asc" index={2}>最早收藏</SelectItem>
                  <SelectItem value="used-desc" index={3}>最近使用</SelectItem>
                  <SelectItem value="updated-desc" index={4}>最近更新</SelectItem>
                  <SelectItem value="title-asc" index={5}>标题 A–Z</SelectItem>
                </SelectContent>
              </Select>
            </label>

            <SnapshotBackfillControl
              missingCount={missingSnapshotCount}
              onCollectionChanged={onSnapshotBackfillChanged}
            />
          </div>

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
                <Card
                  role="article"
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
                </Card>
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
            <Button
              type="button"
              className="button button-quiet"
              onClick={onClearSearch}
            >
              清除搜索
            </Button>
          ) : null}
        </div>
      )}
    </>
  );
}

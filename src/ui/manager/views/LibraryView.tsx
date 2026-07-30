import { Fragment, type ReactNode } from "react";
import type { ListCoverStyle } from "../../../lib/display-settings";
import type { SearchResult, SiteBrandRecord } from "../../../lib/types";
import { RefreshIcon } from "../../components/Icons";
import { ResourceIdentity } from "../../components/ResourceIdentity";
import { SiteThumbnail } from "../../components/SiteThumbnail";
import type { LibraryFilter } from "../types";
import {
  brandForUrl,
  displayDate,
  hostFromUrl
} from "../utils";

interface LibraryViewProps {
  results: SearchResult[];
  visibleResults: SearchResult[];
  filter: LibraryFilter;
  readyCount: number;
  pendingCount: number;
  query: string;
  action: string;
  siteBrandByHost: Map<string, SiteBrandRecord>;
  listCoverStyle: ListCoverStyle;
  onFilterChange: (filter: LibraryFilter) => void;
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

export function LibraryView({
  results,
  visibleResults,
  filter,
  readyCount,
  pendingCount,
  query,
  action,
  siteBrandByHost,
  listCoverStyle,
  onFilterChange,
  onRefresh
}: LibraryViewProps) {
  return (
    <>
      <section className="library-toolbar">
        <div className="library-filter-group">
          <div className="library-tabs" role="tablist" aria-label="收藏状态">
            {(
              [
                ["all", "全部", results.length],
                ["ready", "已理解", readyCount],
                ["pending", "待处理", pendingCount]
              ] as const
            ).map(([value, label, count]) => (
              <button
                type="button"
                role="tab"
                aria-selected={filter === value}
                data-active={filter === value}
                key={value}
                onClick={() => onFilterChange(value)}
              >
                {label}
                <span>{count}</span>
              </button>
            ))}
          </div>
          <p>
            {query ? `“${query}”的搜索结果` : "直接读取 Chrome 原生书签"}
          </p>
        </div>
        <button
          className="button button-quiet refresh-button"
          onClick={onRefresh}
          disabled={Boolean(action)}
        >
          <RefreshIcon />
          刷新
        </button>
      </section>

      {visibleResults.length ? (
        <section className="library-masonry" aria-label="收藏列表">
          {visibleResults.map(
            ({ resource, score, matchReason }, index) => {
              const brand = brandForUrl(siteBrandByHost, resource.url);
              const host = resource.siteName || hostFromUrl(resource.url);
              const summary =
                resource.summary ||
                resource.contentExcerpt ||
                "尚未读取网页正文。再次打开网页并通过侧边栏保存，即可补充 AI 摘要。";
              return (
                <article
                  className="library-card"
                  data-cover-size={coverSize(index)}
                  key={resource.resourceKey}
                >
                  <a
                    className="library-card-cover"
                    href={resource.url}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`打开 ${resource.title}`}
                  >
                    <SiteThumbnail
                      url={resource.url}
                      imageUrl={resource.thumbnailDataUrl}
                      categoryCoverId={resource.categoryCoverId}
                      coverStyle={
                        resource.thumbnailDataUrl ? "page" : listCoverStyle
                      }
                      label={resource.title}
                      className="manager-site-thumbnail"
                    />
                  </a>

                  <div className="library-card-copy">
                    <h3>
                      <a
                        href={resource.url}
                        target="_blank"
                        rel="noreferrer"
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
                        typeof score === "number"
                          ? `${Math.round(score * 100)}% 匹配`
                          : undefined
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
            {results.length
              ? filter === "ready"
                ? "还没有已完成理解的收藏"
                : "没有待处理的收藏"
              : query
                ? "没有找到匹配内容"
                : "收藏库还是空的"}
          </strong>
          <p>
            {results.length
              ? "切换到“全部”查看当前收藏。"
              : query
                ? "换一种标题、标签、摘要描述或拼音首字母再试。"
                : "Chrome 书签中的内容会自动出现在这里，无需导入。"}
          </p>
        </div>
      )}
    </>
  );
}

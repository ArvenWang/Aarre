import { Button } from "@/ui/components/ui/button";
import { registrableHost } from "../../../lib/cover-registry";
import type { ListCoverStyle } from "../../../lib/display-settings";
import { currentSiteBrandImageUrl } from "../../../lib/thumbnail";
import type {
  NativeBookmarkNode,
  SearchResult,
  SiteBrandRecord,
} from "../../../lib/types";
import { EllipsisIcon, SearchIcon } from "../../components/Icons";
import { SiteThumbnail } from "../../components/SiteThumbnail";
import { hostFromUrl } from "../utils";
import { highlightTextMatches } from "./highlightTextMatches";

export type RankedBookmarkResult = SearchResult & { node: NativeBookmarkNode };

interface RankedBookmarkResultsProps {
  results: RankedBookmarkResult[];
  query: string;
  coverStyle: ListCoverStyle;
  siteBrandByHost: Map<string, SiteBrandRecord>;
  onShowInFolders: () => void;
  onOpen: (node: NativeBookmarkNode, newTab: boolean) => void;
  onEdit: (node: NativeBookmarkNode) => void;
}

function siteBrandForUrl(
  siteBrandByHost: Map<string, SiteBrandRecord>,
  input: string,
) {
  try {
    const host = new URL(input).hostname.toLocaleLowerCase();
    return siteBrandByHost.get(host) || siteBrandByHost.get(registrableHost(host));
  } catch {
    return undefined;
  }
}

export function RankedBookmarkResults({
  results,
  query,
  coverStyle,
  siteBrandByHost,
  onShowInFolders,
  onOpen,
  onEdit,
}: RankedBookmarkResultsProps) {
  if (!results.length) {
    return (
      <div className="empty-state library-search-empty">
        <span><SearchIcon /></span>
        <strong>没有找到相关收藏</strong>
      </div>
    );
  }
  return (
    <div className="library-search-results">
      <div className="library-search-summary">
        <span>找到 {results.length} 条相关收藏</span>
        <Button type="button" variant="ghost" onClick={onShowInFolders}>
          在文件夹中查看
        </Button>
      </div>
      {results.map((result) => (
        <div className="library-search-result" key={result.node.id}>
          <Button
            variant="ghost"
            type="button"
            className="library-search-result-main"
            onClick={() => onOpen(result.node, false)}
            onAuxClick={(event) => {
              if (event.button !== 1) return;
              event.preventDefault();
              onOpen(result.node, true);
            }}
          >
            <SiteThumbnail
              url={result.resource.url}
              imageUrl={result.resource.thumbnailDataUrl}
              brandImageUrl={currentSiteBrandImageUrl(
                siteBrandForUrl(siteBrandByHost, result.resource.url),
              )}
              categoryCoverId={result.resource.categoryCoverId}
              coverStyle={coverStyle}
              label={result.resource.title}
              className="bookmark-thumbnail"
            />
            <span>
              <strong>{highlightTextMatches(result.resource.title, query)}</strong>
              <small>
                {result.resource.nativeFolderPath.filter(Boolean).join(" / ") ||
                  hostFromUrl(result.resource.url)}
                {result.matchReason ? ` · 匹配${result.matchReason}` : ""}
              </small>
            </span>
          </Button>
          {!result.node.unmodifiable ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="row-menu"
              aria-label={`编辑 ${result.node.title}`}
              title="编辑"
              onClick={() => onEdit(result.node)}
            >
              <EllipsisIcon />
            </Button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

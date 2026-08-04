import { useEffect, type ComponentProps, type RefObject } from "react";
import { Button } from "@/ui/components/ui/button";
import type { ListCoverStyle } from "../../../lib/display-settings";
import type {
  BookmarkBarSnapshot,
  NativeBookmarkNode,
  ResourceRecord,
  SiteBrandRecord,
} from "../../../lib/types";
import { CloseIcon, SearchIcon, StarIcon } from "../../components/Icons";
import { AgentComposer } from "../components/AgentComposer";
import { BookmarkEditorDialog } from "../components/BookmarkEditorDialog";
import { BookmarkPreviewLayer } from "../components/BookmarkPreview";
import { BookmarkTree } from "../components/BookmarkTree";
import { LibraryHeader } from "../components/LibraryHeader";
import { LibraryNotices } from "../components/LibraryNotices";
import { RankedBookmarkResults, type RankedBookmarkResult } from "../components/RankedBookmarkResults";
import { SearchBar } from "../components/SearchBar";

interface LibraryModel {
  snapshot: BookmarkBarSnapshot | null;
  searchMode: "tree" | "ranked";
  query: string;
  debouncedQuery: string;
  rankedResults: RankedBookmarkResult[];
  visibleNodes: NativeBookmarkNode[];
  resourceByUrl: Map<string, ResourceRecord>;
  siteBrandByHost: Map<string, SiteBrandRecord>;
  coverStyle: ListCoverStyle;
  expanded: Set<string>;
  draggedId: string;
  hasVisibleFolders: boolean;
  contentRef: RefObject<HTMLElement | null>;
  onContentScroll: () => void;
  onSetSearchMode: (mode: "tree" | "ranked") => void;
  onOpen: (node: NativeBookmarkNode, newTab: boolean) => void;
  onEdit: (node: NativeBookmarkNode) => void;
  onPreviewIntent: (node: NativeBookmarkNode, rect: DOMRect) => void;
  onPreviewLeave: () => void;
  onToggle: (id: string) => void;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onMove: (id: string, parentId: string, index?: number) => Promise<void>;
}

interface ScrollModel {
  scrollable: boolean;
  visible: boolean;
  height: number;
  offset: number;
  atEnd: boolean;
  onPointerDown: ComponentProps<"div">["onPointerDown"];
  onPointerMove: ComponentProps<"div">["onPointerMove"];
  onPointerEnd: ComponentProps<"div">["onPointerUp"];
}

interface HomePageProps {
  header: ComponentProps<typeof LibraryHeader>;
  notices: ComponentProps<typeof LibraryNotices>;
  search: ComponentProps<typeof SearchBar>;
  library: LibraryModel;
  scroll: ScrollModel;
  status: {
    error: string;
    notice: string;
    onRetry: () => void;
    onDismissError: () => void;
    onDismissNotice: () => void;
  };
  preview: ComponentProps<typeof BookmarkPreviewLayer>;
  agent: ComponentProps<typeof AgentComposer> | null;
  editor: ComponentProps<typeof BookmarkEditorDialog>;
}

export default function HomePage({
  header,
  notices,
  search,
  library,
  scroll,
  status,
  preview,
  agent,
  editor,
}: HomePageProps) {
  const content = library.contentRef.current;

  useEffect(() => {
    if (!status.notice) return;
    const timer = window.setTimeout(status.onDismissNotice, 2_000);
    return () => window.clearTimeout(timer);
  }, [status.notice, status.onDismissNotice]);

  useEffect(() => {
    if (!status.error) return;
    const timer = window.setTimeout(status.onDismissError, 6_000);
    return () => window.clearTimeout(timer);
  }, [status.error, status.onDismissError]);

  return (
    <main className="native-panel">
      <LibraryHeader {...header} />
      <LibraryNotices {...notices} />
      <SearchBar {...search} />
      <div className="native-content-frame" data-has-folders={library.hasVisibleFolders} data-at-end={scroll.atEnd}>
        {status.error ? (
          <div className="native-error-layout" role="alert">
            <span>{status.error}</span>
            <div>
              {!library.snapshot ? (
                <Button variant="ghost" type="button" className="native-error-retry" onClick={status.onRetry}>重试</Button>
              ) : null}
              <Button type="button" variant="ghost" size="icon-sm" className="native-status-dismiss" aria-label="关闭错误提示" onClick={status.onDismissError}>
                <CloseIcon />
              </Button>
            </div>
          </div>
        ) : null}
        <section
          id="bookmark-list"
          ref={library.contentRef}
          className="native-content"
          data-has-folders={library.hasVisibleFolders}
          aria-label="Chrome 书签"
          onScroll={library.onContentScroll}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            const id = event.dataTransfer.getData("application/x-bookmark-layer-id");
            if (id && library.snapshot) {
              void library.onMove(id, library.snapshot.primaryRootId || library.snapshot.root.id);
            }
          }}
        >
          {library.snapshot ? (
            library.searchMode === "ranked" && library.query.trim() ? (
              <RankedBookmarkResults
                results={library.rankedResults}
                query={library.debouncedQuery}
                coverStyle={library.coverStyle}
                siteBrandByHost={library.siteBrandByHost}
                onShowInFolders={() => library.onSetSearchMode("tree")}
                onOpen={library.onOpen}
                onEdit={library.onEdit}
              />
            ) : library.visibleNodes.length ? (
              <BookmarkTree
                nodes={library.visibleNodes}
                resourceByUrl={library.resourceByUrl}
                siteBrandByHost={library.siteBrandByHost}
                coverStyle={library.coverStyle}
                highlightQuery={library.debouncedQuery}
                onPreviewIntent={library.onPreviewIntent}
                onPreviewLeave={library.onPreviewLeave}
                expanded={library.expanded}
                onToggle={library.onToggle}
                onOpen={library.onOpen}
                onEdit={library.onEdit}
                draggedId={library.draggedId}
                onDragStart={library.onDragStart}
                onDragEnd={library.onDragEnd}
                onMove={library.onMove}
              />
            ) : library.query.trim() ? (
              <div className="empty-state library-search-empty"><span><SearchIcon /></span><strong>没有找到相关收藏</strong></div>
            ) : (
              <div className="empty-state"><span><StarIcon /></span><strong>Chrome 书签还是空的</strong></div>
            )
          ) : <div className="empty-state">正在读取 Chrome 书签…</div>}
        </section>
        {scroll.scrollable ? (
          <div
            className="native-scroll-thumb"
            data-visible={scroll.visible}
            style={{ height: `${scroll.height}px`, transform: `translateY(${scroll.offset}px)` }}
            role="scrollbar"
            aria-controls="bookmark-list"
            aria-orientation="vertical"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={content ? Math.round((content.scrollTop / Math.max(1, content.scrollHeight - content.clientHeight)) * 100) : 0}
            onPointerDown={scroll.onPointerDown}
            onPointerMove={scroll.onPointerMove}
            onPointerUp={scroll.onPointerEnd}
            onPointerCancel={scroll.onPointerEnd}
          />
        ) : null}
      </div>
      {status.notice && !status.error ? (
        <div className="native-notice" role="status">
          <span>{status.notice}</span>
        </div>
      ) : null}
      <BookmarkPreviewLayer {...preview} />
      {agent ? <AgentComposer {...agent} /> : null}
      <BookmarkEditorDialog {...editor} />
    </main>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import {
  bookmarkMatchUrls,
  bookmarkNodesByUrl,
  collectFolderIds,
  filterBookmarkTree,
} from "../../../lib/bookmark-search";
import { visibleBookmarkRootChildren } from "../../../lib/bookmark-tree";
import { sendExtensionRequest } from "../../../lib/messages";
import {
  buildLocalSearchIndex,
  hydratePinyinSearchIndex,
  isPinyinSearchQuery,
  searchLocalIndex,
} from "../../../lib/search";
import type {
  BookmarkBarSnapshot,
  NativeBookmarkNode,
  ResourceRecord,
  SiteBrandRecord,
} from "../../../lib/types";
import { useDebouncedSearchQuery } from "../../hooks/useDebouncedSearchQuery";

interface UseBookmarksInput {
  snapshot: BookmarkBarSnapshot | null;
  resources: ResourceRecord[];
  siteBrands: SiteBrandRecord[];
  removedNodeIds: string[];
  contentRef: React.RefObject<HTMLElement | null>;
  syncScrollThumb: () => void;
  refresh: () => Promise<void>;
  setError: (value: string) => void;
}

export function useBookmarks({
  snapshot,
  resources,
  siteBrands,
  removedNodeIds,
  contentRef,
  syncScrollThumb,
  refresh,
  setError,
}: UseBookmarksInput) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedSearchQuery(query);
  const [pinyinRevision, setPinyinRevision] = useState(0);
  const [searchMode, setSearchMode] = useState<"tree" | "ranked">("tree");
  const [draggedId, setDraggedId] = useState("");
  const searchSnapshot = useRef<{ expanded: Set<string>; scrollTop: number } | null>(null);

  const roots = useMemo(() => {
    if (!snapshot) return [];
    const visible = visibleBookmarkRootChildren(snapshot);
    if (!removedNodeIds.length) return visible;
    const removed = new Set(removedNodeIds);
    const prune = (nodes: NativeBookmarkNode[]): NativeBookmarkNode[] => nodes
      .filter((node) => !removed.has(node.id))
      .map((node) => node.children ? { ...node, children: prune(node.children) } : node);
    return prune(visible);
  }, [removedNodeIds, snapshot]);

  const resourceByUrl = useMemo(() => {
    const map = new Map<string, ResourceRecord>();
    for (const resource of Array.isArray(resources) ? resources : []) {
      map.set(resource.url, resource);
      map.set(resource.canonicalUrl, resource);
    }
    return map;
  }, [resources]);
  const siteBrandByHost = useMemo(
    () => new Map(siteBrands.map((brand) => [brand.host.toLocaleLowerCase(), brand])),
    [siteBrands],
  );
  const searchIndex = useMemo(() => buildLocalSearchIndex(resources), [resources]);

  useEffect(() => {
    let cancelled = false;
    if (!isPinyinSearchQuery(debouncedQuery)) return;
    void hydratePinyinSearchIndex(searchIndex).then((loaded) => {
      if (loaded && !cancelled) setPinyinRevision((value) => value + 1);
    });
    return () => { cancelled = true; };
  }, [debouncedQuery, searchIndex]);

  const rankedResults = useMemo(
    () => debouncedQuery.trim() ? searchLocalIndex(searchIndex, debouncedQuery) : [],
    [debouncedQuery, searchIndex, pinyinRevision],
  );
  const nativeNodeByUrl = useMemo(() => bookmarkNodesByUrl(roots), [roots]);
  const rankedNativeResults = useMemo(() => rankedResults.flatMap((result) => {
    const node = nativeNodeByUrl.get(result.resource.url) || nativeNodeByUrl.get(result.resource.canonicalUrl);
    return node ? [{ ...result, node }] : [];
  }), [nativeNodeByUrl, rankedResults]);
  const filteredNodes = useMemo(
    () => debouncedQuery.trim()
      ? filterBookmarkTree(roots, debouncedQuery, bookmarkMatchUrls(rankedResults.map((result) => result.resource.url)))
      : roots,
    [debouncedQuery, rankedResults, roots],
  );
  const visibleNodes = searchMode === "ranked" && query.trim() ? [] : filteredNodes;
  const visibleExpanded = useMemo(() => {
    if (!debouncedQuery.trim() || searchMode === "ranked") return expanded;
    return new Set([...expanded, ...collectFolderIds(filteredNodes)]);
  }, [debouncedQuery, expanded, filteredNodes, searchMode]);

  function clearSearch() {
    const previous = searchSnapshot.current;
    setQuery("");
    setSearchMode("tree");
    if (!previous) return;
    setExpanded(new Set(previous.expanded));
    searchSnapshot.current = null;
    window.requestAnimationFrame(() => {
      if (contentRef.current) {
        contentRef.current.scrollTop = previous.scrollTop;
        syncScrollThumb();
      }
    });
  }

  function changeQuery(value: string) {
    if (value.trim() && !query.trim() && !searchSnapshot.current) {
      searchSnapshot.current = {
        expanded: new Set(expanded),
        scrollTop: contentRef.current?.scrollTop || 0,
      };
    }
    if (!value.trim()) return clearSearch();
    setQuery(value);
    setSearchMode("tree");
  }

  async function moveNode(id: string, parentId: string, index?: number) {
    if (!parentId) return;
    setError("");
    try {
      await sendExtensionRequest({ type: "MOVE_NATIVE_BOOKMARK", payload: { id, parentId, index } });
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "移动失败");
    }
  }

  return {
    expanded, setExpanded, query, debouncedQuery, searchMode, setSearchMode,
    draggedId, setDraggedId, roots, resourceByUrl, siteBrandByHost,
    rankedNativeResults, visibleNodes, visibleExpanded,
    hasVisibleFolders: visibleNodes.some((node) => !node.url),
    clearSearch, changeQuery, moveNode,
  };
}

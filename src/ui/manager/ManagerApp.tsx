import { Button } from "../../components/ui/button";
import { TabsSubtle, TabsSubtleItem } from "../../components/ui/tabs-subtle";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  getDisplaySettings,
  requestPageSnapshotPermission,
} from "../../lib/display-settings";
import { sendExtensionRequest } from "../../lib/messages";
import { isSnapshotSensitiveUrl } from "../../lib/page-snapshot";
import { searchLocalResources } from "../../lib/search";
import {
  applyTheme,
  initializeTheme,
  THEME_CHANGE_EVENT,
  type ThemeMode
} from "../../lib/theme";
import type {
  AppState,
  BookmarkBarSnapshot,
  BookmarkAgentActionExecutionResult,
  KnowledgeDashboard,
  LibraryInsights,
  ResourceRecord,
  SearchResult,
  SiteBrandRecord,
} from "../../lib/types";
import { BookmarkIcon, MoonIcon, SunIcon } from "../components/Icons";
import type { LibraryFilter, LibrarySort, ManagerView } from "./types";
import {
  ALL_LIBRARY_FOLDERS,
  buildLibraryCollection,
  filterAndSortLibraryResults,
  readLibraryControls,
  writeLibraryControls,
  writeLibraryQuery,
} from "./library-collection";
import { LibraryView } from "./views/LibraryView";
import { OrganizeView } from "./views/OrganizeView";
import { ReadingView } from "./views/ReadingView";
import { ReportView } from "./views/ReportView";
import { ResurfaceView } from "./views/ResurfaceView";
import { TopicsView } from "./views/TopicsView";
import { FloatingScrollbar } from "./components/FloatingScrollbar";

const VALID_VIEWS: ManagerView[] = [
  "library",
  "organize",
  "reading",
  "report",
  "topics",
  "resurface",
];

const VIEW_LABELS: Record<ManagerView, string> = {
  library: "收藏库",
  organize: "整理提案",
  reading: "待读队列",
  report: "报告",
  topics: "主题图谱",
  resurface: "重新发现",
};

function asSearchResults(
  items: ResourceRecord[] | SearchResult[],
): SearchResult[] {
  return items.map((item) => ("resource" in item ? item : { resource: item }));
}

function initialLocationState(): {
  query: string;
  view: ManagerView;
  filter: LibraryFilter;
  folderId: string;
  sort: LibrarySort;
} {
  const params = new URLSearchParams(window.location.search);
  const requestedView = params.get("view") as ManagerView | null;
  const controls = readLibraryControls(params);
  return {
    query: params.get("q") || "",
    view:
      requestedView && VALID_VIEWS.includes(requestedView)
        ? requestedView
        : "library",
    ...controls,
  };
}

export function ManagerApp() {
  const initial = useMemo(initialLocationState, []);
  const [themeMode, setThemeMode] = useState<ThemeMode>(() =>
    initializeTheme(),
  );
  useEffect(() => {
    const onThemeChange = (event: Event) => {
      const mode = (event as CustomEvent<ThemeMode>).detail;
      if (mode === "light" || mode === "dark") setThemeMode(mode);
    };
    window.addEventListener(THEME_CHANGE_EVENT, onThemeChange);
    return () => window.removeEventListener(THEME_CHANGE_EVENT, onThemeChange);
  }, []);
  const [appState, setAppState] = useState<AppState | null>(null);
  const [queryDraft, setQueryDraft] = useState(initial.query);
  const [appliedQuery, setAppliedQuery] = useState(initial.query);
  const [filter, setFilter] = useState<LibraryFilter>(initial.filter);
  const [folderId, setFolderId] = useState(initial.folderId);
  const [sort, setSort] = useState<LibrarySort>(initial.sort);
  const [view, setView] = useState<ManagerView>(initial.view);
  const [libraryResults, setLibraryResults] = useState<SearchResult[]>([]);
  const [bookmarkSnapshot, setBookmarkSnapshot] =
    useState<BookmarkBarSnapshot | null>(null);
  const [insights, setInsights] = useState<LibraryInsights | null>(null);
  const [dashboard, setDashboard] = useState<KnowledgeDashboard | null>(null);
  const [reportPeriod, setReportPeriod] = useState<"week" | "month">("week");
  const [selectedActionIds, setSelectedActionIds] = useState<Set<string>>(
    new Set(),
  );
  const [applyResults, setApplyResults] = useState<
    BookmarkAgentActionExecutionResult[]
  >([]);
  const [undoBatchId, setUndoBatchId] = useState("");
  const [confirmDestructiveApply, setConfirmDestructiveApply] = useState(false);
  const [siteBrands, setSiteBrands] = useState<SiteBrandRecord[]>([]);
  const [pageSnapshotsEnabled, setPageSnapshotsEnabled] = useState(true);
  const [snapshotExcludedHosts, setSnapshotExcludedHosts] = useState<string[]>(
    [],
  );
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const derivedLoadRef = useRef<Promise<void> | null>(null);

  const loadResources = useCallback(async () => {
    const items = await sendExtensionRequest({
      type: "GET_RESOURCES",
    });
    setLibraryResults(asSearchResults(items));
  }, []);

  const loadDerivedData = useCallback(() => {
    if (derivedLoadRef.current) return derivedLoadRef.current;

    const request = Promise.all([
      sendExtensionRequest({ type: "GET_LIBRARY_INSIGHTS" }),
      sendExtensionRequest({ type: "GET_KNOWLEDGE_DASHBOARD" }),
    ]).then(([nextInsights, nextDashboard]) => {
      setInsights(nextInsights);
      setDashboard(nextDashboard);
      setSelectedActionIds(
        new Set(
          nextInsights.organizationPlan.proposals
            .filter((proposal) => proposal.selectedByDefault)
            .flatMap((proposal) => proposal.actions.map((item) => item.id)),
        ),
      );
    });
    derivedLoadRef.current = request;
    request
      .finally(() => {
        if (derivedLoadRef.current === request) {
          derivedLoadRef.current = null;
        }
      })
      .catch(() => undefined);
    return request;
  }, []);

  const refresh = useCallback(
    async (silent = false, waitForDerived = false, runSync = true) => {
      if (!silent) setLoading(true);
      setError("");
      try {
        const [state, nextBookmarkSnapshot, nextSiteBrands, displaySettings] =
          await Promise.all([
            sendExtensionRequest({ type: "GET_APP_STATE" }),
            sendExtensionRequest({ type: "GET_BOOKMARK_BAR" }),
            sendExtensionRequest({ type: "GET_SITE_BRANDS" }),
            getDisplaySettings(),
          ]);
        setAppState(state);
        setBookmarkSnapshot(nextBookmarkSnapshot);
        setSiteBrands(nextSiteBrands);
        setPageSnapshotsEnabled(displaySettings.pageSnapshotsEnabled);
        setSnapshotExcludedHosts(displaySettings.snapshotExcludedHosts);
        if (
          runSync &&
          state.auth.configured &&
          state.auth.signedIn &&
          state.auth.accountMatches === true
        ) {
          try {
            await sendExtensionRequest({ type: "SYNC_NOW" });
          } catch {
            // 网络不可用时，本地收藏仍然要完整可用。
          }
        }
        await loadResources();
        const derived = loadDerivedData();
        if (waitForDerived) {
          await derived;
        } else {
          void derived.catch((caught) => {
            setError(caught instanceof Error ? caught.message : "分析加载失败");
          });
        }
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "加载失败");
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [loadDerivedData, loadResources],
  );

  useEffect(() => {
    // 收藏库先显示真实书签；整理、报告和主题计算在后台继续准备，
    // 避免把首次打开时间交给非首屏功能。
    void refresh(false, initial.view !== "library");
    // 首次加载使用 URL 查询词；之后只在用户提交搜索时访问数据层。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    document.title = `Aarre · ${VIEW_LABELS[view]}`;
  }, [view]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 4_000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const results = useMemo(
    () =>
      appliedQuery
        ? searchLocalResources(
            libraryResults.map((item) => item.resource),
            appliedQuery,
          )
        : libraryResults,
    [appliedQuery, libraryResults],
  );

  const libraryCollection = useMemo(
    () =>
      buildLibraryCollection(
        libraryResults.map((item) => item.resource),
        bookmarkSnapshot,
      ),
    [bookmarkSnapshot, libraryResults],
  );

  useEffect(() => {
    if (
      folderId !== ALL_LIBRARY_FOLDERS &&
      bookmarkSnapshot &&
      !libraryCollection.folders.some((folder) => folder.id === folderId)
    ) {
      setFolderId(ALL_LIBRARY_FOLDERS);
      const controls = writeLibraryControls(new URL(window.location.href), {
        filter,
        folderId: ALL_LIBRARY_FOLDERS,
        sort,
      });
      window.history.replaceState(null, "", controls);
    }
  }, [bookmarkSnapshot, filter, folderId, libraryCollection.folders, sort]);

  const folderScopedResults = useMemo(
    () =>
      filterAndSortLibraryResults(
        results,
        {
          filter: "all",
          folderId,
          sort: "default",
        },
        libraryCollection.locations,
        appliedQuery,
      ),
    [appliedQuery, folderId, libraryCollection.locations, results],
  );
  const readyCount = useMemo(
    () =>
      folderScopedResults.filter((item) => item.resource.aiStatus === "ready")
        .length,
    [folderScopedResults],
  );
  const pendingCount = folderScopedResults.length - readyCount;
  const missingSnapshotCount = useMemo(
    () =>
      libraryResults.filter(
        ({ resource }) =>
          resource.nativeBookmarkIds.length > 0 &&
          !resource.snapshotAt &&
          !isSnapshotSensitiveUrl(resource.url, snapshotExcludedHosts),
      ).length,
    [libraryResults, snapshotExcludedHosts],
  );
  const visibleResults = useMemo(
    () =>
      filterAndSortLibraryResults(
        results,
        { filter, folderId, sort },
        libraryCollection.locations,
        appliedQuery,
      ),
    [
      appliedQuery,
      filter,
      folderId,
      libraryCollection.locations,
      results,
      sort,
    ],
  );
  const siteBrandByHost = useMemo(
    () =>
      new Map(
        siteBrands.map((brand) => [brand.host.toLocaleLowerCase(), brand]),
      ),
    [siteBrands],
  );
  const selectedActions = useMemo(() => {
    const actions =
      insights?.organizationPlan.proposals.flatMap(
        (proposal) => proposal.actions,
      ) || [];
    return actions.filter((item) => selectedActionIds.has(item.id));
  }, [insights, selectedActionIds]);

  function selectView(nextView: ManagerView) {
    setView(nextView);
    const url = new URL(window.location.href);
    if (nextView === "library") url.searchParams.delete("view");
    else url.searchParams.set("view", nextView);
    window.history.replaceState(null, "", url);
  }

  function toggleTheme() {
    const next: ThemeMode = themeMode === "dark" ? "light" : "dark";
    applyTheme(next);
    setThemeMode(next);
  }

  function updateLibraryControls(next: {
    filter?: LibraryFilter;
    folderId?: string;
    sort?: LibrarySort;
  }) {
    const controls = {
      filter: next.filter ?? filter,
      folderId: next.folderId ?? folderId,
      sort: next.sort ?? sort,
    };
    setFilter(controls.filter);
    setFolderId(controls.folderId);
    setSort(controls.sort);
    const url = writeLibraryControls(new URL(window.location.href), controls);
    window.history.replaceState(null, "", url);
  }

  function toggleProposal(actionIds: string[], checked: boolean) {
    setConfirmDestructiveApply(false);
    setSelectedActionIds((current) => {
      const next = new Set(current);
      for (const id of actionIds) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  async function applyOrganizationPlan() {
    if (!selectedActions.length) return;
    if (
      selectedActions.some((item) => item.destructive) &&
      !confirmDestructiveApply
    ) {
      setConfirmDestructiveApply(true);
      return;
    }
    setAction("organize");
    setError("");
    try {
      const result = await sendExtensionRequest({
        type: "APPLY_ORGANIZATION_ACTIONS",
        actions: selectedActions.slice(0, 200),
      });
      setApplyResults(result.results);
      setUndoBatchId(result.batchId || "");
      setConfirmDestructiveApply(false);
      await refresh(false, true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "整理操作执行失败");
    } finally {
      setAction("");
    }
  }

  async function undoOrganizationPlan() {
    if (!undoBatchId) return;
    setAction("undo-organize");
    setError("");
    try {
      await sendExtensionRequest({
        type: "UNDO_BOOKMARK_BATCH",
        batchId: undoBatchId,
      });
      setUndoBatchId("");
      setApplyResults([]);
      await refresh(false, true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "撤销整理失败");
    } finally {
      setAction("");
    }
  }

  function handleSearch() {
    const nextQuery = queryDraft.trim();
    setError("");
    setAppliedQuery(nextQuery);
    const url = writeLibraryQuery(new URL(window.location.href), nextQuery);
    window.history.replaceState(null, "", url);
  }

  function clearSearch() {
    setQueryDraft("");
    setAppliedQuery("");
    const url = writeLibraryQuery(new URL(window.location.href), "");
    window.history.replaceState(null, "", url);
  }

  function handleLibraryResourceChanged(message: string) {
    setNotice(message);
    // 编辑/删除后只刷新本地视图，不触发全量云同步：全量同步会再次
    // 重拉资源与派生数据，造成卡片多次变化；删除等变更由后台同步
    // 定时任务推送到云端。
    void refresh(true, false, false);
  }

  async function openResource(url: string) {
    setError("");
    try {
      // 权限拒绝只会让封面继续使用 Aarre 兜底图，不能阻断正常导航。
      if (pageSnapshotsEnabled) {
        await requestPageSnapshotPermission().catch(() => false);
      }
      await sendExtensionRequest({
        type: "NAVIGATE",
        payload: {
          text: url,
          url,
          disposition: "new",
        },
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "无法打开网页");
    }
  }

  let viewContent: ReactNode;
  if (loading) {
    viewContent = (
      <div className="empty-state" aria-live="polite">
        <span className="loading-indicator" />
        <strong>正在读取你的收藏库</strong>
        <p>本地索引、主题关系与收藏健康度会一起准备好。</p>
      </div>
    );
  } else {
    switch (view) {
      case "organize":
        viewContent = (
          <OrganizeView
            insights={insights}
            selectedActionIds={selectedActionIds}
            selectedActionCount={selectedActions.length}
            confirmDestructiveApply={confirmDestructiveApply}
            action={action}
            undoBatchId={undoBatchId}
            appliedSuccessCount={
              applyResults.filter((item) => item.success).length
            }
            appliedFailureCount={
              applyResults.filter((item) => !item.success).length
            }
            onSelectSafe={() =>
              setSelectedActionIds(
                new Set(
                  insights?.organizationPlan.proposals
                    .filter((proposal) => !proposal.destructive)
                    .flatMap((proposal) =>
                      proposal.actions.map((item) => item.id),
                    ) || [],
                ),
              )
            }
            onToggleProposal={toggleProposal}
            onApply={() => void applyOrganizationPlan()}
            onUndo={() => void undoOrganizationPlan()}
            onOpenResource={(url) => void openResource(url)}
          />
        );
        break;
      case "reading":
        viewContent = (
          <ReadingView
            insights={insights}
            onOpenResource={(url) => void openResource(url)}
          />
        );
        break;
      case "report":
        viewContent = (
          <ReportView
            dashboard={dashboard}
            period={reportPeriod}
            onPeriodChange={setReportPeriod}
            onOpenOrganize={() => selectView("organize")}
            onOpenResource={(url) => void openResource(url)}
          />
        );
        break;
      case "topics":
        viewContent = <TopicsView dashboard={dashboard} />;
        break;
      case "resurface":
        viewContent = (
          <ResurfaceView
            dashboard={dashboard}
            onOpenResource={(url) => void openResource(url)}
          />
        );
        break;
      default:
        viewContent = (
          <LibraryView
            results={results}
            visibleResults={visibleResults}
            filter={filter}
            folderId={folderId}
            folders={libraryCollection.folders}
            locations={libraryCollection.locations}
            sort={sort}
            readyCount={readyCount}
            pendingCount={pendingCount}
            scopeCount={folderScopedResults.length}
            libraryCount={libraryResults.length}
            bookmarkSnapshot={bookmarkSnapshot}
            queryDraft={queryDraft}
            query={appliedQuery}
            action={action}
            siteBrandByHost={siteBrandByHost}
            missingSnapshotCount={missingSnapshotCount}
            onFilterChange={(value) => updateLibraryControls({ filter: value })}
            onFolderChange={(value) =>
              updateLibraryControls({ folderId: value })
            }
            onSortChange={(value) => updateLibraryControls({ sort: value })}
            onQueryDraftChange={setQueryDraft}
            onSearch={handleSearch}
            onClearSearch={clearSearch}
            onResourceChanged={handleLibraryResourceChanged}
            onSnapshotBackfillChanged={() => void loadResources()}
            onOpenResource={(url) => void openResource(url)}
          />
        );
    }
  }

  return (
    <>
      <main className="manager-shell">
      <header className="manager-header">
        <div className="manager-topbar">
          <div className="manager-brand">
            <div className="brand-mark">
              <BookmarkIcon />
            </div>
            <strong>Aarre</strong>
          </div>
        </div>

        <TabsSubtle
          selectedIndex={VALID_VIEWS.indexOf(view)}
          onSelect={(index) => {
            const nextView = VALID_VIEWS[index];
            if (nextView) selectView(nextView);
          }}
          className="manager-view-tabs"
          aria-label="收藏管理功能"
        >
          {(
            [
              ["library", "收藏库", libraryResults.length],
              [
                "organize",
                "整理提案",
                insights?.organizationPlan.proposalCount || 0,
              ],
              ["reading", "待读队列", insights?.readingQueue.length || 0],
              ["report", "报告", dashboard?.weekly.createdCount || 0],
              ["topics", "主题图谱", dashboard?.topicGraph.nodes.length || 0],
              ["resurface", "重新发现", dashboard?.resurfacing.length || 0],
            ] as const
          ).map(([value, label, count], index) => (
            <TabsSubtleItem
              key={value}
              label={`${label} ${count}`}
              index={index}
            />
          ))}
        </TabsSubtle>

        <Button
          type="button"
          variant="unstyled"
          size="icon"
          className="manager-theme-button"
          aria-label={
            themeMode === "dark" ? "切换到日间模式" : "切换到夜间模式"
          }
          title={themeMode === "dark" ? "切换到日间模式" : "切换到夜间模式"}
          onClick={toggleTheme}
        >
          {themeMode === "dark" ? (
            <MoonIcon aria-hidden="true" />
          ) : (
            <SunIcon aria-hidden="true" />
          )}
        </Button>
      </header>

      <h1 className="visually-hidden">{`Aarre · ${VIEW_LABELS[view]}`}</h1>

      {appState?.auth.accountMatches === false ? (
        <div className="notice notice-error">
          产品登录账号与当前 Chrome 配置文件账号不一致，同步已暂停。
        </div>
      ) : null}

      {error ? (
        <div className="notice notice-error" role="alert">
          {error}
        </div>
      ) : null}

      {notice ? (
        <div className="manager-toast" role="status" aria-live="polite">
          {notice}
        </div>
      ) : null}

        <div className="manager-view" data-view={view}>
          {viewContent}
        </div>
      </main>
      <FloatingScrollbar />
    </>
  );
}

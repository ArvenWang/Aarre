import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode
} from "react";
import { signInWithGoogle, signOut } from "../../lib/auth";
import {
  getDisplaySettings,
  type ListCoverStyle
} from "../../lib/display-settings";
import { sendExtensionRequest } from "../../lib/messages";
import type {
  AppState,
  BookmarkAgentActionExecutionResult,
  KnowledgeDashboard,
  LibraryInsights,
  ResourceRecord,
  SearchResult,
  SiteBrandRecord
} from "../../lib/types";
import {
  BookmarkIcon,
  SearchIcon
} from "../components/Icons";
import type {
  LibraryFilter,
  ManagerView
} from "./types";
import { LibraryView } from "./views/LibraryView";
import { OrganizeView } from "./views/OrganizeView";
import { ReadingView } from "./views/ReadingView";
import { ReportView } from "./views/ReportView";
import { ResurfaceView } from "./views/ResurfaceView";
import { TopicsView } from "./views/TopicsView";

const VIEW_COPY: Record<
  ManagerView,
  { title: string; description: string }
> = {
  library: {
    title: "我的收藏",
    description: "保留 Chrome 原生书签，并补充摘要、标签和智能检索。"
  },
  organize: {
    title: "整理提案",
    description: "先预览，再选择应用。任何删除项都默认不勾选。"
  },
  reading: {
    title: "待读队列",
    description: "按 Chrome 记录的打开时间排序；未记录到使用的收藏优先。"
  },
  report: {
    title: "知识报告",
    description: "关注点迁移、知识缺口和收藏健康度都由现有本地元数据计算。"
  },
  topics: {
    title: "主题图谱",
    description: "第一次从整体看见你收藏的知识主题及其联系。"
  },
  resurface: {
    title: "重新发现",
    description: "把与你最近关注内容相关的老收藏主动带回来。"
  }
};

const VALID_VIEWS: ManagerView[] = [
  "library",
  "organize",
  "reading",
  "report",
  "topics",
  "resurface"
];

function asSearchResults(
  items: ResourceRecord[] | SearchResult[]
): SearchResult[] {
  return items.map((item) =>
    "resource" in item ? item : { resource: item }
  );
}

function initialLocationState(): {
  query: string;
  view: ManagerView;
} {
  const params = new URLSearchParams(window.location.search);
  const requestedView = params.get("view") as ManagerView | null;
  return {
    query: params.get("q") || "",
    view:
      requestedView && VALID_VIEWS.includes(requestedView)
        ? requestedView
        : "library"
  };
}

export function ManagerApp() {
  const initial = useMemo(initialLocationState, []);
  const [appState, setAppState] = useState<AppState | null>(null);
  const [query, setQuery] = useState(initial.query);
  const [filter, setFilter] = useState<LibraryFilter>("all");
  const [view, setView] = useState<ManagerView>(initial.view);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [insights, setInsights] = useState<LibraryInsights | null>(null);
  const [dashboard, setDashboard] =
    useState<KnowledgeDashboard | null>(null);
  const [reportPeriod, setReportPeriod] = useState<"week" | "month">(
    "week"
  );
  const [selectedActionIds, setSelectedActionIds] = useState<Set<string>>(
    new Set()
  );
  const [applyResults, setApplyResults] = useState<
    BookmarkAgentActionExecutionResult[]
  >([]);
  const [undoBatchId, setUndoBatchId] = useState("");
  const [confirmDestructiveApply, setConfirmDestructiveApply] =
    useState(false);
  const [siteBrands, setSiteBrands] = useState<SiteBrandRecord[]>([]);
  const [listCoverStyle, setListCoverStyle] =
    useState<ListCoverStyle>("site");
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState("");
  const [error, setError] = useState("");

  const loadResources = useCallback(
    async (nextQuery = query) => {
      const items = await sendExtensionRequest({
        type: "GET_RESOURCES",
        query: nextQuery
      });
      setResults(asSearchResults(items));
    },
    [query]
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const state = await sendExtensionRequest({ type: "GET_APP_STATE" });
      setAppState(state);
      setSiteBrands(
        await sendExtensionRequest({ type: "GET_SITE_BRANDS" })
      );
      const nextInsights = await sendExtensionRequest({
        type: "GET_LIBRARY_INSIGHTS"
      });
      setInsights(nextInsights);
      setDashboard(
        await sendExtensionRequest({ type: "GET_KNOWLEDGE_DASHBOARD" })
      );
      setSelectedActionIds(
        new Set(
          nextInsights.organizationPlan.proposals
            .filter((proposal) => proposal.selectedByDefault)
            .flatMap((proposal) =>
              proposal.actions.map((item) => item.id)
            )
        )
      );
      setListCoverStyle((await getDisplaySettings()).listCoverStyle);
      if (
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
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [loadResources]);

  useEffect(() => {
    void refresh();
    // 首次加载使用 URL 查询词；之后只在用户提交搜索时访问数据层。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const readyCount = useMemo(
    () =>
      results.filter((item) => item.resource.aiStatus === "ready").length,
    [results]
  );
  const pendingCount = results.length - readyCount;
  const visibleResults = useMemo(() => {
    if (filter === "ready") {
      return results.filter(
        (item) => item.resource.aiStatus === "ready"
      );
    }
    if (filter === "pending") {
      return results.filter(
        (item) => item.resource.aiStatus !== "ready"
      );
    }
    return results;
  }, [filter, results]);
  const siteBrandByHost = useMemo(
    () =>
      new Map(
        siteBrands.map((brand) => [
          brand.host.toLocaleLowerCase(),
          brand
        ])
      ),
    [siteBrands]
  );
  const selectedActions = useMemo(() => {
    const actions =
      insights?.organizationPlan.proposals.flatMap(
        (proposal) => proposal.actions
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
        actions: selectedActions.slice(0, 200)
      });
      setApplyResults(result.results);
      setUndoBatchId(result.batchId || "");
      setConfirmDestructiveApply(false);
      await refresh();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "整理操作执行失败"
      );
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
        batchId: undoBatchId
      });
      setUndoBatchId("");
      setApplyResults([]);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "撤销整理失败");
    } finally {
      setAction("");
    }
  }

  async function handleSearch(event: FormEvent) {
    event.preventDefault();
    setAction("search");
    setError("");
    try {
      await loadResources(query);
      const url = new URL(window.location.href);
      if (query) url.searchParams.set("q", query);
      else url.searchParams.delete("q");
      window.history.replaceState(null, "", url);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "搜索失败");
    } finally {
      setAction("");
    }
  }

  async function handleLogin() {
    setAction("login");
    setError("");
    try {
      await signInWithGoogle();
      const state = await sendExtensionRequest({ type: "AUTH_CHANGED" });
      setAppState(state);
      await loadResources();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "登录失败");
    } finally {
      setAction("");
    }
  }

  async function handleSignOut() {
    setAction("logout");
    setError("");
    try {
      await signOut();
      setAppState(
        await sendExtensionRequest({ type: "GET_APP_STATE" })
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "退出失败");
    } finally {
      setAction("");
    }
  }

  async function openSidePanel() {
    setError("");
    try {
      await sendExtensionRequest({ type: "OPEN_SIDE_PANEL" });
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "无法打开侧边栏"
      );
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
                      proposal.actions.map((item) => item.id)
                    ) || []
                )
              )
            }
            onToggleProposal={toggleProposal}
            onApply={() => void applyOrganizationPlan()}
            onUndo={() => void undoOrganizationPlan()}
          />
        );
        break;
      case "reading":
        viewContent = <ReadingView insights={insights} />;
        break;
      case "report":
        viewContent = (
          <ReportView
            dashboard={dashboard}
            period={reportPeriod}
            onPeriodChange={setReportPeriod}
            onOpenOrganize={() => selectView("organize")}
          />
        );
        break;
      case "topics":
        viewContent = <TopicsView dashboard={dashboard} />;
        break;
      case "resurface":
        viewContent = <ResurfaceView dashboard={dashboard} />;
        break;
      default:
        viewContent = (
          <LibraryView
            results={results}
            visibleResults={visibleResults}
            filter={filter}
            readyCount={readyCount}
            pendingCount={pendingCount}
            query={query}
            action={action}
            siteBrandByHost={siteBrandByHost}
            listCoverStyle={listCoverStyle}
            onFilterChange={setFilter}
            onRefresh={() => void refresh()}
          />
        );
    }
  }

  return (
    <main className="manager-shell">
      <header className="manager-header">
        <div className="manager-brand">
          <div className="brand-mark">
            <BookmarkIcon />
          </div>
          <div>
            <div className="eyebrow">AARRE</div>
            <strong>收藏智能层</strong>
          </div>
        </div>

        <div className="manager-header-actions">
          <button
            type="button"
            className="button button-quiet button-small manager-sidepanel-return"
            onClick={() => void openSidePanel()}
          >
            返回侧边栏
          </button>
          <div className="manager-account">
            {appState?.auth.userAvatarUrl ? (
              <img src={appState.auth.userAvatarUrl} alt="" />
            ) : (
              <span className="avatar-fallback">
                {(appState?.auth.userEmail || "?")
                  .slice(0, 1)
                  .toUpperCase()}
              </span>
            )}
            <div>
              <strong>
                {appState?.auth.signedIn
                  ? appState.auth.userName || appState.auth.userEmail
                  : "仅保存在本机"}
              </strong>
              <small>
                {appState?.auth.signedIn
                  ? appState.pendingSyncCount
                    ? `${appState.pendingSyncCount} 条将在后台自动同步`
                    : "智能信息已自动同步"
                  : "Chrome 原生书签仍由 Chrome 同步"}
              </small>
            </div>
            {appState?.auth.configured ? (
              appState.auth.signedIn ? (
                <button
                  className="text-button"
                  onClick={() => void handleSignOut()}
                  disabled={Boolean(action)}
                >
                  退出
                </button>
              ) : (
                <button
                  className="button button-dark button-small"
                  onClick={() => void handleLogin()}
                  disabled={Boolean(action)}
                >
                  {action === "login" ? "登录中…" : "Google 登录"}
                </button>
              )
            ) : null}
          </div>
        </div>
      </header>

      <section className="manager-hero">
        <div>
          <h1>{VIEW_COPY[view].title}</h1>
          <p>{VIEW_COPY[view].description}</p>
        </div>

        {view === "library" ? (
          <div className="manager-search-area">
            <form className="search-box" onSubmit={handleSearch}>
              <SearchIcon aria-hidden="true" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="例如：适合深色产品首页的轻量动态背景"
                aria-label="搜索收藏"
              />
              <button
                type="submit"
                className="button button-dark"
                disabled={action === "search"}
              >
                {action === "search" ? "搜索中…" : "搜索"}
              </button>
            </form>
            <p className="semantic-toggle">
              搜索在本机完成，支持标题、标签、摘要、中文和拼音首字母。
            </p>
          </div>
        ) : null}
      </section>

      {appState?.auth.accountMatches === false ? (
        <div className="notice notice-error">
          产品登录账号与当前 Chrome 配置文件账号不一致，同步已暂停。
        </div>
      ) : null}

      <nav className="manager-view-tabs" aria-label="收藏管理功能">
        {(
          [
            ["library", "收藏库", results.length],
            [
              "organize",
              "整理提案",
              insights?.organizationPlan.proposalCount || 0
            ],
            ["reading", "待读队列", insights?.readingQueue.length || 0],
            ["report", "报告", dashboard?.weekly.createdCount || 0],
            ["topics", "主题图谱", dashboard?.topicGraph.nodes.length || 0],
            ["resurface", "重新发现", dashboard?.resurfacing.length || 0]
          ] as const
        ).map(([value, label, count]) => (
          <button
            type="button"
            key={value}
            data-active={view === value}
            aria-current={view === value ? "page" : undefined}
            onClick={() => selectView(value)}
          >
            {label}
            <span>{count}</span>
          </button>
        ))}
      </nav>

      {error ? (
        <div className="notice notice-error" role="alert">
          {error}
        </div>
      ) : null}

      <div className="manager-view" data-view={view}>
        {viewContent}
      </div>
    </main>
  );
}

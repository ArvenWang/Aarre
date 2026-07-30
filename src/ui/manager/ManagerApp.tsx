import { useCallback, useEffect, useMemo, useState } from "react";
import { signInWithGoogle, signOut } from "../../lib/auth";
import { sendExtensionRequest } from "../../lib/messages";
import { registrableHost } from "../../lib/cover-registry";
import {
  getDisplaySettings,
  type ListCoverStyle
} from "../../lib/display-settings";
import { visibleFolderLabel } from "../../lib/folder-options";
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
  RefreshIcon,
  SearchIcon
} from "../components/Icons";
import { SiteThumbnail } from "../components/SiteThumbnail";

type LibraryFilter = "all" | "ready" | "pending";
type ManagerView =
  | "library"
  | "organize"
  | "reading"
  | "report"
  | "topics"
  | "resurface";

function asSearchResults(
  items: ResourceRecord[] | SearchResult[]
): SearchResult[] {
  return items.map((item) =>
    "resource" in item ? item : { resource: item }
  );
}

function displayDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(new Date(value));
}

function displayTimestamp(value?: number): string {
  if (!value) return "从未记录到通过书签打开";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "short",
    day: "numeric"
  }).format(new Date(value));
}

function hostFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function brandForUrl(
  brands: Map<string, SiteBrandRecord>,
  input: string
): SiteBrandRecord | undefined {
  try {
    const host = new URL(input).hostname.toLocaleLowerCase();
    return brands.get(host) || brands.get(registrableHost(host));
  } catch {
    return undefined;
  }
}

function TopicGraphView({
  dashboard
}: {
  dashboard: KnowledgeDashboard;
}) {
  const width = 900;
  const height = 520;
  const positions = new Map(
    dashboard.topicGraph.nodes.map((node, index, nodes) => {
      const angle = (index / Math.max(1, nodes.length)) * Math.PI * 2;
      const ring = index < 8 ? 150 : 220;
      return [
        node.id,
        {
          x: width / 2 + Math.cos(angle) * ring,
          y: height / 2 + Math.sin(angle) * ring
        }
      ];
    })
  );
  return (
    <div className="topic-graph-card">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="收藏主题之间的共同出现关系图"
      >
        <g className="topic-edges">
          {dashboard.topicGraph.edges.map((edge) => {
            const source = positions.get(edge.source);
            const target = positions.get(edge.target);
            return source && target ? (
              <line
                key={`${edge.source}:${edge.target}`}
                x1={source.x}
                y1={source.y}
                x2={target.x}
                y2={target.y}
                strokeWidth={Math.min(7, 0.8 + edge.weight)}
              />
            ) : null;
          })}
        </g>
        <g className="topic-nodes">
          {dashboard.topicGraph.nodes.map((node) => {
            const point = positions.get(node.id)!;
            const radius = Math.min(38, 13 + Math.sqrt(node.count) * 4);
            return (
              <g
                key={node.id}
                transform={`translate(${point.x} ${point.y})`}
              >
                <circle r={radius} />
                <text textAnchor="middle" y="3">
                  {node.label.slice(0, 12)}
                </text>
                <title>
                  {node.label} · {node.count} 条收藏
                </title>
              </g>
            );
          })}
        </g>
      </svg>
      <p>节点越大，相关收藏越多；连线越粗，两个主题越常在同一条收藏中出现。</p>
    </div>
  );
}

export function ManagerApp() {
  const initialParams = new URLSearchParams(window.location.search);
  const initialQuery = initialParams.get("q") || "";
  const requestedView = initialParams.get("view");
  const initialView: ManagerView = [
    "organize",
    "report",
    "topics",
    "resurface",
    "reading"
  ].includes(requestedView || "")
    ? (requestedView as ManagerView)
    : "library";
  const [appState, setAppState] = useState<AppState | null>(null);
  const [query, setQuery] = useState(initialQuery);
  const [filter, setFilter] = useState<LibraryFilter>("all");
  const [view, setView] = useState<ManagerView>(initialView);
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
            .flatMap((proposal) => proposal.actions.map((item) => item.id))
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
          // Local resources remain fully usable when the network is unavailable.
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
    // The first load uses the query from the URL. Later searches are explicit
    // user actions and must not trigger cloud calls on every keystroke.
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
      return results.filter((item) => item.resource.aiStatus === "ready");
    }
    if (filter === "pending") {
      return results.filter((item) => item.resource.aiStatus !== "ready");
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

  async function handleSearch(event: React.FormEvent) {
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
    await signOut();
    setAppState(await sendExtensionRequest({ type: "GET_APP_STATE" }));
    setAction("");
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
                  onClick={handleSignOut}
                  disabled={Boolean(action)}
                >
                  退出
                </button>
              ) : (
                <button
                  className="button button-dark button-small"
                  onClick={handleLogin}
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
          <h1>
            {view === "library"
              ? "我的收藏"
              : view === "organize"
                ? "整理提案"
                : view === "reading"
                  ? "待读队列"
                  : view === "report"
                    ? "知识报告"
                    : view === "topics"
                      ? "主题图谱"
                      : "重新发现"}
          </h1>
          <p>
            {view === "library"
              ? "保留 Chrome 原生书签，并补充摘要、标签和智能检索。"
              : view === "organize"
                ? "先预览，再选择应用。任何删除项都默认不勾选。"
                : view === "reading"
                  ? "按 Chrome 记录的打开时间排序；未记录到使用的收藏优先。"
                  : view === "report"
                    ? "关注点迁移、知识缺口和收藏健康度都由现有本地元数据计算。"
                    : view === "topics"
                      ? "第一次从整体看见你收藏的知识主题及其联系。"
                      : "把与你最近关注内容相关的老收藏主动带回来。"}
          </p>
        </div>

        {view === "library" ? (
          <>
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
          </>
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
            onClick={() => setView(value)}
          >
            {label}
            <span>{count}</span>
          </button>
        ))}
      </nav>

      {view === "library" ? <section className="library-toolbar">
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
                onClick={() => setFilter(value)}
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
        <div className="toolbar-actions">
          <button
            className="button button-quiet refresh-button"
            onClick={() => void refresh()}
            disabled={Boolean(action)}
          >
            <RefreshIcon />
            刷新
          </button>
        </div>
      </section> : null}

      {error ? <div className="notice notice-error">{error}</div> : null}

      {loading ? (
        <div className="empty-state">正在读取你的收藏库…</div>
      ) : view === "organize" ? (
        <section className="organization-shell">
          <header className="organization-toolbar">
            <div>
              <strong>
                {insights?.organizationPlan.actionableCount || 0} 组可执行建议
              </strong>
              <small>
                规则和相似度计算均在本机完成；失效链接来自实际网络检测。
              </small>
            </div>
            <div>
              <button
                type="button"
                className="button button-quiet"
                onClick={() =>
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
              >
                全选安全项
              </button>
              <button
                type="button"
                className={
                  confirmDestructiveApply
                    ? "button button-danger"
                    : "button button-dark"
                }
                disabled={!selectedActions.length || Boolean(action)}
                onClick={() => void applyOrganizationPlan()}
              >
                {action === "organize"
                  ? "执行中…"
                  : confirmDestructiveApply
                    ? `再次确认：应用 ${selectedActions.length} 项`
                    : `应用已选 ${selectedActions.length} 项`}
              </button>
            </div>
          </header>

          {undoBatchId ? (
            <div className="notice organization-result">
              <span>
                已执行 {applyResults.filter((item) => item.success).length} 项；
                {applyResults.filter((item) => !item.success).length} 项失败。
              </span>
              <button
                type="button"
                className="button button-quiet"
                disabled={action === "undo-organize"}
                onClick={() => void undoOrganizationPlan()}
              >
                {action === "undo-organize" ? "撤销中…" : "撤销本次整理"}
              </button>
            </div>
          ) : null}

          {insights?.organizationPlan.proposals.length ? (
            <div className="proposal-list">
              {insights.organizationPlan.proposals.map((proposal) => {
                const actionIds = proposal.actions.map((item) => item.id);
                const selectedCount = actionIds.filter((id) =>
                  selectedActionIds.has(id)
                ).length;
                return (
                  <article
                    className="proposal-card"
                    data-destructive={proposal.destructive}
                    key={proposal.id}
                  >
                    <header>
                      {actionIds.length ? (
                        <input
                          type="checkbox"
                          checked={
                            selectedCount > 0 &&
                            selectedCount === actionIds.length
                          }
                          ref={(element) => {
                            if (element) {
                              element.indeterminate =
                                selectedCount > 0 &&
                                selectedCount < actionIds.length;
                            }
                          }}
                          onChange={(event) =>
                            toggleProposal(
                              actionIds,
                              event.currentTarget.checked
                            )
                          }
                          aria-label={`选择${proposal.title}`}
                        />
                      ) : (
                        <span className="proposal-info-mark">i</span>
                      )}
                      <div>
                        <strong>{proposal.title}</strong>
                        <small>
                          {proposal.destructive
                            ? "包含删除 · 默认不选"
                            : proposal.actions.length
                              ? "可撤销的移动建议"
                              : "仅提示 · 不自动执行"}
                        </small>
                      </div>
                    </header>
                    <p>{proposal.description}</p>
                    <div className="proposal-preview">
                      {proposal.previewLines.slice(0, 12).map((line) => (
                        <code key={line}>{line}</code>
                      ))}
                      {proposal.previewLines.length > 12 ? (
                        <small>
                          另有 {proposal.previewLines.length - 12} 项，将在应用时一并处理
                        </small>
                      ) : null}
                    </div>
                    {proposal.recoveryLinks?.length ? (
                      <div className="proposal-recovery-links">
                        {proposal.recoveryLinks.map((link) => (
                          <a
                            key={link.url}
                            href={link.url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {link.label}
                          </a>
                        ))}
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="empty-state">
              <strong>当前没有整理建议</strong>
              <p>完成一次全目录扫描后，这里会显示分类、重复和失效链接建议。</p>
            </div>
          )}
        </section>
      ) : view === "reading" ? (
        insights?.readingQueue.length ? (
          <section className="reading-queue">
            {insights.readingQueue.map((item, index) => (
              <article key={item.nodeId}>
                <span className="reading-index">{index + 1}</span>
                <div>
                  <h3>
                    <a href={item.url} target="_blank" rel="noreferrer">
                      {item.title}
                    </a>
                  </h3>
                  <p>{visibleFolderLabel(item.path)}</p>
                  <small>
                    {item.dateLastUsed
                      ? `上次通过书签打开：${displayTimestamp(item.dateLastUsed)}`
                      : "很少通过书签打开 · Chrome 尚未记录使用时间"}
                  </small>
                </div>
              </article>
            ))}
          </section>
        ) : (
          <div className="empty-state">
            <strong>待读队列还是空的</strong>
            <p>Chrome 书签进入本地索引后，会按使用时间排在这里。</p>
          </div>
        )
      ) : view === "report" ? (
        dashboard ? (
          <section className="report-shell">
            <div className="report-period-tabs">
              <button
                type="button"
                data-active={reportPeriod === "week"}
                onClick={() => setReportPeriod("week")}
              >
                周报
              </button>
              <button
                type="button"
                data-active={reportPeriod === "month"}
                onClick={() => setReportPeriod("month")}
              >
                月报
              </button>
            </div>
            {(() => {
              const report =
                reportPeriod === "week"
                  ? dashboard.weekly
                  : dashboard.monthly;
              return (
                <>
                  <article className="report-lead">
                    <span>注意力迁移</span>
                    <h2>{report.attentionShift}</h2>
                    <p>
                      本期新增 {report.createdCount} 条 · 有{" "}
                      {report.rarelyOpenedOver90Days} 条收藏超过 90
                      天很少通过书签打开
                    </p>
                  </article>
                  <div className="report-grid">
                    <article>
                      <span>主题变化</span>
                      <div className="trend-list">
                        {report.topicTrends.map((trend) => (
                          <div key={trend.topic}>
                            <strong>{trend.topic}</strong>
                            <small>
                              本期 {trend.current} · 上期 {trend.previous}
                            </small>
                          </div>
                        ))}
                      </div>
                    </article>
                    <article>
                      <span>知识缺口</span>
                      {report.knowledgeGaps.length ? (
                        report.knowledgeGaps.slice(0, 3).map((gap) => (
                          <p key={gap.topic}>{gap.message}</p>
                        ))
                      ) : (
                        <p>当前还没有足够密集的同主题收藏来判断内容角度。</p>
                      )}
                    </article>
                    <article>
                      <span>收藏健康度</span>
                      <dl className="health-metrics">
                        <div>
                          <dt>失效链接</dt>
                          <dd>{report.health.deadLinks}</dd>
                        </div>
                        <div>
                          <dt>本期新发现</dt>
                          <dd>{report.health.newlyDetectedDeadLinks}</dd>
                        </div>
                        <div>
                          <dt>过大文件夹</dt>
                          <dd>{report.health.largeFolders}</dd>
                        </div>
                      </dl>
                      <button
                        type="button"
                        className="report-link-button"
                        onClick={() => setView("organize")}
                      >
                        查看整理提案
                      </button>
                    </article>
                    <article>
                      <span>重新浮现</span>
                      {report.resurfacing.length ? (
                        <div className="report-resurfacing">
                          {report.resurfacing.slice(0, 3).map((item) => (
                            <a
                              key={item.resourceKey}
                              href={item.url}
                              target="_blank"
                              rel="noreferrer"
                            >
                              <strong>{item.title}</strong>
                              <small>{item.reason}</small>
                            </a>
                          ))}
                        </div>
                      ) : (
                        <p>目前没有同时满足“足够久”和“与近期主题相关”的收藏。</p>
                      )}
                    </article>
                  </div>
                </>
              );
            })()}
          </section>
        ) : null
      ) : view === "topics" ? (
        dashboard?.topicGraph.nodes.length ? (
          <section className="topic-graph-shell">
            <TopicGraphView dashboard={dashboard} />
          </section>
        ) : (
          <div className="empty-state">
            <strong>主题信息还不够</strong>
            <p>完成 AI 元数据扫描后，主题之间的关系会显示在这里。</p>
          </div>
        )
      ) : view === "resurface" ? (
        dashboard?.resurfacing.length ? (
          <section className="resurfacing-grid">
            {dashboard.resurfacing.map((item) => (
              <article key={item.resourceKey}>
                <span>{item.ageDays} 天前收藏</span>
                <h3>
                  <a href={item.url} target="_blank" rel="noreferrer">
                    {item.title}
                  </a>
                </h3>
                <p>{item.reason}</p>
                <small>{visibleFolderLabel(item.path)}</small>
              </article>
            ))}
          </section>
        ) : (
          <div className="empty-state">
            <strong>暂时没有值得重新带回来的收藏</strong>
            <p>使用一段时间后，Aarre 会结合近期主题和收藏时间在这里推荐。</p>
          </div>
        )
      ) : visibleResults.length ? (
        <section className="resource-grid">
          {visibleResults.map(({ resource, score, matchReason }) => (
            <article className="resource-card" key={resource.resourceKey}>
              <div className="resource-topline">
                <div className="resource-source">
                  <SiteThumbnail
                    url={resource.url}
                    imageUrl={resource.thumbnailDataUrl}
                    brandImageUrl={
                      brandForUrl(siteBrandByHost, resource.url)
                        ?.iconDataUrlLight ||
                      brandForUrl(siteBrandByHost, resource.url)
                        ?.iconDataUrl
                    }
                    brandImageUrlDark={
                      brandForUrl(siteBrandByHost, resource.url)
                        ?.iconDataUrlDark
                    }
                    categoryCoverId={resource.categoryCoverId}
                    coverStyle={listCoverStyle}
                    label={resource.siteName || hostFromUrl(resource.url)}
                    className="manager-site-thumbnail"
                  />
                  <span>{resource.siteName || hostFromUrl(resource.url)}</span>
                </div>
                <span className="resource-date">
                  {displayDate(resource.updatedAt)}
                </span>
              </div>

              <h3>
                <a href={resource.url} target="_blank" rel="noreferrer">
                  {resource.title}
                </a>
              </h3>

              <p className="resource-summary">
                {resource.summary ||
                  resource.contentExcerpt ||
                  "尚未读取网页正文。再次打开网页并通过侧边栏保存，即可补充 AI 摘要。"}
              </p>

              {resource.userNote ? (
                <p className="resource-note">“{resource.userNote}”</p>
              ) : null}

              <div className="tag-row">
                {resource.tags.slice(0, 5).map((tag) => (
                  <span key={tag}>#{tag}</span>
                ))}
                {!resource.tags.length ? (
                  <span className="tag-muted">
                    {resource.aiStatus === "pending"
                      ? "等待 AI 处理"
                      : "暂无标签"}
                  </span>
                ) : null}
              </div>

              <footer>
                <span
                  className="sync-pill"
                  data-synced={resource.syncStatus === "synced"}
                >
                  {resource.syncStatus === "synced"
                    ? "云端已同步"
                    : resource.syncStatus === "local"
                      ? "仅保存在本机"
                      : "等待云端同步"}
                </span>
                {typeof score === "number" ? (
                  <span className="score-pill">
                    相关度 {Math.round(score * 100)}%
                  </span>
                ) : null}
                {matchReason ? <small>{matchReason}</small> : null}
              </footer>
            </article>
          ))}
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
    </main>
  );
}

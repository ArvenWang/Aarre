import { useCallback, useEffect, useMemo, useState } from "react";
import { signInWithGoogle, signOut } from "../../lib/auth";
import { sendExtensionRequest } from "../../lib/messages";
import type {
  AppState,
  ResourceRecord,
  SearchResult
} from "../../lib/types";

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

function hostFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function ManagerApp() {
  const initialQuery = new URLSearchParams(window.location.search).get("q") || "";
  const [appState, setAppState] = useState<AppState | null>(null);
  const [query, setQuery] = useState(initialQuery);
  const [semantic, setSemantic] = useState(true);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState("");
  const [error, setError] = useState("");

  const loadResources = useCallback(
    async (nextQuery = query) => {
      const items = await sendExtensionRequest({
        type: "GET_RESOURCES",
        query: nextQuery,
        semantic: semantic && Boolean(nextQuery.trim())
      });
      setResults(asSearchResults(items));
    },
    [query, semantic]
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const state = await sendExtensionRequest({ type: "GET_APP_STATE" });
      setAppState(state);
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

  return (
    <main className="manager-shell">
      <header className="manager-header">
        <div className="manager-brand">
          <div className="brand-mark">✦</div>
          <div>
            <div className="eyebrow">BOOKMARK LAYER</div>
            <strong>你的收藏库</strong>
          </div>
        </div>

        <div className="manager-account">
          {appState?.auth.userAvatarUrl ? (
            <img src={appState.auth.userAvatarUrl} alt="" />
          ) : (
            <span className="avatar-fallback">
              {(appState?.auth.userEmail || "?").slice(0, 1).toUpperCase()}
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
      </header>

      <section className="manager-hero">
        <div>
          <p className="eyebrow">RECALL WHAT MATTERS</p>
          <h1>描述你正在寻找的东西。</h1>
          <p>
            不需要记住网页标题。输入用途、场景或曾经看到的观点。
          </p>
        </div>

        <form className="search-box" onSubmit={handleSearch}>
          <span aria-hidden="true">⌕</span>
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

        <label className="semantic-toggle">
          <input
            type="checkbox"
            checked={semantic}
            onChange={(event) => setSemantic(event.target.checked)}
            disabled={!appState?.auth.signedIn}
          />
          <span>
            AI 语义搜索
            {!appState?.auth.signedIn ? "（登录后可用）" : ""}
          </span>
        </label>
      </section>

      {!appState?.auth.configured ? (
        <section className="setup-banner">
          <div>
            <strong>云端尚未连接</strong>
            <p>
              本地收藏和 Chrome 同步可正常使用。配置 Supabase 与 Google
              OAuth 后，摘要、标签和语义索引才会跨设备同步。
            </p>
          </div>
          <code>{appState?.auth.redirectUrl || "加载重定向地址中…"}</code>
        </section>
      ) : null}

      {appState?.auth.accountMatches === false ? (
        <div className="notice notice-error">
          产品登录账号与当前 Chrome 配置文件账号不一致，同步已暂停。
        </div>
      ) : null}

      <section className="library-toolbar">
        <div>
          <h2>{query ? "搜索结果" : "全部收藏"}</h2>
          <p>
            直接读取 Chrome 原生书签 · {results.length} 条内容 · {readyCount} 条已完成 AI 理解
          </p>
        </div>
        <div className="toolbar-actions">
          <button
            className="button button-dark"
            onClick={() => void refresh()}
            disabled={Boolean(action)}
          >
            刷新
          </button>
        </div>
      </section>

      {error ? <div className="notice notice-error">{error}</div> : null}

      {loading ? (
        <div className="empty-state">正在读取你的收藏库…</div>
      ) : results.length ? (
        <section className="resource-grid">
          {results.map(({ resource, score, matchReason }) => (
            <article className="resource-card" key={resource.resourceKey}>
              <div className="resource-topline">
                <div className="resource-source">
                  {resource.faviconUrl ? (
                    <img src={resource.faviconUrl} alt="" />
                  ) : (
                    <span className="favicon-fallback">↗</span>
                  )}
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
                    : "本地待同步"}
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
          <strong>{query ? "没有找到匹配内容" : "收藏库还是空的"}</strong>
          <p>
            {query
              ? "换一种描述，或关闭 AI 语义搜索后使用关键词。"
              : "Chrome 书签栏中的内容会自动出现在这里，无需导入。"}
          </p>
        </div>
      )}
    </main>
  );
}

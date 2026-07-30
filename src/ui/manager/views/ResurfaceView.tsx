import { visibleFolderLabel } from "../../../lib/folder-options";
import type { KnowledgeDashboard } from "../../../lib/types";

export function ResurfaceView({
  dashboard
}: {
  dashboard: KnowledgeDashboard | null;
}) {
  const items = dashboard?.resurfacing || [];
  return items.length ? (
    <section className="resurfacing-grid">
      {items.map((item) => (
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
  );
}

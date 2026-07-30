import { visibleFolderLabel } from "../../../lib/folder-options";
import type { KnowledgeDashboard } from "../../../lib/types";
import { ResourceLink } from "../components/ResourceLink";

export function ResurfaceView({
  dashboard,
  onOpenResource
}: {
  dashboard: KnowledgeDashboard | null;
  onOpenResource: (url: string) => void;
}) {
  const items = dashboard?.resurfacing || [];
  return items.length ? (
    <section className="resurfacing-grid">
      {items.map((item) => (
        <article key={item.resourceKey}>
          <span>{item.ageDays} 天前收藏</span>
          <h3>
            <ResourceLink
              url={item.url}
              onOpenResource={onOpenResource}
            >
              {item.title}
            </ResourceLink>
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

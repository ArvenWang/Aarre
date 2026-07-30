import { visibleFolderLabel } from "../../../lib/folder-options";
import type { LibraryInsights } from "../../../lib/types";
import { displayTimestamp } from "../utils";

export function ReadingView({
  insights
}: {
  insights: LibraryInsights | null;
}) {
  const queue = insights?.readingQueue || [];
  return queue.length ? (
    <section className="reading-queue">
      {queue.map((item, index) => (
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
  );
}

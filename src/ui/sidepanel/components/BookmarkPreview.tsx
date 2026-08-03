import type { PageSnapshot } from "../../../lib/types";

interface BookmarkPreviewCardProps {
  snapshot: PageSnapshot;
  flip: boolean;
  offset: number;
}

export function BookmarkPreviewCard({
  snapshot,
  flip,
  offset,
}: BookmarkPreviewCardProps) {
  return (
    <aside
      className="bookmark-preview-card"
      data-flip={flip}
      style={
        flip
          ? {
              bottom: offset,
              maxHeight: `calc(100vh - ${offset + 12}px)`,
            }
          : {
              top: offset,
              maxHeight: `calc(100vh - ${offset + 12}px)`,
            }
      }
      aria-hidden="true"
    >
      <div className="bookmark-preview-visual">
        <img src={snapshot.imageDataUrl} alt="" />
      </div>
    </aside>
  );
}

interface BookmarkPreviewLayerProps {
  snapshot: PageSnapshot | null;
  hidden?: boolean;
  placement: { flip: boolean; offset: number } | null;
}

export function BookmarkPreviewLayer({
  snapshot,
  hidden = false,
  placement,
}: BookmarkPreviewLayerProps) {
  if (hidden || !snapshot || !placement) return null;
  return (
    <BookmarkPreviewCard
      snapshot={snapshot}
      flip={placement.flip}
      offset={placement.offset}
    />
  );
}

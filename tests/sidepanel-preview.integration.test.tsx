import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  BookmarkPreviewLayer,
  decideBookmarkPreviewMove
} from "../src/ui/sidepanel/SidePanelApp";
import type { PageSnapshot } from "../src/lib/types";

const snapshot: PageSnapshot = {
  canonicalUrl: "https://example.com/article",
  imageDataUrl: "data:image/webp;base64,UklGRg==",
  capturedAt: "2026-07-30T00:00:00.000Z",
  width: 1280,
  height: 800
};

function render(
  snapshotValue: PageSnapshot | null,
  hidden = false
): string {
  return renderToStaticMarkup(
    createElement(BookmarkPreviewLayer, {
      snapshot: snapshotValue,
      hidden,
      placement: { flip: false, offset: 120 }
    })
  );
}

describe("bookmark hover preview rendering gate", () => {
  it("renders exactly one image when a snapshot exists", () => {
    const markup = render(snapshot);

    expect(markup.match(/class="bookmark-preview-card"/g)).toHaveLength(1);
    expect(markup.match(/<img /g)).toHaveLength(1);
  });

  it("renders no overlay node when there is no snapshot", () => {
    const markup = render(null);

    expect(markup).toBe("");
  });

  it("renders no overlay while an editor is open", () => {
    expect(render(snapshot, true)).toBe("");
  });

  it("contains no visible or hidden text content", () => {
    const markup = render(snapshot);
    const textContent = markup.replace(/<[^>]+>/g, "");

    expect(textContent).toBe("");
  });
});

describe("bookmark hover intent stability", () => {
  it("keeps an already displayed preview while moving inside the same row", () => {
    expect(
      decideBookmarkPreviewMove({
        nodeId: "bookmark-1",
        activeNodeId: "bookmark-1",
        timerArmed: false,
        distance: 120,
        elapsed: 1
      })
    ).toBe("keep");
  });

  it("still cancels a pending preview when the pointer is moving too fast", () => {
    expect(
      decideBookmarkPreviewMove({
        nodeId: "bookmark-1",
        activeNodeId: "",
        timerArmed: true,
        distance: 120,
        elapsed: 1
      })
    ).toBe("cancel");
  });

  it("arms a preview only after pointer movement has slowed down", () => {
    expect(
      decideBookmarkPreviewMove({
        nodeId: "bookmark-1",
        activeNodeId: "",
        timerArmed: false,
        distance: 2,
        elapsed: 20
      })
    ).toBe("arm");
  });
});

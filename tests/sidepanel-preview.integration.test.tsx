import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BookmarkPreviewLayer } from "../src/ui/sidepanel/SidePanelApp";
import type { PageSnapshot } from "../src/lib/types";

const snapshot: PageSnapshot = {
  canonicalUrl: "https://example.com/article",
  imageDataUrl: "data:image/webp;base64,UklGRg==",
  capturedAt: "2026-07-30T00:00:00.000Z",
  width: 1280,
  height: 800
};

function render(snapshotValue: PageSnapshot | null): string {
  return renderToStaticMarkup(
    createElement(BookmarkPreviewLayer, {
      snapshot: snapshotValue,
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

  it("contains no visible or hidden text content", () => {
    const markup = render(snapshot);
    const textContent = markup.replace(/<[^>]+>/g, "");

    expect(textContent).toBe("");
  });
});

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const managerCssUrl = new URL("../src/ui/manager.css", import.meta.url);
const libraryViewUrl = new URL(
  "../src/ui/manager/views/LibraryView.tsx",
  import.meta.url
);
const stableMasonryUrl = new URL(
  "../src/ui/manager/components/StableMasonry.tsx",
  import.meta.url
);
const managerAppUrl = new URL(
  "../src/ui/manager/ManagerApp.tsx",
  import.meta.url
);
const managerMainUrl = new URL(
  "../src/ui/manager/main.tsx",
  import.meta.url
);
const floatingScrollbarUrl = new URL(
  "../src/ui/manager/components/FloatingScrollbar.tsx",
  import.meta.url
);
const tokensUrl = new URL("../src/ui/tokens.css", import.meta.url);

function rule(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) return "";
  const bodyStart = css.indexOf("{", start) + 1;
  return css.slice(bodyStart, css.indexOf("}", bodyStart));
}

describe("manager layout stability", () => {
  it("keeps masonry siblings top-aligned while revealing details", async () => {
    const [css, source, masonrySource] = await Promise.all([
      readFile(managerCssUrl, "utf8"),
      readFile(libraryViewUrl, "utf8"),
      readFile(stableMasonryUrl, "utf8")
    ]);
    const masonryRule = rule(css, ".library-masonry");
    const masonryColumnRule = rule(css, ".library-masonry-column");
    const cardRule = rule(css, ".library-card");
    const coverFrameRule = rule(css, ".library-card-cover-frame");
    const coverRule = rule(css, ".library-card-cover");
    const coverImageRule = rule(
      css,
      ".library-card-cover .site-thumbnail-image"
    );
    const editorTriggerRule = rule(
      css,
      ".library-card-editor-trigger"
    );
    const extraRule = rule(css, ".library-card-extra");
    const hoverExtraRule = rule(
      css,
      ".library-card:hover .library-card-extra,\n.library-card:focus-within .library-card-extra"
    );
    const coverMarkup = source.match(
      /<div className="library-card-cover-frame">[\s\S]*?\n {16}<\/div>/
    )?.[0];

    expect(masonryRule).toContain("display: grid");
    expect(masonryRule).toContain("align-items: start");
    expect(masonryRule).toContain("--masonry-column-count");
    expect(masonryColumnRule).toContain("display: flex");
    expect(masonryColumnRule).toContain("flex-direction: column");
    expect(cardRule).toContain("align-self: start");
    expect(cardRule).not.toContain("display: inline-block");
    expect(cardRule).toContain("overflow: visible");
    expect(coverFrameRule).toContain("aspect-ratio: 1 / 1");
    expect(coverFrameRule).toContain("height: auto");
    expect(coverFrameRule).toContain("overflow: visible");
    expect(cardRule).toContain("border: 0");
    expect(cardRule).toContain("box-shadow: none");
    expect(coverFrameRule).toContain("border: 1px solid var(--card-outline)");
    expect(coverFrameRule).toContain("box-shadow: none");
    expect(coverRule).toContain("height: 100%");
    expect(coverRule).toContain("overflow: hidden");
    expect(coverRule).toContain("border-radius: inherit");
    expect(coverImageRule).toContain("object-position: center");
    expect(coverImageRule).toContain("transform: scale(1.05)");
    expect(coverImageRule).toContain("transform-origin: center");
    const fallbackImageRule = rule(
      css,
      '.library-card-cover .site-thumbnail-image[data-cover-kind="aarre-fallback"]'
    );
    expect(fallbackImageRule).toContain("object-fit: contain");
    expect(fallbackImageRule).toContain("transform: none");
    expect(css).toContain(
      '.library-card:hover\n  .library-card-cover\n  .site-thumbnail-image[data-cover-kind="aarre-fallback"]'
    );
    expect(editorTriggerRule).toContain("opacity: 0");
    expect(editorTriggerRule).toContain("pointer-events: none");
    expect(css).toContain(
      ".library-card-editor-trigger:focus-visible"
    );
    expect(css).toContain(".library-card-editor-heading {");
    expect(coverFrameRule).not.toMatch(/transition:[^}]*\bheight\b/s);
    // Detail is revealed as an overlay inside the fixed-aspect cover, so the
    // reveal contributes no layout height at all.
    expect(extraRule).toContain("position: absolute");
    expect(extraRule).toContain("inset: 0");
    expect(extraRule).toContain("pointer-events: none");
    expect(extraRule).toContain("background: var(--scrim-cover)");
    expect(extraRule).toContain("overflow-y: auto");
    expect(extraRule).toContain("scrollbar-width: none");
    expect(extraRule).not.toContain("linear-gradient");
    expect(extraRule).not.toMatch(/\bmax-height\s*:/);
    expect(rule(css, ".library-card-extra p")).not.toContain(
      "-webkit-line-clamp"
    );
    expect(css).not.toContain(".library-card-extra > div");
    expect(source).not.toContain("resource.tags");
    expect(source).not.toContain("displayDate");
    expect(source).not.toContain("<time");
    expect(source).toContain("{highlightMatches(summary, query)}");
    expect(coverMarkup).toContain('className="library-card-cover"');
    expect(coverMarkup).toContain('className="library-card-extra"');
    // The hover state may only cross-fade (plus enabling scroll); anything that
    // changes box geometry would push the cards below it in the same column.
    expect(hoverExtraRule).toContain("opacity: 1");
    expect(hoverExtraRule).toContain("pointer-events: auto");
    expect(css).not.toContain(".library-card[data-cover-size=");
    expect(source).not.toContain("data-cover-size");
    expect(source).not.toContain("coverSize(");
    expect(source).toContain("StableMasonry");
    expect(masonrySource).toContain("index % safeColumnCount");
    expect(masonrySource).toContain("ResizeObserver");
  });

  it("keeps brand and navigation in one header without a bottom rule", async () => {
    const [css, source] = await Promise.all([
      readFile(managerCssUrl, "utf8"),
      readFile(managerAppUrl, "utf8")
    ]);
    const headerRule = rule(css, ".manager-header");
    const topbarRule = rule(css, ".manager-topbar");
    const tabsRule = rule(css, ".manager-view-tabs");
    const headerMarkup = source.match(
      /<header className="manager-header">[\s\S]*?<\/header>/
    )?.[0];

    expect(headerRule).not.toContain("border-bottom");
    expect(topbarRule).not.toContain("border-bottom");
    expect(tabsRule).not.toContain("border-bottom");
    expect(headerMarkup).toContain('className="manager-topbar"');
    expect(headerMarkup).toContain('className="manager-view-tabs"');
  });

  it("keeps the editor visually open and aligns non-action proposal marks", async () => {
    const css = await readFile(managerCssUrl, "utf8");
    const editorHeading = rule(css, ".library-card-editor-heading");
    const aiSection = rule(css, ".library-card-editor-ai");
    const editorActions = rule(
      css,
      ".library-card-editor-actions,\n.library-card-editor-confirm"
    );
    const infoMark = rule(css, ".proposal-info-mark");
    const close = rule(css, ".library-card-editor-close");

    expect(editorHeading).not.toContain("border-bottom");
    expect(aiSection).not.toContain("border-top");
    expect(editorActions).not.toContain("border-top");
    expect(infoMark).toContain("margin-top: var(--sp-1)");
    expect(close).toContain("width: var(--control-h-sm)");
    expect(close).toContain("height: var(--control-h-sm)");
    expect(close).toContain("border-radius: var(--radius-control)");
    expect(close).toContain("border: 0");
    expect(close).toContain("background: transparent");
  });

  it("uses a manager-only floating scrollbar without consuming page width", async () => {
    const [css, component, main, tokens] = await Promise.all([
      readFile(managerCssUrl, "utf8"),
      readFile(floatingScrollbarUrl, "utf8"),
      readFile(managerMainUrl, "utf8"),
      readFile(tokensUrl, "utf8")
    ]);

    expect(css).toContain("scrollbar-width: none");
    expect(css).toContain("body.manager-page::-webkit-scrollbar");
    expect(css).toContain(".manager-floating-scrollbar {");
    expect(css).toContain("position: fixed");
    expect(css).toContain("pointer-events: none");
    expect(css).toContain("pointer-events: auto");
    expect(css).toContain("opacity: 0");
    expect(css).toContain("--scrollbar-thumb-size");
    expect(css).toContain('html.manager-page[data-theme="light"]');
    expect(component).toContain('role="scrollbar"');
    expect(component).toContain("onPointerDown={beginDrag}");
    expect(component).toContain("onKeyDown={handleKeyDown}");
    expect(component).toContain('document.addEventListener("scroll"');
    expect(main).toContain('classList.add("manager-page")');
    expect(tokens).toContain("--page-bg-light: #ffffff");
  });
});

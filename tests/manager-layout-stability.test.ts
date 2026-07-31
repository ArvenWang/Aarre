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
    const coverRule = rule(css, ".library-card-cover");
    const coverImageRule = rule(
      css,
      ".library-card-cover .site-thumbnail-image"
    );
    const hoverCoverRule = rule(
      css,
      ".library-card:hover .library-card-cover,\n.library-card:focus-within .library-card-cover"
    );
    const extraRule = rule(css, ".library-card-extra");
    const hoverExtraRule = rule(
      css,
      ".library-card:hover .library-card-extra,\n.library-card:focus-within .library-card-extra"
    );

    expect(masonryRule).toContain("display: grid");
    expect(masonryRule).toContain("align-items: start");
    expect(masonryRule).toContain("--masonry-column-count");
    expect(masonryColumnRule).toContain("display: flex");
    expect(masonryColumnRule).toContain("flex-direction: column");
    expect(cardRule).toContain("align-self: start");
    expect(cardRule).not.toContain("display: inline-block");
    expect(coverRule).toContain("aspect-ratio: 16 / 9");
    expect(coverRule).toContain("height: auto");
    expect(coverImageRule).toContain("object-position: center");
    expect(coverRule).not.toMatch(/transition:[^}]*\bheight\b/s);
    expect(hoverCoverRule).not.toMatch(/\bheight\s*:/);
    expect(extraRule).toContain("position: static");
    expect(extraRule).toContain("max-height: 0");
    expect(extraRule).not.toContain("position: absolute");
    expect(hoverExtraRule).toContain("max-height: 160px");
    expect(hoverExtraRule).not.toContain("position: absolute");
    expect(css).not.toContain(".library-card[data-cover-size=");
    expect(source).not.toContain("data-cover-size");
    expect(source).not.toContain("coverSize(");
    expect(source).toContain("StableMasonry");
    expect(masonrySource).toContain("index % safeColumnCount");
    expect(masonrySource).toContain("ResizeObserver");
  });

  it("uses one integrated header divider around brand and navigation", async () => {
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

    expect(headerRule).toContain("border-bottom: 1px solid var(--line)");
    expect(topbarRule).not.toContain("border-bottom");
    expect(tabsRule).not.toContain("border-bottom");
    expect(headerMarkup).toContain('className="manager-topbar"');
    expect(headerMarkup).toContain('className="manager-view-tabs"');
  });
});

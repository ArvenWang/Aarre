import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const managerCssUrl = new URL("../src/ui/manager.css", import.meta.url);
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
  it("keeps masonry hover feedback out of multi-column layout calculations", async () => {
    const css = await readFile(managerCssUrl, "utf8");
    const coverRule = rule(css, ".library-card-cover");
    const hoverCoverRule = rule(
      css,
      ".library-card:hover .library-card-cover,\n.library-card:focus-within .library-card-cover"
    );
    const extraRule = rule(css, ".library-card-extra");
    const hoverExtraRule = rule(
      css,
      ".library-card:hover .library-card-extra,\n.library-card:focus-within .library-card-extra"
    );

    expect(coverRule).not.toMatch(/transition:[^}]*\bheight\b/s);
    expect(hoverCoverRule).not.toMatch(/\bheight\s*:/);
    expect(extraRule).toContain("position: absolute");
    expect(extraRule).toContain("height: var(--reveal)");
    expect(extraRule).toContain("transform: translateY(8px)");
    expect(hoverExtraRule).not.toMatch(/\bheight\s*:/);
    expect(hoverExtraRule).toContain("transform: translateY(0)");
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

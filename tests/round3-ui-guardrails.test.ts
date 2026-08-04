import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const sidepanelCssUrl = new URL("../src/ui/sidepanel.css", import.meta.url);
const agentPageUrl = new URL("../src/ui/sidepanel/pages/AgentChatPage.tsx", import.meta.url);
const agentCssUrl = new URL("../src/ui/sidepanel-lazy.css", import.meta.url);
const folderSelectUrl = new URL("../src/ui/sidepanel/components/FolderSelect.tsx", import.meta.url);
const homePageUrl = new URL("../src/ui/sidepanel/pages/HomePage.tsx", import.meta.url);
const searchBarUrl = new URL("../src/ui/sidepanel/components/SearchBar.tsx", import.meta.url);

function rule(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) return "";
  const bodyStart = css.indexOf("{", start) + 1;
  return css.slice(bodyStart, css.indexOf("}", bodyStart));
}

describe("Round 3 UI root-cause guardrails", () => {
  it("keeps sticky folder headers opaque and removes the top fade animation", async () => {
    const css = await readFile(sidepanelCssUrl, "utf8");
    const sticky = rule(
      css,
      '.bookmark-row[data-folder="true"][data-expanded="true"]',
    );
    expect(sticky).toContain("background: var(--bg)");
    expect(sticky).toContain("mask-image: none");
    expect(sticky).not.toContain("backdrop-filter");
    expect(css).not.toContain("bookmark-reveal-scroll-start");
    expect(css).toContain("bookmark-reveal-scroll-end linear both");
  });

  it("renders cited bookmark links inline without nesting block cards in paragraphs", async () => {
    const [page, css] = await Promise.all([
      readFile(agentPageUrl, "utf8"),
      readFile(agentCssUrl, "utf8"),
    ]);
    expect(page).toContain('className="agent-inline-source"');
    expect(page).toContain("uncitedSources(message.content, message.sources)");
    expect(page).toContain("其他相关收藏");
    expect(css).toContain(".agent-markdown .agent-inline-source");
    expect(page).not.toContain('<div className="agent-inline-source"');
  });

  it("creates a real Chrome folder inline and selects the result", async () => {
    const source = await readFile(folderSelectUrl, "utf8");
    expect(source).toContain('type: "CREATE_NATIVE_FOLDER"');
    expect(source).toContain('type: "GET_FOLDERS"');
    expect(source).toContain("onChange(created.id)");
    expect(source).toContain('maxLength={100}');
  });

  it("auto-dismisses notice and error with their selected durations", async () => {
    const source = await readFile(homePageUrl, "utf8");
    expect(source).toContain("status.onDismissNotice, 2_000");
    expect(source).toContain("status.onDismissError, 6_000");
    expect(source).not.toContain('aria-label="关闭提示"');
  });

  it("leaves the empty search field free of a return-key badge", async () => {
    const source = await readFile(searchBarUrl, "utf8");
    expect(source).not.toContain("<kbd>");
  });
});

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const sidepanelCssUrl = new URL(
  "../src/ui/sidepanel.css",
  import.meta.url
);
const sidepanelAppUrl = new URL(
  "../src/ui/sidepanel/SidePanelApp.tsx",
  import.meta.url
);
const bookmarkEditorFieldsUrl = new URL(
  "../src/ui/components/BookmarkEditorFields.tsx",
  import.meta.url
);
const sidepanelHtmlUrl = new URL("../sidepanel.html", import.meta.url);

function rule(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) return "";
  const bodyStart = css.indexOf("{", start) + 1;
  return css.slice(bodyStart, css.indexOf("}", bodyStart));
}

describe("side panel notification layout", () => {
  it("keeps save feedback and errors floating above the list", async () => {
    const [css, source] = await Promise.all([
      readFile(sidepanelCssUrl, "utf8"),
      readFile(sidepanelAppUrl, "utf8")
    ]);
    const inlineNoticeRule = rule(css, ".native-error-layout,\n.native-notice");
    const settingsNoticeRule = rule(css, ".settings-notice");
    const frame = source.slice(
      source.indexOf('className="native-content-frame"'),
      source.indexOf('id="bookmark-list"')
    );

    expect(inlineNoticeRule).toContain("position: absolute");
    expect(inlineNoticeRule).toContain("min-height: var(--control-h-lg)");
    expect(inlineNoticeRule).toContain("box-shadow: var(--shadow-float)");
    expect(inlineNoticeRule).toContain("line-height: 1.45");
    expect(css).toContain(".native-error-layout > span,\n.native-notice > span");
    expect(settingsNoticeRule).toContain("min-height: var(--control-h-sm)");
    expect(settingsNoticeRule).toContain("align-items: center");
    expect(frame).toContain('className="native-notice"');
    expect(frame).toContain('className="native-error-layout"');
  });
});

describe("settings more entry layout", () => {
  it("stays full-width with the same padded title+chevron inset as other rows", async () => {
    const css = await readFile(sidepanelCssUrl, "utf8");
    const more = rule(css, ".settings-more-button");

    expect(more).toContain("width: 100%");
    expect(more).toContain("padding: var(--sp-3)");
    expect(more).toContain("justify-content: space-between");
    expect(more).not.toContain("padding-inline: 0");
    expect(more).not.toMatch(/margin-inline:\s*calc/);
  });
});

describe("side panel startup rendering", () => {
  it("paints the native Chrome tree before the local index finishes importing", async () => {
    const source = await readFile(sidepanelAppUrl, "utf8");
    const refreshStart = source.indexOf("const refresh = useCallback");
    const refreshEnd = source.indexOf(
      "const loadOrganizationNotice = useCallback",
      refreshStart,
    );
    const refresh = source.slice(refreshStart, refreshEnd);
    const nativeRead = refresh.indexOf("readNativeBookmarkSnapshot()");
    const nativePaint = refresh.indexOf("setSnapshot(nextSnapshot)");
    const localIndexRead = refresh.indexOf('type: "GET_LOCAL_RESOURCES"');

    expect(source).toContain("async function readNativeBookmarkSnapshot");
    expect(nativeRead).toBeGreaterThanOrEqual(0);
    expect(nativePaint).toBeGreaterThan(nativeRead);
    expect(localIndexRead).toBeGreaterThan(nativePaint);
  });

  it("keeps a visible boot shell before the React bundle mounts", async () => {
    const [html, source, css] = await Promise.all([
      readFile(sidepanelHtmlUrl, "utf8"),
      readFile(sidepanelAppUrl, "utf8"),
      readFile(sidepanelCssUrl, "utf8"),
    ]);

    expect(html).toContain('class="sidepanel-static-boot"');
    expect(source).toContain('className="sidepanel-boot-screen"');
    expect(css).toContain(".sidepanel-boot-screen {");
    expect(source).toContain("AgentThinkingSteps");
    expect(source).toContain('type: "CANCEL_BOOKMARK_AGENT"');
    expect(source).toContain("StopIcon");
  });

  it("does not mount the AI setup card in the initial library footer", async () => {
    const source = await readFile(sidepanelAppUrl, "utf8");
    const footerStart = source.indexOf("<BookmarkPreviewLayer");
    const footerEnd = source.indexOf("{editor ? (", footerStart);
    const footer = source.slice(footerStart, footerEnd);

    expect(footer).toContain("{aiConfigured ? (");
    expect(footer).not.toContain("configured={aiConfigured}");
  });
});

describe("side panel bookmark review density", () => {
  it("keeps ordinary search free of AI setup actions and trims review-only copy", async () => {
    const source = await readFile(sidepanelAppUrl, "utf8");
    const css = await readFile(sidepanelCssUrl, "utf8");

    expect(source).not.toContain("按回车查看完整排序");
    expect(source).not.toContain("配置 AI 后可以让它帮你找");
    expect(source).not.toContain("agent-history-limit");
    expect(source).toContain('"--tree-depth": `${depth * 24}px`');
    expect(css).toContain(".bookmark-thumbnail {\n  width: 42px;\n  height: 42px;");
    expect(css).toContain(
      ".library-search-result-main .bookmark-thumbnail {\n  width: 42px;\n  height: 42px;",
    );
  });
});

describe("agent progress controls", () => {
  it("keeps the stop control neutral, solid, and spacious", async () => {
    const [css, icons] = await Promise.all([
      readFile(sidepanelCssUrl, "utf8"),
      readFile(new URL("../src/ui/components/Icons.tsx", import.meta.url), "utf8"),
    ]);
    const stop = rule(css, ".agent-stop-button");
    const steps = rule(css, ".agent-thinking-steps");
    const done = rule(
      css,
      '.agent-thinking-step[data-state="done"] .agent-thinking-step-mark',
    );

    expect(stop).toContain("background: var(--ink)");
    expect(stop).not.toContain("var(--negative)");
    expect(icons).toContain('fill="currentColor"');
    expect(icons).toContain('stroke="none"');
    expect(steps).toContain("gap: var(--sp-2)");
    expect(done).toContain("color: var(--ink-muted)");
    expect(done).not.toContain("var(--positive)");
  });

  it("uses backend-confirmed progress and keeps source text in the row", async () => {
    const [css, source] = await Promise.all([
      readFile(sidepanelCssUrl, "utf8"),
      readFile(sidepanelAppUrl, "utf8"),
    ]);

    expect(source).toContain("new Set(progress?.completedStages || [])");
    expect(source).toContain('progress?.stages || ["preparing"]');
    expect(source).toContain("!Array.isArray(event.completedStages)");
    expect(source).toContain("!Array.isArray(event.stages)");
    expect(source).toContain('className="agent-source-button"');
    expect(source).toContain('size="unstyled"');
    expect(css).toContain(
      '.agent-message-sources > .agent-source-button > [data-slot="button-content"] {\n  grid-column: 1 / -1;',
    );
    expect(css).toContain("height: auto;");
  });
});

describe("bookmark editor parity and tree hierarchy", () => {
  it("keeps both editor surfaces on one field component and indents child rows", async () => {
    const [sidepanel, manager, fields, sidepanelCss, managerCss, tokens] =
      await Promise.all([
        readFile(sidepanelAppUrl, "utf8"),
        readFile(new URL("../src/ui/manager/components/LibraryCardEditor.tsx", import.meta.url), "utf8"),
        readFile(bookmarkEditorFieldsUrl, "utf8"),
        readFile(sidepanelCssUrl, "utf8"),
        readFile(new URL("../src/ui/manager.css", import.meta.url), "utf8"),
        readFile(new URL("../src/ui/tokens.css", import.meta.url), "utf8"),
      ]);

    expect(sidepanel).toContain("<BookmarkEditorFields");
    expect(manager).toContain("<BookmarkEditorFields");
    expect(fields).not.toContain("<span>主题</span>");
    expect(fields).not.toContain("<span>自定义标签</span>");
    expect(fields).not.toContain('className="library-card-editor-location"');
    expect(fields).toContain("locations.length > 1");
    expect(sidepanel).toContain('type: "UPDATE_BOOKMARK_DETAILS"');
    expect(sidepanel).toContain('"编辑收藏"');
    expect(sidepanelCss).toContain(
      ".bookmark-row:not([data-folder=\"true\"]) .bookmark-main {\n  height: 68px;\n  min-height: 68px;\n  padding: var(--sp-2) var(--sp-6) var(--sp-2)\n    var(--tree-depth, 0px);",
    );
    expect(sidepanelCss).toContain(
      ".settings-status {\n  padding: var(--sp-1) var(--sp-3);",
    );
    expect(sidepanelCss).toContain(
      ".context-resurfacing > button {",
    );
    expect(sidepanelCss).toContain("  background: var(--surface);\n  text-align: left;");
    expect(managerCss).toContain(".library-card-editor-status");
    expect(tokens).toContain("--cover-action-bg: var(--ink);");
  });
});

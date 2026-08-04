import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const sidepanelCssUrl = new URL("../src/ui/sidepanel.css", import.meta.url);
const lazyCssUrl = new URL("../src/ui/sidepanel-lazy.css", import.meta.url);
const tokensUrl = new URL("../src/ui/tokens.css", import.meta.url);
const headerUrl = new URL("../src/ui/sidepanel/components/LibraryHeader.tsx", import.meta.url);
const aiSettingsUrl = new URL("../src/ui/sidepanel/components/settings/AiServiceSection.tsx", import.meta.url);
const historyUrl = new URL("../src/ui/sidepanel/pages/AgentHistoryPage.tsx", import.meta.url);
const recentUrl = new URL("../src/ui/sidepanel/components/settings/SettingsMoreContent.tsx", import.meta.url);
const fieldsUrl = new URL("../src/ui/components/BookmarkEditorFields.tsx", import.meta.url);
const editorFieldsCssUrl = new URL("../src/ui/editor-fields.css", import.meta.url);
const dialogUrl = new URL("../src/ui/sidepanel/components/BookmarkEditorDialog.tsx", import.meta.url);
const settingsUrl = new URL("../src/ui/sidepanel/pages/SettingsPage.tsx", import.meta.url);
const managerEditorUrl = new URL("../src/ui/manager/components/LibraryCardEditor.tsx", import.meta.url);
const managerCssUrl = new URL("../src/ui/manager.css", import.meta.url);

describe("Round 4 requested UI convergence", () => {
  it("removes the sticky-list top inset and the title account shortcut", async () => {
    const [css, header] = await Promise.all([
      readFile(sidepanelCssUrl, "utf8"),
      readFile(headerUrl, "utf8"),
    ]);
    expect(css).toContain("padding: 0 var(--sp-4) var(--sp-4) var(--sp-2)");
    expect(header).toContain("<h1>我的书签</h1>");
    expect(header).not.toContain("native-title-avatar");
    expect(header).not.toContain("native-title-account");
  });

  it("combines provider and model in one dropdown and freezes it with the key", async () => {
    const source = await readFile(aiSettingsUrl, "utf8");
    expect(source).toContain("<Select");
    expect(source).toContain("disabled={showMaskedKey || Boolean(action)}");
    expect(source).toContain("模型与服务");
    expect(source).not.toContain("TabsSubtle");
    expect(source).not.toContain('type="text" value={model}');
  });

  it("uses whole-row history hover and removes rename", async () => {
    const [source, css] = await Promise.all([
      readFile(historyUrl, "utf8"),
      readFile(lazyCssUrl, "utf8"),
    ]);
    expect(source).not.toContain("改名");
    expect(source).not.toContain("onRename");
    expect(source).toContain('className="bookmark-row"');
    expect(css).toContain(".agent-history-list > .bookmark-row");
    expect(css).not.toContain(".agent-history-list > article:hover");
  });

  it("renders recent actions as tokenized rows instead of permanent cards", async () => {
    const [source, css, tokens] = await Promise.all([
      readFile(recentUrl, "utf8"),
      readFile(lazyCssUrl, "utf8"),
      readFile(tokensUrl, "utf8"),
    ]);
    expect(source).not.toContain("最近的更改");
    expect(source).toContain('className="bookmark-row"');
    expect(css).toContain(".settings-change-list > .bookmark-row");
    expect(css).not.toContain(".settings-change-list article:hover");
    expect(tokens).toContain("--surface-sunken:");
  });

  it("adds tags through an icon-led inline chip and shares quiet danger styling", async () => {
    const [fields, fieldsCss, dialog, dialogCss, managerEditor, managerCss] = await Promise.all([
      readFile(fieldsUrl, "utf8"),
      readFile(editorFieldsCssUrl, "utf8"),
      readFile(dialogUrl, "utf8"),
      readFile(sidepanelCssUrl, "utf8"),
      readFile(managerEditorUrl, "utf8"),
      readFile(managerCssUrl, "utf8"),
    ]);
    expect(fields).toContain("<PlusIcon />");
    expect(fields).toContain('className="tag-chip tag-chip-add"');
    expect(fields).not.toContain("library-card-editor-tag-submit");
    expect(fieldsCss).toContain(".tag-chip-editor");
    expect(fieldsCss).toContain("border: 0");
    expect(fieldsCss).toContain("background: var(--surface-sunken)");
    expect(dialog).toContain('className="editor-delete-action quiet-danger-action"');
    expect(dialog).toContain('variant="ghost"');
    const dialogDeleteStart = dialog.indexOf('className="editor-delete-action');
    const dialogDeleteEnd = dialog.indexOf("</Button>", dialogDeleteStart);
    expect(dialog.slice(dialogDeleteStart, dialogDeleteEnd)).not.toContain("TrashIcon");
    expect(dialogCss).toContain('.delete-confirmation [data-variant="danger"]');
    expect(managerEditor).toContain('className="library-card-editor-delete quiet-danger-action"');
    expect(managerEditor).not.toContain('variant="danger-quiet"');
    const managerDeleteStart = managerEditor.indexOf('className="library-card-editor-delete');
    const managerDeleteEnd = managerEditor.indexOf("</Button>", managerDeleteStart);
    expect(managerEditor.slice(managerDeleteStart, managerDeleteEnd)).not.toContain("TrashIcon");
    expect(managerCss).toContain('.library-card-editor-confirm [data-variant="danger"]');
  });

  it("uses tertiary settings actions for the annotated navigation rows", async () => {
    const source = await readFile(settingsUrl, "utf8");
    expect(source).toContain('<Button variant="tertiary" size="sm" type="button" onClick={onRestartOnboarding}>');
    expect(source).toContain('<Button variant="tertiary" size="sm" asChild>');
  });
});

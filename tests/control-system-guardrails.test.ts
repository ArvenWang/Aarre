import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readAllSources } from "./source-test-utils";

const uiDirectoryUrl = new URL("../src/ui/", import.meta.url);
const sidepanelDirectoryUrl = new URL("../src/ui/sidepanel/", import.meta.url);
const baseCssUrl = new URL("../src/ui/base.css", import.meta.url);
const sidepanelCssUrl = new URL("../src/ui/sidepanel.css", import.meta.url);
const sidepanelLazyCssUrl = new URL("../src/ui/sidepanel-lazy.css", import.meta.url);
const managerCssUrl = new URL("../src/ui/manager.css", import.meta.url);
const editorFieldsCssUrl = new URL("../src/ui/editor-fields.css", import.meta.url);
const stylesCssUrl = new URL("../src/ui/styles.css", import.meta.url);
const tokensCssUrl = new URL("../src/ui/tokens.css", import.meta.url);
const buttonUrl = new URL(
  "../src/ui/components/ui/button.tsx",
  import.meta.url
);
const fluidControlsUrl = new URL(
  "../src/ui/components/ui/input.tsx",
  import.meta.url
);
const cardEditorUrl = new URL(
  "../src/ui/manager/components/LibraryCardEditor.tsx",
  import.meta.url
);
const bookmarkEditorFieldsUrl = new URL(
  "../src/ui/components/BookmarkEditorFields.tsx",
  import.meta.url
);
const sidepanelAppUrl = new URL(
  "../src/ui/sidepanel/SidePanelApp.tsx",
  import.meta.url
);
const homePageUrl = new URL(
  "../src/ui/sidepanel/pages/HomePage.tsx",
  import.meta.url
);
const sidepanelEditorUrl = new URL(
  "../src/ui/sidepanel/components/BookmarkEditorDialog.tsx",
  import.meta.url
);
const sidepanelEditorHookUrl = new URL(
  "../src/ui/sidepanel/hooks/use-bookmark-editor.ts",
  import.meta.url
);
const libraryNoticesUrl = new URL(
  "../src/ui/sidepanel/components/LibraryNotices.tsx",
  import.meta.url
);
const cloudHandlersUrl = new URL(
  "../src/extension/handlers/cloud.ts",
  import.meta.url
);
async function collectTsx(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collectTsx(path)));
    else if (entry.name.endsWith(".tsx")) files.push(path);
  }
  return files;
}

async function projectClassNames(): Promise<Set<string>> {
  const names = new Set<string>();
  for (const file of await readdir(uiDirectoryUrl)) {
    if (!file.endsWith(".css")) continue;
    const css = await readFile(
      join(uiDirectoryUrl.pathname, file),
      "utf8"
    );
    for (const match of css.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) {
      names.add(match[1]);
    }
  }
  return names;
}

function rule(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) return "";
  const bodyStart = css.indexOf("{", start) + 1;
  return css.slice(bodyStart, css.indexOf("}", bodyStart));
}

describe("destructive actions are visibly destructive", () => {
  it("paints the confirm button with the negative token, not ink", async () => {
    const source = await readFile(buttonUrl, "utf8");
    expect(source).toContain('"text-danger-foreground bg-danger');
    expect(source).not.toContain('danger: "text-foreground');
  });

  it("offers a quiet destructive entry point that is still red", async () => {
    const source = await readFile(buttonUrl, "utf8");
    expect(source).toContain('"text-danger border border-danger/35 bg-transparent');
  });

  it("exposes danger variants on the shared Button component", async () => {
    const [source, styles] = await Promise.all([
      readFile(buttonUrl, "utf8"),
      readFile(stylesCssUrl, "utf8")
    ]);

    expect(source).toContain("danger:");
    expect(source).toContain('"danger-quiet":');
    // The Tailwind danger palette must resolve back to the same token the
    // legacy CSS uses, or the two systems drift apart again.
    expect(styles).toContain("--color-danger: var(--negative)");
  });
});

describe("cloud settings stay local-first", () => {
  it("keeps legacy settings compatible without restoring the removed sync toggle or scope", async () => {
    const source = await readFile(cloudHandlersUrl, "utf8");
    const handler = source.slice(
      source.indexOf("SAVE_CLOUD_SETTINGS:"),
      source.indexOf("GET_CLOUD_USAGE:")
    );

    expect(handler).toContain("saveCloudSyncSettings({ enabled: true })");
    expect(handler).toContain('requestSync("cloud-settings")');
    expect(handler).not.toContain("request.payload");
    expect(handler).not.toContain("scope");
  });

  it("returns from sign-in before starting the potentially large restore", async () => {
    const source = await readFile(cloudHandlersUrl, "utf8");
    const handler = source.slice(
      source.indexOf("SIGN_IN_CLOUD:"),
      source.indexOf("SIGN_OUT_CLOUD:")
    );

    expect(handler).toContain('requestSync("sign-in")');
    expect(handler).not.toContain('await sync("sign-in")');
    expect(handler).toContain("return getAppState();");
  });
});

describe("only one system paints a given control", () => {
  it("does not expose the removed unstyled paint escape hatch", async () => {
    const source = await readFile(buttonUrl, "utf8");
    const base = source.slice(
      source.indexOf("const buttonVariants = cva("),
      source.indexOf("variants: {")
    );
    const variants = source.slice(
      source.indexOf("variant: {"),
      source.indexOf("size: {")
    );

    expect(variants).not.toContain("unstyled:");
    // No press-scale anywhere: on a wide list row a 2% scale reads as the
    // whole entry collapsing sideways, and the same displacement shows up on
    // every other control that inherited it.
    expect(base).not.toContain("active:scale-");
    expect(variants).not.toContain("active:scale-");
    expect(source).not.toContain("active:scale-");
  });

  it("lets project CSS own the resurfacing row's padding and hover fill", async () => {
    const [source, css] = await Promise.all([
      readFile(libraryNoticesUrl, "utf8"),
      readFile(sidepanelCssUrl, "utf8")
    ]);
    const row = source.slice(
      source.indexOf("{resurfacing.map"),
      source.indexOf("</section>", source.indexOf("{resurfacing.map"))
    );

    expect(row).toContain('variant="ghost"');
    expect(rule(css, ".context-resurfacing > button")).toContain(
      "padding: var(--sp-2) var(--sp-3)"
    );
    expect(rule(css, ".context-resurfacing > button:hover")).toContain(
      "background: var(--surface)"
    );
  });

  it("keeps every Button on the unified variant system", async () => {
    await projectClassNames();
    const offenders: string[] = [];

    for (const file of await collectTsx(uiDirectoryUrl.pathname)) {
      const source = await readFile(file, "utf8");
      for (const match of source.matchAll(/<Button\b([\s\S]*?)>/g)) {
        const attributes = match[1];
        if (/variant="unstyled"/.test(attributes))
          offenders.push(`${file.split("/src/")[1]}: unstyled`);
        const classes = attributes.match(/className="([^"]*)"/)?.[1].split(/\s+/) || [];
        if (classes.some((name) => /^button(?:-|$)/.test(name)))
          offenders.push(`${file.split("/src/")[1]}: legacy button class`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it("does not wrap composed children in the text-trim span", async () => {
    const source = await readFile(buttonUrl, "utf8");
    const label = source.slice(source.indexOf('data-slot="button-label"') - 400);

    // The trim span is a plain inline box, so wrapping an icon plus a label in
    // it stacks them instead of laying them out along the button's flex row.
    expect(label).toContain('typeof label === "string"');
  });

  it("focuses form fields by darkening the border, never with an accent ring", async () => {
    const source = await readFile(fluidControlsUrl, "utf8");

    // An accent ring around every focused field reads as a green selection
    // frame. Form fields only deepen their own border.
    expect(source).toContain("focus:border-[color:var(--line-strong)]");
    expect(source).not.toContain("focus-visible:ring");
    expect(source).not.toContain("focus:ring");
    expect(source).not.toContain("var(--focus-ring)");
    expect(source).not.toContain("var(--accent)");
  });

  it("does not mix the ghost hover paint into CSS-owned tag submit buttons", async () => {
    const [sidepanel, editor, fields, managerCss] = await Promise.all([
      readFile(sidepanelEditorUrl, "utf8"),
      readFile(cardEditorUrl, "utf8"),
      readFile(bookmarkEditorFieldsUrl, "utf8"),
      Promise.all([readFile(managerCssUrl, "utf8"), readFile(editorFieldsCssUrl, "utf8")]).then((parts) => parts.join("\n"))
    ]);

    expect(sidepanel).toContain("<BookmarkEditorFields");
    expect(editor).toContain("<BookmarkEditorFields");
    expect(fields).toContain('variant="ghost"');
    expect(fields).toContain('className="library-card-editor-tag-submit"');
    expect(
      rule(managerCss, ".library-card-editor-tag-submit:not(:disabled):hover")
    ).toContain("background:");
  });
});

describe("pickers use one dropdown, not two", () => {
  it("builds the card editor's folder picker from the shared Select", async () => {
    const [editor, fields] = await Promise.all([
      readFile(cardEditorUrl, "utf8"),
      readFile(bookmarkEditorFieldsUrl, "utf8")
    ]);

    expect(editor).toContain("<BookmarkEditorFields");
    expect(editor).not.toContain("FluidSelect");
    expect(fields).toContain("editor-select-trigger");
    expect(fields).toContain("SelectContent");
  });

  it("defines the removable tag chip once for both surfaces", async () => {
    const [base, sidepanel, manager] = await Promise.all([
      readFile(baseCssUrl, "utf8"),
      Promise.all([readFile(sidepanelCssUrl, "utf8"), readFile(sidepanelLazyCssUrl, "utf8")]).then((parts) => parts.join("\n")),
      readFile(managerCssUrl, "utf8")
    ]);

    expect(rule(base, ".tag-chip")).toContain(
      "min-height: var(--control-h-xs)"
    );
    expect(rule(base, ".tag-chip-remove")).toContain(
      "width: var(--control-h-2xs)"
    );
    expect(sidepanel).not.toContain(".editable-tag-list > span button");
    expect(manager).not.toContain(
      ".library-card-editor-tags > div:nth-child(2) > span button"
    );
  });
});

describe("overlays darken the page in both themes", () => {
  it("mixes scrims and shadows from a fixed dark ink, never from --ink", async () => {
    const tokens = await readFile(tokensCssUrl, "utf8");
    const styles = await readFile(stylesCssUrl, "utf8");

    // --ink inverts for the dark theme, so a scrim mixed from it brightens the
    // page it is supposed to dim.
    expect(tokens).toContain("--shade:");
    for (const css of [tokens, styles]) {
      expect(css).not.toMatch(/--scrim[\w-]*:[^;]*var\(--ink\)/);
      expect(css).not.toMatch(/--shadow-[\w-]*:[^;]*var\(--ink\)/);
    }
  });

  it("routes every modal backdrop through the same scrim token", async () => {
    const [sidepanel, manager] = await Promise.all([
      Promise.all([readFile(sidepanelCssUrl, "utf8"), readFile(sidepanelLazyCssUrl, "utf8")]).then((parts) => parts.join("\n")),
      readFile(managerCssUrl, "utf8")
    ]);

    const painted: string[] = [];
    for (const css of [sidepanel, manager]) {
      for (const backdrop of css.matchAll(/\.[\w-]*backdrop\s*\{([^}]*)\}/g)) {
        const background = backdrop[1].match(/background:([^;]*);/)?.[1];
        if (background) painted.push(background.trim());
      }
    }

    expect(painted.length).toBe(4);
    expect(painted.every((value) => value === "var(--scrim-modal)")).toBe(true);
  });
});

describe("focus is indicated exactly once", () => {
  it("lets the shared Button draw its own ring instead of stacking two", async () => {
    const css = await readFile(baseCssUrl, "utf8");

    expect(rule(css, "button:focus-visible,\na:focus-visible")).toContain(
      "outline: 2px solid var(--focus-ring)"
    );
    expect(rule(css, 'button[data-slot="button"]:focus-visible')).toContain(
      "outline: 0"
    );
  });

  it("keeps focus chrome cool-neutral, never the accent green", async () => {
    const [tokens, styles, shape, select] = await Promise.all([
      readFile(tokensCssUrl, "utf8"),
      readFile(stylesCssUrl, "utf8"),
      readFile(new URL("../src/lib/shape-context.tsx", import.meta.url), "utf8"),
      readFile(new URL("../src/ui/components/ui/select.tsx", import.meta.url), "utf8"),
    ]);

    expect(tokens).toMatch(/--focus-ring:\s*color-mix/);
    expect(tokens).not.toMatch(/--focus-ring:\s*var\(--accent\)/);
    expect(styles).not.toMatch(/--focus-ring:\s*var\(--accent\)/);
    expect(styles).toContain("--color-ring: var(--focus-ring)");
    // Menu shell is concentric and one step below search/card softness:
    // outer md (14), inner nested-md (10). lg/xl belong to covers and search.
    expect(shape).toContain('container: "rounded-[var(--radius-module)]"');
    expect(shape).toContain('bg: "rounded-[var(--radius-inset-module)]"');
    expect(shape).toContain('button: "rounded-[var(--radius-control)]"');
    expect(shape).not.toContain('container: "rounded-[var(--radius-xl)]"');
    expect(shape).not.toContain('container: "rounded-[var(--radius-lg)]"');
    // Highlights mount on a known row rect so they never spring from 0×0.
    // Pointer feedback is a fill only — no focus-ring stroke around the row.
    expect(select).toContain("open && checkedRect");
    expect(select).toContain("open && activeRect");
    expect(select).not.toContain("focusRect");
    expect(select).not.toContain("border-[color:var(--focus-ring)]");
  });
});

describe("nested surfaces use a tokenized radius ladder", () => {
  it("keeps shell, module, inset and control tiers explicit", async () => {
    const [tokens, base, shape, sidepanel, manager] = await Promise.all([
      readFile(tokensCssUrl, "utf8"),
      readFile(baseCssUrl, "utf8"),
      readFile(new URL("../src/lib/shape-context.tsx", import.meta.url), "utf8"),
      Promise.all([readFile(sidepanelCssUrl, "utf8"), readFile(sidepanelLazyCssUrl, "utf8")]).then((parts) => parts.join("\n")),
      readFile(managerCssUrl, "utf8"),
    ]);

    expect(tokens).toContain("--radius-shell: var(--radius-lg)");
    expect(tokens).toContain("--radius-module: var(--radius-md)");
    expect(tokens).toContain("--radius-control: var(--radius-sm)");
    expect(tokens).toContain("--radius-inset-module: var(--radius-nested-md)");
    expect(tokens).toContain("--control-h-button: 30px");
    expect(base).not.toContain(".button {");
    expect(shape).toContain('button: "rounded-[var(--radius-control)]"');
    expect(sidepanel).toContain(
      '.organization-notice-banner [data-slot="button"] {\n  border-radius: var(--radius-control);',
    );
    expect(sidepanel).toContain(
      '.settings-change-list article [data-slot="button"] {\n  border-radius: var(--radius-control);',
    );
    expect(manager).toContain("border-radius: var(--radius-shell)");
  });
});

describe("elevated surfaces keep a faint edge", () => {
  it("draws the same hairline Card uses, not shadow alone", async () => {
    const elevated = await readFile(
      new URL("../src/lib/elevated.tsx", import.meta.url),
      "utf8"
    );

    expect(elevated).toContain("border border-border/60");
  });
});

describe("status notices float above the list", () => {
  it("keeps sidepanel notices inside the content frame as elevated overlays", async () => {
    const [source, css] = await Promise.all([
      readFile(homePageUrl, "utf8"),
      Promise.all([readFile(sidepanelCssUrl, "utf8"), readFile(sidepanelLazyCssUrl, "utf8")]).then((parts) => parts.join("\n"))
    ]);
    const frame = source.slice(
      source.indexOf('className="native-content-frame"'),
      source.indexOf('id="bookmark-list"')
    );
    const notice = rule(css, ".native-error-layout,\n.native-notice");

    // A document-flow strip with the same sunken fill as the list reads as
    // one fused block; the notice must sit above the scroll surface instead.
    expect(frame).toContain('className="native-notice"');
    expect(frame).toContain("native-error-layout");
    expect(notice).toContain("position: absolute");
    expect(notice).toContain("box-shadow: var(--shadow-float)");
    expect(notice).toContain("background: var(--surface)");
  });
});

describe("the AI section explains itself through its own labels", () => {
  it("drops the paragraph that restated the field names", async () => {
    const [allSidepanelSources, css] = await Promise.all([
      readAllSources(sidepanelDirectoryUrl),
      Promise.all([readFile(sidepanelCssUrl, "utf8"), readFile(sidepanelLazyCssUrl, "utf8")]).then((parts) => parts.join("\n"))
    ]);

    expect(allSidepanelSources).not.toContain("主题是 AI 归纳的内容方向");
    expect(css).not.toContain("edit-ai-hint");
  });
});

describe("delete confirmation does not move the card", () => {
  it("locks the confirmation row to one control height", async () => {
    const css = (await Promise.all([readFile(sidepanelCssUrl, "utf8"), readFile(sidepanelLazyCssUrl, "utf8")])).join("\n");
    const confirmation = rule(css, ".delete-confirmation");

    expect(confirmation).toContain("min-height: var(--control-h-lg)");
    expect(confirmation).toContain("align-items: center");
  });

  it("keeps the normal action row at the same height as the confirm row", async () => {
    const css = (await Promise.all([readFile(sidepanelCssUrl, "utf8"), readFile(sidepanelLazyCssUrl, "utf8")])).join("\n");
    const actions = rule(css, ".native-dialog-actions");

    expect(actions).toContain("min-height: var(--control-h-lg)");
    expect(css).toContain(
      ".native-dialog-actions > div:not(.delete-confirmation)",
    );
    expect(css).toContain("gap: var(--sp-2)");
  });

  it("clears the busy flag when the editor opens so no grey state survives", async () => {
    const source = await readFile(sidepanelEditorHookUrl, "utf8");
    const startEdit = source.slice(source.indexOf("function startEdit"));

    expect(startEdit.slice(0, 600)).toContain('setBusy("")');
  });
});

describe("library cards are a single click target", () => {
  it("stretches the title link across the whole card", async () => {
    const css = await readFile(managerCssUrl, "utf8");
    const overlay = rule(css, ".library-card-link::after");

    expect(overlay).toContain("position: absolute");
    expect(overlay).toContain("inset: 0");
  });

  it("keeps the editor button above the click overlay", async () => {
    const css = await readFile(managerCssUrl, "utf8");
    const overlayZ = Number(
      rule(css, ".library-card-link::after").match(/z-index:\s*(\d+)/)?.[1]
    );
    const editorZ = Number(
      rule(css, ".library-card-editor-trigger").match(/z-index:\s*(\d+)/)?.[1]
    );

    expect(overlayZ).toBeGreaterThan(0);
    expect(editorZ).toBeGreaterThan(overlayZ);
  });

  it("lays the settings 'more' entry out as one row", async () => {
    const css = (await Promise.all([readFile(sidepanelCssUrl, "utf8"), readFile(sidepanelLazyCssUrl, "utf8")])).join("\n");
    const entry = rule(css, ".settings-more-button");

    expect(entry).toContain("justify-content: space-between");
    // A button shrinks to its content even as a flex container, so without an
    // explicit width space-between has nothing to push the chevron against.
    expect(entry).toContain("width: 100%");
    expect(entry).toContain("min-height: var(--control-h-touch)");
    expect(rule(css, '.settings-more-button > [data-slot="button-content"]')).toContain(
      "display: contents"
    );
  });

  it("gives the card a keyboard focus ring", async () => {
    const css = await readFile(managerCssUrl, "utf8");

    expect(rule(css, ".library-card-link:focus-visible::after")).toContain(
      "outline"
    );
  });

  it("does not outline the cover, which only ever showed on straight edges", async () => {
    const css = await readFile(managerCssUrl, "utf8");

    expect(rule(css, ".library-card-cover")).not.toContain("border:");
  });
});

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("manager and side-panel coexistence", () => {
  it("lets Chrome open the side panel without closing either surface", async () => {
    const [source, handlers, contextMenus] = await Promise.all([
      readFile(new URL("../src/extension/background.ts", import.meta.url), "utf8"),
      readFile(new URL("../src/extension/handlers/index.ts", import.meta.url), "utf8"),
      readFile(new URL("../src/extension/lifecycle/context-menu-core.ts", import.meta.url), "utf8")
    ]);

    expect(contextMenus).toContain("openPanelOnActionClick: true");
    expect(source).not.toContain("chrome.action.onClicked.addListener");
    expect(source).not.toContain("chrome.sidePanel.close");
    expect(source).not.toContain("closeManagerTabs");
    expect(source).not.toContain("coordinateManagerTabSidePanel");
    expect(handlers).toContain("return actions.openManagerPage(");
  });

  it("does not require the newer sidePanel.close API", async () => {
    const manifest = JSON.parse(
      await readFile(
        new URL("../public/manifest.json", import.meta.url),
        "utf8",
      ),
    ) as { minimum_chrome_version?: string };

    expect(manifest.minimum_chrome_version).toBe("134");
  });
});

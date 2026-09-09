import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { readAllSources } from "./source-test-utils";

const extensionDirectory = new URL("../src/extension/", import.meta.url);

describe("manager and floating-menu coexistence", () => {
  it("uses the floating action and removes the obsolete side-panel entry", async () => {
    const [allExtensionSources, handlers, contextMenus] = await Promise.all([
      readAllSources(extensionDirectory),
      readFile(new URL("../src/extension/handlers/index.ts", import.meta.url), "utf8"),
      readFile(new URL("../src/extension/lifecycle/context-menu-core.ts", import.meta.url), "utf8")
    ]);

    expect(contextMenus).not.toContain("chrome.sidePanel");
    const manifest = JSON.parse(await readFile(new URL("../public/manifest.json", import.meta.url), "utf8"));
    expect(manifest.permissions).not.toContain("sidePanel");
    expect(manifest.side_panel).toBeUndefined();
    expect(allExtensionSources).toContain("chrome.action.onClicked.addListener");
    expect(allExtensionSources).not.toContain("chrome.sidePanel.close");
    expect(allExtensionSources).not.toContain("closeManagerTabs");
    expect(allExtensionSources).not.toContain("coordinateManagerTabSidePanel");
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

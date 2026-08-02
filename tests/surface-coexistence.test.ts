import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("manager and side-panel coexistence", () => {
  it("lets Chrome open the side panel without closing either surface", async () => {
    const source = await readFile(
      new URL("../src/extension/background.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("openPanelOnActionClick: true");
    expect(source).not.toContain("chrome.action.onClicked.addListener");
    expect(source).not.toContain("chrome.sidePanel.close");
    expect(source).not.toContain("closeManagerTabs");
    expect(source).not.toContain("coordinateManagerTabSidePanel");
    expect(source).toContain("return openManagerPage(");
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

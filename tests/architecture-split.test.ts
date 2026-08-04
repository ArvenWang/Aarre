import { readFile } from "node:fs/promises";
import { relative } from "node:path";
import { describe, expect, it } from "vitest";
import { sourceFiles } from "./source-test-utils";

const projectRoot = new URL("../", import.meta.url);
const extensionBackground = new URL(
  "../src/extension/background.ts",
  import.meta.url,
);
const sidepanelDirectory = new URL("../src/ui/sidepanel/", import.meta.url);
const viteConfig = new URL("../vite.config.ts", import.meta.url);
const backgroundViteConfig = new URL(
  "../vite.background.config.ts",
  import.meta.url,
);

function lineCount(source: string): number {
  return source.replace(/\n$/, "").split(/\r?\n/).length;
}

describe("T-06/T-07 architecture limits", () => {
  it("keeps the MV3 background entry below 400 lines", async () => {
    const source = await readFile(extensionBackground, "utf8");
    expect(lineCount(source)).toBeLessThan(400);
    expect(source).toContain("initializeBackground();");
  });

  it("builds MV3 background separately without unsupported dynamic imports", async () => {
    const [pageSource, backgroundSource] = await Promise.all([
      readFile(viteConfig, "utf8"),
      readFile(backgroundViteConfig, "utf8"),
    ]);
    expect(pageSource).not.toContain('background: resolve(__dirname');
    expect(backgroundSource).toContain("codeSplitting: false");
    expect(backgroundSource).toContain('fileName: () => "background.js"');
    expect(backgroundSource).toContain('formats: ["es"]');
  });

  it("keeps every side-panel TypeScript module at or below 500 lines", async () => {
    const oversized: string[] = [];
    for (const file of await sourceFiles(sidepanelDirectory)) {
      const count = lineCount(await readFile(file, "utf8"));
      if (count > 500) {
        oversized.push(`${relative(projectRoot.pathname, file)}: ${count}`);
      }
    }
    expect(oversized).toEqual([]);
  });
});

import { access, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const managerAppUrl = new URL("../src/ui/manager/ManagerApp.tsx", import.meta.url);
const managerTypesUrl = new URL("../src/ui/manager/types.ts", import.meta.url);
const libraryInsightsUrl = new URL("../src/lib/library-insights.ts", import.meta.url);
const libraryTypesUrl = new URL("../src/lib/types.ts", import.meta.url);
const messagesUrl = new URL("../src/lib/messages.ts", import.meta.url);
const previewUrl = new URL("../src/ui/sidepanel/preview-message-data.ts", import.meta.url);
const readingViewUrl = new URL("../src/ui/manager/views/ReadingView.tsx", import.meta.url);

describe("removed organization surfaces stay removed", () => {
  it("does not expose or calculate a reading queue", async () => {
    const source = (
      await Promise.all([
        readFile(managerAppUrl, "utf8"),
        readFile(managerTypesUrl, "utf8"),
        readFile(libraryInsightsUrl, "utf8"),
        readFile(libraryTypesUrl, "utf8"),
        readFile(messagesUrl, "utf8"),
        readFile(previewUrl, "utf8"),
      ])
    ).join("\n");

    expect(source).not.toContain("readingQueue");
    expect(source).not.toContain("待读队列");
    expect(source).not.toContain('"reading"');
    await expect(access(readingViewUrl)).rejects.toThrow();
  });

  it("does not generate topic classification proposals", async () => {
    const source = (
      await Promise.all([
        readFile(libraryInsightsUrl, "utf8"),
        readFile(libraryTypesUrl, "utf8"),
        readFile(previewUrl, "utf8"),
      ])
    ).join("\n");

    expect(source).not.toContain('kind: "classify"');
    expect(source).not.toContain("classificationProposals");
    expect(source).not.toContain("主题分布");
    expect(source).not.toContain("归到一起");
  });
});

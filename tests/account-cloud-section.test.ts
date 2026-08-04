import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("account cloud section structure", () => {
  it("keeps avatar and identity styles on explicit stable classes", async () => {
    const source = await readFile(
      new URL(
        "../src/ui/sidepanel/components/settings/AccountCloudSection.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    expect(source).toContain('className="settings-account-avatar"');
    expect(source).toContain('className="settings-account-identity"');
    expect(source.indexOf("<CloudStatusRow")).toBeGreaterThan(
      source.indexOf('className="settings-account-identity"'),
    );
    expect(source).not.toContain("settings-account-row > div");
  });
});

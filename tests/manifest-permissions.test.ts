import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("commercial enhancement permissions", () => {
  it("declares persistent web access required by native Chrome bookmarks", async () => {
    const manifest = JSON.parse(
      await readFile(
        new URL("../public/manifest.json", import.meta.url),
        "utf8"
      )
    ) as {
      host_permissions?: string[];
      optional_host_permissions?: string[];
    };

    expect(manifest.host_permissions).toEqual(["<all_urls>"]);
    expect(manifest.optional_host_permissions || []).not.toEqual(
      expect.arrayContaining(["<all_urls>"])
    );
    expect(
      (manifest as { permissions?: string[] }).permissions
    ).toContain("webNavigation");
  });
});

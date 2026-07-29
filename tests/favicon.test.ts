import { describe, expect, it } from "vitest";
import {
  aarreIconUrl,
  chromeFaviconUrl,
  siteIconCandidates
} from "../src/lib/favicon";

const resolveExtensionUrl = (path: string) =>
  `chrome-extension://example-extension${path}`;

describe("chromeFaviconUrl", () => {
  it("builds the official Manifest V3 favicon service URL", () => {
    const result = new URL(
      chromeFaviconUrl(
        "https://example.com/articles?id=1",
        48,
        resolveExtensionUrl
      )
    );

    expect(result.href).toMatch(
      /^chrome-extension:\/\/example-extension\/_favicon\//
    );
    expect(result.pathname).toBe("/_favicon/");
    expect(result.searchParams.get("pageUrl")).toBe(
      "https://example.com/articles?id=1"
    );
    expect(result.searchParams.get("size")).toBe("48");
    expect(result.searchParams.get("scaleFactor")).toBe("2x");
    expect(
      result.searchParams.get("forceEmptyDefaultFavicon")
    ).toBe("1");
  });
});

describe("siteIconCandidates", () => {
  it("prefers the captured icon, keeps Chrome's cache, and ends with Aarre", () => {
    const candidates = siteIconCandidates(
      "https://example.com/docs",
      "https://cdn.example.com/icon.png",
      32,
      resolveExtensionUrl
    );

    expect(candidates[0]).toBe("https://cdn.example.com/icon.png");
    expect(candidates[1]).toContain("/_favicon/");
    expect(candidates.at(-1)).toBe(
      "chrome-extension://example-extension/icons/icon.svg"
    );
  });

  it("uses the site root favicon and Aarre fallback outside the extension runtime", () => {
    expect(
      siteIconCandidates("https://example.com/docs", "", 32, undefined)
    ).toEqual([
      "https://example.com/favicon.ico",
      "/icons/icon.svg"
    ]);
  });

  it("resolves the branded fallback inside the extension", () => {
    expect(aarreIconUrl(resolveExtensionUrl)).toBe(
      "chrome-extension://example-extension/icons/icon.svg"
    );
  });
});

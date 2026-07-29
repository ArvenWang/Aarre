import { describe, expect, it } from "vitest";
import { canonicalizeUrl, isSupportedPageUrl } from "../src/lib/url";

describe("canonicalizeUrl", () => {
  it("removes known tracking parameters and sorts the rest", () => {
    expect(
      canonicalizeUrl(
        "https://Example.com:443/docs/?utm_source=newsletter&b=2&a=1#intro"
      )
    ).toBe("https://example.com/docs?a=1&b=2");
  });

  it("uses the declared canonical URL", () => {
    expect(
      canonicalizeUrl(
        "https://example.com/article?ref_src=email",
        "/canonical-article"
      )
    ).toBe("https://example.com/canonical-article");
  });

  it("preserves hash-based application routes", () => {
    expect(canonicalizeUrl("https://example.com/app#/project/42")).toBe(
      "https://example.com/app#/project/42"
    );
  });

  it("rejects non-web canonical schemes", () => {
    expect(
      canonicalizeUrl("https://example.com/article", "data:text/plain,wrong")
    ).toBe("https://example.com/article");
  });
});

describe("isSupportedPageUrl", () => {
  it("allows normal web pages only", () => {
    expect(isSupportedPageUrl("https://example.com")).toBe(true);
    expect(isSupportedPageUrl("http://localhost:3000")).toBe(true);
    expect(isSupportedPageUrl("chrome://bookmarks")).toBe(false);
    expect(isSupportedPageUrl("file:///tmp/private.html")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import {
  categoryCoverForResource,
  categoryCoverUrl,
  coverBrightnessForHost,
  listCoverPipeline,
  matchCoverRule,
  recordPageImageSample,
  registrableHost,
  resolveRuleAsset
} from "../src/lib/cover-registry";
import { COVER_RULES } from "../src/lib/cover-rules";

describe("cover registry", () => {
  it("resolves structured YouTube covers without scraping HTML", () => {
    const url = "https://www.youtube.com/watch?v=abc123";
    expect(matchCoverRule(url)?.id).toBe("youtube");
    expect(listCoverPipeline(url)).toBe("page-image");
    expect(resolveRuleAsset(url, "pageImage")).toBe(
      "https://i.ytimg.com/vi/abc123/maxresdefault.jpg"
    );
  });

  it("assigns document and semantic category fallbacks", () => {
    expect(
      categoryCoverForResource({
        url: "https://docs.google.com/spreadsheets/d/1",
        title: "Budget",
        topics: [],
        tags: [],
        summary: ""
      })
    ).toBe("data-chart");
    expect(
      categoryCoverForResource({
        url: "https://example.com/article",
        title: "模型训练实践",
        topics: ["机器学习"],
        tags: [],
        summary: ""
      })
    ).toBe("ai-automation");
  });

  it("ships a real asset for every fallback and varies brightness deterministically", () => {
    expect(categoryCoverUrl("education-science")).toContain(
      "education-science-v3"
    );
    expect(categoryCoverUrl("missing")).toContain("generic-webpage");
    expect(coverBrightnessForHost("example.com")).toBe(
      coverBrightnessForHost("example.com")
    );
    expect(
      coverBrightnessForHost("https://example.com/one")
    ).toBe(coverBrightnessForHost("https://example.com/two"));
    expect(coverBrightnessForHost("example.com")).toBeGreaterThanOrEqual(0.94);
    expect(coverBrightnessForHost("example.com")).toBeLessThanOrEqual(1.06);
  });

  it("falls back from subdomains to a practical registrable host", () => {
    expect(registrableHost("docs.github.com")).toBe("github.com");
    expect(registrableHost("a.b.example.co.uk")).toBe("example.co.uk");
  });

  it("marks the same page image on three resources as a common banner", () => {
    let samples: Record<string, string[]> = {};
    for (const key of ["one", "two", "three"]) {
      const next = recordPageImageSample(
        samples,
        "https://example.com/banner.png",
        key
      );
      samples = next.samples;
      expect(next.isCommonBanner).toBe(key === "three");
    }
  });

  it("matches every declared host to its own tested rule", () => {
    for (const rule of COVER_RULES) {
      for (const host of rule.hosts) {
        expect(
          matchCoverRule(`https://${host}/`)?.id,
          `${host} should match ${rule.id}`
        ).toBe(rule.id);
      }
      expect(
        Boolean(
          rule.brandAsset ||
            rule.categoryCoverId ||
            rule.pageImage
        ),
        `${rule.id} must provide a real cover outcome`
      ).toBe(true);
    }
  });
});

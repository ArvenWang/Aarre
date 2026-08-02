import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  AARRE_FALLBACK_COVER_IDS,
  aarreFallbackCoverId,
  CATEGORY_COVER_BACKGROUNDS,
  CATEGORY_COVER_FILES,
  categoryCoverForResource,
  categoryCoverBackground,
  categoryCoverUrl,
  coverBrightnessForHost,
  listCoverPipeline,
  matchCoverRule,
  pinnedBrandAssetNeedsRefresh,
  recordPageImageSample,
  registrableHost,
  resolveRuleAsset,
  stableFallbackCoverId
} from "../src/lib/cover-registry";
import { COVER_RULES } from "../src/lib/cover-rules";
import { bundledPinnedBrandIcon } from "../src/lib/bundled-brand-icons";

describe("cover registry", () => {
  it.each([
    "https://github.com/signerlabs/ShipSwift",
    "https://www.github.com/signerlabs/ShipSwift",
    "https://gist.github.com/example/123456"
  ])("pins GitHub hosts to the official vector favicon: %s", (url) => {
    expect(matchCoverRule(url)).toMatchObject({
      id: "github",
      pinBrandAsset: true
    });
    expect(listCoverPipeline(url)).toBe("site-brand");
    expect(resolveRuleAsset(url, "brandAsset")).toBe(
      "https://github.githubassets.com/favicons/favicon.svg"
    );
    expect(
      pinnedBrandAssetNeedsRefresh(
        url,
        "https://github.com/apple-touch-icon-180x180.png"
      )
    ).toBe(true);
    expect(
      pinnedBrandAssetNeedsRefresh(
        url,
        "https://github.githubassets.com/favicons/favicon.svg"
      )
    ).toBe(false);
  });

  it("does not invalidate non-pinned site-brand caches", () => {
    expect(
      pinnedBrandAssetNeedsRefresh(
        "https://www.youtube.com/watch?v=abc123",
        "https://www.youtube.com/apple-touch-icon.png"
      )
    ).toBe(false);
  });

  it("bundles the pinned GitHub mark so cache repair does not depend on remote SVG decoding", async () => {
    const bundled = bundledPinnedBrandIcon(
      "https://github.com/signerlabs/ShipSwift"
    );

    expect(bundled).toMatchObject({
      assetUrl: "https://github.githubassets.com/favicons/favicon.svg",
      nativeWidth: 32,
      nativeHeight: 32
    });
    expect(bundled?.dataUrl).toMatch(/^data:image\/webp;base64,/);
    const encoded = bundled?.dataUrl.split(",", 2)[1] || "";
    const { data, info } = await sharp(Buffer.from(encoded, "base64"))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const pixel = (x: number, y: number) =>
      [...data.subarray((y * info.width + x) * 4, (y * info.width + x) * 4 + 4)];
    expect(info).toMatchObject({ width: 192, height: 192, channels: 4 });
    expect(pixel(0, 0)[3]).toBe(0);
    expect(pixel(8, 96)).toEqual([36, 41, 46, 255]);
    expect(pixel(96, 96)[3]).toBe(0);
    expect(
      bundledPinnedBrandIcon("https://www.youtube.com/watch?v=abc123")
    ).toBeUndefined();
  });

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

  it("ships and exposes all 40 local Aarre fallback covers", () => {
    expect(AARRE_FALLBACK_COVER_IDS).toHaveLength(40);
    expect(AARRE_FALLBACK_COVER_IDS).toEqual(
      Object.keys(CATEGORY_COVER_FILES).sort()
    );
    for (const id of AARRE_FALLBACK_COVER_IDS) {
      expect(categoryCoverUrl(id), `${id} should resolve`).toContain(
        CATEGORY_COVER_FILES[id]
      );
      expect(CATEGORY_COVER_BACKGROUNDS[id], `${id} should have a base color`).toMatch(
        /^#[0-9A-F]{6}$/i
      );
      expect(categoryCoverBackground(id)).toBe(CATEGORY_COVER_BACKGROUNDS[id]);
    }
    expect(categoryCoverBackground("missing")).toBe(
      CATEGORY_COVER_BACKGROUNDS["generic-webpage"]
    );
  });

  it("keeps a reliable semantic fallback before stable hash distribution", () => {
    expect(
      aarreFallbackCoverId({
        canonicalUrl: "https://example.com/reference",
        url: "https://example.com/reference",
        title: "Reference",
        topics: [],
        tags: [],
        summary: "",
        categoryCoverId: "documentation-api"
      })
    ).toBe("documentation-api");
    expect(
      aarreFallbackCoverId({
        canonicalUrl: "https://example.com/model",
        url: "https://example.com/model",
        title: "模型训练实践",
        topics: ["机器学习"],
        tags: [],
        summary: "",
        categoryCoverId: "generic-webpage"
      })
    ).toBe("ai-automation");
  });

  it("assigns unknown pages deterministically by canonical URL", () => {
    const canonical = "https://example.com/article?a=1&b=2";
    const first = stableFallbackCoverId(
      "https://EXAMPLE.com/article/?b=2&utm_source=test&a=1"
    );
    expect(first).toBe(stableFallbackCoverId(canonical));
    expect(first).toBe(stableFallbackCoverId(canonical));

    const assigned = new Set(
      Array.from({ length: 2_000 }, (_, index) =>
        stableFallbackCoverId(`https://unknown.example/${index}`)
      )
    );
    expect(assigned).toEqual(new Set(AARRE_FALLBACK_COVER_IDS));
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

import { describe, expect, it } from "vitest";
import {
  extractPageEssenceFromHtml,
  isInternalOrSensitiveUrl
} from "../src/lib/page-essence";

describe("page essence", () => {
  it("extracts compact metadata without retaining the full page", () => {
    const essence = extractPageEssenceFromHtml(
      `
        <html>
          <head>
            <meta property="og:site_name" content="Design Notes">
            <meta name="description" content="A practical guide to motion.">
            <meta name="keywords" content="motion, interaction, ux">
            <meta property="og:image" content="/images/motion-cover.jpg">
            <link rel="icon" href="/icons/site.svg">
          </head>
          <body>
            <h1>Purposeful motion</h1>
            <h2>Timing</h2>
            <h2>Accessibility</h2>
            <p>Use motion to explain how interface states are related.</p>
          </body>
        </html>
      `,
      "https://example.com/guides/motion-design"
    );

    expect(essence).toMatchObject({
      description: "A practical guide to motion.",
      siteName: "Design Notes",
      imageUrl: "https://example.com/images/motion-cover.jpg",
      faviconUrl: "https://example.com/icons/site.svg",
      keywords: ["motion", "interaction", "ux"],
      h1: "Purposeful motion",
      h2: ["Timing", "Accessibility"],
      firstParagraph:
        "Use motion to explain how interface states are related.",
      pathTokens: ["guides", "motion", "design"]
    });
  });

  it("blocks local, private and common internal hosts", () => {
    expect(isInternalOrSensitiveUrl("http://localhost:5173")).toBe(true);
    expect(isInternalOrSensitiveUrl("https://192.168.1.10/page")).toBe(true);
    expect(isInternalOrSensitiveUrl("https://team.internal/doc")).toBe(true);
    expect(isInternalOrSensitiveUrl("https://example.com/article")).toBe(false);
  });

  it("uses JSON-LD images when social metadata is missing", () => {
    const essence = extractPageEssenceFromHtml(
      `
        <script type="application/ld+json">
          {
            "@type": "Article",
            "headline": "A useful article",
            "image": {
              "@type": "ImageObject",
              "name": "Article cover",
              "url": "/media/article-cover.webp"
            }
          }
        </script>
      `,
      "https://example.com/articles/useful"
    );

    expect(essence.imageUrl).toBe(
      "https://example.com/media/article-cover.webp"
    );
  });

  it("falls back to a meaningful body image and ignores logos", () => {
    const essence = extractPageEssenceFromHtml(
      `
        <body>
          <img class="site-logo" src="/logo.png" width="240" height="120">
          <img
            class="thumbnail_img"
            src="/media/reference.jpg"
            width="960"
            height="624"
            alt="Reference website preview"
          >
        </body>
      `,
      "https://example.com/design"
    );

    expect(essence.imageUrl).toBe(
      "https://example.com/media/reference.jpg"
    );
  });

  it("prefers explicit social metadata over page-body candidates", () => {
    const essence = extractPageEssenceFromHtml(
      `
        <meta property="og:image" content="/social-card.jpg">
        <img class="hero" src="/body-hero.jpg" width="1200" height="800">
      `,
      "https://example.com/"
    );

    expect(essence.imageUrl).toBe("https://example.com/social-card.jpg");
  });

  it("builds a GitHub repository preview when the page metadata cannot be read", () => {
    const essence = extractPageEssenceFromHtml(
      "",
      "https://github.com/CatsJuice/medal-forge/tree/main"
    );

    expect(essence.imageUrl).toBe(
      "https://opengraph.githubassets.com/aarre/CatsJuice/medal-forge"
    );
  });

  it("does not treat GitHub system pages as repositories", () => {
    const essence = extractPageEssenceFromHtml(
      "",
      "https://github.com/settings/profile"
    );

    expect(essence.imageUrl).toBe("");
  });
});

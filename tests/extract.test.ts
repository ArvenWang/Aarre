// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { extractPage } from "../src/content/extract";

describe("extractPage", () => {
  it("extracts readable content and respects canonical metadata", async () => {
    document.head.innerHTML = `
      <title>Original browser title</title>
      <link rel="canonical" href="https://example.com/guide?utm_source=test">
      <meta property="og:title" content="Practical WebGL Guide">
      <meta name="description" content="A guide to efficient animated backgrounds.">
      <meta name="author" content="Lin">
      <meta property="og:site_name" content="Graphics Notes">
    `;
    document.documentElement.lang = "en";
    document.body.innerHTML = `
      <nav>Private navigation labels</nav>
      <article>
        <h1>Practical WebGL Guide</h1>
        <p>This guide explains how to build a lightweight WebGL background.</p>
        <p>It covers fragment shaders, performance budgets, and fallbacks.</p>
      </article>
      <form><input value="secret form value"></form>
    `;

    const result = await extractPage(document, {
      pageUrl: "https://example.com/guide?utm_campaign=email",
      selectedText: "fragment shaders"
    });

    expect(result.canonicalUrl).toBe("https://example.com/guide");
    expect(result.title).toBe("Practical WebGL Guide");
    expect(result.description).toContain("efficient animated backgrounds");
    expect(result.content).toContain("fragment shaders");
    expect(result.content).not.toContain("secret form value");
    expect(result.selectedText).toBe("fragment shaders");
    expect(result.siteName).toBe("Graphics Notes");
  });

  it("retains article siblings and excludes all suite interfaces from a bounded long-page copy", async () => {
    document.head.innerHTML = '<title>Feed</title>';
    document.body.innerHTML = `<article><h1>First story</h1><p>${'First article content. '.repeat(40)}</p></article>
      <article><h2>Second story</h2><p>${'Second article content. '.repeat(40)}</p></article>
      <aarre-floating-host>PRIVATE AARRE</aarre-floating-host><div id="nexcatcher-ui-host">PRIVATE CATCHER</div>
      <div data-layerscope-canvas-toolbar>PRIVATE NEXALIGN</div><script>${'script content '.repeat(50000)}</script>
      <section>${'<p>More readable content.</p>'.repeat(15000)}</section>`;
    let yielded = false;
    const timer = setTimeout(() => { yielded = true; }, 0);
    const result = await extractPage(document, { pageUrl: 'https://example.com/feed' });
    clearTimeout(timer);
    expect(yielded).toBe(true);
    expect(result.content).toContain('First article content.');
    expect(result.content).toContain('Second article content.');
    expect(result.content).not.toMatch(/PRIVATE|script content/);
    expect(result.content.length).toBeLessThanOrEqual(80000);
  });
});

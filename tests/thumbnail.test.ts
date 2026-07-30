import { describe, expect, it } from "vitest";
import {
  composeSiteIconPixels,
  normalizeSvgViewport,
  sanitizeStaticSvg,
  SITE_ICON_SURFACES
} from "../src/lib/thumbnail";

describe("thumbnail safety", () => {
  it("allows a self-contained static SVG", () => {
    expect(
      sanitizeStaticSvg(
        '<svg viewBox="0 0 192 192"><path fill="#111" d="M0 0h192v192H0z"/></svg>'
      )
    ).toContain("<path");
  });

  it("rejects scripts, event handlers and external references", () => {
    expect(() =>
      sanitizeStaticSvg("<svg><script>alert(1)</script></svg>")
    ).toThrow("unsafe-svg");
    expect(() =>
      sanitizeStaticSvg('<svg onload="alert(1)"></svg>')
    ).toThrow("unsafe-svg");
    expect(() =>
      sanitizeStaticSvg(
        '<svg><use href="https://tracker.example/icon.svg#x"/></svg>'
      )
    ).toThrow("unsafe-svg");
  });

  it("keeps the same transparent dark graphic visible on both surfaces", () => {
    const size = 192;
    const pixels = new Uint8ClampedArray(size * size * 4);
    for (let y = 40; y < 152; y += 1) {
      for (let x = 40; x < 152; x += 1) {
        if (Math.abs(x - 96) + Math.abs(y - 96) > 72) continue;
        const index = (y * size + x) * 4;
        pixels[index] = 18;
        pixels[index + 1] = 20;
        pixels[index + 2] = 24;
        pixels[index + 3] = 255;
      }
    }

    const light = composeSiteIconPixels(
      pixels,
      SITE_ICON_SURFACES.light
    );
    const dark = composeSiteIconPixels(
      pixels,
      SITE_ICON_SURFACES.dark
    );

    expect(light.inkCoverage).toBeGreaterThan(0.15);
    expect(dark.inkCoverage).toBeGreaterThan(0.15);
    const center = (96 * size + 96) * 4;
    expect(light.pixels[center]).toBeLessThan(64);
    expect(dark.pixels[center]).toBeGreaterThan(224);
  });
});

describe("svg viewport normalisation", () => {
  it("rasterises a 32px favicon at the full site-icon size", () => {
    const result = normalizeSvgViewport(
      '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><circle cx="16" cy="16" r="14"/></svg>',
      192
    );

    expect(result.intrinsicWidth).toBe(32);
    expect(result.intrinsicHeight).toBe(32);
    expect(result.source).toContain('width="192"');
    expect(result.source).toContain('height="192"');
    expect(result.source).toContain('viewBox="0 0 32 32"');
    expect(result.source).toContain("<circle");
  });

  it("keeps the aspect ratio so non-square vectors still fail the square gate", () => {
    const result = normalizeSvgViewport(
      '<svg width="100" height="40" viewBox="0 0 100 40"><rect width="100" height="40"/></svg>',
      192
    );

    expect(result.intrinsicWidth).toBe(100);
    expect(result.intrinsicHeight).toBe(40);
    expect(result.source).toContain('width="192"');
    expect(result.source).toContain('height="77"');
  });

  it("derives the viewport from viewBox when width and height are missing", () => {
    const result = normalizeSvgViewport(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="M0 0h64v64H0z"/></svg>',
      192
    );

    expect(result.intrinsicWidth).toBe(64);
    expect(result.source).toContain('width="192"');
  });

  it("does not touch stroke-width or other hyphenated attributes", () => {
    const result = normalizeSvgViewport(
      '<svg width="48" height="48" viewBox="0 0 48 48" stroke-width="3"><path d="M4 4h40"/></svg>',
      192
    );

    expect(result.source).toContain('stroke-width="3"');
    expect(result.source).toContain('width="192"');
  });

  it("reports an unresolved viewport when neither size nor viewBox is present", () => {
    const source = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h8v8H0z"/></svg>';
    const result = normalizeSvgViewport(source, 192);

    expect(result.intrinsicWidth).toBe(0);
    expect(result.source).toBe(source);
  });
});

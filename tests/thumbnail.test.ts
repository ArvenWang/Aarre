import { describe, expect, it } from "vitest";
import {
  composeSiteIconPixels,
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

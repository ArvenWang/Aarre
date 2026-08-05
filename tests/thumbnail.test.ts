import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import {
  cacheSiteBrandIcon,
  currentSiteBrandImageUrl,
  extractLargestPngFromIco,
  normalizeSvgViewport,
  normalizeSiteIconPixels,
  sanitizeStaticSvg,
  SITE_ICON_SURFACE,
  siteBrandIconCacheIsFresh,
  type SiteIconDecodeFallbackInput
} from "../src/lib/thumbnail";

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47] as const;
const baseCssUrl = new URL("../src/ui/base.css", import.meta.url);
const tokensCssUrl = new URL("../src/ui/tokens.css", import.meta.url);
const thumbnailSourceUrl = new URL("../src/lib/thumbnail.ts", import.meta.url);

function createIco(
  frames: Array<{
    width: number;
    height: number;
    data: number[];
  }>
): Uint8Array {
  const directorySize = 6 + frames.length * 16;
  const totalSize =
    directorySize + frames.reduce((sum, frame) => sum + frame.data.length, 0);
  const output = new Uint8Array(totalSize);
  const view = new DataView(output.buffer);
  view.setUint16(0, 0, true);
  view.setUint16(2, 1, true);
  view.setUint16(4, frames.length, true);
  let dataOffset = directorySize;
  frames.forEach((frame, index) => {
    const entryOffset = 6 + index * 16;
    output[entryOffset] = frame.width === 256 ? 0 : frame.width;
    output[entryOffset + 1] =
      frame.height === 256 ? 0 : frame.height;
    view.setUint16(entryOffset + 4, 1, true);
    view.setUint16(entryOffset + 6, 32, true);
    view.setUint32(entryOffset + 8, frame.data.length, true);
    view.setUint32(entryOffset + 12, dataOffset, true);
    output.set(frame.data, dataOffset);
    dataOffset += frame.data.length;
  });
  return output;
}

describe("thumbnail safety", () => {
  it("gives transparent artwork a theme-independent canvas", async () => {
    const [css, tokens] = await Promise.all([
      readFile(baseCssUrl, "utf8"),
      readFile(tokensCssUrl, "utf8"),
    ]);
    const start = css.indexOf(".site-thumbnail {");
    const bodyStart = css.indexOf("{", start) + 1;
    const rule = css.slice(bodyStart, css.indexOf("}", bodyStart));

    expect(rule).toContain("background: var(--site-icon-canvas)");
    expect(rule).toContain("color-scheme: only light");
    expect(tokens.match(/--site-icon-canvas:/g)).toHaveLength(1);
    expect(tokens).toContain("--site-icon-canvas: #ffffff");
    expect(css).toContain(".site-thumbnail > picture {");
    expect(css).toContain("background: inherit");
  });

  it("makes the cached page-cover canvas opaque before encoding", async () => {
    const source = await readFile(thumbnailSourceUrl, "utf8");

    expect(source).toContain(
      'context.globalCompositeOperation = "destination-over"',
    );
    expect(source).toContain("context.fillRect(0, 0, width, height)");
  });

  it("never exposes a legacy site-brand cache to the UI", () => {
    expect(
      currentSiteBrandImageUrl({
        iconDataUrl: "data:image/webp;base64,DARK_LEGACY",
        iconDataUrlLight: "data:image/webp;base64,DARK_LEGACY",
        iconRenderVersion: 1,
      }),
    ).toBe("");
    expect(
      currentSiteBrandImageUrl({
        iconDataUrl: "data:image/webp;base64,UNKNOWN_LEGACY",
      }),
    ).toBe("");
    expect(
      currentSiteBrandImageUrl({
        iconDataUrl: "data:image/webp;base64,TRANSPARENT_CURRENT",
        iconDataUrlLight: "data:image/webp;base64,TRANSPARENT_CURRENT",
        iconRenderVersion: 9,
      }),
    ).toBe("data:image/webp;base64,TRANSPARENT_CURRENT");
    expect(
      currentSiteBrandImageUrl({
        host: "github.com",
        iconDataUrl: "data:image/webp;base64,OLD_GITHUB",
        iconDataUrlLight: "data:image/webp;base64,OLD_GITHUB",
        iconRenderVersion: 9,
        iconAssetUrl: "https://github.com/apple-touch-icon-180x180.png",
      }),
    ).toBe("");
    expect(
      currentSiteBrandImageUrl({
        host: "github.com",
        iconDataUrl: "data:image/webp;base64,CURRENT_GITHUB",
        iconDataUrlLight: "data:image/webp;base64,CURRENT_GITHUB",
        iconRenderVersion: 9,
        iconAssetUrl:
          "https://github.githubassets.com/favicons/favicon.svg",
      }),
    ).toBe("data:image/webp;base64,CURRENT_GITHUB");
  });

  it("marks missing or legacy site-brand icons for regeneration", () => {
    const now = Date.parse("2026-08-02T00:00:00.000Z");

    expect(siteBrandIconCacheIsFresh(undefined, now)).toBe(false);
    expect(
      siteBrandIconCacheIsFresh(
        {
          iconDataUrlLight: "data:image/webp;base64,LEGACY",
          iconRenderVersion: 2,
          updatedAt: "2026-08-01T00:00:00.000Z"
        },
        now
      )
    ).toBe(false);
    expect(
      siteBrandIconCacheIsFresh(
        {
          iconDataUrlLight: "data:image/webp;base64,CURRENT",
          iconRenderVersion: 9,
          updatedAt: "2026-08-01T00:00:00.000Z"
        },
        now
      )
    ).toBe(true);
    expect(
      siteBrandIconCacheIsFresh(
        {
          iconDataUrlLight: "data:image/webp;base64,PUBLIC",
          iconRenderVersion: 9,
          iconSource: "public-service",
          updatedAt: "2026-07-20T00:00:00.000Z"
        },
        now
      )
    ).toBe(false);
    expect(
      siteBrandIconCacheIsFresh(
        {
          iconDataUrlLight: "data:image/webp;base64,PUBLIC",
          iconRenderVersion: 9,
          iconSource: "public-service",
          updatedAt: "2026-07-28T00:00:00.000Z"
        },
        now
      )
    ).toBe(true);
  });

  it("allows a self-contained static SVG", () => {
    expect(
      sanitizeStaticSvg(
        '<svg viewBox="0 0 192 192"><path fill="#111" d="M0 0h192v192H0z"/></svg>'
      )
    ).toContain("<path");
  });

  it("uses the generic DOM decoder when the service worker cannot decode a safe SVG", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          '<svg width="32" height="32" viewBox="0 0 32 32"><circle cx="16" cy="16" r="15"/></svg>',
          { status: 200, headers: { "content-type": "image/svg+xml" } }
        )
      )
    );
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => {
        throw new Error("The source image could not be decoded.");
      })
    );
    const decodeFallback = vi.fn(async (_input: SiteIconDecodeFallbackInput) => ({
      iconDataUrl: "data:image/webp;base64,DOM_DECODED",
      iconDataUrlLight: "data:image/webp;base64,DOM_DECODED",
      iconRenderVersion: 9,
      nativeWidth: 32,
      nativeHeight: 32
    }));

    try {
      const result = await cacheSiteBrandIcon(
        [
          {
            url: "https://icons.example/favicon.svg",
            source: "svg-icon",
            vector: true
          }
        ],
        decodeFallback
      );

      expect(decodeFallback).toHaveBeenCalledTimes(1);
      expect(decodeFallback.mock.calls[0]?.[0]).toMatchObject({
        vector: true,
        nativeWidth: 32,
        nativeHeight: 32
      });
      expect(result).toMatchObject({
        iconDataUrlLight: "data:image/webp;base64,DOM_DECODED",
        iconSource: "svg-icon",
        iconAssetUrl: "https://icons.example/favicon.svg"
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("probes a priority group in parallel and never touches the lower group after success", async () => {
    const requested: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      requested.push(url);
      if (url.includes("good.svg")) {
        return new Response(
          '<svg width="32" height="32" viewBox="0 0 32 32"><circle cx="16" cy="16" r="15"/></svg>',
          { status: 200, headers: { "content-type": "image/svg+xml" } }
        );
      }
      return new Response("missing", { status: 404 });
    }));
    vi.stubGlobal("createImageBitmap", vi.fn(async () => {
      throw new Error("decode in offscreen document");
    }));
    const decodeFallback = vi.fn(async () => ({
      iconDataUrlLight: "data:image/webp;base64,GOOD",
      iconRenderVersion: 9,
      nativeWidth: 32,
      nativeHeight: 32
    }));

    try {
      const result = await cacheSiteBrandIcon([
        { url: "https://icons.example/good.svg", source: "svg-icon", vector: true },
        { url: "https://icons.example/high-2.ico", source: "conventional-favicon-ico" },
        { url: "https://icons.example/high-3.ico", source: "conventional-favicon-ico" },
        { url: "https://icons.example/high-4.ico", source: "conventional-favicon-ico" },
        { url: "https://icons.example/low.ico", source: "conventional-favicon-ico" }
      ], decodeFallback);

      expect(result.iconDataUrlLight).toContain("GOOD");
      expect(requested).not.toContain("https://icons.example/low.ico");
    } finally {
      vi.unstubAllGlobals();
    }
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

  it("keeps a dark site graphic transparent for the white CSS carrier", () => {
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

    const normalized = normalizeSiteIconPixels(
      pixels,
      SITE_ICON_SURFACE,
      { x: 0, y: 0, width: size, height: size, canvasWidth: size }
    );

    expect(normalized.inkCoverage).toBeGreaterThan(0.15);
    expect([...normalized.pixels.slice(0, 4)]).toEqual([0, 0, 0, 0]);
    const center = (96 * size + 96) * 4;
    expect(normalized.pixels[center]).toBeLessThan(64);
    expect(normalized.pixels[center + 3]).toBe(255);
  });

  it("removes an opaque dark outer matte without darkening the enclosed white artwork", () => {
    const size = 64;
    const pixels = new Uint8ClampedArray(size * size * 4);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const index = (y * size + x) * 4;
        pixels[index] = 18;
        pixels[index + 1] = 20;
        pixels[index + 2] = 24;
        pixels[index + 3] = 255;
        const distance = Math.hypot(x - 31.5, y - 31.5);
        if (distance <= 25) {
          pixels[index] = 255;
          pixels[index + 1] = 255;
          pixels[index + 2] = 255;
        }
        if (x >= 22 && x <= 42 && y >= 20 && y <= 47) {
          pixels[index] = 18;
          pixels[index + 1] = 20;
          pixels[index + 2] = 24;
        }
      }
    }

    const normalized = normalizeSiteIconPixels(
      pixels,
      SITE_ICON_SURFACE,
      { x: 0, y: 0, width: size, height: size, canvasWidth: size },
    );
    const whiteCircle = (32 * size + 12) * 4;
    const darkLogo = (32 * size + 32) * 4;

    expect([...normalized.pixels.slice(0, 4)]).toEqual([0, 0, 0, 0]);
    expect([...normalized.pixels.slice(whiteCircle, whiteCircle + 4)]).toEqual([
      255,
      255,
      255,
      255,
    ]);
    expect([...normalized.pixels.slice(darkLogo, darkLogo + 4)]).toEqual([
      18,
      20,
      24,
      255,
    ]);
    expect(normalized.inkCoverage).toBeGreaterThan(0.15);
  });

  it("darkens a genuinely light-only transparent glyph as one unit", () => {
    const size = 64;
    const pixels = new Uint8ClampedArray(size * size * 4);
    for (let y = 12; y < 52; y += 1) {
      for (let x = 24; x < 40; x += 1) {
        const index = (y * size + x) * 4;
        pixels[index] = 255;
        pixels[index + 1] = 255;
        pixels[index + 2] = 255;
        pixels[index + 3] = 255;
      }
    }

    const normalized = normalizeSiteIconPixels(
      pixels,
      SITE_ICON_SURFACE,
      { x: 0, y: 0, width: size, height: size, canvasWidth: size },
    );
    const glyph = (32 * size + 32) * 4;

    expect([...normalized.pixels.slice(0, 4)]).toEqual([0, 0, 0, 0]);
    expect(normalized.pixels[glyph]).toBe(24);
    expect(normalized.pixels[glyph + 3]).toBe(255);
    expect(normalized.inkCoverage).toBeGreaterThan(0.15);
  });

  it("measures ink inside the drawn asset region instead of the whole canvas", () => {
    const size = 192;
    const pixels = new Uint8ClampedArray(size * size * 4);
    for (let y = 48; y < 87; y += 1) {
      for (let x = 48; x < 144; x += 1) {
        const index = (y * size + x) * 4;
        pixels[index] = 18;
        pixels[index + 1] = 20;
        pixels[index + 2] = 24;
        pixels[index + 3] = 255;
      }
    }

    const result = normalizeSiteIconPixels(
      pixels,
      SITE_ICON_SURFACE,
      { x: 48, y: 48, width: 96, height: 96, canvasWidth: size }
    );

    expect((39 * 96) / (size * size)).toBeLessThan(0.15);
    expect(result.inkCoverage).toBeGreaterThan(0.4);
  });

  it("still rejects an asset whose own drawn region has too little ink", () => {
    const size = 192;
    const pixels = new Uint8ClampedArray(size * size * 4);
    for (let y = 0; y < 19; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const index = (y * size + x) * 4;
        pixels[index] = 238;
        pixels[index + 1] = 239;
        pixels[index + 2] = 241;
        pixels[index + 3] = 25;
      }
    }

    const result = normalizeSiteIconPixels(
      pixels,
      SITE_ICON_SURFACE,
      { x: 0, y: 0, width: size, height: size, canvasWidth: size }
    );

    expect(result.inkCoverage).toBeLessThan(0.15);
  });
});

describe("ICO frame extraction", () => {
  it("extracts the largest PNG frame from a multi-frame ICO", () => {
    const ico = createIco([
      { width: 16, height: 16, data: [...PNG_MAGIC, 16] },
      { width: 32, height: 32, data: [...PNG_MAGIC, 32] },
      { width: 256, height: 256, data: [...PNG_MAGIC, 255] }
    ]);

    const result = extractLargestPngFromIco(ico);

    expect(result.kind).toBe("png");
    if (result.kind !== "png") throw new Error("expected PNG frame");
    expect(result.width).toBe(256);
    expect(result.height).toBe(256);
    expect([...result.bytes]).toEqual([...PNG_MAGIC, 255]);
  });

  it("treats a zero directory dimension as 256", () => {
    const ico = createIco([
      { width: 256, height: 256, data: [...PNG_MAGIC, 1] }
    ]);

    const result = extractLargestPngFromIco(ico);

    expect(result.kind).toBe("png");
    if (result.kind !== "png") throw new Error("expected PNG frame");
    expect(result.width).toBe(256);
    expect(result.height).toBe(256);
  });

  it("returns an unsupported result when the largest frame is DIB", () => {
    const ico = createIco([
      { width: 32, height: 32, data: [...PNG_MAGIC, 1] },
      { width: 256, height: 256, data: [0x28, 0, 0, 0, 2] }
    ]);

    expect(extractLargestPngFromIco(ico)).toEqual({
      kind: "unsupported-ico"
    });
  });

  it("leaves a non-ICO PNG on the ordinary image path", () => {
    expect(
      extractLargestPngFromIco(new Uint8Array([...PNG_MAGIC, 1, 2, 3]))
    ).toEqual({ kind: "not-ico" });
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

describe("site icon render contract", () => {
  it("upsizes small bitmaps to fill the canvas and bumps the render version", async () => {
    const [thumbnailSource, processorSource, baseCss] = await Promise.all([
      readFile(thumbnailSourceUrl, "utf8"),
      readFile(new URL("../src/extension/icon-processor.ts", import.meta.url), "utf8"),
      readFile(baseCssUrl, "utf8")
    ]);

    expect(thumbnailSource).toMatch(/SITE_ICON_RENDER_VERSION = 9/);
    expect(thumbnailSource).not.toMatch(
      /const scale = Math\.min\(\s*1,\s*SITE_ICON_SIZE/
    );
    expect(thumbnailSource).toMatch(
      /const scale = SITE_ICON_SIZE \/ Math\.max\(renderWidth, renderHeight\)/
    );
    expect(processorSource).not.toMatch(
      /const scale = Math\.min\(\s*1,\s*SITE_ICON_SIZE/
    );
    expect(processorSource).toMatch(
      /const scale = SITE_ICON_SIZE \/ Math\.max\(renderWidth, renderHeight\)/
    );
    expect(baseCss).toMatch(
      /\.site-thumbnail-image\s*\{\s*object-fit:\s*contain;/
    );
  });
});

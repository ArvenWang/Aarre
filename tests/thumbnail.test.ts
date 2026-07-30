import { describe, expect, it } from "vitest";
import {
  composeSiteIconPixels,
  extractLargestPngFromIco,
  normalizeSvgViewport,
  sanitizeStaticSvg,
  SITE_ICON_SURFACES
} from "../src/lib/thumbnail";

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47] as const;

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
      SITE_ICON_SURFACES.light,
      { x: 0, y: 0, width: size, height: size, canvasWidth: size }
    );
    const dark = composeSiteIconPixels(
      pixels,
      SITE_ICON_SURFACES.dark,
      { x: 0, y: 0, width: size, height: size, canvasWidth: size }
    );

    expect(light.inkCoverage).toBeGreaterThan(0.15);
    expect(dark.inkCoverage).toBeGreaterThan(0.15);
    const center = (96 * size + 96) * 4;
    expect(light.pixels[center]).toBeLessThan(64);
    expect(dark.pixels[center]).toBeGreaterThan(224);
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

    const result = composeSiteIconPixels(
      pixels,
      SITE_ICON_SURFACES.light,
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

    const result = composeSiteIconPixels(
      pixels,
      SITE_ICON_SURFACES.light,
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

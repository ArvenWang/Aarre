import type {
  SiteIconCandidate,
  SiteIconSource
} from "./types";

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_SVG_BYTES = 256 * 1024;
const SITE_ICON_SIZE = 192;
const PAGE_COVER_LONG_EDGE = 512;

export interface SiteIconSurface {
  red: number;
  green: number;
  blue: number;
}

export const SITE_ICON_SURFACES = {
  light: { red: 246, green: 247, blue: 250 },
  dark: { red: 36, green: 36, blue: 38 }
} as const satisfies Record<"light" | "dark", SiteIconSurface>;

export interface CachedSiteIcon {
  /** 浅色版本的兼容别名，供旧数据与旧调用方平滑迁移。 */
  iconDataUrl?: string;
  iconDataUrlLight?: string;
  iconDataUrlDark?: string;
  iconSource?: SiteIconSource;
  iconRejectReason?: string;
  nativeWidth?: number;
  nativeHeight?: number;
}

async function readLimitedBlob(
  response: Response,
  maxBytes = MAX_IMAGE_BYTES
): Promise<Blob> {
  const declaredSize = Number(response.headers.get("content-length") || 0);
  if (declaredSize > maxBytes) throw new Error("file-too-large");
  if (!response.body) {
    const blob = await response.blob();
    if (blob.size > maxBytes) throw new Error("file-too-large");
    return blob;
  }

  const reader = response.body.getReader();
  const chunks: ArrayBuffer[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error("file-too-large");
      const copy = new Uint8Array(value.byteLength);
      copy.set(value);
      chunks.push(copy.buffer);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return new Blob(chunks, {
    type: response.headers.get("content-type") || "image/png"
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return blob.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer);
    const parts: string[] = [];
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      parts.push(
        String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
      );
    }
    return `data:${blob.type};base64,${btoa(parts.join(""))}`;
  });
}

async function fetchImage(
  url: string,
  maxBytes = MAX_IMAGE_BYTES,
  allowUnknownContentType = false
) {
  const response = await fetch(url, {
    credentials: "omit",
    redirect: "follow",
    headers: {
      Accept: "image/avif,image/webp,image/svg+xml,image/*,*/*;q=0.3"
    },
    signal: AbortSignal.timeout(12_000)
  });
  const contentType = response.headers.get("content-type") || "";
  if (
    !response.ok ||
    (!allowUnknownContentType &&
      !contentType.toLowerCase().startsWith("image/"))
  ) {
    throw new Error("not-an-image");
  }
  return readLimitedBlob(response, maxBytes);
}

export function sanitizeStaticSvg(source: string): string {
  const text = source.trim();
  if (!/^<svg\b/i.test(text)) throw new Error("invalid-svg");
  if (
    /<(?:script|foreignObject|iframe|object|embed|image)\b/i.test(text) ||
    /\bon[a-z]+\s*=/i.test(text) ||
    /@import\b/i.test(text) ||
    /\b(?:href|src)\s*=\s*["'](?!#)[^"']+/i.test(text) ||
    /url\(\s*["']?(?!#)[^)]+/i.test(text)
  ) {
    throw new Error("unsafe-svg");
  }
  return text;
}

async function safeSvgBlob(blob: Blob): Promise<Blob> {
  if (blob.size > MAX_SVG_BYTES) throw new Error("svg-too-large");
  const source = sanitizeStaticSvg(await blob.text());
  return new Blob([source], { type: "image/svg+xml" });
}

export interface SvgViewport {
  source: string;
  intrinsicWidth: number;
  intrinsicHeight: number;
}

export type IcoPngExtraction =
  | { kind: "not-ico" }
  | { kind: "unsupported-ico" }
  | {
      kind: "png";
      bytes: Uint8Array<ArrayBuffer>;
      width: number;
      height: number;
    };

/**
 * ICO 是一个多帧容器。这里严格选择目录中的最大帧；只有该帧本身是 PNG
 * 编码时才抽出复用现有图像管线。DIB/BMP 帧不做隐式降级，避免引入一套
 * 复杂且难以审计的解码器。
 */
export function extractLargestPngFromIco(
  input: ArrayBuffer | Uint8Array
): IcoPngExtraction {
  const bytes =
    input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength < 6) return { kind: "not-ico" };
  const view = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength
  );
  if (view.getUint16(0, true) !== 0 || view.getUint16(2, true) !== 1) {
    return { kind: "not-ico" };
  }

  const count = view.getUint16(4, true);
  const directoryEnd = 6 + count * 16;
  if (!count || directoryEnd > bytes.byteLength) {
    return { kind: "unsupported-ico" };
  }

  let largest:
    | {
        width: number;
        height: number;
        size: number;
        offset: number;
      }
    | undefined;
  for (let index = 0; index < count; index += 1) {
    const entryOffset = 6 + index * 16;
    const width = bytes[entryOffset] === 0 ? 256 : bytes[entryOffset]!;
    const height =
      bytes[entryOffset + 1] === 0 ? 256 : bytes[entryOffset + 1]!;
    const size = view.getUint32(entryOffset + 8, true);
    const offset = view.getUint32(entryOffset + 12, true);
    if (
      size === 0 ||
      offset < directoryEnd ||
      offset > bytes.byteLength ||
      size > bytes.byteLength - offset
    ) {
      continue;
    }
    if (
      !largest ||
      width * height > largest.width * largest.height ||
      (width * height === largest.width * largest.height &&
        Math.max(width, height) >
          Math.max(largest.width, largest.height))
    ) {
      largest = { width, height, size, offset };
    }
  }
  if (!largest) return { kind: "unsupported-ico" };

  const pngMagic = [0x89, 0x50, 0x4e, 0x47] as const;
  if (
    pngMagic.some(
      (value, index) => bytes[largest!.offset + index] !== value
    )
  ) {
    return { kind: "unsupported-ico" };
  }
  const frameBytes = new Uint8Array(largest.size);
  frameBytes.set(
    bytes.subarray(largest.offset, largest.offset + largest.size)
  );
  return {
    kind: "png",
    bytes: frameBytes,
    width: largest.width,
    height: largest.height
  };
}

function parseSvgLength(value: string | undefined): number {
  const match = value?.trim().match(/^([0-9]*\.?[0-9]+)\s*(?:px|pt)?$/i);
  const parsed = Number(match?.[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/**
 * SVG 的 `width="32"` 只是默认渲染尺寸，不是分辨率上限——矢量图可以在任意
 * 尺寸下无损重绘。若照 32 解码再套 128px 下限，会把大量站点的 favicon.svg
 * 当成小图拒掉，正好是 PRD 5.5 想避免的结果。这里把根元素改写成按最长边
 * SITE_ICON_SIZE 渲染，让解码器直接栅格化到目标尺寸。
 *
 * 拿不到固有宽高也拿不到 viewBox 时返回 0，调用方据此退回位图判定，
 * 避免给未知画布强加一个可能裁掉内容的 viewBox。
 */
export function normalizeSvgViewport(
  source: string,
  size: number
): SvgViewport {
  const unresolved: SvgViewport = {
    source,
    intrinsicWidth: 0,
    intrinsicHeight: 0
  };
  const openTag = source.match(/^<svg\b[^>]*[^/]>/i)?.[0];
  if (!openTag) return unresolved;

  const attribute = (name: string): string | undefined =>
    openTag.match(
      new RegExp(`[\\s]${name}\\s*=\\s*["']([^"']*)["']`, "i")
    )?.[1];

  const viewBox = (attribute("viewBox") || "")
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number);
  const hasViewBox =
    viewBox.length === 4 && viewBox.every((value) => Number.isFinite(value));
  const boxWidth = hasViewBox ? viewBox[2]! : 0;
  const boxHeight = hasViewBox ? viewBox[3]! : 0;

  const intrinsicWidth = parseSvgLength(attribute("width")) || boxWidth;
  const intrinsicHeight = parseSvgLength(attribute("height")) || boxHeight;
  if (intrinsicWidth <= 0 || intrinsicHeight <= 0) return unresolved;

  const scale = size / Math.max(intrinsicWidth, intrinsicHeight);
  const rewritten = `${openTag
    .replace(/\s+(?:width|height)\s*=\s*["'][^"']*["']/gi, "")
    .slice(0, -1)}${
    boxWidth > 0 && boxHeight > 0
      ? ""
      : ` viewBox="0 0 ${intrinsicWidth} ${intrinsicHeight}"`
  } width="${Math.round(intrinsicWidth * scale)}" height="${Math.round(
    intrinsicHeight * scale
  )}">`;

  return {
    source: rewritten + source.slice(openTag.length),
    intrinsicWidth,
    intrinsicHeight
  };
}

function inspectPixels(
  context: OffscreenCanvasRenderingContext2D,
  width: number,
  height: number
): { inkCoverage: number; dominantColorRatio: number } {
  const pixels = context.getImageData(0, 0, width, height).data;
  let ink = 0;
  const colorCounts = new Map<number, number>();
  let visible = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    const alpha = pixels[index + 3] || 0;
    if (alpha < 24) continue;
    visible += 1;
    const red = pixels[index] || 0;
    const green = pixels[index + 1] || 0;
    const blue = pixels[index + 2] || 0;
    if (Math.max(255 - red, 255 - green, 255 - blue) >= 28) ink += 1;
    const key =
      (Math.round(red / 16) << 8) |
      (Math.round(green / 16) << 4) |
      Math.round(blue / 16);
    colorCounts.set(key, (colorCounts.get(key) || 0) + 1);
  }
  const total = width * height;
  return {
    inkCoverage: ink / total,
    dominantColorRatio:
      visible > 0 ? Math.max(...colorCounts.values()) / visible : 1
  };
}

function channelLuminance(value: number): number {
  const normalized = value / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(
  red: number,
  green: number,
  blue: number
): number {
  return (
    0.2126 * channelLuminance(red) +
    0.7152 * channelLuminance(green) +
    0.0722 * channelLuminance(blue)
  );
}

function contrastRatio(
  red: number,
  green: number,
  blue: number,
  surface: SiteIconSurface
): number {
  const foreground = relativeLuminance(red, green, blue);
  const background = relativeLuminance(
    surface.red,
    surface.green,
    surface.blue
  );
  return (
    (Math.max(foreground, background) + 0.05) /
    (Math.min(foreground, background) + 0.05)
  );
}

export interface CompositedSiteIcon {
  pixels: Uint8ClampedArray;
  inkCoverage: number;
}

export interface SiteIconContentRect {
  x: number;
  y: number;
  width: number;
  height: number;
  canvasWidth: number;
}

/**
 * 把透明站点图标合成到真实承载色上。只对接近承载色、会消失的像素
 * 做中性前景色补偿；本来已有足够对比度的品牌色保持不变。
 */
export function composeSiteIconPixels(
  sourcePixels: Uint8ClampedArray,
  surface: SiteIconSurface,
  contentRect: SiteIconContentRect
): CompositedSiteIcon {
  const output = new Uint8ClampedArray(sourcePixels.length);
  const canvasWidth = Math.max(1, Math.floor(contentRect.canvasWidth));
  const canvasHeight = Math.ceil(
    sourcePixels.length / 4 / canvasWidth
  );
  const left = Math.max(0, Math.floor(contentRect.x));
  const top = Math.max(0, Math.floor(contentRect.y));
  const right = Math.min(
    canvasWidth,
    Math.ceil(contentRect.x + contentRect.width)
  );
  const bottom = Math.min(
    canvasHeight,
    Math.ceil(contentRect.y + contentRect.height)
  );
  const contentArea = Math.max(1, (right - left) * (bottom - top));
  const surfaceLuminance = relativeLuminance(
    surface.red,
    surface.green,
    surface.blue
  );
  const fallback = surfaceLuminance < 0.5 ? 242 : 24;
  let ink = 0;

  for (let index = 0; index < sourcePixels.length; index += 4) {
    const alpha = (sourcePixels[index + 3] || 0) / 255;
    const sourceRed = sourcePixels[index] || 0;
    const sourceGreen = sourcePixels[index + 1] || 0;
    const sourceBlue = sourcePixels[index + 2] || 0;
    const renderedRed = Math.round(
      sourceRed * alpha + surface.red * (1 - alpha)
    );
    const renderedGreen = Math.round(
      sourceGreen * alpha + surface.green * (1 - alpha)
    );
    const renderedBlue = Math.round(
      sourceBlue * alpha + surface.blue * (1 - alpha)
    );
    const needsContrastLift =
      alpha >= 24 / 255 &&
      contrastRatio(
        renderedRed,
        renderedGreen,
        renderedBlue,
        surface
      ) < 1.8;
    const red = needsContrastLift
      ? Math.round(fallback * alpha + surface.red * (1 - alpha))
      : renderedRed;
    const green = needsContrastLift
      ? Math.round(fallback * alpha + surface.green * (1 - alpha))
      : renderedGreen;
    const blue = needsContrastLift
      ? Math.round(fallback * alpha + surface.blue * (1 - alpha))
      : renderedBlue;

    output[index] = red;
    output[index + 1] = green;
    output[index + 2] = blue;
    output[index + 3] = 255;
    const pixel = index / 4;
    const x = pixel % canvasWidth;
    const y = Math.floor(pixel / canvasWidth);
    if (
      x >= left &&
      x < right &&
      y >= top &&
      y < bottom &&
      alpha >= 24 / 255 &&
      Math.max(
        Math.abs(red - surface.red),
        Math.abs(green - surface.green),
        Math.abs(blue - surface.blue)
      ) >= 28
    ) {
      ink += 1;
    }
  }

  return {
    pixels: output,
    inkCoverage: ink / contentArea
  };
}

async function bitmapFromBlob(blob: Blob): Promise<ImageBitmap> {
  return Promise.race([
    createImageBitmap(blob),
    new Promise<never>((_, reject) => {
      globalThis.setTimeout(() => reject(new Error("image-decode-timeout")), 3_000);
    })
  ]);
}

async function cacheSiteIconCandidate(
  candidate: SiteIconCandidate
): Promise<CachedSiteIcon> {
  let source = await fetchImage(
    candidate.url,
    candidate.vector ? MAX_SVG_BYTES : MAX_IMAGE_BYTES,
    candidate.source === "conventional-favicon-ico"
  );
  const sourceBytes = new Uint8Array(await source.arrayBuffer());
  const ico = extractLargestPngFromIco(sourceBytes);
  let icoFrame:
    | Extract<IcoPngExtraction, { kind: "png" }>
    | undefined;
  if (ico.kind === "unsupported-ico") {
    return { iconRejectReason: "unsupported-ico-frame" };
  }
  if (ico.kind === "png") {
    icoFrame = ico;
    source = new Blob([ico.bytes], { type: "image/png" });
  }
  let viewport: SvgViewport | null = null;
  const sourceLooksLikeSvg = new TextDecoder()
    .decode(sourceBytes.subarray(0, Math.min(1_024, sourceBytes.length)))
    .trimStart()
    .startsWith("<svg");
  if (
    candidate.vector ||
    source.type.toLowerCase().includes("svg") ||
    /\.svg(?:[?#]|$)/i.test(candidate.url) ||
    sourceLooksLikeSvg
  ) {
    source = await safeSvgBlob(source);
    const normalized = normalizeSvgViewport(
      await source.text(),
      SITE_ICON_SIZE
    );
    if (normalized.intrinsicWidth > 0) {
      viewport = normalized;
      source = new Blob([normalized.source], { type: "image/svg+xml" });
    }
  }
  const bitmap = await bitmapFromBlob(source);
  try {
    // 固有尺寸用于上报和方形判定；绘制一律用解码后的实际位图尺寸，
    // 矢量图这两者不同。
    const nativeWidth =
      viewport?.intrinsicWidth || icoFrame?.width || bitmap.width;
    const nativeHeight =
      viewport?.intrinsicHeight || icoFrame?.height || bitmap.height;
    const renderWidth = bitmap.width;
    const renderHeight = bitmap.height;
    if (!viewport && (nativeWidth < 128 || nativeHeight < 128)) {
      return {
        iconRejectReason: "below-128px",
        nativeWidth,
        nativeHeight
      };
    }
    const ratio =
      Math.max(nativeWidth, nativeHeight) /
      Math.min(nativeWidth, nativeHeight);
    if (ratio > 1.2) {
      return {
        iconRejectReason: "non-square",
        nativeWidth,
        nativeHeight
      };
    }

    const sourceCanvas = new OffscreenCanvas(
      SITE_ICON_SIZE,
      SITE_ICON_SIZE
    );
    const sourceContext = sourceCanvas.getContext("2d", {
      willReadFrequently: true
    });
    if (!sourceContext) throw new Error("image-processing-unavailable");
    sourceContext.clearRect(0, 0, SITE_ICON_SIZE, SITE_ICON_SIZE);
    const scale = Math.min(
      1,
      SITE_ICON_SIZE / Math.max(renderWidth, renderHeight)
    );
    const width = renderWidth * scale;
    const height = renderHeight * scale;
    const x = (SITE_ICON_SIZE - width) / 2;
    const y = (SITE_ICON_SIZE - height) / 2;
    sourceContext.drawImage(
      bitmap,
      x,
      y,
      width,
      height
    );
    const sourcePixels = sourceContext.getImageData(
      0,
      0,
      SITE_ICON_SIZE,
      SITE_ICON_SIZE
    ).data;

    const renderVariant = async (
      surface: SiteIconSurface
    ): Promise<{ dataUrl: string; inkCoverage: number }> => {
      const canvas = new OffscreenCanvas(
        SITE_ICON_SIZE,
        SITE_ICON_SIZE
      );
      const context = canvas.getContext("2d", {
        willReadFrequently: true
      });
      if (!context) throw new Error("image-processing-unavailable");

      // 输出图像必须自带与 UI 相同的承载色，不能依赖透明底碰巧可见。
      context.fillStyle = `rgb(${surface.red} ${surface.green} ${surface.blue})`;
      context.fillRect(0, 0, SITE_ICON_SIZE, SITE_ICON_SIZE);
      context.drawImage(
        bitmap,
        x,
        y,
        width,
        height
      );
      const composed = composeSiteIconPixels(sourcePixels, surface, {
        x,
        y,
        width,
        height,
        canvasWidth: SITE_ICON_SIZE
      });
      const imageData = context.createImageData(
        SITE_ICON_SIZE,
        SITE_ICON_SIZE
      );
      imageData.data.set(composed.pixels);
      context.putImageData(imageData, 0, 0);
      return {
        dataUrl: await blobToDataUrl(
          await canvas.convertToBlob({
            type: "image/webp",
            quality: 0.85
          })
        ),
        inkCoverage: composed.inkCoverage
      };
    };

    const [light, dark] = await Promise.all([
      renderVariant(SITE_ICON_SURFACES.light),
      renderVariant(SITE_ICON_SURFACES.dark)
    ]);
    if (light.inkCoverage < 0.15 || dark.inkCoverage < 0.15) {
      return {
        iconRejectReason: "low-ink-or-contrast",
        nativeWidth,
        nativeHeight
      };
    }
    return {
      iconDataUrl: light.dataUrl,
      iconDataUrlLight: light.dataUrl,
      iconDataUrlDark: dark.dataUrl,
      iconSource: candidate.source,
      nativeWidth,
      nativeHeight
    };
  } finally {
    bitmap.close();
  }
}

export async function cacheSiteBrandIcon(
  candidates: SiteIconCandidate[]
): Promise<CachedSiteIcon> {
  let lastRejection = "no-candidate";
  for (const candidate of candidates) {
    try {
      const result = await cacheSiteIconCandidate(candidate);
      if (result.iconDataUrlLight && result.iconDataUrlDark) return result;
      lastRejection = result.iconRejectReason || lastRejection;
    } catch (error) {
      lastRejection =
        error instanceof Error ? error.message : "image-processing-failed";
    }
  }
  return { iconRejectReason: lastRejection };
}

/**
 * 管线 B：校验并缓存页面封面。它服务 160px 以上的卡片场景，
 * 不用于 48px 书签列表。
 */
export async function cacheRepresentativeImage(
  imageUrl: string
): Promise<string> {
  if (!imageUrl) return "";
  const source = await fetchImage(imageUrl);
  if (source.size < 1_024) throw new Error("image-below-1kb");
  const bitmap = await bitmapFromBlob(source);
  try {
    if (bitmap.width < 200 || bitmap.height < 200) {
      throw new Error("image-below-200px");
    }
    const ratio =
      Math.max(bitmap.width, bitmap.height) /
      Math.min(bitmap.width, bitmap.height);
    if (ratio > 4) throw new Error("extreme-aspect-ratio");

    const scale = Math.min(
      1,
      PAGE_COVER_LONG_EDGE / Math.max(bitmap.width, bitmap.height)
    );
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d", {
      willReadFrequently: true
    });
    if (!context) throw new Error("image-processing-unavailable");
    context.drawImage(bitmap, 0, 0, width, height);
    if (
      inspectPixels(context, width, height).dominantColorRatio > 0.95
    ) {
      throw new Error("near-solid-image");
    }
    return blobToDataUrl(
      await canvas.convertToBlob({
        type: "image/webp",
        quality: 0.8
      })
    );
  } finally {
    bitmap.close();
  }
}

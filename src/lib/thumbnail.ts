import type {
  SiteBrandRecord,
  SiteIconCandidate,
  SiteIconSource
} from "./types";
import { pinnedBrandAssetNeedsRefresh } from "./cover-rules";
import { ICON_MAX_RATIO, ICON_MIN_INK, ICON_MIN_SIZE } from "./icon-quality";

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_SVG_BYTES = 256 * 1024;
const SITE_ICON_SIZE = 192;
const PAGE_COVER_LONG_EDGE = 512;
const SITE_ICON_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1_000;
const PUBLIC_SERVICE_ICON_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000;

export interface SiteIconSurface {
  red: number;
  green: number;
  blue: number;
}

export const SITE_ICON_SURFACE = {
  red: 255,
  green: 255,
  blue: 255
} as const satisfies SiteIconSurface;
// 9：渲染管线变更必须清字节重抓。8 曾只抬版本号保留旧图，导致过小/错标
// 仍显示；本版 invalidate 会清空图标字节并后台重抓。
export const SITE_ICON_RENDER_VERSION = 9;

export function siteBrandIconCacheIsFresh(
  brand:
    | Pick<
        SiteBrandRecord,
        "iconDataUrlLight" | "iconRenderVersion" | "updatedAt" | "iconSource"
      >
    | undefined,
  referenceTime = Date.now()
): boolean {
  if (
    !brand?.iconDataUrlLight ||
    brand.iconRenderVersion !== SITE_ICON_RENDER_VERSION
  ) {
    return false;
  }
  const updatedAt = Date.parse(brand.updatedAt);
  const maxAge =
    brand.iconSource === "public-service"
      ? PUBLIC_SERVICE_ICON_CACHE_MAX_AGE_MS
      : SITE_ICON_CACHE_MAX_AGE_MS;
  return Number.isFinite(updatedAt) && referenceTime - updatedAt < maxAge;
}

/**
 * Only the current alpha-preserving render is safe to show. Older records may
 * contain a dark pre-composited WebP in either compatibility field; keeping
 * those records readable is useful for migration, but they must never reach
 * an image element again.
 */
export function currentSiteBrandImageUrl(
  brand:
    | (Pick<
        SiteBrandRecord,
        "iconDataUrl" | "iconDataUrlLight" | "iconRenderVersion"
      > &
        Partial<Pick<SiteBrandRecord, "host" | "iconAssetUrl">>)
    | undefined
): string {
  if (brand?.iconRenderVersion !== SITE_ICON_RENDER_VERSION) return "";
  if (
    brand.host &&
    pinnedBrandAssetNeedsRefresh(
      `https://${brand.host}/`,
      brand.iconAssetUrl
    )
  ) {
    return "";
  }
  return brand.iconDataUrlLight || "";
}

export interface CachedSiteIcon {
  /** 当前透明缓存的兼容别名，供旧数据与旧调用方平滑迁移。 */
  iconDataUrl?: string;
  iconDataUrlLight?: string;
  iconRenderVersion?: number;
  iconSource?: SiteIconSource;
  iconAssetUrl?: string;
  iconRejectReason?: string;
  nativeWidth?: number;
  nativeHeight?: number;
}

export interface SiteIconDecodeFallbackInput {
  source: Blob;
  vector: boolean;
  nativeWidth?: number;
  nativeHeight?: number;
}

export type SiteIconDecodeFallback = (
  input: SiteIconDecodeFallbackInput
) => Promise<CachedSiteIcon>;

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

interface PixelPoint {
  x: number;
  y: number;
}

function isOpaqueDarkNeutralPixel(
  pixels: Uint8ClampedArray,
  index: number
): boolean {
  const alpha = pixels[index + 3] || 0;
  if (alpha < 224) return false;
  const red = pixels[index] || 0;
  const green = pixels[index + 1] || 0;
  const blue = pixels[index + 2] || 0;
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  return maximum <= 80 && maximum - minimum <= 32;
}

function convexHull(points: PixelPoint[]): PixelPoint[] {
  const sorted = points
    .sort((left, right) => left.x - right.x || left.y - right.y)
    .filter(
      (point, index, all) =>
        index === 0 ||
        point.x !== all[index - 1]!.x ||
        point.y !== all[index - 1]!.y
    );
  if (sorted.length <= 2) return sorted;
  const cross = (origin: PixelPoint, a: PixelPoint, b: PixelPoint) =>
    (a.x - origin.x) * (b.y - origin.y) -
    (a.y - origin.y) * (b.x - origin.x);
  const lower: PixelPoint[] = [];
  for (const point of sorted) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2]!, lower[lower.length - 1]!, point) <= 0
    ) {
      lower.pop();
    }
    lower.push(point);
  }
  const upper: PixelPoint[] = [];
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const point = sorted[index]!;
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2]!, upper[upper.length - 1]!, point) <= 0
    ) {
      upper.pop();
    }
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

function polygonArea(points: PixelPoint[]): number {
  let twiceArea = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]!;
    const next = points[(index + 1) % points.length]!;
    twiceArea += current.x * next.y - next.x * current.y;
  }
  return Math.abs(twiceArea) / 2;
}

/**
 * Some app-icon assets contain a neutral dark presentation matte even though
 * the useful logo is centred inside it. Remove only the outer matte while
 * retaining dark logo pixels enclosed by the coloured/light artwork. This is
 * a generic pixel transform and does not alter candidate selection.
 */
function removeOpaqueDarkOuterMatte(
  sourcePixels: Uint8ClampedArray,
  canvasWidth: number,
  canvasHeight: number,
  left: number,
  top: number,
  right: number,
  bottom: number
): Uint8ClampedArray {
  const output = new Uint8ClampedArray(sourcePixels);
  if (right - left < 8 || bottom - top < 8) return output;
  const indexAt = (x: number, y: number) => (y * canvasWidth + x) * 4;
  const cornerCoordinates = [
    [left, top],
    [right - 1, top],
    [left, bottom - 1],
    [right - 1, bottom - 1]
  ] as const;
  const darkCorners = cornerCoordinates.filter(([x, y]) =>
    isOpaqueDarkNeutralPixel(sourcePixels, indexAt(x, y))
  ).length;
  if (darkCorners < 3) return output;

  let darkBorderPixels = 0;
  let borderPixels = 0;
  const inspectBorderPixel = (x: number, y: number) => {
    borderPixels += 1;
    if (isOpaqueDarkNeutralPixel(sourcePixels, indexAt(x, y))) {
      darkBorderPixels += 1;
    }
  };
  for (let x = left; x < right; x += 1) {
    inspectBorderPixel(x, top);
    inspectBorderPixel(x, bottom - 1);
  }
  for (let y = top + 1; y < bottom - 1; y += 1) {
    inspectBorderPixel(left, y);
    inspectBorderPixel(right - 1, y);
  }
  if (!borderPixels || darkBorderPixels / borderPixels < 0.78) return output;

  const rowMinimum = new Int32Array(canvasHeight);
  const rowMaximum = new Int32Array(canvasHeight);
  const columnMinimum = new Int32Array(canvasWidth);
  const columnMaximum = new Int32Array(canvasWidth);
  rowMinimum.fill(canvasWidth);
  rowMaximum.fill(-1);
  columnMinimum.fill(canvasHeight);
  columnMaximum.fill(-1);
  let foregroundPixels = 0;
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const index = indexAt(x, y);
      if (
        (sourcePixels[index + 3] || 0) < 24 ||
        isOpaqueDarkNeutralPixel(sourcePixels, index)
      ) {
        continue;
      }
      foregroundPixels += 1;
      rowMinimum[y] = Math.min(rowMinimum[y]!, x);
      rowMaximum[y] = Math.max(rowMaximum[y]!, x);
      columnMinimum[x] = Math.min(columnMinimum[x]!, y);
      columnMaximum[x] = Math.max(columnMaximum[x]!, y);
    }
  }
  const contentArea = (right - left) * (bottom - top);
  if (foregroundPixels / contentArea < 0.02) return output;

  const boundaryPoints: PixelPoint[] = [];
  for (let y = top; y < bottom; y += 1) {
    if (rowMaximum[y]! < 0) continue;
    boundaryPoints.push({ x: rowMinimum[y]!, y });
    boundaryPoints.push({ x: rowMaximum[y]!, y });
  }
  for (let x = left; x < right; x += 1) {
    if (columnMaximum[x]! < 0) continue;
    boundaryPoints.push({ x, y: columnMinimum[x]! });
    boundaryPoints.push({ x, y: columnMaximum[x]! });
  }
  const hull = convexHull(boundaryPoints);
  if (hull.length < 3 || polygonArea(hull) / contentArea < 0.04) return output;

  const spanMinimum = new Int32Array(canvasHeight);
  const spanMaximum = new Int32Array(canvasHeight);
  spanMinimum.fill(canvasWidth);
  spanMaximum.fill(-1);
  for (let y = top; y < bottom; y += 1) {
    let minimum = Number.POSITIVE_INFINITY;
    let maximum = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < hull.length; index += 1) {
      const start = hull[index]!;
      const end = hull[(index + 1) % hull.length]!;
      const low = Math.min(start.y, end.y);
      const high = Math.max(start.y, end.y);
      if (y < low || y > high) continue;
      if (start.y === end.y) {
        minimum = Math.min(minimum, start.x, end.x);
        maximum = Math.max(maximum, start.x, end.x);
        continue;
      }
      const ratio = (y - start.y) / (end.y - start.y);
      const x = start.x + (end.x - start.x) * ratio;
      minimum = Math.min(minimum, x);
      maximum = Math.max(maximum, x);
    }
    if (Number.isFinite(minimum) && Number.isFinite(maximum)) {
      spanMinimum[y] = Math.floor(minimum);
      spanMaximum[y] = Math.ceil(maximum);
    }
  }

  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const index = indexAt(x, y);
      if (
        !isOpaqueDarkNeutralPixel(sourcePixels, index) ||
        (x >= spanMinimum[y]! && x <= spanMaximum[y]!)
      ) {
        continue;
      }
      output[index] = 0;
      output[index + 1] = 0;
      output[index + 2] = 0;
      output[index + 3] = 0;
    }
  }
  return output;
}

export interface NormalizedSiteIcon {
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
 * 保留站点图标的原始颜色和透明通道；若来源图片带有覆盖整个方形画布
 * 的中性深色展示底，只移除外围底色并保留被图形包围的深色 Logo。
 * 只有整张可见图形几乎都是浅色时才整体转为中性深色，避免白色单色
 * Logo 在固定白色承载层上消失。背景始终由 SiteThumbnail 的 CSS 负责。
 */
export function normalizeSiteIconPixels(
  sourcePixels: Uint8ClampedArray,
  surface: SiteIconSurface,
  contentRect: SiteIconContentRect
): NormalizedSiteIcon {
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
  const output = removeOpaqueDarkOuterMatte(
    sourcePixels,
    canvasWidth,
    canvasHeight,
    left,
    top,
    right,
    bottom
  );
  const fallback = 24;
  let visible = 0;
  let contrasting = 0;
  for (let index = 0; index < output.length; index += 4) {
    const alpha = (output[index + 3] || 0) / 255;
    if (alpha < 24 / 255) continue;
    visible += 1;
    const renderedRed = Math.round(
      (output[index] || 0) * alpha + surface.red * (1 - alpha)
    );
    const renderedGreen = Math.round(
      (output[index + 1] || 0) * alpha + surface.green * (1 - alpha)
    );
    const renderedBlue = Math.round(
      (output[index + 2] || 0) * alpha + surface.blue * (1 - alpha)
    );
    if (contrastRatio(renderedRed, renderedGreen, renderedBlue, surface) >= 1.8) {
      contrasting += 1;
    }
  }
  const liftEntireLightArtwork = visible > 0 && contrasting / visible < 0.08;
  let ink = 0;

  for (let index = 0; index < output.length; index += 4) {
    const alpha = (output[index + 3] || 0) / 255;
    const red = liftEntireLightArtwork && alpha >= 24 / 255
      ? fallback
      : output[index] || 0;
    const green = liftEntireLightArtwork && alpha >= 24 / 255
      ? fallback
      : output[index + 1] || 0;
    const blue = liftEntireLightArtwork && alpha >= 24 / 255
      ? fallback
      : output[index + 2] || 0;
    const visibleRed = Math.round(red * alpha + surface.red * (1 - alpha));
    const visibleGreen = Math.round(
      green * alpha + surface.green * (1 - alpha)
    );
    const visibleBlue = Math.round(
      blue * alpha + surface.blue * (1 - alpha)
    );

    output[index] = red;
    output[index + 1] = green;
    output[index + 2] = blue;
    const pixel = index / 4;
    const x = pixel % canvasWidth;
    const y = Math.floor(pixel / canvasWidth);
    if (
      x >= left &&
      x < right &&
      y >= top &&
      y < bottom &&
      alpha >= 24 / 255 &&
      contrastRatio(visibleRed, visibleGreen, visibleBlue, surface) >= 1.8
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
  let timeout: ReturnType<typeof globalThis.setTimeout> | undefined;
  try {
    return await Promise.race([
      createImageBitmap(blob),
      new Promise<never>((_, reject) => {
        timeout = globalThis.setTimeout(
          () => reject(new Error("image-decode-timeout")),
          3_000
        );
      })
    ]);
  } finally {
    if (timeout !== undefined) globalThis.clearTimeout(timeout);
  }
}

async function cacheSiteIconCandidate(
  candidate: SiteIconCandidate,
  decodeFallback?: SiteIconDecodeFallback
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
    if (decodeFallback) {
      const result = await decodeFallback({
        source: new Blob([sourceBytes], { type: "image/x-icon" }),
        vector: false
      });
      return result.iconDataUrlLight
        ? {
            ...result,
            iconSource: candidate.source,
            iconAssetUrl: candidate.url
          }
        : result;
    }
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
  let bitmap: ImageBitmap;
  try {
    bitmap = await bitmapFromBlob(source);
  } catch (error) {
    if (!decodeFallback) throw error;
    const result = await decodeFallback({
      source,
      vector: Boolean(viewport || candidate.vector),
      ...(viewport?.intrinsicWidth
        ? { nativeWidth: viewport.intrinsicWidth }
        : {}),
      ...(viewport?.intrinsicHeight
        ? { nativeHeight: viewport.intrinsicHeight }
        : {})
    });
    return result.iconDataUrlLight
      ? {
          ...result,
          iconSource: candidate.source,
          iconAssetUrl: candidate.url
        }
      : result;
  }
  try {
    // 固有尺寸用于上报和方形判定；绘制一律用解码后的实际位图尺寸，
    // 矢量图这两者不同。
    const nativeWidth =
      viewport?.intrinsicWidth || icoFrame?.width || bitmap.width;
    const nativeHeight =
      viewport?.intrinsicHeight || icoFrame?.height || bitmap.height;
    const renderWidth = bitmap.width;
    const renderHeight = bitmap.height;
    // 质量门槛放宽：16px 是 favicon 的最小常见尺寸，只有连 16px 都
    // 没有的候选才拒绝；此前 128px 门槛会把大量真实 favicon 挡在
    // 门外导致误用兜底图。
    if (!candidate.vector && (nativeWidth < ICON_MIN_SIZE || nativeHeight < ICON_MIN_SIZE)) {
      return {
        iconRejectReason: "below-16px",
        nativeWidth,
        nativeHeight
      };
    }
    const ratio =
      Math.max(nativeWidth, nativeHeight) /
      Math.min(nativeWidth, nativeHeight);
    // 比例上限放宽到 3:1：方形 favicon 之外，横幅/宽图标也允许进入，
    // 只有明显不成比例的候选才拒绝。
    if (ratio > ICON_MAX_RATIO) {
      return {
        iconRejectReason: "extreme-ratio",
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
    // Contain 填满画布：小 favicon 必须放大，否则 42px 列表里只剩中心小点。
    const scale = SITE_ICON_SIZE / Math.max(renderWidth, renderHeight);
    const width = renderWidth * scale;
    const height = renderHeight * scale;
    const x = (SITE_ICON_SIZE - width) / 2;
    const y = (SITE_ICON_SIZE - height) / 2;
    sourceContext.imageSmoothingEnabled = true;
    sourceContext.imageSmoothingQuality = "high";
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
    const contentRect = {
      x,
      y,
      width,
      height,
      canvasWidth: SITE_ICON_SIZE
    };
    const normalized = normalizeSiteIconPixels(
      sourcePixels,
      SITE_ICON_SURFACE,
      contentRect
    );
    // 墨迹下限降到 0.01：几乎全白/全透明的图才拒绝，正常低对比度
    // favicon 也允许进入（用户要求“抓得到就用真实图标”）。
    if (normalized.inkCoverage < ICON_MIN_INK) {
      return {
        iconRejectReason: "blank-image",
        nativeWidth,
        nativeHeight
      };
    }
    const imageData = sourceContext.createImageData(
      SITE_ICON_SIZE,
      SITE_ICON_SIZE
    );
    imageData.data.set(normalized.pixels);
    sourceContext.putImageData(imageData, 0, 0);
    const transparentDataUrl = await blobToDataUrl(
      await sourceCanvas.convertToBlob({
        type: "image/webp",
        quality: 0.85
      })
    );
    return {
      iconDataUrl: transparentDataUrl,
      iconDataUrlLight: transparentDataUrl,
      iconRenderVersion: SITE_ICON_RENDER_VERSION,
      iconSource: candidate.source,
      iconAssetUrl: candidate.url,
      nativeWidth,
      nativeHeight
    };
  } finally {
    bitmap.close();
  }
}

export async function cacheSiteBrandIcon(
  candidates: SiteIconCandidate[],
  decodeFallback?: SiteIconDecodeFallback
): Promise<CachedSiteIcon> {
  let lastRejection = "no-candidate";
  const groups = [candidates.slice(0, 4), candidates.slice(4)];
  for (const group of groups) {
    if (!group.length) continue;
    const results = await Promise.allSettled(
      group.map((candidate) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        return Promise.race([
          cacheSiteIconCandidate(candidate, decodeFallback),
          new Promise<CachedSiteIcon>((_, reject) => {
            timer = setTimeout(() => reject(new Error("icon-candidate-timeout")), 5_000);
          })
        ]).finally(() => {
          if (timer) clearTimeout(timer);
        });
      })
    );
    // 并行只降低等待时间；选择仍严格遵循候选原始优先级。
    for (const result of results) {
      if (result.status === "fulfilled" && result.value.iconDataUrlLight) {
        return result.value;
      }
      lastRejection = result.status === "fulfilled"
        ? result.value.iconRejectReason || lastRejection
        : result.reason instanceof Error
          ? result.reason.message
          : "image-processing-failed";
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
    // Make the cached page cover opaque before encoding it. A transparent
    // canvas carries black RGB channels underneath its zero-alpha pixels; if
    // the image is ever rendered outside SiteThumbnail, those pixels must not
    // become a dark background.
    context.globalCompositeOperation = "destination-over";
    context.fillStyle = `rgb(${SITE_ICON_SURFACE.red} ${SITE_ICON_SURFACE.green} ${SITE_ICON_SURFACE.blue})`;
    context.fillRect(0, 0, width, height);
    context.globalCompositeOperation = "source-over";
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

import type {
  SiteIconCandidate,
  SiteIconSource
} from "./types";

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_SVG_BYTES = 256 * 1024;
const SITE_ICON_SIZE = 192;
const PAGE_COVER_LONG_EDGE = 512;

export interface CachedSiteIcon {
  iconDataUrl?: string;
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

async function fetchImage(url: string, maxBytes = MAX_IMAGE_BYTES) {
  const response = await fetch(url, {
    credentials: "omit",
    redirect: "follow",
    headers: {
      Accept: "image/avif,image/webp,image/svg+xml,image/*,*/*;q=0.3"
    },
    signal: AbortSignal.timeout(12_000)
  });
  const contentType = response.headers.get("content-type") || "";
  if (!response.ok || !contentType.toLowerCase().startsWith("image/")) {
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
    candidate.vector ? MAX_SVG_BYTES : MAX_IMAGE_BYTES
  );
  if (
    candidate.vector ||
    source.type.toLowerCase().includes("svg") ||
    /\.svg(?:[?#]|$)/i.test(candidate.url)
  ) {
    source = await safeSvgBlob(source);
  }
  const bitmap = await bitmapFromBlob(source);
  try {
    const nativeWidth = bitmap.width;
    const nativeHeight = bitmap.height;
    if (nativeWidth < 128 || nativeHeight < 128) {
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

    const canvas = new OffscreenCanvas(SITE_ICON_SIZE, SITE_ICON_SIZE);
    const context = canvas.getContext("2d", {
      willReadFrequently: true
    });
    if (!context) throw new Error("image-processing-unavailable");
    context.clearRect(0, 0, SITE_ICON_SIZE, SITE_ICON_SIZE);
    const scale = Math.min(
      1,
      SITE_ICON_SIZE / Math.max(nativeWidth, nativeHeight)
    );
    const width = nativeWidth * scale;
    const height = nativeHeight * scale;
    context.drawImage(
      bitmap,
      (SITE_ICON_SIZE - width) / 2,
      (SITE_ICON_SIZE - height) / 2,
      width,
      height
    );
    const quality = inspectPixels(
      context,
      SITE_ICON_SIZE,
      SITE_ICON_SIZE
    );
    if (quality.inkCoverage < 0.15) {
      return {
        iconRejectReason: "low-ink-or-contrast",
        nativeWidth,
        nativeHeight
      };
    }
    return {
      iconDataUrl: await blobToDataUrl(
        await canvas.convertToBlob({
          type: "image/webp",
          quality: 0.85
        })
      ),
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
      if (result.iconDataUrl) return result;
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

    const scale =
      PAGE_COVER_LONG_EDGE / Math.max(bitmap.width, bitmap.height);
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

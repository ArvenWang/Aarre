import {
  isOffscreenSiteIconRequest,
  OFFSCREEN_SITE_ICON_RESPONSE,
  OFFSCREEN_SITE_ICON_TARGET,
  type OffscreenSiteIconRequest,
  type OffscreenSiteIconResponse
} from "../lib/offscreen-icon-protocol";
import {
  normalizeSiteIconPixels,
  SITE_ICON_RENDER_VERSION,
  SITE_ICON_SURFACE,
  type CachedSiteIcon
} from "../lib/thumbnail";

const SITE_ICON_SIZE = 192;
const MAX_DATA_URL_LENGTH = 6_000_000;
const IMAGE_LOAD_TIMEOUT_MS = 4_000;

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const timer = globalThis.setTimeout(() => {
      image.src = "";
      reject(new Error("dom-image-decode-timeout"));
    }, IMAGE_LOAD_TIMEOUT_MS);
    image.onload = () => {
      globalThis.clearTimeout(timer);
      resolve(image);
    };
    image.onerror = () => {
      globalThis.clearTimeout(timer);
      reject(new Error("dom-image-decode-failed"));
    };
    image.decoding = "async";
    image.src = dataUrl;
  });
}

function canvasBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("image-encode-failed")),
      type,
      quality
    );
  });
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const parts: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    parts.push(
      String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
    );
  }
  return `data:${blob.type};base64,${btoa(parts.join(""))}`;
}

async function renderSiteIcon(
  request: OffscreenSiteIconRequest
): Promise<CachedSiteIcon> {
  if (
    request.dataUrl.length > MAX_DATA_URL_LENGTH ||
    !/^data:image\/[a-z0-9.+-]+;base64,/i.test(request.dataUrl)
  ) {
    return { iconRejectReason: "invalid-offscreen-image-input" };
  }
  const image = await loadImage(request.dataUrl);
  const renderWidth = image.naturalWidth;
  const renderHeight = image.naturalHeight;
  const nativeWidth = request.nativeWidth || renderWidth;
  const nativeHeight = request.nativeHeight || renderHeight;
  if (!renderWidth || !renderHeight || !nativeWidth || !nativeHeight) {
    return { iconRejectReason: "empty-image-dimensions" };
  }
  if (!request.vector && (nativeWidth < 128 || nativeHeight < 128)) {
    return { iconRejectReason: "below-128px", nativeWidth, nativeHeight };
  }
  if (
    Math.max(nativeWidth, nativeHeight) / Math.min(nativeWidth, nativeHeight) >
    1.2
  ) {
    return { iconRejectReason: "non-square", nativeWidth, nativeHeight };
  }

  const canvas = document.createElement("canvas");
  canvas.width = SITE_ICON_SIZE;
  canvas.height = SITE_ICON_SIZE;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("image-processing-unavailable");
  const scale = Math.min(
    1,
    SITE_ICON_SIZE / Math.max(renderWidth, renderHeight)
  );
  const width = renderWidth * scale;
  const height = renderHeight * scale;
  const x = (SITE_ICON_SIZE - width) / 2;
  const y = (SITE_ICON_SIZE - height) / 2;
  context.clearRect(0, 0, SITE_ICON_SIZE, SITE_ICON_SIZE);
  context.drawImage(image, x, y, width, height);
  const source = context.getImageData(
    0,
    0,
    SITE_ICON_SIZE,
    SITE_ICON_SIZE
  );
  const normalized = normalizeSiteIconPixels(source.data, SITE_ICON_SURFACE, {
    x,
    y,
    width,
    height,
    canvasWidth: SITE_ICON_SIZE
  });
  if (normalized.inkCoverage < 0.15) {
    return {
      iconRejectReason: "low-ink-or-contrast",
      nativeWidth,
      nativeHeight
    };
  }
  const output = context.createImageData(SITE_ICON_SIZE, SITE_ICON_SIZE);
  output.data.set(normalized.pixels);
  context.putImageData(output, 0, 0);
  const dataUrl = await blobToDataUrl(
    await canvasBlob(canvas, "image/webp", 0.85)
  );
  return {
    iconDataUrl: dataUrl,
    iconDataUrlLight: dataUrl,
    iconRenderVersion: SITE_ICON_RENDER_VERSION,
    nativeWidth,
    nativeHeight
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!isOffscreenSiteIconRequest(message)) return false;
  void renderSiteIcon(message)
    .then((result) => {
      const response: OffscreenSiteIconResponse = {
        type: OFFSCREEN_SITE_ICON_RESPONSE,
        target: OFFSCREEN_SITE_ICON_TARGET,
        requestId: message.requestId,
        ok: Boolean(result.iconDataUrlLight),
        result,
        ...(result.iconDataUrlLight
          ? {}
          : {
              error:
                result.iconRejectReason || "offscreen-image-decode-failed"
            })
      };
      sendResponse(response);
    })
    .catch((error) => {
      const response: OffscreenSiteIconResponse = {
        type: OFFSCREEN_SITE_ICON_RESPONSE,
        target: OFFSCREEN_SITE_ICON_TARGET,
        requestId: message.requestId,
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "offscreen-image-decode-failed"
      };
      sendResponse(response);
    });
  return true;
});

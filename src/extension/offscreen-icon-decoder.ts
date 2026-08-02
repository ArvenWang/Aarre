import type {
  CachedSiteIcon,
  SiteIconDecodeFallbackInput
} from "../lib/thumbnail";
import {
  isOffscreenSiteIconResponse,
  OFFSCREEN_SITE_ICON_REQUEST,
  OFFSCREEN_SITE_ICON_TARGET,
  type OffscreenSiteIconRequest
} from "../lib/offscreen-icon-protocol";

const OFFSCREEN_DOCUMENT_PATH = "icon-processor.html";
const OFFSCREEN_RESPONSE_TIMEOUT_MS = 6_000;
let offscreenCreation: Promise<void> | undefined;

async function ensureIconProcessorDocument(): Promise<void> {
  const documentUrl = chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH);
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [documentUrl]
  });
  if (contexts.length) return;
  if (!offscreenCreation) {
    offscreenCreation = chrome.offscreen
      .createDocument({
        url: OFFSCREEN_DOCUMENT_PATH,
        reasons: [chrome.offscreen.Reason.BLOBS],
        justification:
          "Decode validated site icons that a Manifest V3 service worker cannot render."
      })
      .finally(() => {
        offscreenCreation = undefined;
      });
  }
  await offscreenCreation;
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const parts: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    parts.push(
      String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
    );
  }
  return `data:${blob.type || "image/png"};base64,${btoa(parts.join(""))}`;
}

function responseTimeout(): Promise<never> {
  return new Promise((_, reject) => {
    globalThis.setTimeout(
      () => reject(new Error("offscreen-image-decode-timeout")),
      OFFSCREEN_RESPONSE_TIMEOUT_MS
    );
  });
}

export async function decodeSiteIconWithOffscreen(
  input: SiteIconDecodeFallbackInput
): Promise<CachedSiteIcon> {
  await ensureIconProcessorDocument();
  const requestId = crypto.randomUUID();
  const request: OffscreenSiteIconRequest = {
    type: OFFSCREEN_SITE_ICON_REQUEST,
    target: OFFSCREEN_SITE_ICON_TARGET,
    requestId,
    dataUrl: await blobToDataUrl(input.source),
    vector: input.vector,
    ...(input.nativeWidth ? { nativeWidth: input.nativeWidth } : {}),
    ...(input.nativeHeight ? { nativeHeight: input.nativeHeight } : {})
  };
  const response = await Promise.race([
    chrome.runtime.sendMessage(request),
    responseTimeout()
  ]);
  if (!isOffscreenSiteIconResponse(response, requestId)) {
    throw new Error("invalid-offscreen-image-response");
  }
  if (!response.ok) {
    return {
      iconRejectReason: response.error || "offscreen-image-decode-failed"
    };
  }
  return response.result || {
    iconRejectReason: "empty-offscreen-image-response"
  };
}

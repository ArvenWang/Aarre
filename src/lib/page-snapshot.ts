import { canonicalizeUrl, isSupportedPageUrl } from "./url";
import { isInternalOrSensitiveUrl } from "./page-essence";
import type { PageSnapshot } from "./types";

const BUILT_IN_SENSITIVE_HOSTS = [
  "alipay.com",
  "adyen.com",
  "bankofamerica.com",
  "bankcomm.com",
  "barclays.co.uk",
  "boc.cn",
  "capitalone.com",
  "ccb.com",
  "chase.com",
  "checkout.com",
  "citi.com",
  "citibank.com",
  "cmbchina.com",
  "dbs.com",
  "hsbc.com",
  "icbc.com.cn",
  "klarna.com",
  "ocbc.com",
  "paypal.com",
  "payoneer.com",
  "squareup.com",
  "standardchartered.com",
  "tenpay.com",
  "unionpay.com",
  "uob.com.sg",
  "wechatpay.cn",
  "wellsfargo.com",
  "stripe.com",
  "wise.com",
  "revolut.com",
  "mychart.com",
  "myhealthrecord.gov.au",
  "zocdoc.com"
];

function hostMatches(host: string, blocked: string): boolean {
  const normalized = blocked
    .trim()
    .toLocaleLowerCase()
    .replace(/^\*\./, "");
  return Boolean(normalized) &&
    (host === normalized || host.endsWith(`.${normalized}`));
}

export function isSnapshotSensitiveUrl(
  input: string,
  customHosts: string[] = []
): boolean {
  if (!isSupportedPageUrl(input) || isInternalOrSensitiveUrl(input)) {
    return true;
  }
  try {
    const host = new URL(input).hostname.toLocaleLowerCase();
    if (
      host.endsWith(".bank") ||
      /(^|[.-])(bank|banking|clinic|health|hospital|medical|patient|payment|payments|wallet)([.-]|$)/.test(
        host
      ) ||
      host.includes("onlinebank") ||
      host.includes("internetbank") ||
      host.includes("bankof")
    ) {
      return true;
    }
    return [...BUILT_IN_SENSITIVE_HOSTS, ...customHosts].some((blocked) =>
      hostMatches(host, blocked)
    );
  } catch {
    return true;
  }
}

export function matchesSnapshotTargetUrl(
  targetUrl: string,
  loadedUrl: string
): boolean {
  try {
    return canonicalizeUrl(targetUrl) === canonicalizeUrl(loadedUrl);
  } catch {
    return false;
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return blob.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer);
    const chunks: string[] = [];
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      chunks.push(
        String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
      );
    }
    return `data:${blob.type};base64,${btoa(chunks.join(""))}`;
  });
}

export async function createPageSnapshot(
  canonicalUrl: string,
  pngDataUrl: string,
  capturedAt = new Date().toISOString()
): Promise<PageSnapshot> {
  const source = await (await fetch(pngDataUrl)).blob();
  const bitmap = await createImageBitmap(source);
  try {
    const targetWidth = Math.min(680, bitmap.width);
    const targetHeight = Math.round(targetWidth / 1.6);
    const sourceRatio = bitmap.width / bitmap.height;
    const sourceWidth =
      sourceRatio > 1.6 ? Math.round(bitmap.height * 1.6) : bitmap.width;
    const sourceHeight =
      sourceRatio > 1.6 ? bitmap.height : Math.round(bitmap.width / 1.6);
    const canvas = new OffscreenCanvas(targetWidth, targetHeight);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("页面快照处理不可用");
    context.drawImage(
      bitmap,
      (bitmap.width - sourceWidth) / 2,
      (bitmap.height - sourceHeight) / 2,
      sourceWidth,
      sourceHeight,
      0,
      0,
      targetWidth,
      targetHeight
    );
    return {
      canonicalUrl: canonicalizeUrl(canonicalUrl),
      imageDataUrl: await blobToDataUrl(
        await canvas.convertToBlob({
          type: "image/webp",
          quality: 0.75
        })
      ),
      capturedAt,
      width: targetWidth,
      height: targetHeight
    };
  } finally {
    bitmap.close();
  }
}

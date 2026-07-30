import { canonicalizeUrl, isSupportedPageUrl } from "./url";
import { isInternalOrSensitiveUrl } from "./page-essence";
import type { PageSnapshot } from "./types";

export const PAGE_SNAPSHOT_WIDTH = 960;
export const PAGE_SNAPSHOT_REFRESH_INTERVAL_MS =
  7 * 24 * 60 * 60 * 1_000;

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

export function mergePageSnapshotSchedule(
  existing: {
    delayMs: number;
    showToast: boolean;
    completedUrl?: string;
  } | undefined,
  next: {
    delayMs: number;
    showToast: boolean;
  }
): {
  delayMs: number;
  showToast: boolean;
  completedUrl?: string;
} {
  return {
    delayMs: Math.max(next.delayMs, existing?.delayMs || 0),
    showToast: next.showToast || existing?.showToast === true,
    ...(existing?.completedUrl
      ? { completedUrl: existing.completedUrl }
      : {})
  };
}

export function isPageSnapshotStale(
  snapshot: Pick<PageSnapshot, "capturedAt"> | null | undefined,
  referenceTime = Date.now(),
  refreshIntervalMs = PAGE_SNAPSHOT_REFRESH_INTERVAL_MS
): boolean {
  if (!snapshot) return true;
  const capturedAt = Date.parse(snapshot.capturedAt);
  return (
    !Number.isFinite(capturedAt) ||
    referenceTime - capturedAt >= refreshIntervalMs
  );
}

export function isLoadedSnapshotTab(
  tab: Pick<
    chrome.tabs.Tab,
    "active" | "incognito" | "status" | "url"
  >,
  expectedUrl = ""
): boolean {
  return Boolean(
    tab.active &&
      !tab.incognito &&
      tab.status === "complete" &&
      tab.url &&
      isSupportedPageUrl(tab.url) &&
      (!expectedUrl || matchesSnapshotTargetUrl(expectedUrl, tab.url))
  );
}

/**
 * 此函数会被 chrome.scripting.executeScript 序列化到网页上下文执行，
 * 因此函数体必须保持自包含，不能引用模块外变量。
 */
export async function waitForStablePageInDocument(
  quietWindowMs = 900,
  maxQuietWaitMs = 4_000
): Promise<boolean> {
  if (
    document.readyState !== "complete" ||
    !document.documentElement
  ) {
    return false;
  }

  const wait = (milliseconds: number) =>
    new Promise<void>((resolve) => {
      globalThis.setTimeout(resolve, milliseconds);
    });

  if ("fonts" in document) {
    await Promise.race([document.fonts.ready.then(() => undefined), wait(3_000)]);
  }

  const visibleImages = Array.from(document.images)
    .filter((image) => {
      if (image.complete) return false;
      const rect = image.getBoundingClientRect();
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        rect.bottom >= 0 &&
        rect.top <= globalThis.innerHeight * 1.5
      );
    })
    .slice(0, 24);
  await Promise.all(
    visibleImages.map(
      (image) =>
        new Promise<void>((resolve) => {
          const finish = () => {
            image.removeEventListener("load", finish);
            image.removeEventListener("error", finish);
            resolve();
          };
          image.addEventListener("load", finish, { once: true });
          image.addEventListener("error", finish, { once: true });
          globalThis.setTimeout(finish, 3_000);
        })
    )
  );

  await new Promise<void>((resolve) => {
    let finished = false;
    let quietTimer: ReturnType<typeof globalThis.setTimeout> | undefined;
    let maximumTimer:
      | ReturnType<typeof globalThis.setTimeout>
      | undefined;
    const observer = new MutationObserver(() => {
      if (quietTimer !== undefined) globalThis.clearTimeout(quietTimer);
      quietTimer = globalThis.setTimeout(finish, quietWindowMs);
    });
    const finish = () => {
      if (finished) return;
      finished = true;
      if (quietTimer !== undefined) globalThis.clearTimeout(quietTimer);
      if (maximumTimer !== undefined) {
        globalThis.clearTimeout(maximumTimer);
      }
      observer.disconnect();
      resolve();
    };
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true
    });
    quietTimer = globalThis.setTimeout(finish, quietWindowMs);
    maximumTimer = globalThis.setTimeout(finish, maxQuietWaitMs);
  });

  await new Promise<void>((resolve) => {
    globalThis.requestAnimationFrame(() =>
      globalThis.requestAnimationFrame(() => resolve())
    );
  });
  return document.readyState === "complete";
}

/**
 * 本函数会被序列化到网页上下文中执行。Shadow DOM 用来隔离站点样式，
 * 固定宿主 id 则避免重复提示叠在一起。
 */
export function showSnapshotUpdatedToastInDocument(): void {
  const hostId = "aarre-snapshot-updated-toast";
  document.getElementById(hostId)?.remove();

  const host = document.createElement("div");
  host.id = hostId;
  host.style.position = "fixed";
  host.style.left = "50%";
  host.style.bottom = "28px";
  host.style.zIndex = "2147483647";
  host.style.transform = "translateX(-50%)";
  host.style.pointerEvents = "none";

  const shadow = host.attachShadow({ mode: "closed" });
  const toast = document.createElement("div");
  toast.setAttribute("role", "status");
  toast.setAttribute("aria-live", "polite");
  toast.textContent = "封面截图已更新";
  Object.assign(toast.style, {
    boxSizing: "border-box",
    maxWidth: "calc(100vw - 32px)",
    padding: "11px 16px",
    border: "1px solid rgba(255, 255, 255, 0.14)",
    borderRadius: "12px",
    background: "rgba(22, 24, 27, 0.94)",
    boxShadow: "0 12px 36px rgba(0, 0, 0, 0.26)",
    color: "#ffffff",
    font: "600 14px/1.4 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    letterSpacing: "0.01em",
    opacity: "0",
    transform: "translateY(8px)",
    transition: "opacity 160ms ease, transform 160ms ease"
  });
  shadow.append(toast);
  document.documentElement.append(host);
  globalThis.requestAnimationFrame(() => {
    toast.style.opacity = "1";
    toast.style.transform = "translateY(0)";
  });
  globalThis.setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(6px)";
    globalThis.setTimeout(() => host.remove(), 180);
  }, 3_000);
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
    const targetWidth = Math.min(PAGE_SNAPSHOT_WIDTH, bitmap.width);
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

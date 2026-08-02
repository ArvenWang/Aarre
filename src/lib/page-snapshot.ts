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
  expectedUrl = "",
  requireActive = true
): boolean {
  return Boolean(
    (!requireActive || tab.active) &&
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
  maxQuietWaitMs = 4_000,
  options: {
    fontTimeoutMs?: number;
    imageTimeoutMs?: number;
    rAFTimeoutMs?: number;
    /**
     * 后台补拍专用：未开始加载的懒加载图片也要等待。
     * 隐藏标签页不会触发 IntersectionObserver 懒加载，这类图片的
     * complete 也是 true 但 naturalWidth 为 0，旧逻辑会错误跳过。
     */
    waitForPendingImages?: boolean;
    /** 网络活动安静窗口。后台补拍专用：DOM 安静不代表 fetch/XHR 渲染完成。 */
    resourceQuietMs?: number;
    /** 网络安静等待上限，避免站点持续加载拖住整个队列。 */
    resourceQuietMaxMs?: number;
  } = {}
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
    await Promise.race([
      document.fonts.ready.then(() => undefined),
      wait(options.fontTimeoutMs ?? 3_000)
    ]);
  }

  const visibleImages = Array.from(document.images)
    .filter((image) => {
      // 非后台路径保持旧行为：complete 的图片（含已失败、空图）不再等待。
      if (!options.waitForPendingImages && image.complete) return false;
      // 已成功解码或根本没有资源的空图视为就绪；未开始的懒加载图
      // complete=true 但 naturalWidth=0，必须继续等待。
      const hasPendingSource = Boolean(
        image.getAttribute("src") ||
          image.getAttribute("srcset") ||
          image.getAttribute("data-src") ||
          image.getAttribute("data-srcset") ||
          image.getAttribute("data-lazy-src") ||
          image.getAttribute("data-original")
      );
      if (
        image.complete &&
        (image.naturalWidth > 0 ||
          image.naturalHeight > 0 ||
          !hasPendingSource)
      ) {
        return false;
      }
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
          globalThis.setTimeout(
            finish,
            options.imageTimeoutMs ?? 3_000
          );
        })
    )
  );

  // DOM 安静不代表页面渲染完成：SPA 的数据请求、CSS 背景图和
  // 接口驱动的区块都可能在 load 事件之后才到达。用 resource timing
  // 判断“最近没有资源完成传输”，安静一段时间再继续。环境不支持时跳过。
  if (options.resourceQuietMs && options.resourceQuietMaxMs) {
    const quietMs = options.resourceQuietMs;
    const startAt = performance.now();
    const latestResourceEnd = (): number => {
      try {
        const entries = performance.getEntriesByType(
          "resource"
        ) as PerformanceResourceTiming[];
        let latest = 0;
        for (const entry of entries) {
          if (entry.responseEnd > latest) latest = entry.responseEnd;
        }
        return latest;
      } catch {
        return performance.now();
      }
    };
    // 已经安静（最近 quietMs 内没有资源完成）时直接通过，不加额外等待；
    // 还在下载时才按窗口轮询，上限防止站点无限加载拖住批量任务。
    while (performance.now() - startAt < options.resourceQuietMaxMs) {
      if (performance.now() - latestResourceEnd() >= quietMs) break;
      await wait(quietMs);
    }
  }

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

  // 后台标签页不会触发 requestAnimationFrame（渲染被节流/暂停），
  // 必须用超时兜底，否则批量后台补拍会永远卡在等待两帧这里。
  await Promise.race([
    new Promise<void>((resolve) => {
      globalThis.requestAnimationFrame(() =>
        globalThis.requestAnimationFrame(() => resolve())
      );
    }),
    wait(options.rAFTimeoutMs ?? 1_000)
  ]);
  return document.readyState === "complete";
}

/**
 * 判断图片是否真正可用于截图：
 * - 已成功加载（naturalWidth/naturalHeight > 0）；
 * - 或者根本没有 src/srcset（占位空图，无需等待）。
 * 未开始的懒加载图片 complete 也为 true 但 naturalWidth 为 0，
 * 必须视为“待加载”，否则后台补拍会在图片空白时提前截图。
 */
export function imageIsReadyForCapture(
  image: HTMLImageElement
): boolean {
  if (!image.complete) return false;
  // data-src 等占位属性说明懒加载库还没把真实地址写进 src，
  // 即使当前没有可加载资源也必须视为“待加载”。
  const hasPendingSource = Boolean(
    image.getAttribute("src") ||
      image.getAttribute("srcset") ||
      image.getAttribute("data-src") ||
      image.getAttribute("data-srcset") ||
      image.getAttribute("data-lazy-src") ||
      image.getAttribute("data-original")
  );
  return (
    image.naturalWidth > 0 ||
    image.naturalHeight > 0 ||
    !hasPendingSource
  );
}

/**
 * 批量后台补拍专用：隐藏标签页不会触发 IntersectionObserver 懒加载，
 * content-visibility 的内容也不会按需渲染，必须在截图前强制触发。
 * 函数会被序列化到网页上下文执行，因此必须保持自包含，不能引用模块外变量。
 */
export async function prepareBackgroundPageForCaptureInDocument(
  options: {
    maxImages?: number;
    scrollSteps?: number;
  } = {}
): Promise<{ forcedImages: number }> {
  const maxImages = options.maxImages ?? 80;
  const scrollSteps = options.scrollSteps ?? 16;
  let forcedImages = 0;

  const forceImage = (image: HTMLImageElement): void => {
    const hasPendingSource = Boolean(
      image.getAttribute("src") ||
        image.getAttribute("srcset") ||
        image.getAttribute("data-src") ||
        image.getAttribute("data-srcset") ||
        image.getAttribute("data-lazy-src") ||
        image.getAttribute("data-original")
    );
    const imageReady =
      image.complete &&
      (image.naturalWidth > 0 ||
        image.naturalHeight > 0 ||
        !hasPendingSource);
    if (forcedImages >= maxImages || imageReady) {
      return;
    }
    const src = image.getAttribute("src");
    const srcset = image.getAttribute("srcset");
    // 很多懒加载库（lozad、vanilla-lazyload 等）用 data-src 等属性占位，
    // 到视口时才写入真实地址；隐藏标签页里它们永远不会触发，需要代劳。
    const dataSrc =
      image.getAttribute("data-src") ||
      image.getAttribute("data-lazy-src") ||
      image.getAttribute("data-original");
    const dataSrcset = image.getAttribute("data-srcset");
    if (!src && !srcset && !dataSrc && !dataSrcset) return;
    image.loading = "eager";
    image.decoding = "async";
    // 先移除再写回 src/srcset，保证属性真正变化并重新发起请求；
    // 直接赋相同值不会触发加载。
    const nextSrc = src || dataSrc || "";
    const nextSrcset = srcset || dataSrcset || "";
    if (nextSrcset) {
      image.removeAttribute("srcset");
      image.setAttribute("srcset", nextSrcset);
    }
    if (nextSrc) {
      image.removeAttribute("src");
      image.setAttribute("src", nextSrc);
    }
    forcedImages += 1;
  };

  // 遍历普通 DOM 与开放 shadow root，尽量覆盖组件库内懒加载图片。
  const walk = (root: ParentNode, budget: { elements: number }): void => {
    if (budget.elements >= 10_000) return;
    // document / shadow root / 元素都通过 children 进入下一层；
    // 入口传 document 时它本身不是 Element，必须单独放行。
    const children =
      root instanceof Document ||
      root instanceof DocumentFragment ||
      root instanceof Element
        ? Array.from(root.children)
        : [];
    for (const child of children) {
      if (budget.elements >= 10_000) return;
      budget.elements += 1;
      if (child instanceof HTMLImageElement) {
        forceImage(child);
      }
      if (child.shadowRoot) walk(child.shadowRoot, budget);
      walk(child, budget);
    }
  };
  walk(document, { elements: 0 });

  // content-visibility: auto 的内容在隐藏标签页里不会渲染，
  // 临时用一条全局规则强制可见；导航后文档销毁，无需清理。
  const hostId = "aarre-capture-force-visibility";
  if (!document.getElementById(hostId)) {
    const style = document.createElement("style");
    style.id = hostId;
    style.textContent = "*{content-visibility:visible!important}";
    (document.head || document.documentElement).appendChild(style);
  }

  // 滚动整页触发依赖 scroll/IntersectionObserver 的懒加载库，
  // 最后回到顶部，保证截图内容仍是页面顶部视口。
  document.documentElement.style.scrollBehavior = "auto";
  const viewportHeight = globalThis.innerHeight || 800;
  const maxY = Math.max(
    0,
    document.documentElement.scrollHeight - viewportHeight
  );
  const steps =
    maxY > 0
      ? Math.min(scrollSteps, Math.ceil(maxY / viewportHeight) + 1)
      : 1;
  if (typeof globalThis.scrollTo === "function") {
    for (let i = 0; i < steps; i += 1) {
      globalThis.scrollTo(0, Math.min(maxY, i * viewportHeight));
    }
    globalThis.scrollTo(0, 0);
  }

  return { forcedImages };
}

/**
 * 检测 Cloudflare/Turnstile 等“安全验证”挑战页。此类页面截图没有收藏价值，
 * 而且往往自己跳转或保持轮询，会拖住批量补拍。函数会被序列化到网页上下文
 * 执行，因此必须保持自包含，不能引用模块外变量。
 */
export function detectBotChallengeInDocument(): boolean {
  const title = document.title || "";
  const url = globalThis.location?.href || "";
  const body = document.body;
  const text = (body?.innerText || body?.textContent || "")
    .slice(0, 3_000);
  const challengeText = /请稍候|正在进行安全验证|verify(?:ing)? you are human|checking your browser|cf-challenge|turnstile/i.test(
    `${title} ${text}`
  );
  const hasChallengeDom =
    document.querySelector(
      '[id*="challenge"], [class*="challenge"], [id*="turnstile"], [class*="turnstile"]'
    ) !== null;
  if (
    url.includes("/cdn-cgi/challenge") ||
    url.includes("__cf_chl") ||
    (challengeText && /ray[- ]id|cf-ray/i.test(text)) ||
    (challengeText && /cloudflare|turnstile/i.test(text)) ||
    (challengeText && hasChallengeDom)
  ) {
    return true;
  }
  return false;
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

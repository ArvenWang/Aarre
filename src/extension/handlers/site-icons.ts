import { bundledPinnedBrandIcon } from "../../lib/bundled-brand-icons";
import {
  matchCoverRule,
  pinnedBrandAssetNeedsRefresh,
  recordPageImageSample,
  registrableHost,
  resolveRuleAsset
} from "../../lib/cover-registry";
import { extractPageEssenceFromHtml } from "../../lib/page-essence";
import { getDisplaySettings } from "../../lib/display-settings";
import { publicFaviconCandidates } from "../../lib/public-favicon";
import {
  getLocalResources,
  getSiteBrand,
  getSiteBrands,
  invalidateStaleSiteBrandIcons,
  putSiteBrand
} from "../../lib/storage";
import {
  cacheSiteBrandIcon,
  SITE_ICON_RENDER_VERSION,
  siteBrandIconCacheIsFresh,
  type CachedSiteIcon
} from "../../lib/thumbnail";
import { DomainRateLimiter } from "../../lib/scan-scheduler";
import type {
  ResourceRecord,
  SiteBrandRecord,
  SiteIconCandidate
} from "../../lib/types";
import { decodeSiteIconWithOffscreen } from "../offscreen-icon-decoder";

interface SiteIconHandlerDependencies {
  readLimitedText(response: Response, maxBytes?: number): Promise<string>;
  upsertLocalResource(resource: ResourceRecord): Promise<void>;
}

export interface SiteIconHandlers {
  getSiteBrands(): Promise<SiteBrandRecord[]>;
  ensurePinnedSiteBrandIcons(): Promise<number>;
  ensureSiteBrandForResource(
    resource: ResourceRecord,
    force?: boolean,
    candidatesSeed?: SiteIconCandidate[]
  ): Promise<boolean>;
  scanSiteBrand(
    resource: ResourceRecord,
    essence: ReturnType<typeof extractPageEssenceFromHtml>,
    force: boolean,
    candidatesSeed?: SiteIconCandidate[]
  ): Promise<SiteBrandRecord | undefined>;
  registerPageImageSample(
    resource: ResourceRecord,
    imageUrl: string
  ): Promise<boolean>;
}

const SITE_BRAND_REGEN_CONCURRENCY = 4;
const SITE_BRAND_HTML_MAX_BYTES = 300_000;
const SITE_BRAND_HTML_TIMEOUT_MS = 10_000;
const SITE_BRAND_FETCH_RATE_LIMIT_MS = 750;
const siteBrandFetchRateLimiter = new DomainRateLimiter(
  SITE_BRAND_FETCH_RATE_LIMIT_MS
);
const siteBrandFetchInFlight = new Map<string, Promise<boolean>>();

function notifySiteBrandsUpdated(): void {
  if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) return;
  void chrome.runtime.sendMessage({ type: "SITE_BRANDS_UPDATED" }).catch(() => undefined);
}

function now(): string {
  return new Date().toISOString();
}

function iconSize(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const sizes = [...value.matchAll(/(\d+)\s*x\s*(\d+)/gi)]
    .map((match) => Math.min(Number(match[1]), Number(match[2])))
    .filter((size) => Number.isFinite(size) && size > 0);
  return sizes.length ? Math.max(...sizes) : undefined;
}

export function createSiteIconHandlers(
  dependencies: SiteIconHandlerDependencies
): SiteIconHandlers {
  let pinnedSiteBrandRefreshPromise: Promise<number> | undefined;
  let missingSiteBrandRegenPromise: Promise<number> | undefined;

  async function manifestIconCandidates(
    manifestUrl: string
  ): Promise<SiteIconCandidate[]> {
    if (!manifestUrl) return [];
    try {
      const response = await fetch(manifestUrl, {
        credentials: "omit",
        redirect: "follow",
        headers: { Accept: "application/manifest+json,application/json" },
        signal: AbortSignal.timeout(8_000)
      });
      if (!response.ok) return [];
      const manifest = JSON.parse(
        await dependencies.readLimitedText(response, 256 * 1024)
      ) as {
        icons?: Array<{
          src?: unknown;
          sizes?: unknown;
          type?: unknown;
        }>;
      };
      if (!Array.isArray(manifest.icons)) return [];
      return manifest.icons
        .flatMap((icon): SiteIconCandidate[] => {
          if (typeof icon.src !== "string" || !icon.src.trim()) return [];
          try {
            const url = new URL(
              icon.src,
              response.url || manifestUrl
            ).toString();
            const vector =
              icon.type === "image/svg+xml" || /\.svg(?:[?#]|$)/i.test(url);
            const declaredSize = iconSize(icon.sizes);
            return [
              {
                url,
                source: "manifest",
                ...(declaredSize ? { declaredSize } : {}),
                ...(vector ? { vector: true } : {})
              }
            ];
          } catch {
            return [];
          }
        })
        .sort(
          (left, right) =>
            (right.declaredSize || 0) - (left.declaredSize || 0)
        );
    } catch {
      return [];
    }
  }

  async function conventionalIconCandidates(
    pageUrl: string
  ): Promise<SiteIconCandidate[]> {
    try {
      const origin = new URL(pageUrl).origin;
      const paths = [
        "/apple-touch-icon-180x180.png",
        "/apple-touch-icon.png",
        "/apple-touch-icon-precomposed.png",
        "/apple-touch-icon-152x152.png",
        "/apple-icon.png",
        "/apple-icon-180x180.png",
        "/icon.png"
      ];
      const probes: SiteIconCandidate[] = [
        ...paths.map((path, index) => ({
          url: new URL(path, origin).toString(),
          source: "conventional-apple-touch-icon" as const,
          declaredSize: path.includes("152") ? 152 : 180
        })),
        {
          url: new URL("/favicon.ico", origin).toString(),
          source: "conventional-favicon-ico" as const
        },
        {
          url: new URL("/favicon.svg", origin).toString(),
          source: "svg-icon" as const,
          vector: true
        }
      ];
      // 全部并行 HEAD，再把命中的候选按原始优先级返回：典型站点一次
      // 往返即可定位图标，不再串行逐个探测。
      const results = await Promise.allSettled(
        probes.map(async (candidate) => {
          try {
            const response = await fetch(candidate.url, {
              method: "HEAD",
              credentials: "omit",
              redirect: "follow",
              signal: AbortSignal.timeout(5_000)
            });
            const contentType =
              (response.headers.get("content-type") || "").toLowerCase();
            // 软 404 / 登录页常返回 200 + text/html，不能当图标候选。
            if (
              response.ok &&
              !contentType.startsWith("text/html") &&
              !contentType.startsWith("application/json")
            ) {
              return candidate;
            }
          } catch {
            // 单个探测失败不阻塞其他候选。
          }
          return undefined;
        })
      );
      return results.flatMap((result, index) =>
        result.status === "fulfilled" && result.value
          ? [result.value as SiteIconCandidate]
          : []
      ).sort((left, right) => {
        const leftIndex = probes.findIndex(
          (candidate) => candidate.url === left.url
        );
        const rightIndex = probes.findIndex(
          (candidate) => candidate.url === right.url
        );
        return leftIndex - rightIndex;
      });
    } catch {
      // Invalid URLs are filtered before this function.
    }
    return [];
  }

  function uniqueIconCandidates(
    candidates: SiteIconCandidate[]
  ): SiteIconCandidate[] {
    const seen = new Set<string>();
    return candidates.filter((candidate) => {
      if (!candidate.url || seen.has(candidate.url)) return false;
      seen.add(candidate.url);
      return true;
    });
  }

  function bundledPinnedSiteBrandResult(
    input: string
  ): CachedSiteIcon | undefined {
    const bundled = bundledPinnedBrandIcon(input);
    if (!bundled) return undefined;
    return {
      iconDataUrl: bundled.dataUrl,
      iconDataUrlLight: bundled.dataUrl,
      iconRenderVersion: SITE_ICON_RENDER_VERSION,
      iconSource: "registry",
      iconAssetUrl: bundled.assetUrl,
      nativeWidth: bundled.nativeWidth,
      nativeHeight: bundled.nativeHeight
    };
  }

  async function refreshPinnedSiteBrandIcons(): Promise<number> {
    const brands = await getSiteBrands();
    const pending = brands.flatMap((brand) => {
      const pageUrl = `https://${brand.host}/`;
      if (!pinnedBrandAssetNeedsRefresh(pageUrl, brand.iconAssetUrl)) return [];
      const assetUrl = resolveRuleAsset(pageUrl, "brandAsset");
      return assetUrl ? [{ brand, pageUrl, assetUrl }] : [];
    });
    if (!pending.length) return 0;

    const resultByAsset = new Map<string, Promise<CachedSiteIcon>>();
    let updated = 0;
    for (const { brand, pageUrl, assetUrl } of pending) {
      let resultPromise = resultByAsset.get(assetUrl);
      if (!resultPromise) {
        const bundled = bundledPinnedSiteBrandResult(pageUrl);
        resultPromise = bundled
          ? Promise.resolve(bundled)
          : cacheSiteBrandIcon(
              [
                {
                  url: assetUrl,
                  source: "registry",
                  ...(/\.svg(?:[?#]|$)/i.test(assetUrl)
                    ? { vector: true }
                    : {})
                }
              ],
              decodeSiteIconWithOffscreen
            );
        resultByAsset.set(assetUrl, resultPromise);
      }
      const result = await resultPromise;
      if (!result.iconDataUrlLight) {
        await putSiteBrand({
          ...brand,
          iconRejectReason:
            result.iconRejectReason || "pinned-brand-refresh-failed",
          updatedAt: now()
        });
        continue;
      }
      await putSiteBrand({
        host: brand.host,
        ...result,
        ...(brand.skipPageImage ? { skipPageImage: true } : {}),
        ...(brand.pageImageSamples
          ? { pageImageSamples: brand.pageImageSamples }
          : {}),
        updatedAt: now()
      });
      updated += 1;
    }
    return updated;
  }

  function ensurePinnedSiteBrandIcons(): Promise<number> {
    if (!pinnedSiteBrandRefreshPromise) {
      pinnedSiteBrandRefreshPromise = refreshPinnedSiteBrandIcons().finally(
        () => {
          pinnedSiteBrandRefreshPromise = undefined;
        }
      );
    }
    return pinnedSiteBrandRefreshPromise;
  }

  /**
   * 收藏保存后的即时图标补全：缓存新鲜直接跳过；缺失或过期时读取公开
   * HTML 提取图标候选并落库，随后广播让侧边栏刷新。同域名限速、同主机
   * 并发去重；正文读不到（登录墙/网络失败）也继续尝试常规路径与公共服务，
   * 失败只返回 false，绝不影响收藏本身。
   */
  async function ensureSiteBrandForResource(
    resource: ResourceRecord,
    force = false,
    candidatesSeed: SiteIconCandidate[] = []
  ): Promise<boolean> {
    let host: string;
    try {
      host = new URL(resource.url).hostname.toLocaleLowerCase();
    } catch {
      return false;
    }
    const existing = await getSiteBrand(host);
    if (!force && siteBrandIconCacheIsFresh(existing)) return false;
    const inFlight = siteBrandFetchInFlight.get(host);
    if (inFlight) return inFlight;

    const task = siteBrandFetchRateLimiter.run(resource.url, async () => {
      if (candidatesSeed.length) {
        // 保存时已拿到页面声明的 favicon：先直接试它，跳过整轮 HTML
        // 读取；失败再走完整候选扫描。
        const seeded = await scanSiteBrand(
          resource,
          extractPageEssenceFromHtml("", resource.url),
          force,
          candidatesSeed
        );
        if (seeded?.iconDataUrlLight && !siteBrandIconCacheIsFresh(existing)) {
          notifySiteBrandsUpdated();
          return true;
        }
      }
      let essence = extractPageEssenceFromHtml("", resource.url);
      try {
        const response = await fetch(resource.url, {
          credentials: "omit",
          redirect: "follow",
          headers: {
            Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.2"
          },
          signal: AbortSignal.timeout(SITE_BRAND_HTML_TIMEOUT_MS)
        });
        const contentType =
          (response.headers.get("content-type") || "").toLowerCase();
        if (
          response.ok &&
          !/(?:^|\/)(?:login|signin|sign-in|auth)(?:\/|$)/i.test(
            new URL(response.url || resource.url).pathname
          ) &&
          (contentType.includes("text/html") ||
            contentType.includes("application/xhtml+xml"))
        ) {
          essence = extractPageEssenceFromHtml(
            await dependencies.readLimitedText(
              response,
              SITE_BRAND_HTML_MAX_BYTES
            ),
            response.url || resource.url
          );
        }
      } catch {
        // 正文读不到时不阻塞图标：scanSiteBrand 仍会尝试常规路径、
        // 主域别名与公共服务候选。
      }
      const result = await scanSiteBrand(
        resource,
        essence,
        force,
        candidatesSeed
      );
      if (result?.iconDataUrlLight && !siteBrandIconCacheIsFresh(existing)) {
        notifySiteBrandsUpdated();
        return true;
      }
      return false;
    });
    siteBrandFetchInFlight.set(host, task);
    try {
      return await task;
    } finally {
      siteBrandFetchInFlight.delete(host);
    }
  }

  async function scanSiteBrand(
    resource: ResourceRecord,
    essence: ReturnType<typeof extractPageEssenceFromHtml>,
    force: boolean,
    candidatesSeed: SiteIconCandidate[] = []
  ): Promise<SiteBrandRecord | undefined> {
    const pageUrl = new URL(resource.url);
    const host = pageUrl.hostname.toLocaleLowerCase();
    const existing = await getSiteBrand(host);
    const rule = matchCoverRule(resource.url);
    const registryAsset = resolveRuleAsset(resource.url, "brandAsset");
    const pinnedAssetNeedsRefresh = pinnedBrandAssetNeedsRefresh(
      resource.url,
      existing?.iconAssetUrl
    );
    if (
      siteBrandIconCacheIsFresh(existing) &&
      !force &&
      !pinnedAssetNeedsRefresh
    ) {
      return existing;
    }

    const apple = essence.siteIconCandidates.filter(
      (candidate) => candidate.source === "apple-touch-icon"
    );
    const declaredSvg = essence.siteIconCandidates.filter(
      (candidate) => candidate.source === "svg-icon"
    );
    const largeBitmap = essence.siteIconCandidates.filter(
      (candidate) => candidate.source === "large-icon"
    );
    const tile = essence.siteIconCandidates.filter(
      (candidate) => candidate.source === "msapplication-tile"
    );
    const candidates = uniqueIconCandidates([
      ...(registryAsset
        ? [{ url: registryAsset, source: "registry" as const }]
        : []),
      ...candidatesSeed,
      ...apple,
      ...(await conventionalIconCandidates(resource.url)),
      ...(await manifestIconCandidates(essence.manifestUrl)),
      ...declaredSvg,
      ...largeBitmap,
      ...tile
    ]);
    let result =
      bundledPinnedSiteBrandResult(resource.url) ||
      (await cacheSiteBrandIcon(candidates, decodeSiteIconWithOffscreen));

    const baseHost = registrableHost(host);
    if (!result.iconDataUrlLight && baseHost && baseHost !== host) {
      const base = await getSiteBrand(baseHost);
      if (
        base?.iconDataUrlLight &&
        base.iconRenderVersion === SITE_ICON_RENDER_VERSION &&
        !force
      ) {
        const aliased = { ...base, host, updatedAt: now() };
        await putSiteBrand(aliased);
        return aliased;
      }
      const baseUrl = `${pageUrl.protocol}//${baseHost}/`;
      result = await cacheSiteBrandIcon(
        await conventionalIconCandidates(baseUrl),
        decodeSiteIconWithOffscreen
      );
      const baseRecord: SiteBrandRecord = {
        host: baseHost,
        ...result,
        ...(rule?.skipPageImage ? { skipPageImage: true } : {}),
        updatedAt: now()
      };
      await putSiteBrand(baseRecord);
      if (result.iconDataUrlLight) {
        const aliased = { ...baseRecord, host, updatedAt: now() };
        await putSiteBrand(aliased);
        return aliased;
      }
    }

    // 只有站点自身、Manifest、固定品牌资产与主域候选全部失败后，才
    // 根据用户设置尝试公共服务，避免对第三方发送不必要的域名请求。
    if (!result.iconDataUrlLight) {
      const displaySettings = await getDisplaySettings();
      const publicCandidates = publicFaviconCandidates(
        resource.url,
        displaySettings
      );
      if (publicCandidates.length) {
        result = await cacheSiteBrandIcon(
          publicCandidates,
          decodeSiteIconWithOffscreen
        );
      }
    }

    const record: SiteBrandRecord = {
      host,
      ...result,
      ...(rule?.skipPageImage ? { skipPageImage: true } : {}),
      updatedAt: now()
    };
    await putSiteBrand(record);
    return record;
  }

  async function registerPageImageSample(
    resource: ResourceRecord,
    imageUrl: string
  ): Promise<boolean> {
    if (!imageUrl) return false;
    const host = new URL(resource.url).hostname.toLocaleLowerCase();
    const existing = await getSiteBrand(host);
    const sampleResult = recordPageImageSample(
      existing?.pageImageSamples || {},
      imageUrl,
      resource.resourceKey
    );
    await putSiteBrand({
      ...(existing || {}),
      host,
      pageImageSamples: sampleResult.samples,
      ...(sampleResult.isCommonBanner ? { skipPageImage: true } : {}),
      updatedAt: now()
    });
    if (!sampleResult.isCommonBanner) return false;

    const resources = await getLocalResources();
    for (const item of resources) {
      let sameHost = false;
      try {
        sameHost = new URL(item.url).hostname.toLocaleLowerCase() === host;
      } catch {
        sameHost = false;
      }
      if (!sameHost || item.imageUrl !== imageUrl) continue;
      const { thumbnailDataUrl: _removed, ...withoutThumbnail } = item;
      await dependencies.upsertLocalResource({
        ...withoutThumbnail,
        imageUrl: "",
        coverSource: "category:common-banner",
        coverUpdatedAt: now()
      });
    }
    return true;
  }

  async function regenerateMissingSiteBrandIcons(): Promise<number> {
    const [brands, resources] = await Promise.all([
      getSiteBrands(),
      getLocalResources()
    ]);
    const hostsNeedingIcon = new Set(
      brands
        .filter((brand) => !brand.iconDataUrlLight)
        .map((brand) => brand.host.toLocaleLowerCase())
    );
    if (!hostsNeedingIcon.size) return 0;

    const resourceByHost = new Map<string, ResourceRecord>();
    for (const resource of resources) {
      if (!resource.nativeBookmarkIds.length) continue;
      try {
        const host = new URL(resource.url).hostname.toLocaleLowerCase();
        if (hostsNeedingIcon.has(host) && !resourceByHost.has(host)) {
          resourceByHost.set(host, resource);
        }
      } catch {
        // Skip invalid bookmark URLs.
      }
    }

    const queue = [...resourceByHost.values()];
    let updated = 0;
    let cursor = 0;
    const workers = Array.from(
      { length: Math.min(SITE_BRAND_REGEN_CONCURRENCY, queue.length) },
      async () => {
        while (cursor < queue.length) {
          const index = cursor;
          cursor += 1;
          const resource = queue[index]!;
          const essence = extractPageEssenceFromHtml("", resource.url);
          const result = await scanSiteBrand(resource, essence, true);
          if (result?.iconDataUrlLight) {
            updated += 1;
            if (updated === 1 || updated % 8 === 0) {
              notifySiteBrandsUpdated();
            }
          }
        }
      }
    );
    await Promise.all(workers);
    if (updated > 0) notifySiteBrandsUpdated();
    return updated;
  }

  function ensureMissingSiteBrandIcons(): Promise<number> {
    if (!missingSiteBrandRegenPromise) {
      missingSiteBrandRegenPromise = regenerateMissingSiteBrandIcons().finally(
        () => {
          missingSiteBrandRegenPromise = undefined;
        }
      );
    }
    return missingSiteBrandRegenPromise;
  }

  async function getSiteBrandRecords(): Promise<SiteBrandRecord[]> {
    const cleared = await invalidateStaleSiteBrandIcons(SITE_ICON_RENDER_VERSION);
    await ensurePinnedSiteBrandIcons();
    if (cleared > 0) {
      // 清掉旧管线像素后立刻后台重抓，不等用户手动扫描。
      void ensureMissingSiteBrandIcons().catch(() => undefined);
    }
    return getSiteBrands();
  }

  return {
    getSiteBrands: getSiteBrandRecords,
    ensurePinnedSiteBrandIcons,
    ensureSiteBrandForResource,
    scanSiteBrand,
    registerPageImageSample
  };
}

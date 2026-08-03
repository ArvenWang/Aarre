import { bundledPinnedBrandIcon } from "../../lib/bundled-brand-icons";
import {
  matchCoverRule,
  pinnedBrandAssetNeedsRefresh,
  recordPageImageSample,
  registrableHost,
  resolveRuleAsset
} from "../../lib/cover-registry";
import { extractPageEssenceFromHtml } from "../../lib/page-essence";
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
  scanSiteBrand(
    resource: ResourceRecord,
    essence: ReturnType<typeof extractPageEssenceFromHtml>,
    force: boolean
  ): Promise<SiteBrandRecord | undefined>;
  registerPageImageSample(
    resource: ResourceRecord,
    imageUrl: string
  ): Promise<boolean>;
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
      const candidates: SiteIconCandidate[] = [];
      const paths = [
        "/apple-touch-icon-180x180.png",
        "/apple-touch-icon.png",
        "/apple-touch-icon-precomposed.png",
        "/apple-touch-icon-152x152.png"
      ];
      for (const path of paths) {
        const url = new URL(path, origin).toString();
        try {
          const response = await fetch(url, {
            method: "HEAD",
            credentials: "omit",
            redirect: "follow",
            signal: AbortSignal.timeout(5_000)
          });
          if (response.ok) {
            candidates.push({
              url,
              source: "conventional-apple-touch-icon",
              declaredSize: path.includes("152") ? 152 : 180
            });
            break;
          }
        } catch {
          // Continue to the next conventional path.
        }
      }
      const icoUrl = new URL("/favicon.ico", origin).toString();
      try {
        const response = await fetch(icoUrl, {
          method: "HEAD",
          credentials: "omit",
          redirect: "follow",
          signal: AbortSignal.timeout(5_000)
        });
        if (response.ok) {
          candidates.push({
            url: icoUrl,
            source: "conventional-favicon-ico"
          });
        }
      } catch {
        // Continue to the conventional SVG candidate.
      }
      const svgUrl = new URL("/favicon.svg", origin).toString();
      try {
        const response = await fetch(svgUrl, {
          method: "HEAD",
          credentials: "omit",
          redirect: "follow",
          signal: AbortSignal.timeout(5_000)
        });
        if (response.ok) {
          candidates.push({
            url: svgUrl,
            source: "svg-icon",
            vector: true
          });
        }
      } catch {
        // No conventional SVG icon.
      }
      return candidates;
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

  async function scanSiteBrand(
    resource: ResourceRecord,
    essence: ReturnType<typeof extractPageEssenceFromHtml>,
    force: boolean
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

  async function getSiteBrandRecords(): Promise<SiteBrandRecord[]> {
    await invalidateStaleSiteBrandIcons(SITE_ICON_RENDER_VERSION);
    await ensurePinnedSiteBrandIcons();
    return getSiteBrands();
  }

  return {
    getSiteBrands: getSiteBrandRecords,
    ensurePinnedSiteBrandIcons,
    scanSiteBrand,
    registerPageImageSample
  };
}

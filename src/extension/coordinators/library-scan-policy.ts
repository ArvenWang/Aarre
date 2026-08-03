import { getAiProviderPreset, getAiRuntimeSettings } from "../../lib/settings";
import { needsAiEnrichment } from "../../lib/ai-fields";
import { getLocalResources, getSiteBrands } from "../../lib/storage";
import { interleaveResourcesByHost } from "../../lib/scan-scheduler";
import { estimateScanCost } from "../../lib/ai-cost";
import { siteBrandIconCacheIsFresh } from "../../lib/thumbnail";
import { pinnedBrandAssetNeedsRefresh } from "../../lib/cover-registry";
import type {
  ImportResult,
  LibraryScanEstimate,
  ResourceRecord,
  SiteBrandRecord
} from "../../lib/types";

const LIBRARY_SCAN_CONCURRENCY = 4;
const LINK_HEALTH_REFRESH_MS = 7 * 24 * 60 * 60 * 1_000;

interface LibraryScanPolicyDependencies {
  getPrivacyProtectionContext(): Promise<unknown>;
  resourceProtectionState(resource: ResourceRecord, context: unknown): { protected: boolean };
  importNativeBookmarks(): Promise<ImportResult>;
}

export function createLibraryScanPolicy(dependencies: LibraryScanPolicyDependencies) {
  const {
    getPrivacyProtectionContext,
    resourceProtectionState,
    importNativeBookmarks
  } = dependencies;

  function needsRepresentativeImageRefresh(resource: ResourceRecord): boolean {
    if (!resource.thumbnailDataUrl) return !resource.coverSource;
    try {
      const pageUrl = new URL(resource.url);
      const pathParts = pageUrl.pathname.split("/").filter(Boolean);
      const reservedGitHubPaths = new Set([
        "about", "apps", "collections", "codespaces", "enterprise", "events",
        "explore", "features", "issues", "login", "marketplace", "new",
        "notifications", "orgs", "organizations", "pricing", "search",
        "settings", "signup", "site", "sponsors", "topics", "users"
      ]);
      const isGitHubRepository =
        (pageUrl.hostname === "github.com" || pageUrl.hostname === "www.github.com") &&
        pathParts.length >= 2 &&
        !reservedGitHubPaths.has(pathParts[0]?.toLowerCase() || "");
      return isGitHubRepository && !resource.imageUrl.includes("opengraph.githubassets.com/");
    } catch {
      return false;
    }
  }

  function needsLinkHealthRefresh(resource: ResourceRecord, referenceTime = Date.now()): boolean {
    if (!resource.linkHealth?.checkedAt) return true;
    const checkedAt = Date.parse(resource.linkHealth.checkedAt);
    return !Number.isFinite(checkedAt) || referenceTime - checkedAt >= LINK_HEALTH_REFRESH_MS;
  }

  function needsSiteBrandRefresh(
    resource: ResourceRecord,
    siteBrandByHost: Map<string, SiteBrandRecord>
  ): boolean {
    try {
      const host = new URL(resource.url).hostname.toLocaleLowerCase();
      const brand = siteBrandByHost.get(host);
      return !siteBrandIconCacheIsFresh(brand) ||
        pinnedBrandAssetNeedsRefresh(resource.url, brand?.iconAssetUrl);
    } catch {
      return false;
    }
  }

  async function libraryScanCandidates(force = false) {
    const [runtime, privacyContext, siteBrands] = await Promise.all([
      getAiRuntimeSettings(),
      getPrivacyProtectionContext(),
      getSiteBrands()
    ]);
    const hasAi = Boolean(runtime.apiKey);
    const siteBrandByHost = new Map(
      siteBrands.map((brand) => [brand.host.toLocaleLowerCase(), brand])
    );
    await importNativeBookmarks();
    const resources = interleaveResourcesByHost(
      (await getLocalResources()).filter(
        (resource) =>
          resource.nativeBookmarkIds.length > 0 &&
          !resourceProtectionState(resource, privacyContext).protected &&
          (force || needsSiteBrandRefresh(resource, siteBrandByHost) ||
            needsLinkHealthRefresh(resource) || !resource.coverSource ||
            (hasAi && needsAiEnrichment(resource)) ||
            needsRepresentativeImageRefresh(resource))
      )
    );
    const aiResourceCount = resources.filter(
      (resource) => hasAi && needsAiEnrichment(resource, force)
    ).length;
    return { runtime, resources, aiResourceCount };
  }

  async function getLibraryScanEstimate(force = false): Promise<LibraryScanEstimate> {
    const { runtime, resources, aiResourceCount } = await libraryScanCandidates(force);
    const estimate = estimateScanCost(
      aiResourceCount,
      runtime.provider,
      runtime.model,
      LIBRARY_SCAN_CONCURRENCY
    );
    const networkMinutes = resources.length
      ? Math.max(1, Math.ceil((resources.length * 4) / (60 * LIBRARY_SCAN_CONCURRENCY)))
      : 0;
    const priceAvailable = estimate.estimatedCostCny !== null;
    return {
      total: resources.length,
      aiResourceCount,
      concurrency: LIBRARY_SCAN_CONCURRENCY,
      estimatedMinutes: Math.max(networkMinutes, estimate.estimatedMinutes),
      estimatedInputTokens: estimate.estimatedInputTokens,
      estimatedOutputTokens: estimate.estimatedOutputTokens,
      ...(priceAvailable ? { estimatedCostCny: estimate.estimatedCostCny! } : {}),
      pricingUpdatedAt: estimate.pricingUpdatedAt,
      providerName: getAiProviderPreset(runtime.provider).name,
      model: runtime.model,
      priceAvailable
    };
  }

  return { libraryScanCandidates, getLibraryScanEstimate };
}

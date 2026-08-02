import { getAgentConversations } from "./conversations";
import { resourceCloudPayload } from "./cloud";
import type { CloudSyncEstimate, CloudSyncScope } from "./cloud-settings";
import { getDisplaySettings } from "./display-settings";
import {
  buildProtectionPolicy,
  getProtectionSettings,
  isResourceUserProtected
} from "./protection";
import {
  getLocalResources,
  getPageSnapshots,
  getSiteBrands,
  getUndoSnapshots
} from "./storage";
import { SITE_ICON_RENDER_VERSION } from "./thumbnail";
import { getSyncedThemeMode } from "./theme";
import { getAiSettingsStatus } from "./settings";
import { getAiUsageStats } from "./usage-stats";
import { pinnedBrandAssetNeedsRefresh } from "./cover-rules";
import { resourceKeyForUrl } from "./url";

const ORGANIZATION_INSIGHTS_KEY = "aarre:organization-insights";

function jsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function dataUrlBytes(value: string | undefined): number {
  if (!value) return 0;
  const match = /^data:[^;,]+;base64,(.*)$/s.exec(value);
  if (!match) return 0;
  const padding = match[1].match(/=*$/)?.[0].length || 0;
  return Math.max(0, Math.floor(match[1].length * 3 / 4) - padding);
}

function hostForResource(resource: { url: string }): string | null {
  try {
    return new URL(resource.url).hostname.toLocaleLowerCase();
  } catch {
    return null;
  }
}

function bookmarkHints(
  nodes: chrome.bookmarks.BookmarkTreeNode[],
  parentPath: string[] = []
): Array<{ id: string; title: string; url: string; folderPath: string[] }> {
  const result: Array<{ id: string; title: string; url: string; folderPath: string[] }> = [];
  for (const node of nodes) {
    if (node.url) {
      result.push({
        id: node.id,
        title: node.title || node.url,
        url: node.url,
        folderPath: parentPath
      });
      continue;
    }
    const path = node.id === "0"
      ? parentPath
      : [...parentPath, node.title || "未命名文件夹"];
    result.push(...bookmarkHints(node.children || [], path));
  }
  return result;
}

/**
 * Estimates the bytes represented by the same local payload classes that the
 * cloud sync pipeline can upload. It intentionally excludes extracted body
 * text, API keys, native bookmark IDs, and protected resources.
 */
export async function getCloudSyncEstimate(
  scope: CloudSyncScope
): Promise<CloudSyncEstimate> {
  const [resources, snapshots, brands, protectionSettings, bookmarkTree] =
    await Promise.all([
      getLocalResources(),
      getPageSnapshots(),
      getSiteBrands(),
      getProtectionSettings(),
      chrome.bookmarks.getTree()
    ]);
  const protectionPolicy = buildProtectionPolicy(
    bookmarkTree,
    protectionSettings
  );
  const eligibleResources = resources.filter(
    (resource) =>
      resource.nativeBookmarkIds.length > 0 &&
      !isResourceUserProtected(resource, protectionPolicy)
  );
  let localMetadataBytes = eligibleResources.reduce(
    (total, resource) => total + jsonBytes(resourceCloudPayload(resource)),
    0
  );
  const resourceByNativeBookmarkId = new Map(
    eligibleResources.flatMap((resource) =>
      resource.nativeBookmarkIds.map((id) => [id, resource] as const)
    )
  );
  const bookmarkMetadata = bookmarkHints(bookmarkTree)
    .flatMap((bookmark) => {
      const resource = resourceByNativeBookmarkId.get(bookmark.id);
      if (!resource) return [];
      return [{
        bookmarkItemId: "00000000-0000-4000-8000-000000000000",
        resourceKey: resource.resourceKey,
        userNote: resource.userNote,
        tags: resource.tags,
        bindingHint: {
          title: bookmark.title,
          url: bookmark.url,
          folderPath: bookmark.folderPath
        },
        createdAt: resource.createdAt,
        updatedAt: resource.updatedAt
      }];
    });
  localMetadataBytes += jsonBytes(bookmarkMetadata);

  const [display, ai, usage, conversations, protection, theme, undoSnapshots, organization] =
    await Promise.all([
      getDisplaySettings(),
      getAiSettingsStatus(),
      getAiUsageStats(),
      getAgentConversations(),
      getProtectionSettings(),
      getSyncedThemeMode(),
      getUndoSnapshots(),
      chrome.storage.local.get(ORGANIZATION_INSIGHTS_KEY)
    ]);
  localMetadataBytes += jsonBytes([
    display,
    { provider: ai.provider, models: ai.providerModels },
    { scope, usage },
    conversations,
    protection,
    theme,
    undoSnapshots,
    organization[ORGANIZATION_INSIGHTS_KEY] || null
  ]);

  if (scope === "text") {
    return {
      scope,
      localTotalBytes: localMetadataBytes,
      localMetadataBytes,
      localAssetBytes: 0,
      resourceCount: eligibleResources.length,
      assetCount: 0,
      calculatedAt: new Date().toISOString()
    };
  }

  let localAssetBytes = 0;
  let assetCount = 0;
  const resourcesByKey = new Map(
    eligibleResources.map((resource) => [resource.resourceKey, resource])
  );
  for (const resource of eligibleResources) {
    if (!resource.thumbnailDataUrl) continue;
    localAssetBytes += dataUrlBytes(resource.thumbnailDataUrl);
    assetCount += 1;
  }
  for (const snapshot of snapshots) {
    const resourceKey = await resourceKeyForUrl(snapshot.canonicalUrl);
    if (!resourcesByKey.has(resourceKey)) continue;
    localAssetBytes += dataUrlBytes(snapshot.imageDataUrl);
    assetCount += 1;
  }
  const protectedHosts = new Set(
    resources
      .filter((resource) => isResourceUserProtected(resource, protectionPolicy))
      .map(hostForResource)
      .filter((host): host is string => Boolean(host))
  );
  for (const brand of brands) {
    const icon = brand.iconDataUrlLight || brand.iconDataUrl;
    if (
      !icon ||
      brand.iconRenderVersion !== SITE_ICON_RENDER_VERSION ||
      protectedHosts.has(brand.host) ||
      pinnedBrandAssetNeedsRefresh(`https://${brand.host}/`, brand.iconAssetUrl)
    ) {
      continue;
    }
    localAssetBytes += dataUrlBytes(icon);
    assetCount += 1;
  }

  return {
    scope,
    localTotalBytes: localMetadataBytes + localAssetBytes,
    localMetadataBytes,
    localAssetBytes,
    resourceCount: eligibleResources.length,
    assetCount,
    calculatedAt: new Date().toISOString()
  };
}

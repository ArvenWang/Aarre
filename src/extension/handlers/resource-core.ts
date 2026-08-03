import { getAuthState } from "../../lib/auth";
import { requestSync } from "../../lib/sync-request";
import { pullCloudResources as pullCloudResourcesFromCloud } from "../../lib/cloud";
import { getDisplaySettings } from "../../lib/display-settings";
import {
  bookmarkProtectionState,
  buildProtectionPolicy,
  folderProtectionState,
  getProtectionSettings,
  isResourceUserProtected,
  setFolderProtection,
  setResourceProtection,
  type ItemProtectionState,
  type ProtectionPolicy
} from "../../lib/protection";
import { getLocalResources, upsertLocalResource as persistLocalResource } from "../../lib/storage";
import { isSnapshotSensitiveUrl } from "../../lib/page-snapshot";
import { canonicalizeUrl, isSupportedPageUrl, resourceKeyForUrl } from "../../lib/url";
import type { ProtectionTarget } from "../../lib/messages";
import type { ImportResult, ResourceRecord } from "../../lib/types";

export interface PrivacyProtectionContext {
  pageSnapshotsEnabled: boolean;
  excludedHosts: string[];
  policy: ProtectionPolicy;
}

export const USER_PROTECTION_MESSAGE =
  "这条收藏或其所在文件夹已设为受保护。Aarre 不会增强、截图、检查链接，也不会把它发送给 AI。";

interface ResourceCoreDependencies {
  importNativeBookmarks(force?: boolean): Promise<ImportResult>;
  cancelEnhancementsForResources(resourceKeys: ReadonlySet<string>): Promise<void>;
  queueEnhancementsUntilVisit(resource: ResourceRecord, trigger?: "recovery", context?: PrivacyProtectionContext): Promise<void>;
  cancelAllAgentRuns(reason: string): void;
}

export function createResourceCore(dependencies: ResourceCoreDependencies) {
  const {
    importNativeBookmarks,
    cancelEnhancementsForResources,
    queueEnhancementsUntilVisit,
    cancelAllAgentRuns
  } = dependencies;
  let bookmarkedResourceLookupCache: Map<string, string> | null = null;
  let bookmarkedResourceLookupRevision = 0;
  const now = () => new Date().toISOString();
async function getPrivacyProtectionContext(
  knownTree?: chrome.bookmarks.BookmarkTreeNode[]
): Promise<PrivacyProtectionContext> {
  const [display, protection, tree] = await Promise.all([
    getDisplaySettings(),
    getProtectionSettings(),
    knownTree ? Promise.resolve(knownTree) : chrome.bookmarks.getTree()
  ]);
  return {
    pageSnapshotsEnabled: display.pageSnapshotsEnabled,
    excludedHosts: display.snapshotExcludedHosts,
    policy: buildProtectionPolicy(tree, protection)
  };
}

function resourceProtectionState(
  resource: Pick<
    ResourceRecord,
    "resourceKey" | "nativeBookmarkIds" | "url"
  >,
  context: PrivacyProtectionContext,
  loadedUrl = resource.url
): { protected: boolean; userProtected: boolean } {
  const userProtected = isResourceUserProtected(resource, context.policy);
  return {
    protected:
      userProtected ||
      isSnapshotSensitiveUrl(loadedUrl, context.excludedHosts),
    userProtected
  };
}

async function resourceForProtectionTarget(
  bookmarkId: string
): Promise<{ resourceKey: string; resource?: ResourceRecord }> {
  await importNativeBookmarks();
  const resource = (await getLocalResources()).find((candidate) =>
    candidate.nativeBookmarkIds.includes(bookmarkId)
  );
  if (resource) {
    return { resourceKey: resource.resourceKey, resource };
  }
  const [bookmark] = await chrome.bookmarks.get(bookmarkId);
  if (!bookmark?.url || !isSupportedPageUrl(bookmark.url)) {
    throw new Error("这条网页收藏已经不存在，请刷新后再试。");
  }
  return { resourceKey: await resourceKeyForUrl(bookmark.url) };
}

async function getItemProtectionState(
  target: ProtectionTarget,
  knownContext?: PrivacyProtectionContext
): Promise<ItemProtectionState> {
  const context = knownContext || (await getPrivacyProtectionContext());
  const [node] = await chrome.bookmarks.get(target.id);
  if (!node) throw new Error("保护目标已经不存在，请刷新后再试。");
  if (target.kind === "folder") {
    if (node.url) throw new Error("这个保护目标不是文件夹。");
    return folderProtectionState(target.id, context.policy);
  }
  if (!node.url) throw new Error("这个保护目标不是网页收藏。");
  const { resourceKey } = await resourceForProtectionTarget(target.id);
  const state = bookmarkProtectionState(
    resourceKey,
    target.id,
    context.policy
  );
  // 自动隐私规则（银行/支付/医疗等敏感网址）也算“受保护”，
  // 编辑界面的开关应如实显示开启；但它不是用户显式设置，
  // 开关在 UI 上锁定，无法通过这里关闭。
  const autoProtected = isSnapshotSensitiveUrl(
    node.url,
    context.excludedHosts
  );
  if (autoProtected) {
    return { ...state, protected: true, autoProtected: true };
  }
  return state;
}

async function reconcileProtectionRules(): Promise<void> {
  const [context, resources] = await Promise.all([
    getPrivacyProtectionContext(),
    getLocalResources()
  ]);
  const states = new Map(
    resources.map((resource) => [
      resource.resourceKey,
      resourceProtectionState(resource, context)
    ])
  );
  await cancelEnhancementsForResources(
    new Set(
      resources
        .filter(
          (resource) =>
            resource.nativeBookmarkIds.length > 0 &&
            states.get(resource.resourceKey)?.userProtected
        )
        .map((resource) => resource.resourceKey)
    )
  );
  for (const resource of resources) {
    if (!resource.nativeBookmarkIds.length) continue;
    const state = states.get(resource.resourceKey)!;
    if (state.userProtected) {
      const next: ResourceRecord = {
        ...resource,
        aiStatus:
          resource.aiStatus === "ready" ? "ready" : "unavailable",
        enhancementBlockReason: "privacy",
        enhancementBlockMessage: USER_PROTECTION_MESSAGE,
        updatedAt: now()
      };
      if (
        next.aiStatus !== resource.aiStatus ||
        next.enhancementBlockReason !== resource.enhancementBlockReason ||
        next.enhancementBlockMessage !== resource.enhancementBlockMessage
      ) {
        await upsertLocalResource(next);
      }
      continue;
    }

    if (
      resource.enhancementBlockReason === "privacy" &&
      !isSnapshotSensitiveUrl(resource.url, context.excludedHosts)
    ) {
      const next: ResourceRecord = {
        ...resource,
        aiStatus:
          resource.aiStatus === "unavailable" ? "pending" : resource.aiStatus,
        enhancementBlockReason: undefined,
        enhancementBlockMessage: undefined,
        updatedAt: now()
      };
      await upsertLocalResource(next);
      await queueEnhancementsUntilVisit(next, "recovery", context);
    }
  }
}

async function setItemProtection(
  target: ProtectionTarget,
  enabled: boolean
): Promise<ItemProtectionState> {
  const [node] = await chrome.bookmarks.get(target.id);
  if (!node) throw new Error("保护目标已经不存在，请刷新后再试。");
  if (target.kind === "folder") {
    if (node.url) throw new Error("这个保护目标不是文件夹。");
    await setFolderProtection(target.id, enabled);
  } else {
    if (!node.url) throw new Error("这个保护目标不是网页收藏。");
    const { resourceKey } = await resourceForProtectionTarget(target.id);
    await setResourceProtection(resourceKey, enabled);
  }
  cancelAllAgentRuns("保护规则已变化，请重新发起查询。");
  await reconcileProtectionRules();
  const auth = await getAuthState();
  if (auth.signedIn && auth.accountMatches === true) {
    requestSync("protection-changed", 3_000);
  }
  return getItemProtectionState(target);
}

function updateBookmarkedResourceLookupEntry(resource: ResourceRecord): void {
  if (!bookmarkedResourceLookupCache) return;
  for (const [canonicalUrl, resourceKey] of bookmarkedResourceLookupCache) {
    if (resourceKey === resource.resourceKey) {
      bookmarkedResourceLookupCache.delete(canonicalUrl);
    }
  }
  if (!resource.nativeBookmarkIds.length) return;
  for (const candidate of [
    resource.url,
    resource.canonicalUrl,
    ...(resource.aliases || [])
  ]) {
    try {
      bookmarkedResourceLookupCache.set(
        canonicalizeUrl(candidate),
        resource.resourceKey
      );
    } catch {
      // Invalid legacy aliases are ignored while the primary resource remains usable.
    }
  }
}

async function upsertLocalResource(resource: ResourceRecord): Promise<void> {
  await persistLocalResource(resource);
  bookmarkedResourceLookupRevision += 1;
  updateBookmarkedResourceLookupEntry(resource);
}

async function pullCloudResources(): Promise<ResourceRecord[]> {
  const resources = await pullCloudResourcesFromCloud();
  bookmarkedResourceLookupRevision += 1;
  bookmarkedResourceLookupCache = null;
  return resources;
}

async function bookmarkedResourceLookup(): Promise<Map<string, string>> {
  if (bookmarkedResourceLookupCache) return bookmarkedResourceLookupCache;
  const startingRevision = bookmarkedResourceLookupRevision;
  const lookup = new Map<string, string>();
  for (const resource of await getLocalResources()) {
    if (!resource.nativeBookmarkIds.length) continue;
    for (const candidate of [
      resource.url,
      resource.canonicalUrl,
      ...(resource.aliases || [])
    ]) {
      try {
        lookup.set(canonicalizeUrl(candidate), resource.resourceKey);
      } catch {
        // Ignore a malformed legacy alias without invalidating the resource.
      }
    }
  }
  if (startingRevision !== bookmarkedResourceLookupRevision) {
    return bookmarkedResourceLookup();
  }
  bookmarkedResourceLookupCache = lookup;
  return lookup;
}

  function forgetBookmarkedResourceLookup(url: string): void {
    bookmarkedResourceLookupCache?.delete(url);
  }

  return {
    getPrivacyProtectionContext,
    resourceProtectionState,
    getItemProtectionState,
    reconcileProtectionRules,
    setItemProtection,
    upsertLocalResource,
    pullCloudResources,
    bookmarkedResourceLookup,
    forgetBookmarkedResourceLookup
  };
}

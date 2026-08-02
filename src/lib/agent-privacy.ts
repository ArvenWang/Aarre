import { isSnapshotSensitiveUrl } from "./page-snapshot";
import {
  isResourceUserProtected,
  type ProtectionPolicy
} from "./protection";
import type {
  BookmarkAgentCatalog,
  ResourceRecord
} from "./types";

export interface PrivacySafeAgentLibrary {
  resources: ResourceRecord[];
  catalog: BookmarkAgentCatalog;
  excludedCount: number;
}

/**
 * The conversation feature follows the same privacy boundary as snapshots and
 * enrichment. A protected bookmark is removed before any provider prompt is
 * built; filtering the action catalog as well prevents its title and URL from
 * leaking through an AI-generated mutation proposal.
 */
export function privacySafeAgentLibrary(
  resources: ResourceRecord[],
  catalog: BookmarkAgentCatalog,
  customExcludedHosts: string[] = [],
  protectionPolicy?: ProtectionPolicy
): PrivacySafeAgentLibrary {
  const isSafeResource = (resource: ResourceRecord) =>
      !isSnapshotSensitiveUrl(resource.url, customExcludedHosts) &&
      (!protectionPolicy ||
        !isResourceUserProtected(resource, protectionPolicy));
  const safeResources = resources.filter(isSafeResource);
  const excludedBookmarkIds = new Set(
    resources
      .filter((resource) => !isSafeResource(resource))
      .flatMap((resource) => resource.nativeBookmarkIds)
  );
  const safeBookmarks = catalog.bookmarks.filter(
    (bookmark) =>
      !isSnapshotSensitiveUrl(bookmark.url, customExcludedHosts) &&
      !excludedBookmarkIds.has(bookmark.id) &&
      !protectionPolicy?.protectedBookmarkIds.has(bookmark.id)
  );

  return {
    resources: safeResources,
    catalog: {
      bookmarks: safeBookmarks,
      folders: protectionPolicy
        ? catalog.folders.filter(
            (folder) => !protectionPolicy.protectedFolderIds.has(folder.id)
          )
        : catalog.folders
    },
    excludedCount: resources.length - safeResources.length
  };
}

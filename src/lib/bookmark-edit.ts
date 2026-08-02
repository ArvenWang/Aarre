import type { ResourceRecord, SyncStatus } from "./types";
import { canonicalizeUrl } from "./url";

export function bookmarkUrlEditPlan(input: {
  source: Pick<
    ResourceRecord,
    "resourceKey" | "url" | "canonicalUrl" | "aliases"
  >;
  currentUrl: string;
  nextUrl: string;
  changedUrlResourceKey?: string;
}): {
  bookmarkUrlChanged: boolean;
  canonicalAddressChanged: boolean;
  targetResourceKey: string;
  resourceIdentityChanged: boolean;
} {
  const bookmarkUrlChanged = input.nextUrl !== input.currentUrl;
  const canonicalAddressChanged =
    bookmarkUrlChanged &&
    canonicalizeUrl(input.nextUrl) !==
      canonicalizeUrl(input.currentUrl);
  const nextCanonicalUrl = canonicalizeUrl(input.nextUrl);
  const matchesKnownResourceUrl = [
    input.source.url,
    input.source.canonicalUrl,
    ...(input.source.aliases || [])
  ].some((candidate) => {
    try {
      return canonicalizeUrl(candidate) === nextCanonicalUrl;
    } catch {
      return false;
    }
  });
  if (
    bookmarkUrlChanged &&
    !matchesKnownResourceUrl &&
    !input.changedUrlResourceKey
  ) {
    throw new Error("网址变化后缺少新的资源标识。");
  }
  const candidateKey =
    input.changedUrlResourceKey || input.source.resourceKey;
  const resourceIdentityChanged =
    bookmarkUrlChanged &&
    !matchesKnownResourceUrl &&
    candidateKey !== input.source.resourceKey;
  const targetResourceKey = resourceIdentityChanged
    ? candidateKey
    : input.source.resourceKey;
  return {
    bookmarkUrlChanged,
    canonicalAddressChanged,
    targetResourceKey,
    resourceIdentityChanged
  };
}

export function bookmarkEditTags(input: {
  sourceTags: string[];
  sourceTagsSource?: "ai" | "user";
  requestedTags: string[];
  tagsChanged: boolean;
  resourceIdentityChanged: boolean;
}): {
  tags: string[];
  tagsSource?: "ai" | "user";
} {
  if (input.tagsChanged) {
    return {
      tags: input.requestedTags,
      ...(input.requestedTags.length ? { tagsSource: "user" as const } : {})
    };
  }
  if (!input.resourceIdentityChanged) {
    return {
      tags: input.sourceTags,
      ...(input.sourceTagsSource && input.sourceTags.length
        ? { tagsSource: input.sourceTagsSource }
        : {})
    };
  }
  if (input.sourceTagsSource === "user") {
    return {
      tags: input.sourceTags,
      ...(input.sourceTags.length ? { tagsSource: "user" as const } : {})
    };
  }
  return { tags: [] };
}

export async function runBookmarkEditRecoverySteps(
  steps: Array<{
    name: string;
    run: () => Promise<unknown>;
  }>
): Promise<string[]> {
  const failed: string[] = [];
  for (const step of steps) {
    try {
      await step.run();
    } catch {
      failed.push(step.name);
    }
  }
  return failed;
}

export function bookmarkEditTargetResourceKey(input: {
  sourceResourceKey: string;
  urlChanged: boolean;
  changedUrlResourceKey?: string;
}): string {
  if (!input.urlChanged) return input.sourceResourceKey;
  if (!input.changedUrlResourceKey) {
    throw new Error("网址变化后缺少新的资源标识。");
  }
  return input.changedUrlResourceKey;
}

export function rehomeResourceAfterBookmarkUrlChange(input: {
  source: ResourceRecord;
  previousTarget?: ResourceRecord;
  targetResourceKey: string;
  bookmarkId: string;
  url: string;
  canonicalUrl: string;
  title: string;
  userNote: string;
  tags: string[];
  categoryCoverId?: string;
  nativeFolderPath: string[];
  syncStatus: SyncStatus;
  timestamp: string;
}): {
  remainingSource: ResourceRecord;
  nextResource: ResourceRecord;
} {
  if (input.targetResourceKey === input.source.resourceKey) {
    throw new Error("同一资源不得执行跨资源迁移。");
  }
  const remainingSource: ResourceRecord = {
    ...input.source,
    nativeBookmarkIds: input.source.nativeBookmarkIds.filter(
      (bookmarkId) => bookmarkId !== input.bookmarkId
    ),
    updatedAt: input.timestamp
  };
  const nextResource: ResourceRecord = {
    ...(input.previousTarget || input.source),
    resourceKey: input.targetResourceKey,
    canonicalUrl: input.canonicalUrl,
    url: input.url,
    title: input.title,
    userNote: input.userNote,
    summary: "",
    tags: input.tags,
    tagsSource: input.tags.length ? "user" : undefined,
    topics: [],
    aliases: undefined,
    useCases: undefined,
    contentType: undefined,
    questions: undefined,
    entities: undefined,
    aiSchemaVersion: undefined,
    contentExcerpt: "",
    contentHash: "",
    selectedText: "",
    author: "",
    siteName: new URL(input.url).hostname,
    language: "",
    imageUrl: "",
    thumbnailDataUrl: undefined,
    coverSource: undefined,
    coverUpdatedAt: undefined,
    categoryCoverId: input.categoryCoverId,
    snapshotAt: undefined,
    enhancementBlockReason: undefined,
    enhancementBlockMessage: undefined,
    linkHealth: undefined,
    faviconUrl: "",
    nativeBookmarkIds: [
      ...new Set([
        ...(input.previousTarget?.nativeBookmarkIds || []),
        input.bookmarkId
      ])
    ],
    nativeFolderPath: input.nativeFolderPath,
    aiStatus: "pending",
    syncStatus: input.syncStatus,
    createdAt:
      input.previousTarget?.createdAt || input.source.createdAt,
    updatedAt: input.timestamp,
    lastSyncedAt: input.previousTarget?.lastSyncedAt
  };
  return { remainingSource, nextResource };
}

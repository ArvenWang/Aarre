import {
  openDB,
  type DBSchema,
  type IDBPDatabase
} from "idb";
import type {
  OutboxItem,
  PageSnapshot,
  ResourceRecord,
  SiteBrandRecord,
  UndoSnapshotBatch
} from "./types";

const MAX_OUTBOX_CONTENT_LENGTH = 50_000;

interface BookmarkLayerDatabase extends DBSchema {
  resources: {
    key: string;
    value: ResourceRecord;
    indexes: {
      "by-updated-at": string;
    };
  };
  outbox: {
    key: string;
    value: OutboxItem;
    indexes: {
      "by-queued-at": string;
    };
  };
  undoSnapshots: {
    key: string;
    value: UndoSnapshotBatch;
    indexes: {
      "by-created-at": string;
    };
  };
  siteBrands: {
    key: string;
    value: SiteBrandRecord;
    indexes: {
      "by-updated-at": string;
    };
  };
  pageSnapshots: {
    key: string;
    value: PageSnapshot;
    indexes: {
      "by-captured-at": string;
    };
  };
}

let databasePromise: Promise<IDBPDatabase<BookmarkLayerDatabase>> | null = null;

const AI_STATUSES = new Set<ResourceRecord["aiStatus"]>([
  "not_requested",
  "pending",
  "processing",
  "ready",
  "failed",
  "unavailable"
]);
const SYNC_STATUSES = new Set<ResourceRecord["syncStatus"]>([
  "local",
  "pending",
  "synced",
  "failed"
]);
const LINK_HEALTH_STATUSES = new Set([
  "healthy",
  "login_required",
  "temporary",
  "dead",
  "soft_404"
]);

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is string => typeof item === "string" && item.length > 0
  );
}

function normalizeLinkHealth(
  value: unknown
): ResourceRecord["linkHealth"] {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Partial<
    NonNullable<ResourceRecord["linkHealth"]>
  >;
  if (
    !LINK_HEALTH_STATUSES.has(record.status || "") ||
    typeof record.checkedAt !== "string"
  ) {
    return undefined;
  }
  return {
    status: record.status as NonNullable<
      ResourceRecord["linkHealth"]
    >["status"],
    checkedAt: record.checkedAt,
    consecutiveFailures:
      typeof record.consecutiveFailures === "number"
        ? Math.max(0, Math.floor(record.consecutiveFailures))
        : 0,
    ...(typeof record.httpStatus === "number"
      ? { httpStatus: Math.floor(record.httpStatus) }
      : {}),
    ...(typeof record.finalUrl === "string" && record.finalUrl
      ? { finalUrl: record.finalUrl }
      : {}),
    ...(typeof record.reason === "string" && record.reason
      ? { reason: record.reason.slice(0, 240) }
      : {})
  };
}

/**
 * 早期版本只保存了标题和 URL。所有 IndexedDB 读取都经过这里，
 * 这样升级扩展后无需清空用户书签，也不会因缺少 AI 字段而崩溃。
 */
export function normalizeResourceRecord(value: unknown): ResourceRecord {
  const record =
    value && typeof value === "object"
      ? (value as Partial<ResourceRecord>)
      : {};
  const canonicalUrl =
    stringValue(record.canonicalUrl) || stringValue(record.url);
  const url = stringValue(record.url) || canonicalUrl;
  const timestamp = new Date().toISOString();
  const aiStatus = AI_STATUSES.has(record.aiStatus as ResourceRecord["aiStatus"])
    ? (record.aiStatus as ResourceRecord["aiStatus"])
    : "not_requested";
  const syncStatus = SYNC_STATUSES.has(
    record.syncStatus as ResourceRecord["syncStatus"]
  )
    ? (record.syncStatus as ResourceRecord["syncStatus"])
    : "local";
  const tagsSource =
    record.tagsSource === "user"
      ? "user"
      : record.tagsSource === "ai" || stringArray(record.tags).length
        ? "ai"
        : undefined;
  const linkHealth = normalizeLinkHealth(record.linkHealth);

  return {
    resourceKey:
      stringValue(record.resourceKey) || canonicalUrl || url,
    canonicalUrl,
    url,
    title: stringValue(record.title) || url,
    userNote: stringValue(record.userNote),
    summary: stringValue(record.summary),
    tags: stringArray(record.tags),
    ...(tagsSource ? { tagsSource } : {}),
    topics: stringArray(record.topics),
    ...(stringArray(record.aliases).length
      ? { aliases: stringArray(record.aliases) }
      : {}),
    ...(stringArray(record.useCases).length
      ? { useCases: stringArray(record.useCases) }
      : {}),
    ...(stringValue(record.contentType)
      ? { contentType: stringValue(record.contentType) }
      : {}),
    ...(stringArray(record.questions).length
      ? { questions: stringArray(record.questions) }
      : {}),
    ...(Array.isArray(record.entities)
      ? { entities: stringArray(record.entities) }
      : {}),
    ...(typeof record.aiSchemaVersion === "number" &&
    Number.isFinite(record.aiSchemaVersion) &&
    record.aiSchemaVersion > 0
      ? { aiSchemaVersion: Math.floor(record.aiSchemaVersion) }
      : {}),
    contentExcerpt: stringValue(record.contentExcerpt),
    contentHash: stringValue(record.contentHash),
    selectedText: stringValue(record.selectedText),
    author: stringValue(record.author),
    siteName: stringValue(record.siteName),
    language: stringValue(record.language),
    imageUrl: stringValue(record.imageUrl),
    ...(stringValue(record.thumbnailDataUrl)
      ? { thumbnailDataUrl: stringValue(record.thumbnailDataUrl) }
      : {}),
    ...(stringValue(record.coverSource)
      ? { coverSource: stringValue(record.coverSource) }
      : {}),
    ...(stringValue(record.coverUpdatedAt)
      ? { coverUpdatedAt: stringValue(record.coverUpdatedAt) }
      : {}),
    ...(stringValue(record.categoryCoverId)
      ? { categoryCoverId: stringValue(record.categoryCoverId) }
      : {}),
    ...(stringValue(record.snapshotAt)
      ? { snapshotAt: stringValue(record.snapshotAt) }
      : {}),
    ...(record.enhancementBlockReason === "privacy"
      ? { enhancementBlockReason: "privacy" as const }
      : {}),
    ...(stringValue(record.enhancementBlockMessage)
      ? {
          enhancementBlockMessage: stringValue(
            record.enhancementBlockMessage
          )
        }
      : {}),
    ...(linkHealth ? { linkHealth } : {}),
    faviconUrl: stringValue(record.faviconUrl),
    nativeBookmarkIds: stringArray(record.nativeBookmarkIds),
    nativeFolderPath: stringArray(record.nativeFolderPath),
    aiStatus,
    syncStatus,
    createdAt: stringValue(record.createdAt) || timestamp,
    updatedAt:
      stringValue(record.updatedAt) ||
      stringValue(record.createdAt) ||
      timestamp,
    ...(stringValue(record.lastSyncedAt)
      ? { lastSyncedAt: stringValue(record.lastSyncedAt) }
      : {})
  };
}

function database(): Promise<IDBPDatabase<BookmarkLayerDatabase>> {
  if (!databasePromise) {
    databasePromise = openDB<BookmarkLayerDatabase>(
      "bookmark-layer",
      4,
      {
        upgrade(db, oldVersion) {
          if (oldVersion < 1) {
            const resources = db.createObjectStore("resources", {
              keyPath: "resourceKey"
            });
            resources.createIndex("by-updated-at", "updatedAt");

            const outbox = db.createObjectStore("outbox", {
              keyPath: "resource.resourceKey"
            });
            outbox.createIndex("by-queued-at", "queuedAt");
          }
          if (oldVersion < 2) {
            const undoSnapshots = db.createObjectStore("undoSnapshots", {
              keyPath: "batchId"
            });
            undoSnapshots.createIndex("by-created-at", "createdAt");
          }
          if (oldVersion < 3) {
            const siteBrands = db.createObjectStore("siteBrands", {
              keyPath: "host"
            });
            siteBrands.createIndex("by-updated-at", "updatedAt");
          }
          if (oldVersion < 4) {
            const pageSnapshots = db.createObjectStore("pageSnapshots", {
              keyPath: "canonicalUrl"
            });
            pageSnapshots.createIndex("by-captured-at", "capturedAt");
          }
        }
      }
    );
  }
  return databasePromise;
}

function normalizeSiteBrand(value: SiteBrandRecord): SiteBrandRecord {
  const pageImageSamples =
    value.pageImageSamples &&
    typeof value.pageImageSamples === "object"
      ? Object.fromEntries(
          Object.entries(value.pageImageSamples)
            .filter(
              ([url, keys]) =>
                Boolean(url) &&
                Array.isArray(keys) &&
                keys.every((key) => typeof key === "string")
            )
            .slice(0, 20)
            .map(([url, keys]) => [url, [...new Set(keys)].slice(0, 3)])
        )
      : undefined;
  return {
    host: value.host.toLocaleLowerCase(),
    ...(value.iconDataUrl ? { iconDataUrl: value.iconDataUrl } : {}),
    ...(value.iconDataUrlLight
      ? { iconDataUrlLight: value.iconDataUrlLight }
      : {}),
    ...(value.iconDataUrlDark
      ? { iconDataUrlDark: value.iconDataUrlDark }
      : {}),
    ...(typeof value.iconRenderVersion === "number"
      ? { iconRenderVersion: value.iconRenderVersion }
      : {}),
    ...(value.iconSource ? { iconSource: value.iconSource } : {}),
    ...(value.iconAssetUrl
      ? { iconAssetUrl: value.iconAssetUrl.slice(0, 2_000) }
      : {}),
    ...(value.iconRejectReason
      ? { iconRejectReason: value.iconRejectReason }
      : {}),
    ...(typeof value.nativeWidth === "number"
      ? { nativeWidth: value.nativeWidth }
      : {}),
    ...(typeof value.nativeHeight === "number"
      ? { nativeHeight: value.nativeHeight }
      : {}),
    ...(value.skipPageImage
      ? { skipPageImage: true }
      : {}),
    ...(pageImageSamples && Object.keys(pageImageSamples).length
      ? { pageImageSamples }
      : {}),
    updatedAt: value.updatedAt
  };
}

export async function putSiteBrand(
  brand: SiteBrandRecord
): Promise<void> {
  const db = await database();
  await db.put("siteBrands", normalizeSiteBrand(brand));
}

export async function getSiteBrand(
  host: string
): Promise<SiteBrandRecord | undefined> {
  const db = await database();
  return db.get("siteBrands", host.toLocaleLowerCase());
}

export async function getSiteBrands(): Promise<SiteBrandRecord[]> {
  const db = await database();
  return db.getAll("siteBrands");
}

/**
 * Remove rendered icon bytes produced by an older compositor. The host-level
 * record and its diagnostics remain so the normal site scan can regenerate a
 * current alpha-preserving icon without losing other metadata.
 */
export async function invalidateStaleSiteBrandIcons(
  currentRenderVersion: number,
): Promise<number> {
  const db = await database();
  const brands = await db.getAll("siteBrands");
  const stale = brands.filter(
    (brand) =>
      brand.iconRenderVersion !== currentRenderVersion &&
      Boolean(
        brand.iconDataUrl || brand.iconDataUrlLight || brand.iconDataUrlDark,
      ),
  );
  if (!stale.length) return 0;

  const transaction = db.transaction("siteBrands", "readwrite");
  for (const brand of stale) {
    const {
      iconDataUrl: _iconDataUrl,
      iconDataUrlLight: _iconDataUrlLight,
      iconDataUrlDark: _iconDataUrlDark,
      iconRenderVersion: _iconRenderVersion,
      ...withoutRenderedIcon
    } = brand;
    await transaction.store.put(withoutRenderedIcon);
  }
  await transaction.done;
  return stale.length;
}

export async function putPageSnapshot(
  snapshot: PageSnapshot,
  maxSnapshots = 2_000
): Promise<void> {
  const db = await database();
  await db.put("pageSnapshots", snapshot);
  const count = await db.count("pageSnapshots");
  if (count <= maxSnapshots) return;
  const transaction = db.transaction("pageSnapshots", "readwrite");
  let remaining = count - maxSnapshots;
  let cursor = await transaction.store.index("by-captured-at").openCursor();
  while (cursor && remaining > 0) {
    await cursor.delete();
    remaining -= 1;
    cursor = await cursor.continue();
  }
  await transaction.done;
}

export async function getPageSnapshot(
  canonicalUrl: string
): Promise<PageSnapshot | undefined> {
  const db = await database();
  return db.get("pageSnapshots", canonicalUrl);
}

export async function deletePageSnapshot(canonicalUrl: string): Promise<void> {
  const db = await database();
  await db.delete("pageSnapshots", canonicalUrl);
}

export async function getPageSnapshots(): Promise<PageSnapshot[]> {
  const db = await database();
  return (
    await db.getAllFromIndex("pageSnapshots", "by-captured-at")
  ).reverse();
}

export async function countPageSnapshots(): Promise<number> {
  const db = await database();
  return db.count("pageSnapshots");
}

export async function putUndoSnapshot(
  batch: UndoSnapshotBatch
): Promise<void> {
  const db = await database();
  await db.put("undoSnapshots", batch);
}

export async function getUndoSnapshot(
  batchId: string
): Promise<UndoSnapshotBatch | undefined> {
  const db = await database();
  return db.get("undoSnapshots", batchId);
}

export async function getUndoSnapshots(): Promise<UndoSnapshotBatch[]> {
  const db = await database();
  return (await db.getAllFromIndex("undoSnapshots", "by-created-at")).reverse();
}

export async function deleteUndoSnapshot(batchId: string): Promise<void> {
  const db = await database();
  await db.delete("undoSnapshots", batchId);
}

export async function cleanupExpiredUndoSnapshots(
  at = new Date()
): Promise<number> {
  const db = await database();
  const transaction = db.transaction("undoSnapshots", "readwrite");
  let removed = 0;
  let cursor = await transaction.store.openCursor();
  while (cursor) {
    if (Date.parse(cursor.value.expiresAt) <= at.getTime()) {
      await cursor.delete();
      removed += 1;
    }
    cursor = await cursor.continue();
  }
  await transaction.done;
  return removed;
}

export async function getLocalResources(): Promise<ResourceRecord[]> {
  const db = await database();
  return (await db.getAllFromIndex("resources", "by-updated-at"))
    .reverse()
    .map(normalizeResourceRecord);
}

export async function getLocalResource(
  resourceKey: string
): Promise<ResourceRecord | undefined> {
  const db = await database();
  const resource = await db.get("resources", resourceKey);
  return resource ? normalizeResourceRecord(resource) : undefined;
}

export async function upsertLocalResource(
  nextResource: ResourceRecord
): Promise<void> {
  const db = await database();
  await db.put("resources", normalizeResourceRecord(nextResource));
}

export async function deleteLocalResource(resourceKey: string): Promise<void> {
  const db = await database();
  await db.delete("resources", resourceKey);
}

export async function mergeLocalResources(
  incoming: ResourceRecord[]
): Promise<ResourceRecord[]> {
  const db = await database();
  const transaction = db.transaction("resources", "readwrite");

  for (const incomingItem of incoming) {
    const item = normalizeResourceRecord(incomingItem);
    const storedLocal = await transaction.store.get(item.resourceKey);
    const local = storedLocal
      ? normalizeResourceRecord(storedLocal)
      : undefined;
    const preservePendingLocal =
      local?.syncStatus === "pending" &&
      local.updatedAt >= item.updatedAt;
    await transaction.store.put({
      ...item,
      ...(preservePendingLocal ? local : {}),
      ...(local?.thumbnailDataUrl
        ? { thumbnailDataUrl: local.thumbnailDataUrl }
        : {}),
      nativeBookmarkIds:
        local?.nativeBookmarkIds.length && !item.nativeBookmarkIds.length
          ? local.nativeBookmarkIds
          : item.nativeBookmarkIds
    });
  }

  await transaction.done;
  return getLocalResources();
}

export async function getOutbox(): Promise<OutboxItem[]> {
  const db = await database();
  return (await db.getAllFromIndex("outbox", "by-queued-at")).map(
    (item) => ({
      ...item,
      resource: normalizeResourceRecord(item.resource)
    })
  );
}

export async function enqueueOutbox(
  resource: ResourceRecord,
  content: string
): Promise<OutboxItem> {
  const db = await database();
  const normalizedResource = normalizeResourceRecord(resource);
  const existing = await db.get(
    "outbox",
    normalizedResource.resourceKey
  );
  const nextContent = content
    ? content.slice(0, MAX_OUTBOX_CONTENT_LENGTH)
    : existing?.content || "";
  const nextItem: OutboxItem = {
    revision: crypto.randomUUID(),
    resource: normalizedResource,
    content: nextContent,
    attempts: 0,
    queuedAt: existing?.queuedAt || new Date().toISOString()
  };
  await db.put("outbox", nextItem);
  return nextItem;
}

export async function removeOutboxItem(resourceKey: string): Promise<void> {
  const db = await database();
  await db.delete("outbox", resourceKey);
}

function sameOutboxRevision(
  current: OutboxItem,
  expected: OutboxItem
): boolean {
  if (current.revision && expected.revision) {
    return current.revision === expected.revision;
  }

  return (
    current.resource.updatedAt === expected.resource.updatedAt &&
    current.content === expected.content &&
    current.queuedAt === expected.queuedAt &&
    current.attempts === expected.attempts
  );
}

export async function completeOutboxItem(
  expected: OutboxItem
): Promise<boolean> {
  const db = await database();
  const transaction = db.transaction("outbox", "readwrite");
  const current = await transaction.store.get(expected.resource.resourceKey);
  if (!current || !sameOutboxRevision(current, expected)) {
    await transaction.done;
    return false;
  }

  await transaction.store.delete(expected.resource.resourceKey);
  await transaction.done;
  return true;
}

export async function deferOutboxItem(
  expected: OutboxItem,
  error: string,
  failedAt = new Date()
): Promise<boolean> {
  const db = await database();
  const transaction = db.transaction("outbox", "readwrite");
  const current = await transaction.store.get(expected.resource.resourceKey);
  if (!current || !sameOutboxRevision(current, expected)) {
    await transaction.done;
    return false;
  }

  const attempts = current.attempts + 1;
  const retryDelayMinutes = Math.min(5 * 2 ** (attempts - 1), 6 * 60);
  await transaction.store.put({
    ...current,
    revision: crypto.randomUUID(),
    attempts,
    lastAttemptAt: failedAt.toISOString(),
    nextAttemptAt: new Date(
      failedAt.getTime() + retryDelayMinutes * 60_000
    ).toISOString(),
    lastError: error
  });
  await transaction.done;
  return true;
}

export const chromeStorageAdapter = {
  async getItem(key: string): Promise<string | null> {
    const result = await chrome.storage.local.get(key);
    return typeof result[key] === "string" ? result[key] : null;
  },
  async setItem(key: string, value: string): Promise<void> {
    await chrome.storage.local.set({ [key]: value });
  },
  async removeItem(key: string): Promise<void> {
    await chrome.storage.local.remove(key);
  }
};

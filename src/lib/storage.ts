import {
  openDB,
  type DBSchema,
  type IDBPDatabase
} from "idb";
import type {
  OutboxItem,
  ResourceRecord,
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

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is string => typeof item === "string" && item.length > 0
  );
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
      2,
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
        }
      }
    );
  }
  return databasePromise;
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

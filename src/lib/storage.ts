import {
  openDB,
  type DBSchema,
  type IDBPDatabase
} from "idb";
import type { OutboxItem, ResourceRecord } from "./types";

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
}

let databasePromise: Promise<IDBPDatabase<BookmarkLayerDatabase>> | null = null;

function database(): Promise<IDBPDatabase<BookmarkLayerDatabase>> {
  if (!databasePromise) {
    databasePromise = openDB<BookmarkLayerDatabase>(
      "bookmark-layer",
      1,
      {
        upgrade(db) {
          const resources = db.createObjectStore("resources", {
            keyPath: "resourceKey"
          });
          resources.createIndex("by-updated-at", "updatedAt");

          const outbox = db.createObjectStore("outbox", {
            keyPath: "resource.resourceKey"
          });
          outbox.createIndex("by-queued-at", "queuedAt");
        }
      }
    );
  }
  return databasePromise;
}

export async function getLocalResources(): Promise<ResourceRecord[]> {
  const db = await database();
  return (await db.getAllFromIndex("resources", "by-updated-at")).reverse();
}

export async function getLocalResource(
  resourceKey: string
): Promise<ResourceRecord | undefined> {
  const db = await database();
  return db.get("resources", resourceKey);
}

export async function upsertLocalResource(
  nextResource: ResourceRecord
): Promise<void> {
  const db = await database();
  await db.put("resources", nextResource);
}

export async function mergeLocalResources(
  incoming: ResourceRecord[]
): Promise<ResourceRecord[]> {
  const db = await database();
  const transaction = db.transaction("resources", "readwrite");

  for (const item of incoming) {
    const local = await transaction.store.get(item.resourceKey);
    const preservePendingLocal =
      local?.syncStatus === "pending" &&
      local.updatedAt >= item.updatedAt;
    await transaction.store.put({
      ...item,
      ...(preservePendingLocal ? local : {}),
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
  return db.getAllFromIndex("outbox", "by-queued-at");
}

export async function enqueueOutbox(
  resource: ResourceRecord,
  content: string
): Promise<OutboxItem> {
  const db = await database();
  const existing = await db.get("outbox", resource.resourceKey);
  const nextContent = content
    ? content.slice(0, MAX_OUTBOX_CONTENT_LENGTH)
    : existing?.content || "";
  const nextItem: OutboxItem = {
    revision: crypto.randomUUID(),
    resource,
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

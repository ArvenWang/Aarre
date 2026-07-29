import {
  openDB,
  type DBSchema,
  type IDBPDatabase
} from "idb";
import type { OutboxItem, ResourceRecord } from "./types";

const MAX_METADATA_ONLY_OUTBOX_ITEMS = 2_000;
const MAX_CONTENT_OUTBOX_ITEMS = 50;
const MAX_OUTBOX_CONTENT_LENGTH = 30_000;

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
    await transaction.store.put({
      ...local,
      ...item,
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
  return (await db.getAllFromIndex("outbox", "by-queued-at")).reverse();
}

export async function enqueueOutbox(
  resource: ResourceRecord,
  content: string
): Promise<void> {
  const db = await database();
  await db.put("outbox", {
    resource,
    content: content.slice(0, MAX_OUTBOX_CONTENT_LENGTH),
    attempts: 0,
    queuedAt: new Date().toISOString()
  });
  await trimOutbox();
}

export async function updateOutbox(items: OutboxItem[]): Promise<void> {
  const contentItems = items
    .filter((item) => item.content.length > 0)
    .slice(0, MAX_CONTENT_OUTBOX_ITEMS);
  const metadataItems = items
    .filter((item) => item.content.length === 0)
    .slice(0, MAX_METADATA_ONLY_OUTBOX_ITEMS);
  const db = await database();
  const transaction = db.transaction("outbox", "readwrite");
  await transaction.store.clear();
  for (const item of [...contentItems, ...metadataItems]) {
    await transaction.store.put(item);
  }
  await transaction.done;
}

export async function removeOutboxItem(resourceKey: string): Promise<void> {
  const db = await database();
  await db.delete("outbox", resourceKey);
}

async function trimOutbox(): Promise<void> {
  const current = await getOutbox();
  const contentCount = current.filter((item) => item.content.length > 0).length;
  const metadataCount = current.length - contentCount;

  if (
    contentCount > MAX_CONTENT_OUTBOX_ITEMS ||
    metadataCount > MAX_METADATA_ONLY_OUTBOX_ITEMS
  ) {
    await updateOutbox(current);
  }
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

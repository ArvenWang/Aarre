import { database, mergeCloudResource, normalizeResourceRecord } from "./storage";
import type { ResourceRecord } from "./types";

const KEY = "cloud-resources:v2";
const LEGACY_CURSOR = "aarre:cloud-sync-cursor:v1";
const LEGACY_REVISIONS = "aarre:cloud-resource-revisions:v1";

export interface CloudResourceTracking {
  generation: string;
  cursor: number;
  revisions: Record<string, number>;
}

export interface CloudResourceChange {
  resourceKey: string;
  revision: number;
  resource?: ResourceRecord;
  deleted?: boolean;
}

export async function readCloudResourceTracking(): Promise<CloudResourceTracking> {
  const db = await database();
  const current = await db.get("syncMetadata", KEY) as CloudResourceTracking | undefined;
  if (current) return current;
  const legacy = await chrome.storage.local.get([LEGACY_CURSOR, LEGACY_REVISIONS]);
  const candidate = legacy[LEGACY_REVISIONS];
  const revisions = candidate && typeof candidate === "object"
    ? Object.fromEntries(Object.entries(candidate).filter(([, value]) => Number.isSafeInteger(value) && Number(value) >= 0)) as Record<string, number>
    : {};
  const transaction = db.transaction("syncMetadata", "readwrite");
  const concurrent = await transaction.store.get(KEY) as CloudResourceTracking | undefined;
  const initial = concurrent || {
    generation: crypto.randomUUID(),
    cursor: Number.isSafeInteger(legacy[LEGACY_CURSOR]) && Number(legacy[LEGACY_CURSOR]) > 0 ? Number(legacy[LEGACY_CURSOR]) : 0,
    revisions
  };
  if (!concurrent) await transaction.store.put(initial, KEY);
  await transaction.done;
  return initial;
}

export async function clearCloudResourceTracking(expectedGeneration?: string): Promise<void> {
  const db = await database();
  const transaction = db.transaction("syncMetadata", "readwrite");
  const current = await transaction.store.get(KEY) as CloudResourceTracking | undefined;
  if (expectedGeneration && current?.generation !== expectedGeneration) { await transaction.done; throw new Error("云端会话已变化，请重新同步。"); }
  await transaction.store.put({ generation: crypto.randomUUID(), cursor: 0, revisions: {} }, KEY);
  await transaction.done;
  await chrome.storage.local.remove([LEGACY_CURSOR, LEGACY_REVISIONS]);
}

/** Resources, deletions, revisions and cursor commit together or none do. */
export async function commitCloudResourceChanges(
  expectedGeneration: string,
  changes: CloudResourceChange[],
  cursor?: number
): Promise<ResourceRecord[]> {
  const db = await database();
  const transaction = db.transaction(["resources", "outbox", "syncMetadata"], "readwrite");
  const tracking = await transaction.objectStore("syncMetadata").get(KEY) as CloudResourceTracking | undefined;
  if (!tracking || tracking.generation !== expectedGeneration) {
    await transaction.done;
    throw new Error("云端账号已变化，已忽略上一个会话的同步结果。");
  }
  const revisions = { ...tracking.revisions };
  const applied = new Map<string, ResourceRecord>();
  const resources = transaction.objectStore("resources");
  for (const change of changes) {
    if ((revisions[change.resourceKey] || 0) > change.revision) continue;
    revisions[change.resourceKey] = change.revision;
    if (change.deleted) {
      await resources.delete(change.resourceKey);
      await transaction.objectStore("outbox").delete(change.resourceKey);
      applied.delete(change.resourceKey);
    } else if (change.resource) {
      const stored = await resources.get(change.resourceKey);
      const local = stored ? normalizeResourceRecord(stored) : undefined;
      const merged = mergeCloudResource(local, normalizeResourceRecord(change.resource));
      await resources.put(merged);
      applied.set(change.resourceKey, merged);
    }
  }
  const next = { ...tracking, revisions, cursor: cursor === undefined ? tracking.cursor : Math.max(tracking.cursor, cursor) };
  await transaction.objectStore("syncMetadata").put(next, KEY);
  await transaction.done;
  return [...applied.values()];
}

import { cloudOwner } from "./cloud-owner";
import { cloudRequest } from "./auth";
import {
  buildProtectionPolicy,
  getProtectionSettings,
  isResourceUserProtected
} from "./protection";
import {
  completeOutboxItem,
  deleteLocalResource,
  deferOutboxItem,
  getLocalResource,
  getOutbox,
} from "./storage";
import { clearCloudResourceTracking, commitCloudResourceChanges, readCloudResourceTracking, type CloudResourceChange } from "./cloud-resource-store";
import type { OutboxItem, ResourceRecord } from "./types";

interface CloudResourcePayload {
  canonicalUrl: string;
  summary?: string;
  userNote?: string;
  tags?: string[];
  tagsSource?: "ai" | "user";
  topics?: string[];
  aliases?: string[];
  useCases?: string[];
  contentType?: string;
  questions?: string[];
  entities?: string[];
  aiSchemaVersion?: number;
  selectedText?: string;
  author?: string;
  siteName?: string;
  language?: string;
  contentHash?: string;
  linkHealth?: ResourceRecord["linkHealth"];
  coverSource?: string;
  coverUpdatedAt?: string;
  coverOrigin?: "user" | "auto";
  coverContentHash?: string;
  categoryCoverId?: string;
  createdAt: string;
  updatedAt: string;
}

interface CloudResourceResponse {
  resourceKey: string;
  payload: CloudResourcePayload;
  revision: number;
  fieldUpdatedAt: Record<string, string>;
  deleted: boolean;
  sequence?: number;
  conflictCount?: number;
}

export interface CloudConflict {
  conflictId: string;
  resourceKey: string;
  baseRevision: number;
  serverRevision: number;
  createdAt: string;
  fields: Array<{
    field: "userNote" | "tags";
    current: string | string[];
    incoming: string | string[];
  }>;
}

/**
 * The local sync status is not account-scoped and can survive upgrades from an
 * older cloud implementation. The revision map, however, is cleared whenever
 * the signed-in account changes and is rebuilt from that account's bootstrap.
 * First-sync seeding must therefore use both signals: a record marked
 * "synced" is only safe to skip when this account actually returned a
 * revision for it.
 */
export async function getTrackedCloudResourceKeys(): Promise<ReadonlySet<string>> {
  return new Set(Object.keys((await readCloudResourceTracking()).revisions));
}

export function shouldQueueResourceForCloud(
  resource: Pick<ResourceRecord, "resourceKey" | "nativeBookmarkIds" | "syncStatus">,
  trackedResourceKeys: ReadonlySet<string>
): boolean {
  return (
    resource.nativeBookmarkIds.length > 0 &&
    (resource.syncStatus !== "synced" ||
      !trackedResourceKeys.has(resource.resourceKey))
  );
}

export async function clearCloudResourceSyncTracking(): Promise<void> {
  await clearCloudResourceTracking();
}

function nonEmpty<T>(value: T | "" | undefined): T | undefined {
  return value === "" || value === undefined ? undefined : value;
}

export function resourceCloudPayload(resource: ResourceRecord): CloudResourcePayload {
  return {
    canonicalUrl: resource.canonicalUrl,
    ...(nonEmpty(resource.summary) ? { summary: resource.summary } : {}),
    ...(resource.userNote || resource.fieldClears?.includes("userNote") ? { userNote: resource.userNote } : {}),
    ...(resource.tags.length || resource.fieldClears?.includes("tags") ? { tags: resource.tags } : {}),
    ...(resource.tagsSource ? { tagsSource: resource.tagsSource } : {}),
    ...(resource.topics.length ? { topics: resource.topics } : {}),
    ...(resource.aliases?.length ? { aliases: resource.aliases } : {}),
    ...(resource.useCases?.length ? { useCases: resource.useCases } : {}),
    ...(resource.contentType ? { contentType: resource.contentType } : {}),
    ...(resource.questions?.length ? { questions: resource.questions } : {}),
    ...(resource.entities?.length ? { entities: resource.entities } : {}),
    ...(resource.aiSchemaVersion ? { aiSchemaVersion: resource.aiSchemaVersion } : {}),
    ...(nonEmpty(resource.selectedText) ? { selectedText: resource.selectedText.slice(0, 8_192) } : {}),
    ...(nonEmpty(resource.author) ? { author: resource.author } : {}),
    ...(nonEmpty(resource.siteName) ? { siteName: resource.siteName } : {}),
    ...(nonEmpty(resource.language) ? { language: resource.language } : {}),
    ...(nonEmpty(resource.contentHash) ? { contentHash: resource.contentHash } : {}),
    ...(resource.linkHealth ? { linkHealth: resource.linkHealth } : {}),
    ...(resource.coverSource ? { coverSource: resource.coverSource } : {}),
    ...(resource.coverUpdatedAt ? { coverUpdatedAt: resource.coverUpdatedAt } : {}),
    ...(resource.coverOrigin ? { coverOrigin: resource.coverOrigin } : {}),
    ...(nonEmpty(resource.coverContentHash) ? { coverContentHash: resource.coverContentHash } : {}),
    ...(resource.categoryCoverId ? { categoryCoverId: resource.categoryCoverId } : {}),
    createdAt: resource.createdAt,
    updatedAt: resource.updatedAt
  };
}

async function resourceIsProtected(resource: ResourceRecord): Promise<boolean> {
  const [settings, tree] = await Promise.all([
    getProtectionSettings(),
    chrome.bookmarks.getTree()
  ]);
  return isResourceUserProtected(
    resource,
    buildProtectionPolicy(tree, settings)
  );
}

async function responseToLocal(cloud: CloudResourceResponse): Promise<ResourceRecord> {
  const existing = await getLocalResource(cloud.resourceKey);
  const payload = cloud.payload;
  const timestamp = new Date().toISOString();
  return {
    resourceKey: cloud.resourceKey,
    canonicalUrl: payload.canonicalUrl,
    url: existing?.url || payload.canonicalUrl,
    title: existing?.title || payload.canonicalUrl,
    userNote: payload.userNote || "",
    summary: payload.summary || "",
    tags: payload.tags || [],
    ...(payload.tagsSource ? { tagsSource: payload.tagsSource } : {}),
    topics: payload.topics || [],
    ...(payload.aliases?.length ? { aliases: payload.aliases } : {}),
    ...(payload.useCases?.length ? { useCases: payload.useCases } : {}),
    ...(payload.contentType ? { contentType: payload.contentType } : {}),
    ...(payload.questions?.length ? { questions: payload.questions } : {}),
    ...(payload.entities ? { entities: payload.entities } : {}),
    ...(payload.aiSchemaVersion ? { aiSchemaVersion: payload.aiSchemaVersion } : {}),
    contentExcerpt: existing?.contentExcerpt || "",
    contentHash: payload.contentHash || "",
    selectedText: payload.selectedText || "",
    author: payload.author || "",
    siteName: payload.siteName || existing?.siteName || "",
    language: payload.language || "",
    imageUrl: existing?.imageUrl || "",
    ...(existing?.thumbnailDataUrl ? { thumbnailDataUrl: existing.thumbnailDataUrl } : {}),
    ...(payload.coverSource ? { coverSource: payload.coverSource } : {}),
    ...(payload.coverUpdatedAt ? { coverUpdatedAt: payload.coverUpdatedAt } : {}),
    ...(payload.coverOrigin ? { coverOrigin: payload.coverOrigin } : {}),
    ...(payload.coverContentHash ? { coverContentHash: payload.coverContentHash } : {}),
    ...(payload.categoryCoverId ? { categoryCoverId: payload.categoryCoverId } : {}),
    ...(existing?.snapshotAt ? { snapshotAt: existing.snapshotAt } : {}),
    ...(payload.linkHealth ? { linkHealth: payload.linkHealth } : {}),
    faviconUrl: existing?.faviconUrl || "",
    nativeBookmarkIds: existing?.nativeBookmarkIds || [],
    nativeFolderPath: existing?.nativeFolderPath || [],
    aiStatus: payload.summary ? "ready" : existing?.aiStatus || "not_requested",
    syncStatus: "synced",
    createdAt: payload.createdAt || existing?.createdAt || timestamp,
    updatedAt: payload.updatedAt || timestamp,
    lastSyncedAt: timestamp,
    // 携带云端的字段时钟，让 mergeLocalResources 能逐字段裁决而不是整条覆盖。
    fieldUpdatedAt: cloud.fieldUpdatedAt || {},
    fieldClears: [
      ...(Object.hasOwn(payload, "userNote") && payload.userNote === "" ? ["userNote" as const] : []),
      ...(Object.hasOwn(payload, "tags") && payload.tags?.length === 0 ? ["tags" as const] : [])
    ]
  };
}

export async function syncOneResource(
  resource: ResourceRecord,
  _content: string,
  operationId: string = crypto.randomUUID(),
  owner?: string
): Promise<ResourceRecord> {
  if (await resourceIsProtected(resource)) {
    throw Object.assign(new Error("受保护的收藏不会上传云端。"), { protectedResource: true });
  }
  const payload = resourceCloudPayload(resource);
  const tracking = await readCloudResourceTracking();
  const baseRevision = tracking.revisions[resource.resourceKey] || 0;
  const response = await cloudRequest<CloudResourceResponse>(
    `/v1/sync/resources/${encodeURIComponent(resource.resourceKey)}`,
    {
      method: "PUT",
      body: JSON.stringify({
        operationId,
        clientRevision: operationId,
        baseRevision,
        payload,
        fieldUpdatedAt: Object.fromEntries(
          Object.keys(payload).map((field) => [
            field,
            resource.fieldUpdatedAt?.[field] || resource.updatedAt
          ])
        ),
        deleted: Boolean(resource.deletedAt)
      })
    }, owner
  );
  if (resource.deletedAt) {
    await commitCloudResourceChanges(tracking.generation, [{ resourceKey: resource.resourceKey, revision: response.revision }]);
    return resource;
  }
  const local = await responseToLocal(response);
  const applied = await commitCloudResourceChanges(tracking.generation, [{ resourceKey: resource.resourceKey, revision: response.revision, resource: local }]);
  return applied[0] || (await getLocalResource(resource.resourceKey)) || local;
}

async function pullFullCloudResources(): Promise<ResourceRecord[]> {
  const tracking = await readCloudResourceTracking();
  const incoming = new Map<string, ResourceRecord>();
  let offset = 0;
  let bootstrapCursor: number | undefined;
  while (true) {
    const page = await cloudRequest<{
      resources: CloudResourceResponse[];
      nextOffset: number | null;
      cursor: number;
    }>(`/v1/sync/bootstrap?offset=${offset}&limit=200`);
    // Replay changes since the first page, including edits while bootstrap ran.
    bootstrapCursor ??= page.cursor;
    const changes: CloudResourceChange[] = [];
    for (const cloud of page.resources) {
      changes.push({
        resourceKey: cloud.resourceKey, revision: cloud.revision,
        ...(cloud.deleted ? { deleted: true } : { resource: await responseToLocal(cloud) })
      });
      if (cloud.deleted) incoming.delete(cloud.resourceKey);
    }
    const applied = await commitCloudResourceChanges(
      tracking.generation, changes, page.nextOffset === null ? bootstrapCursor : undefined
    );
    for (const item of applied) incoming.set(item.resourceKey, item);
    if (page.nextOffset === null) break;
    if (!Number.isSafeInteger(page.nextOffset) || page.nextOffset <= offset) {
      throw new Error("云端分页没有继续推进，已保留已接收数据并停止重试。");
    }
    offset = page.nextOffset;
  }
  return [...incoming.values()];
}

export async function pullCloudResources(): Promise<ResourceRecord[]> {
  const tracking = await readCloudResourceTracking();
  let cursor = tracking.cursor;
  if (!cursor) return pullFullCloudResources();
  const incoming = new Map<string, ResourceRecord>();
  while (true) {
    const page = await cloudRequest<{
      changes: Array<{
        sequence: number; entityType: string; entityId: string;
        revision: number; deleted: boolean;
        payload?: CloudResourcePayload | null;
        fieldUpdatedAt?: Record<string, string>;
      }>;
      cursor: number; hasMore: boolean; fullResyncRequired: boolean;
    }>(`/v1/sync/changes?cursor=${cursor}&limit=200`);
    if (page.fullResyncRequired) {
      await clearCloudResourceTracking(tracking.generation);
      return pullFullCloudResources();
    }
    if (!Number.isSafeInteger(page.cursor) || page.cursor < cursor || (page.hasMore && page.cursor === cursor)) {
      throw new Error("云端同步进度无效，已停止提交这批变化。");
    }
    const changes: CloudResourceChange[] = [];
    for (const change of [...page.changes].sort((a, b) => a.sequence - b.sequence)) {
      if (change.entityType !== "resource") continue;
      if (change.deleted) {
        changes.push({ resourceKey: change.entityId, revision: change.revision, deleted: true });
        incoming.delete(change.entityId);
      } else if (change.payload) {
        changes.push({
          resourceKey: change.entityId, revision: change.revision,
          resource: await responseToLocal({
            resourceKey: change.entityId, payload: change.payload, revision: change.revision,
            fieldUpdatedAt: change.fieldUpdatedAt || {}, deleted: false, sequence: change.sequence
          })
        });
      } else {
        throw new Error("云端变化缺少收藏内容，已停止提交这批数据。");
      }
    }
    const applied = await commitCloudResourceChanges(tracking.generation, changes, page.cursor);
    for (const item of applied) incoming.set(item.resourceKey, item);
    cursor = page.cursor;
    if (!page.hasMore) break;
  }
  return [...incoming.values()];
}

export async function listCloudConflicts(): Promise<CloudConflict[]> {
  const response = await cloudRequest<{ conflicts: CloudConflict[] }>(
    "/v1/sync/conflicts"
  );
  return response.conflicts;
}

export async function resolveCloudConflict(
  conflictId: string,
  input: {
    resolution: "current" | "incoming" | "merged";
    mergedUserNote?: string;
    mergedTags?: string[];
  }
): Promise<void> {
  await cloudRequest(`/v1/sync/conflicts/${encodeURIComponent(conflictId)}/resolve`, {
    method: "POST",
    body: JSON.stringify({ operationId: crypto.randomUUID(), ...input })
  });
  await pullCloudResources();
}

function due(item: OutboxItem, at = Date.now()): boolean {
  return !item.nextAttemptAt || Date.parse(item.nextAttemptAt) <= at;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "云端同步失败";
}

export async function processOutbox(options: { force?: boolean } = {}): Promise<{
  attempted: number;
  synced: number;
  failed: number;
}> {
  const owner = await cloudOwner();
  const items = (await getOutbox()).filter((item) => options.force || due(item)).slice(0, 25);
  let synced = 0;
  let failed = 0;
  for (const item of items) {
    try {
      if (await resourceIsProtected(item.resource)) {
        await completeOutboxItem(item);
        continue;
      }
      await syncOneResource(item.resource, "", item.revision || crypto.randomUUID(), owner);
      const completed = await completeOutboxItem(item);
      if (completed && item.resource.deletedAt) {
        await deleteLocalResource(item.resource.resourceKey);
      }
      synced += 1;
    } catch (error) {
      if ((error as { protectedResource?: boolean })?.protectedResource) {
        await completeOutboxItem(item);
        continue;
      }
      await deferOutboxItem(item, message(error));
      failed += 1;
    }
  }
  return { attempted: items.length, synced, failed };
}

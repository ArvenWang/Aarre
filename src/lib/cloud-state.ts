import { cloudRequest } from "./auth";
import {
  getCloudSyncSettings,
  saveCloudSyncSettings,
  type CloudSyncSettings
} from "./cloud-settings";
import {
  conversationHasCompletedAnswer,
  getAgentConversations,
  saveIncomingAgentConversation
} from "./conversations";
import {
  getDisplaySettings,
  saveDisplaySettings,
  type DisplaySettings
} from "./display-settings";
import {
  buildProtectionPolicy,
  getProtectionSettings,
  isResourceUserProtected,
  saveProtectionSettings,
  type ProtectionSettings
} from "./protection";
import { getAiSettingsStatus, saveAiModelPreferences } from "./settings";
import { getAiUsageStats, mergeAiUsageStats } from "./usage-stats";
import { getLocalResources, getUndoSnapshots } from "./storage";
import { getSyncedThemeMode, saveSyncedThemeMode } from "./theme";
import { isSupportedPageUrl, resourceKeyForUrl } from "./url";
import type {
  AgentConversation,
  AiProviderId,
  AiUsageStats,
  BookmarkAgentActionProposal
} from "./types";

const CLOUD_STATE_KEY = "aarre:cloud-durable-state:v1";
const CLOUD_PROTECTION_BINDINGS_KEY = "aarre:cloud-protection-bindings:v1";
const ORGANIZATION_INSIGHTS_KEY = "aarre:organization-insights";
const CLOUD_OPERATION_HISTORY_KEY = "aarre:cloud-operation-history:v1";
const CLOUD_BOOKMARK_BINDINGS_KEY = "aarre:cloud-bookmark-bindings:v1";
const BOOKMARK_ITEM_ID_MIGRATION_KEY = "aarre:cloud-bookmark-id-migration:v2";

export async function clearDurableCloudStateTracking(): Promise<void> {
  await chrome.storage.local.remove([
    CLOUD_STATE_KEY,
    CLOUD_PROTECTION_BINDINGS_KEY,
    CLOUD_BOOKMARK_BINDINGS_KEY
  ]);
}

interface SyncedStateEntry {
  hash: string;
  revision?: number;
}

type SyncedState = Record<string, SyncedStateEntry>;

interface ProtectionBinding {
  ruleId: string;
  kind: "resource" | "folder";
  resourceKey?: string;
  nativeFolderId?: string;
  path?: string[];
  parentPath?: string[];
  title?: string;
  /** Resource identities currently inherited from this protected folder.
   * The server stores these in a normalized enforcement table, while the
   * encrypted folder payload remains the cross-device rebinding source. */
  resourceKeys?: string[];
  createdAt: string;
  updatedAt?: string;
}

interface CloudEntity {
  entityType: string;
  entityId: string;
  payload: unknown;
  revision: number;
  deleted: boolean;
}

interface EntityMutationInput {
  entityType: string;
  entityId: string;
  updatedAt: string;
  payload: unknown;
  deleted?: boolean;
}

interface PreparedEntityMutation {
  stateKey: string;
  hash: string;
  mutation: EntityMutationInput & { operationId: string; deleted: boolean };
}

interface BookmarkItemPayload {
  bookmarkItemId: string;
  resourceKey: string;
  userNote: string;
  tags: string[];
  bindingHint: {
    title: string;
    url: string;
    folderPath: string[];
  };
  createdAt: string;
  updatedAt: string;
}

interface BookmarkItemBinding {
  bookmarkItemId: string;
  nativeBookmarkId?: string;
  payload: BookmarkItemPayload;
}

interface NativeBookmarkHint {
  id: string;
  title: string;
  url: string;
  folderPath: string[];
  dateAdded?: number;
}

export function usagePeriodCloudPayload(input: {
  period: string;
  provider: AiProviderId;
  model: string;
  usage: AiUsageStats;
}) {
  return {
    period: input.period,
    provider: input.provider,
    model: input.model,
    inputTokens: input.usage.inputTokens,
    outputTokens: input.usage.outputTokens,
    cachedInputTokens: input.usage.cachedInputTokens,
    estimatedTokens: input.usage.estimatedTokens,
    estimatedCostCny: input.usage.estimatedCostCny,
    scanCount: input.usage.scanCount,
    priceUpdatedAt: input.usage.priceUpdatedAt,
    updatedAt: input.usage.updatedAt
  };
}

/**
 * 公共 favicon 开关是设备本地隐私偏好：不上传云端，也不允许其他设备
 * 通过设置恢复覆盖。这里显式列出服务端契约字段，避免以后给本地设置新增
 * 属性时再次触发 strict schema 的 unrecognized_keys。
 */
export function cloudDisplaySettingsPayload(input: DisplaySettings) {
  return {
    listCoverStyle: input.listCoverStyle,
    pageSnapshotsEnabled: input.pageSnapshotsEnabled,
    snapshotExcludedHosts: input.snapshotExcludedHosts,
    scanCostLimitCny: input.scanCostLimitCny
  };
}

async function digest(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function stableUuid(identity: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(identity));
  const bytes = new Uint8Array(hash).slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * 收藏位置的云端标识。
 *
 * 只能使用跨设备稳定的信息。Chrome Sync 同步书签内容但不同步本地
 * 书签 ID，用 `chrome.bookmarks` 的 id 派生会让同一条书签在每台
 * 设备上得到不同的云端标识，两台设备随后会把对方的记录当成重复项
 * 互相删除。规范化网址与文件夹路径在所有设备上一致，可以让云端按
 * 同一个标识 upsert。
 */
export async function bookmarkItemIdFor(
  resourceKey: string,
  folderPath: readonly string[]
): Promise<string> {
  const normalizedPath = folderPath
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
    .join("/");
  return stableUuid(`bookmark-item:${resourceKey}|${normalizedPath}`);
}

async function readSyncedState(): Promise<SyncedState> {
  const stored = (await chrome.storage.local.get(CLOUD_STATE_KEY))[CLOUD_STATE_KEY];
  return stored && typeof stored === "object" ? (stored as SyncedState) : {};
}

async function readProtectionBindings(): Promise<ProtectionBinding[]> {
  const stored = (await chrome.storage.local.get(CLOUD_PROTECTION_BINDINGS_KEY))[
    CLOUD_PROTECTION_BINDINGS_KEY
  ];
  return Array.isArray(stored) ? (stored as ProtectionBinding[]) : [];
}

/**
 * 一次性迁移：把旧标识体系下的收藏位置从云端清掉。
 *
 * 旧标识由 Chrome 本地书签 ID 派生，同一条书签在每台设备上都不同。
 * 留在云端会与新标识并存成重复记录，因此在首次按新规则同步之前，
 * 先把本机记得的旧绑定全部推送删除，并清空本地绑定缓存让它按新规则重建。
 */
async function drainLegacyBookmarkBindings(): Promise<BookmarkItemBinding[]> {
  const stored = await chrome.storage.local.get([
    BOOKMARK_ITEM_ID_MIGRATION_KEY,
    CLOUD_BOOKMARK_BINDINGS_KEY
  ]);
  if (stored[BOOKMARK_ITEM_ID_MIGRATION_KEY]) return [];
  const legacy = Array.isArray(stored[CLOUD_BOOKMARK_BINDINGS_KEY])
    ? (stored[CLOUD_BOOKMARK_BINDINGS_KEY] as BookmarkItemBinding[])
    : [];
  await chrome.storage.local.set({
    [BOOKMARK_ITEM_ID_MIGRATION_KEY]: true,
    [CLOUD_BOOKMARK_BINDINGS_KEY]: []
  });
  return legacy;
}

async function readBookmarkBindings(): Promise<BookmarkItemBinding[]> {
  const stored = (await chrome.storage.local.get(CLOUD_BOOKMARK_BINDINGS_KEY))[
    CLOUD_BOOKMARK_BINDINGS_KEY
  ];
  return Array.isArray(stored) ? (stored as BookmarkItemBinding[]) : [];
}

async function putEntity(
  state: SyncedState,
  input: EntityMutationInput
): Promise<boolean> {
  const prepared = await prepareEntity(state, input);
  if (!prepared) return false;
  const result = await cloudRequest<{ revision: number }>("/v1/sync/entities", {
    method: "PUT",
    body: JSON.stringify(prepared.mutation)
  });
  state[prepared.stateKey] = { hash: prepared.hash, revision: result.revision };
  return true;
}

async function prepareEntity(
  state: SyncedState,
  input: EntityMutationInput
): Promise<PreparedEntityMutation | null> {
  const stateKey = `${input.entityType}:${input.entityId}`;
  const hash = await digest({ payload: input.payload, deleted: Boolean(input.deleted) });
  if (state[stateKey]?.hash === hash) return null;
  return {
    stateKey,
    hash,
    mutation: {
      operationId: crypto.randomUUID(),
      ...input,
      deleted: Boolean(input.deleted)
    }
  };
}

async function flushEntityBatch(
  state: SyncedState,
  pending: PreparedEntityMutation[],
  onProgress?: (processed: number, total: number) => void | Promise<void>
): Promise<number> {
  await onProgress?.(0, pending.length);
  let processed = 0;
  for (let offset = 0; offset < pending.length; offset += 100) {
    const batch = pending.slice(offset, offset + 100);
    let results: Array<{ revision: number }>;
    try {
      const response = await cloudRequest<{ results: Array<{ revision: number }> }>(
        "/v1/sync/entities/batch",
        { method: "PUT", body: JSON.stringify({ mutations: batch.map((item) => item.mutation) }) }
      );
      results = response.results;
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status !== 404 && status !== 405) throw error;
      // 滚动发布兼容：旧服务端尚无 batch 路由时，使用同一 operationId
      // 受控并发写入，避免退回数百条完全串行请求。
      results = [];
      for (let fallbackOffset = 0; fallbackOffset < batch.length; fallbackOffset += 12) {
        results.push(...await Promise.all(
          batch.slice(fallbackOffset, fallbackOffset + 12).map((item) =>
            cloudRequest<{ revision: number }>("/v1/sync/entities", {
              method: "PUT",
              body: JSON.stringify(item.mutation)
            })
          )
        ));
        await onProgress?.(
          processed + Math.min(fallbackOffset + 12, batch.length),
          pending.length
        );
      }
    }
    if (results.length !== batch.length) {
      throw new Error("云端批量同步返回数量不一致。");
    }
    batch.forEach((item, index) => {
      state[item.stateKey] = { hash: item.hash, revision: results[index].revision };
    });
    processed += batch.length;
    await onProgress?.(processed, pending.length);
  }
  return processed;
}

function stableConversation(conversation: AgentConversation): AgentConversation {
  return {
    id: conversation.id,
    title: (conversation.title || "收藏对话").slice(0, 80),
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    messages: conversation.messages
      .filter((message) => message.status !== "sending")
      .slice(-60)
      .map((message) => ({
        id: message.id.slice(0, 160),
        role: message.role,
        content: message.content.slice(0, 12_000),
        createdAt: message.createdAt,
        ...(message.providerName ? { providerName: message.providerName.slice(0, 240) } : {}),
        ...(message.sources
          ? {
              sources: message.sources
                .filter((source) =>
                  /^[a-f0-9]{64}$/.test(source.resourceKey) &&
                  isSupportedPageUrl(source.url) &&
                  source.url.length <= 8_192
                )
                .slice(0, 20)
                .map((source) => ({
                  resourceKey: source.resourceKey,
                  title: source.title.slice(0, 1_000),
                  url: source.url,
                  siteName: source.siteName.slice(0, 512),
                  // Icon bytes are restored through COS assets, never conversation JSON.
                  faviconUrl: ""
                }))
            }
          : {}),
        ...(message.actions
          ? {
              actions: message.actions.slice(0, 40).map((action): BookmarkAgentActionProposal => ({
                id: action.id.slice(0, 160),
                type: action.type,
                label: action.label.slice(0, 500),
                description: action.description.slice(0, 2_000),
                destructive: action.destructive,
                status: action.status,
                ...(action.resourceKey ? { resourceKey: action.resourceKey } : {}),
                ...(action.resultMessage ? { resultMessage: action.resultMessage.slice(0, 2_000) } : {})
              }))
            }
          : {}),
        ...(message.status && message.status !== "sending" ? { status: message.status } : {})
      }))
  };
}

function sanitizeReport(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeReport);
  if (!value || typeof value !== "object") return value;
  const forbidden = /(?:targetId|parentId|destinationId|createdNodeId|nativeBookmarkIds|nativeFolderId|progress)/i;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !forbidden.test(key))
      .map(([key, child]) => [key, sanitizeReport(child)])
  );
}

function folderHints(tree: chrome.bookmarks.BookmarkTreeNode[]): Map<string, { title: string; path: string[]; parentPath: string[] }> {
  const result = new Map<string, { title: string; path: string[]; parentPath: string[] }>();
  const visit = (node: chrome.bookmarks.BookmarkTreeNode, path: string[]) => {
    if (node.url) return;
    const nextPath = node.title ? [...path, node.title] : path;
    result.set(node.id, { title: node.title, path: nextPath, parentPath: path });
    for (const child of node.children || []) visit(child, nextPath);
  };
  for (const root of tree) visit(root, []);
  return result;
}

function nativeBookmarkHints(tree: chrome.bookmarks.BookmarkTreeNode[]): NativeBookmarkHint[] {
  const result: NativeBookmarkHint[] = [];
  const visit = (node: chrome.bookmarks.BookmarkTreeNode, folderPath: string[]) => {
    if (node.url) {
      result.push({
        id: node.id,
        title: node.title || node.url,
        url: node.url,
        folderPath,
        dateAdded: node.dateAdded
      });
      return;
    }
    const nextPath = node.title ? [...folderPath, node.title] : folderPath;
    for (const child of node.children || []) visit(child, nextPath);
  };
  for (const root of tree) visit(root, []);
  return result;
}

async function currentBookmarkBindings(
  tree: chrome.bookmarks.BookmarkTreeNode[],
  resources: Awaited<ReturnType<typeof getLocalResources>>,
  protectedResourceKeys: ReadonlySet<string>
): Promise<{ current: BookmarkItemBinding[]; deleted: BookmarkItemBinding[] }> {
  const previous = await readBookmarkBindings();
  const previousById = new Map(previous.map((binding) => [binding.bookmarkItemId, binding]));
  const usedBookmarkItemIds = new Set<string>();
  const resourceByNativeId = new Map<string, (typeof resources)[number]>();
  const resourceByKey = new Map(resources.map((resource) => [resource.resourceKey, resource]));
  for (const resource of resources) {
    for (const nativeId of resource.nativeBookmarkIds) resourceByNativeId.set(nativeId, resource);
  }
  const now = new Date().toISOString();
  const current: BookmarkItemBinding[] = [];
  for (const hint of nativeBookmarkHints(tree)) {
    if (!isSupportedPageUrl(hint.url)) continue;
    const localResource = resourceByNativeId.get(hint.id);
    const resourceKey = localResource?.resourceKey || await resourceKeyForUrl(hint.url);
    if (protectedResourceKeys.has(resourceKey)) continue;
    const folderPath = hint.folderPath.slice(-32);
    const bookmarkItemId = await bookmarkItemIdFor(resourceKey, folderPath);
    // 同一文件夹里的重复网址在云端是同一条收藏位置，只登记一次。
    if (usedBookmarkItemIds.has(bookmarkItemId)) continue;
    const resource = localResource || resourceByKey.get(resourceKey);
    const existing = previousById.get(bookmarkItemId);
    const payload: BookmarkItemPayload = {
      bookmarkItemId,
      resourceKey,
      userNote: resource?.userNote || existing?.payload.userNote || "",
      tags: resource?.tags || existing?.payload.tags || [],
      bindingHint: {
        title: hint.title.slice(0, 1_000),
        url: hint.url,
        folderPath
      },
      createdAt:
        existing?.payload.createdAt ||
        (hint.dateAdded ? new Date(hint.dateAdded).toISOString() : now),
      updatedAt: resource?.updatedAt || existing?.payload.updatedAt || now
    };
    usedBookmarkItemIds.add(bookmarkItemId);
    current.push({ bookmarkItemId, nativeBookmarkId: hint.id, payload });
  }
  // 云端存在但本机 Chrome 树里没有的收藏位置分两种：本机删除过的
  // （曾绑定过本地书签）要推送删除；其他设备刚新增、Chrome Sync 还
  // 没送达本机的要原样保留，否则会把对方的记录删掉。
  for (const binding of previous) {
    if (usedBookmarkItemIds.has(binding.bookmarkItemId)) continue;
    if (protectedResourceKeys.has(binding.payload.resourceKey)) continue;
    if (binding.nativeBookmarkId) continue;
    usedBookmarkItemIds.add(binding.bookmarkItemId);
    current.push(binding);
  }
  const currentIds = new Set(current.map((binding) => binding.bookmarkItemId));
  return {
    current,
    deleted: previous.filter(
      (binding) =>
        !currentIds.has(binding.bookmarkItemId) &&
        (Boolean(binding.nativeBookmarkId) ||
          protectedResourceKeys.has(binding.payload.resourceKey))
    )
  };
}

function folderResourceKeys(
  tree: chrome.bookmarks.BookmarkTreeNode[],
  folderBindings: ProtectionBinding[],
  resources: Awaited<ReturnType<typeof getLocalResources>>
): Map<string, string[]> {
  const folderRuleByNativeId = new Map(
    folderBindings
      .filter((binding) => binding.nativeFolderId)
      .map((binding) => [binding.nativeFolderId!, binding.ruleId])
  );
  const resourceByBookmarkId = new Map<string, string>();
  for (const resource of resources) {
    for (const bookmarkId of resource.nativeBookmarkIds) {
      resourceByBookmarkId.set(bookmarkId, resource.resourceKey);
    }
  }
  const keysByRule = new Map(
    folderBindings.map((binding) => [binding.ruleId, new Set<string>()])
  );
  const visit = (
    node: chrome.bookmarks.BookmarkTreeNode,
    inheritedRules: ReadonlySet<string>
  ) => {
    const activeRules = new Set(inheritedRules);
    const folderRule = folderRuleByNativeId.get(node.id);
    if (folderRule) activeRules.add(folderRule);
    if (node.url) {
      const resourceKey = resourceByBookmarkId.get(node.id);
      if (resourceKey) {
        for (const ruleId of activeRules) keysByRule.get(ruleId)?.add(resourceKey);
      }
      return;
    }
    for (const child of node.children || []) visit(child, activeRules);
  };
  for (const root of tree) visit(root, new Set());
  return new Map(
    [...keysByRule].map(([ruleId, keys]) => [ruleId, [...keys].sort()])
  );
}

async function currentProtectionBindings(
  settings: ProtectionSettings,
  tree: chrome.bookmarks.BookmarkTreeNode[],
  resources: Awaited<ReturnType<typeof getLocalResources>>
): Promise<ProtectionBinding[]> {
  const existing = await readProtectionBindings();
  const byResource = new Map(existing.filter((item) => item.kind === "resource").map((item) => [item.resourceKey, item]));
  const byFolder = new Map(existing.filter((item) => item.kind === "folder").map((item) => [item.nativeFolderId, item]));
  const hints = folderHints(tree);
  const now = new Date().toISOString();
  const result: ProtectionBinding[] = [];
  for (const resourceKey of settings.resourceKeys) {
    const existingBinding = byResource.get(resourceKey);
    result.push(
      existingBinding
        ? { ...existingBinding, updatedAt: existingBinding.updatedAt || existingBinding.createdAt }
        : {
            ruleId: await stableUuid(`protected-resource:${resourceKey}`),
            kind: "resource",
            resourceKey,
            createdAt: now,
            updatedAt: now
          }
    );
  }
  const folderBindings: ProtectionBinding[] = [];
  for (const nativeFolderId of settings.folderIds) {
    const hint = hints.get(nativeFolderId);
    if (!hint) continue;
    const existingBinding = byFolder.get(nativeFolderId);
    const hintChanged = Boolean(
      existingBinding && (
        existingBinding.title !== hint.title ||
        (existingBinding.path || []).join("\n") !== hint.path.join("\n") ||
        (existingBinding.parentPath || []).join("\n") !== hint.parentPath.join("\n")
      )
    );
    folderBindings.push(
      existingBinding
        ? {
            ...existingBinding,
            path: hint.path,
            parentPath: hint.parentPath,
            title: hint.title,
            updatedAt: hintChanged ? now : existingBinding.updatedAt || existingBinding.createdAt
          }
        : {
            ruleId: await stableUuid(`protected-folder:${hint.path.join("\n")}`),
            kind: "folder",
            nativeFolderId,
            path: hint.path,
            parentPath: hint.parentPath,
            title: hint.title,
            createdAt: now,
            updatedAt: now
          }
    );
  }
  const keysByRule = folderResourceKeys(tree, folderBindings, resources);
  for (const binding of folderBindings) {
    const resourceKeys = keysByRule.get(binding.ruleId) || [];
    const resourceKeysChanged =
      (binding.resourceKeys || []).join("\n") !== resourceKeys.join("\n");
    result.push({
      ...binding,
      resourceKeys,
      updatedAt: resourceKeysChanged ? now : binding.updatedAt
    });
  }
  return result;
}

export async function syncDurableCloudState(
  onProgress?: (processed: number, total: number) => void | Promise<void>
): Promise<{ synced: number; total: number }> {
  const cloudSettings = await getCloudSyncSettings();
  const state = await readSyncedState();
  const pending: PreparedEntityMutation[] = [];
  const queueEntity = async (input: EntityMutationInput) => {
    const prepared = await prepareEntity(state, input);
    if (prepared) pending.push(prepared);
  };
  const now = new Date().toISOString();
  const [display, ai, usage, conversations, protection, organization, theme, undoSnapshots, bookmarkTree, resources] = await Promise.all([
    getDisplaySettings(),
    getAiSettingsStatus(),
    getAiUsageStats(),
    getAgentConversations(),
    getProtectionSettings(),
    chrome.storage.local.get(ORGANIZATION_INSIGHTS_KEY),
    getSyncedThemeMode(),
    getUndoSnapshots(),
    chrome.bookmarks.getTree(),
    getLocalResources()
  ]);
  await queueEntity({
    entityType: "setting-display",
    entityId: "display",
    updatedAt: now,
    payload: cloudDisplaySettingsPayload(display)
  });
  if (theme) await queueEntity({
    entityType: "setting-theme",
    entityId: "theme",
    updatedAt: now,
    payload: { mode: theme }
  });
  await queueEntity({
    entityType: "setting-ai-models",
    entityId: "ai-models",
    updatedAt: now,
    payload: { provider: ai.provider, models: ai.providerModels }
  });
  await queueEntity({
    entityType: "setting-cloud-scope",
    entityId: "cloud-scope",
    updatedAt: cloudSettings.updatedAt || now,
    payload: cloudSettings
  });
  const period = now.slice(0, 7);
  await queueEntity({
    entityType: "usage-period",
    entityId: `${period}:${ai.provider}:${ai.model}`,
    updatedAt: usage.updatedAt || now,
    payload: usagePeriodCloudPayload({
      period,
      provider: ai.provider,
      model: ai.model,
      usage
    })
  });
  for (const conversation of conversations) {
    if (!/^[0-9a-f-]{36}$/i.test(conversation.id)) continue;
    if (!conversationHasCompletedAnswer(conversation)) continue;
    await queueEntity({
      entityType: "conversation",
      entityId: conversation.id,
      updatedAt: conversation.updatedAt,
      payload: stableConversation(conversation)
    });
  }
  for (const snapshot of undoSnapshots) {
    if (!/^[0-9a-f-]{36}$/i.test(snapshot.batchId)) continue;
    const resourceKeys = [...new Set(
      snapshot.mutations
        .map((mutation) => "resourceKey" in mutation ? mutation.resourceKey : undefined)
        .filter((value): value is string => Boolean(value && /^[a-f0-9]{64}$/.test(value)))
    )];
    await queueEntity({
      entityType: "operation-history",
      entityId: snapshot.batchId,
      updatedAt: snapshot.createdAt,
      payload: {
        operationId: snapshot.batchId,
        kind: snapshot.source,
        label: snapshot.label,
        result: snapshot.status,
        resourceKeys,
        createdAt: snapshot.createdAt,
        expiresAt: snapshot.expiresAt
      }
    });
  }
  const protectionPolicy = buildProtectionPolicy(bookmarkTree, protection);
  const protectedResourceKeys = new Set(
    resources
      .filter((resource) => isResourceUserProtected(resource, protectionPolicy))
      .map((resource) => resource.resourceKey)
  );
  const previousBindings = await readProtectionBindings();
  const bindings = await currentProtectionBindings(
    protection,
    bookmarkTree,
    resources
  );
  const currentRuleIds = new Set(bindings.map((item) => item.ruleId));
  for (const binding of [...bindings, ...previousBindings.filter((item) => !currentRuleIds.has(item.ruleId))]) {
    const deleted = !currentRuleIds.has(binding.ruleId);
    const ruleUpdatedAt = deleted ? now : binding.updatedAt || binding.createdAt;
    const payload = binding.kind === "resource"
      ? {
          ruleId: binding.ruleId,
          kind: "resource",
          resourceKey: binding.resourceKey,
          updatedAt: ruleUpdatedAt,
          deleted
        }
      : {
          ruleId: binding.ruleId,
          kind: "folder",
          path: binding.path || [],
          parentPath: binding.parentPath || [],
          title: binding.title || "受保护文件夹",
          resourceKeys: binding.resourceKeys || [],
          createdAt: binding.createdAt,
          updatedAt: ruleUpdatedAt,
          deleted
        };
    await queueEntity({
      entityType: "protection-rule",
      entityId: binding.ruleId,
      updatedAt: ruleUpdatedAt,
      payload,
      deleted
    });
  }

  for (const legacy of await drainLegacyBookmarkBindings()) {
    await queueEntity({
      entityType: "bookmark-item",
      entityId: legacy.bookmarkItemId,
      updatedAt: now,
      payload: legacy.payload,
      deleted: true
    });
  }
  const bookmarkBindings = await currentBookmarkBindings(
    bookmarkTree,
    resources,
    protectedResourceKeys
  );
  for (const binding of [...bookmarkBindings.current, ...bookmarkBindings.deleted]) {
    const deleted = bookmarkBindings.deleted.includes(binding);
    await queueEntity({
      entityType: "bookmark-item",
      entityId: binding.bookmarkItemId,
      updatedAt: deleted ? now : binding.payload.updatedAt,
      payload: binding.payload,
      deleted
    });
  }
  const report = organization[ORGANIZATION_INSIGHTS_KEY];
  if (report && typeof report === "object") {
    const reportId = await stableUuid("organization-insights");
    const generatedAt = (report as { insights?: { organizationPlan?: { generatedAt?: string } } })
      .insights?.organizationPlan?.generatedAt || now;
    await queueEntity({
      entityType: "report",
      entityId: reportId,
      updatedAt: generatedAt,
      payload: {
        reportId,
        kind: "organization-insights",
        title: "收藏库整理洞察",
        generatedAt,
        data: sanitizeReport(report)
      }
    });
  }
  const synced = await flushEntityBatch(state, pending, onProgress);
  await chrome.storage.local.set({
    [CLOUD_STATE_KEY]: state,
    [CLOUD_PROTECTION_BINDINGS_KEY]: bindings,
    [CLOUD_BOOKMARK_BINDINGS_KEY]: bookmarkBindings.current
  });
  return { synced, total: pending.length };
}

export async function syncCloudScopeSetting(
  settings: CloudSyncSettings
): Promise<void> {
  const state = await readSyncedState();
  await putEntity(state, {
    entityType: "setting-cloud-scope",
    entityId: "cloud-scope",
    updatedAt: settings.updatedAt || new Date().toISOString(),
    payload: settings
  });
  await chrome.storage.local.set({ [CLOUD_STATE_KEY]: state });
}

function matchingFolderIds(
  tree: chrome.bookmarks.BookmarkTreeNode[],
  path: string[],
  title: string
): string[] {
  const hints = folderHints(tree);
  return [...hints.entries()]
    .filter(([, hint]) => hint.title === title && hint.path.join("\n") === path.join("\n"))
    .map(([id]) => id);
}

export async function restoreDurableCloudState(
  options: { skipCloudScope?: boolean } = {}
): Promise<{ restored: number }> {
  const response = await cloudRequest<{ entities: CloudEntity[] }>("/v1/sync/entities");
  let restored = 0;
  const tree = await chrome.bookmarks.getTree();
  const localProtection = await getProtectionSettings();
  const resourceKeys = new Set(localProtection.resourceKeys);
  const folderIds = new Set(localProtection.folderIds);
  const bindings: ProtectionBinding[] = [];
  const bookmarkBindings: BookmarkItemBinding[] = [];
  const restoredOperationHistory: unknown[] = [];

  // 本机书签按与上传完全相同的确定性规则算出收藏位置 ID，云端记录
  // 直接按 ID 对齐，不再依赖标题/路径的模糊匹配和候选认领。
  const hintByItemId = new Map<string, NativeBookmarkHint>();
  for (const hint of nativeBookmarkHints(tree)) {
    if (!isSupportedPageUrl(hint.url)) continue;
    const itemId = await bookmarkItemIdFor(
      await resourceKeyForUrl(hint.url),
      hint.folderPath.slice(-32)
    );
    if (!hintByItemId.has(itemId)) hintByItemId.set(itemId, hint);
  }
  const seenRestoredItemIds = new Set<string>();
  for (const entity of response.entities) {
    if (entity.deleted || entity.entityType !== "bookmark-item" || !entity.payload) continue;
    const payload = entity.payload as BookmarkItemPayload;
    if (seenRestoredItemIds.has(payload.bookmarkItemId)) continue;
    seenRestoredItemIds.add(payload.bookmarkItemId);
    const matched = hintByItemId.get(payload.bookmarkItemId);
    bookmarkBindings.push({
      bookmarkItemId: payload.bookmarkItemId,
      ...(matched ? { nativeBookmarkId: matched.id } : {}),
      payload
    });
  }

  for (const entity of response.entities) {
    if (entity.deleted || !entity.payload) continue;
    if (entity.entityType === "protection-rule") {
      const rule = entity.payload as {
        ruleId: string;
        kind: "resource" | "folder";
        resourceKey?: string;
        path?: string[];
        parentPath?: string[];
        title?: string;
        resourceKeys?: string[];
        createdAt?: string;
        updatedAt?: string;
      };
      if (rule.kind === "resource" && rule.resourceKey) {
        resourceKeys.add(rule.resourceKey);
        bindings.push({
          ruleId: rule.ruleId,
          kind: "resource",
          resourceKey: rule.resourceKey,
          createdAt: rule.createdAt || rule.updatedAt || new Date().toISOString(),
          updatedAt: rule.updatedAt
        });
      } else if (rule.kind === "folder" && rule.path && rule.title) {
        const candidates = matchingFolderIds(tree, rule.path, rule.title);
        for (const id of candidates) folderIds.add(id);
        bindings.push({
          ruleId: rule.ruleId,
          kind: "folder",
          ...(candidates.length === 1 ? { nativeFolderId: candidates[0] } : {}),
          path: rule.path,
          parentPath: rule.parentPath || rule.path.slice(0, -1),
          title: rule.title,
          resourceKeys: rule.resourceKeys || [],
          createdAt: rule.createdAt || new Date().toISOString(),
          updatedAt: rule.updatedAt
        });
      }
    }
  }
  await saveProtectionSettings({ resourceKeys: [...resourceKeys], folderIds: [...folderIds] });
  await chrome.storage.local.set({ [CLOUD_PROTECTION_BINDINGS_KEY]: bindings });
  await chrome.storage.local.set({ [CLOUD_BOOKMARK_BINDINGS_KEY]: bookmarkBindings });

  for (const entity of response.entities) {
    if (entity.deleted || !entity.payload || entity.entityType === "protection-rule") continue;
    if (entity.entityType === "setting-display") {
      await saveDisplaySettings(entity.payload as Parameters<typeof saveDisplaySettings>[0]);
      restored += 1;
    } else if (entity.entityType === "setting-ai-models") {
      await saveAiModelPreferences(entity.payload as Parameters<typeof saveAiModelPreferences>[0]);
      restored += 1;
    } else if (
      entity.entityType === "setting-cloud-scope" &&
      !options.skipCloudScope
    ) {
      // 产品只保留完整备份：恢复云端设置时只恢复开关，范围恒为 complete。
      await saveCloudSyncSettings({ enabled: true });
      restored += 1;
    } else if (entity.entityType === "setting-theme") {
      const setting = entity.payload as { mode?: "light" | "dark" };
      if (setting.mode) {
        await saveSyncedThemeMode(setting.mode);
        restored += 1;
      }
    } else if (entity.entityType === "conversation") {
      if (await saveIncomingAgentConversation(entity.payload as AgentConversation)) {
        restored += 1;
      }
    } else if (entity.entityType === "usage-period") {
      await mergeAiUsageStats(entity.payload as Parameters<typeof mergeAiUsageStats>[0]);
      restored += 1;
    } else if (entity.entityType === "report") {
      const report = entity.payload as { kind?: string; data?: unknown };
      if (report.kind === "organization-insights" && report.data) {
        await chrome.storage.local.set({ [ORGANIZATION_INSIGHTS_KEY]: report.data });
        restored += 1;
      }
    } else if (entity.entityType === "operation-history") {
      restoredOperationHistory.push(entity.payload);
      restored += 1;
    }
  }
  if (restoredOperationHistory.length) {
    await chrome.storage.local.set({
      [CLOUD_OPERATION_HISTORY_KEY]: restoredOperationHistory
    });
  }
  return { restored };
}

import { cloudRequest } from "./auth";
import {
  getCloudSyncSettings,
  saveCloudSyncSettings,
  type CloudSyncSettings
} from "./cloud-settings";
import { getAgentConversations, saveAgentConversation } from "./conversations";
import { getDisplaySettings, saveDisplaySettings } from "./display-settings";
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
import { canonicalizeUrl, isSupportedPageUrl, resourceKeyForUrl } from "./url";
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

async function readBookmarkBindings(): Promise<BookmarkItemBinding[]> {
  const stored = (await chrome.storage.local.get(CLOUD_BOOKMARK_BINDINGS_KEY))[
    CLOUD_BOOKMARK_BINDINGS_KEY
  ];
  return Array.isArray(stored) ? (stored as BookmarkItemBinding[]) : [];
}

async function putEntity(
  state: SyncedState,
  input: {
    entityType: string;
    entityId: string;
    updatedAt: string;
    payload: unknown;
    deleted?: boolean;
  }
): Promise<boolean> {
  const stateKey = `${input.entityType}:${input.entityId}`;
  const nextHash = await digest({ payload: input.payload, deleted: Boolean(input.deleted) });
  if (state[stateKey]?.hash === nextHash) return false;
  const result = await cloudRequest<{ revision: number }>("/v1/sync/entities", {
    method: "PUT",
    body: JSON.stringify({
      operationId: crypto.randomUUID(),
      ...input,
      deleted: Boolean(input.deleted)
    })
  });
  state[stateKey] = { hash: nextHash, revision: result.revision };
  return true;
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

function bookmarkHintMatches(binding: BookmarkItemBinding, hint: NativeBookmarkHint): boolean {
  try {
    return canonicalizeUrl(binding.payload.bindingHint.url) === canonicalizeUrl(hint.url) &&
      binding.payload.bindingHint.title === hint.title &&
      binding.payload.bindingHint.folderPath.join("\n") === hint.folderPath.join("\n");
  } catch {
    return false;
  }
}

async function currentBookmarkBindings(
  tree: chrome.bookmarks.BookmarkTreeNode[],
  resources: Awaited<ReturnType<typeof getLocalResources>>,
  protectedResourceKeys: ReadonlySet<string>
): Promise<{ current: BookmarkItemBinding[]; deleted: BookmarkItemBinding[] }> {
  const previous = await readBookmarkBindings();
  const byNativeId = new Map(
    previous.filter((binding) => binding.nativeBookmarkId)
      .map((binding) => [binding.nativeBookmarkId!, binding])
  );
  const unbound = previous.filter((binding) => !binding.nativeBookmarkId);
  const usedBookmarkItemIds = new Set<string>();
  const resourceByNativeId = new Map<string, (typeof resources)[number]>();
  const resourceByKey = new Map(resources.map((resource) => [resource.resourceKey, resource]));
  for (const resource of resources) {
    for (const nativeId of resource.nativeBookmarkIds) resourceByNativeId.set(nativeId, resource);
  }
  const now = new Date().toISOString();
  const current: BookmarkItemBinding[] = [];
  const deleted: BookmarkItemBinding[] = [];
  // 同一规范化网址只保留一条收藏位置，其余标记删除。
  // 换扩展 ID / 重装后本地绑定缓存清空曾导致同一网址反复生成新
  // bookmarkItemId 上传，云端积累大量重复；这里按网址去重并让
  // 多余记录随同步删除，之后不会继续增长。
  const seenHintUrls = new Set<string>();
  for (const hint of nativeBookmarkHints(tree)) {
    if (!isSupportedPageUrl(hint.url)) continue;
    const hintUrlKey = canonicalizeUrl(hint.url);
    if (seenHintUrls.has(hintUrlKey)) {
      const duplicate =
        byNativeId.get(hint.id) ||
        unbound.find(
          (binding) =>
            !usedBookmarkItemIds.has(binding.bookmarkItemId) &&
            bookmarkHintMatches(binding, hint)
        );
      if (duplicate) {
        deleted.push({
          bookmarkItemId: duplicate.bookmarkItemId,
          ...(hint.id ? { nativeBookmarkId: hint.id } : {}),
          payload: duplicate.payload
        });
      }
      continue;
    }
    seenHintUrls.add(hintUrlKey);
    const localResource = resourceByNativeId.get(hint.id);
    const resourceKey = localResource?.resourceKey || await resourceKeyForUrl(hint.url);
    if (protectedResourceKeys.has(resourceKey)) continue;
    const resource = localResource || resourceByKey.get(resourceKey);
    const exactUnbound = unbound.find(
      (binding) => !usedBookmarkItemIds.has(binding.bookmarkItemId) && bookmarkHintMatches(binding, hint)
    );
    const existing = byNativeId.get(hint.id) || exactUnbound;
    const createdAt = existing?.payload.createdAt ||
      (hint.dateAdded ? new Date(hint.dateAdded).toISOString() : now);
    // 收藏位置 ID 由 Chrome 书签 ID 确定性派生：同一书签在重装、
    // 换扩展 ID 后仍保持同一 ID，云端按 ID upsert 而不是新增。
    const payload: BookmarkItemPayload = {
      bookmarkItemId:
        existing?.bookmarkItemId ||
        (await stableUuid(`bookmark:${hint.id}`)),
      resourceKey,
      userNote: resource?.userNote || existing?.payload.userNote || "",
      tags: resource?.tags || existing?.payload.tags || [],
      bindingHint: {
        title: hint.title.slice(0, 1_000),
        url: hint.url,
        folderPath: hint.folderPath.slice(-32)
      },
      createdAt,
      updatedAt: resource?.updatedAt || existing?.payload.updatedAt || now
    };
    usedBookmarkItemIds.add(payload.bookmarkItemId);
    current.push({
      bookmarkItemId: payload.bookmarkItemId,
      nativeBookmarkId: hint.id,
      payload
    });
  }
  for (const binding of unbound) {
    if (
      !usedBookmarkItemIds.has(binding.bookmarkItemId) &&
      !protectedResourceKeys.has(binding.payload.resourceKey)
    ) {
      const unboundUrlKey = canonicalizeUrl(binding.payload.bindingHint.url);
      if (seenHintUrls.has(unboundUrlKey)) {
        deleted.push(binding);
        continue;
      }
      seenHintUrls.add(unboundUrlKey);
      current.push(binding);
    }
  }
  const currentIds = new Set(current.map((binding) => binding.bookmarkItemId));
  const deletedByUrl: BookmarkItemBinding[] = deleted;
  const deletedIds = new Set(deletedByUrl.map((binding) => binding.bookmarkItemId));
  return {
    current,
    deleted: [
      ...deletedByUrl,
      ...previous.filter(
        (binding) =>
          !currentIds.has(binding.bookmarkItemId) &&
          !deletedIds.has(binding.bookmarkItemId) &&
          (Boolean(binding.nativeBookmarkId) ||
            protectedResourceKeys.has(binding.payload.resourceKey))
      )
    ]
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

export async function syncDurableCloudState(): Promise<{ synced: number }> {
  const cloudSettings = await getCloudSyncSettings();
  if (!cloudSettings.enabled) return { synced: 0 };
  const state = await readSyncedState();
  let synced = 0;
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
  if (await putEntity(state, {
    entityType: "setting-display",
    entityId: "display",
    updatedAt: now,
    payload: display
  })) synced += 1;
  if (theme && await putEntity(state, {
    entityType: "setting-theme",
    entityId: "theme",
    updatedAt: now,
    payload: { mode: theme }
  })) synced += 1;
  if (await putEntity(state, {
    entityType: "setting-ai-models",
    entityId: "ai-models",
    updatedAt: now,
    payload: { provider: ai.provider, models: ai.providerModels }
  })) synced += 1;
  if (await putEntity(state, {
    entityType: "setting-cloud-scope",
    entityId: "cloud-scope",
    updatedAt: cloudSettings.updatedAt || now,
    payload: cloudSettings
  })) synced += 1;
  const period = now.slice(0, 7);
  if (await putEntity(state, {
    entityType: "usage-period",
    entityId: `${period}:${ai.provider}:${ai.model}`,
    updatedAt: usage.updatedAt || now,
    payload: usagePeriodCloudPayload({
      period,
      provider: ai.provider,
      model: ai.model,
      usage
    })
  })) synced += 1;
  for (const conversation of conversations) {
    if (!/^[0-9a-f-]{36}$/i.test(conversation.id)) continue;
    if (await putEntity(state, {
      entityType: "conversation",
      entityId: conversation.id,
      updatedAt: conversation.updatedAt,
      payload: stableConversation(conversation)
    })) synced += 1;
  }
  for (const snapshot of undoSnapshots) {
    if (!/^[0-9a-f-]{36}$/i.test(snapshot.batchId)) continue;
    const resourceKeys = [...new Set(
      snapshot.mutations
        .map((mutation) => "resourceKey" in mutation ? mutation.resourceKey : undefined)
        .filter((value): value is string => Boolean(value && /^[a-f0-9]{64}$/.test(value)))
    )];
    if (await putEntity(state, {
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
    })) synced += 1;
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
    if (await putEntity(state, {
      entityType: "protection-rule",
      entityId: binding.ruleId,
      updatedAt: ruleUpdatedAt,
      payload,
      deleted
    })) synced += 1;
  }

  const bookmarkBindings = await currentBookmarkBindings(
    bookmarkTree,
    resources,
    protectedResourceKeys
  );
  for (const binding of [...bookmarkBindings.current, ...bookmarkBindings.deleted]) {
    const deleted = bookmarkBindings.deleted.includes(binding);
    if (await putEntity(state, {
      entityType: "bookmark-item",
      entityId: binding.bookmarkItemId,
      updatedAt: deleted ? now : binding.payload.updatedAt,
      payload: binding.payload,
      deleted
    })) synced += 1;
  }
  const report = organization[ORGANIZATION_INSIGHTS_KEY];
  if (report && typeof report === "object") {
    const reportId = await stableUuid("organization-insights");
    const generatedAt = (report as { insights?: { organizationPlan?: { generatedAt?: string } } })
      .insights?.organizationPlan?.generatedAt || now;
    if (await putEntity(state, {
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
    })) synced += 1;
  }
  await chrome.storage.local.set({
    [CLOUD_STATE_KEY]: state,
    [CLOUD_PROTECTION_BINDINGS_KEY]: bindings,
    [CLOUD_BOOKMARK_BINDINGS_KEY]: bookmarkBindings.current
  });
  return { synced };
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

  const bookmarkHints = nativeBookmarkHints(tree).filter((hint) => isSupportedPageUrl(hint.url));
  const claimedNativeIds = new Set<string>();
  // 云端同 URL 多条收藏位置时只恢复一条，避免重复灌回本地。
  const seenRestoredUrls = new Set<string>();
  for (const entity of response.entities) {
    if (entity.deleted || entity.entityType !== "bookmark-item" || !entity.payload) continue;
    const payload = entity.payload as BookmarkItemPayload;
    const payloadUrlKey = canonicalizeUrl(payload.bindingHint.url);
    if (seenRestoredUrls.has(payloadUrlKey)) continue;
    seenRestoredUrls.add(payloadUrlKey);
    const exactCandidates = bookmarkHints.filter(
      (hint) => !claimedNativeIds.has(hint.id) && bookmarkHintMatches({
        bookmarkItemId: payload.bookmarkItemId,
        payload
      }, hint)
    );
    let matched = exactCandidates.length === 1 ? exactCandidates[0] : undefined;
    if (!matched) {
      const urlCandidates = bookmarkHints.filter((hint) => {
        if (claimedNativeIds.has(hint.id)) return false;
        try {
          return canonicalizeUrl(hint.url) === canonicalizeUrl(payload.bindingHint.url);
        } catch {
          return false;
        }
      });
      if (urlCandidates.length === 1) matched = urlCandidates[0];
    }
    if (matched) claimedNativeIds.add(matched.id);
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
      await saveAgentConversation(entity.payload as AgentConversation);
      restored += 1;
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

import { needsAiEnrichment } from "../../lib/ai-fields";
import { getAiRuntimeSettings } from "../../lib/settings";
import { getLocalResource } from "../../lib/storage";
import { canonicalizeUrl, hashText, resourceKeyForUrl } from "../../lib/url";
import type { BookmarkAiPreview, BookmarkSaveState, PrepareBookmarkAiInput, ResourceRecord } from "../../lib/types";

// Only saved resources are held here. A cancelled preview never creates a
// resource or durable job. Durable enhancement jobs remain the restart fallback.
const savingAi = new Map<string, number>();
export const isSaveAiPending = (key: string) => savingAi.has(key);
export function holdSaveAi(key: string) {
  savingAi.set(key, (savingAi.get(key) || 0) + 1);
  return () => {
    const count = (savingAi.get(key) || 1) - 1;
    if (count) savingAi.set(key, count); else savingAi.delete(key);
  };
}

type PreparedAiFields = Pick<ResourceRecord, "summary" | "tags" | "topics" | "aliases" | "useCases" | "contentType" | "questions" | "entities" | "aiSchemaVersion">;
function preparedFields(resource: PreparedAiFields): PreparedAiFields {
  return { summary: resource.summary, tags: resource.tags, topics: resource.topics,
    aliases: resource.aliases, useCases: resource.useCases, contentType: resource.contentType,
    questions: resource.questions, entities: resource.entities, aiSchemaVersion: resource.aiSchemaVersion };
}
export function applyPreparedAi(resource: ResourceRecord, prepared: PreparedAiFields): ResourceRecord {
  return {
    ...resource,
    tagsSource: resource.tagsSource === "user" ? "user" : "ai",
    ...preparedFields(prepared),
    // A late automatic result must keep user-authored tags.
    tags: resource.tagsSource === "user" ? resource.tags : prepared.tags,
    aiStatus: "ready",
    updatedAt: new Date().toISOString(),
  };
}

interface Dependencies {
  getBookmarkSaveState(url: string): Promise<BookmarkSaveState>;
  getPrivacyProtectionContext(): Promise<unknown>;
  resourceProtectionState(resource: Pick<ResourceRecord, "resourceKey" | "nativeBookmarkIds" | "url">, context: unknown): { protected: boolean; userProtected?: boolean };
  resourceMatchesLoadedUrl(resource: ResourceRecord, url: string): boolean;
}
export interface PreparedSaveAi {
  fingerprint: string;
  resourceKey: string;
  createdAt: number;
  result?: BookmarkAiPreview;
  resource?: PreparedAiFields;
  cacheKey?: string;
  done: Promise<BookmarkAiPreview>;
}
const TTL = 15 * 60_000;
const SESSION_KEY = "aarre:save-ai-previews:v1";
type StoredPreparation = Omit<PreparedSaveAi, "done">;
async function fingerprint(input: Omit<PrepareBookmarkAiInput, "requestId">) {
  const page = input.capture;
  return hashText(JSON.stringify([input.sourceTabId, page.url, page.canonicalUrl, page.title, page.content, page.excerpt, page.selectedText, page.headings]));
}

export function createSaveAiPreparation(deps: Dependencies) {
  const requests = new Map<string, Promise<PreparedSaveAi>>();
  const entries = new Map<string, PreparedSaveAi>();
  let persistence = Promise.resolve();
  async function storedPreviews(): Promise<Record<string, StoredPreparation>> {
    const stored = (await chrome.storage.session.get(SESSION_KEY))[SESSION_KEY];
    if (!stored || typeof stored !== "object") return {};
    return Object.fromEntries(Object.entries(stored as Record<string, StoredPreparation>)
      .filter(([, value]) => value?.result && typeof value.fingerprint === "string" && Date.now() - value.createdAt < TTL));
  }
  function persist(requestId: string, entry: PreparedSaveAi) {
    persistence = persistence.catch(() => undefined).then(async () => {
      const current = await storedPreviews();
      current[requestId] = { fingerprint: entry.fingerprint, resourceKey: entry.resourceKey, cacheKey: entry.cacheKey,
        createdAt: entry.createdAt, result: entry.result, ...(entry.resource ? { resource: preparedFields(entry.resource) } : {}) };
      const bounded = Object.fromEntries(Object.entries(current).sort((a, b) => b[1].createdAt - a[1].createdAt).slice(0, 32));
      await chrome.storage.session.set({ [SESSION_KEY]: bounded });
    });
    return persistence;
  }

  async function create(input: PrepareBookmarkAiInput): Promise<PreparedSaveAi> {
    const page = input.capture;
    const [identity, resourceKey, runtime] = await Promise.all([
      fingerprint(input), resourceKeyForUrl(canonicalizeUrl(page.url, page.canonicalUrl)), getAiRuntimeSettings(),
    ]);
    const cacheKey = await hashText(JSON.stringify([identity, runtime.provider, runtime.model, runtime.apiKey]));
    for (const [key, item] of entries) if (item.result && Date.now() - item.createdAt > TTL) entries.delete(key);
    // Recheck privacy even when reusing a finished result.
    const [existing, state, context, tab] = await Promise.all([
      getLocalResource(resourceKey), deps.getBookmarkSaveState(page.url), deps.getPrivacyProtectionContext(),
      typeof input.sourceTabId === "number" ? chrome.tabs.get(input.sourceTabId).catch(() => null) : null,
    ]);
    const policy = deps.resourceProtectionState({ resourceKey, url: page.url, nativeBookmarkIds: [...new Set([...(existing?.nativeBookmarkIds || []), ...state.matches.map(item => item.id)])] }, context);
    const timestamp = new Date().toISOString();
    const activeExisting = existing?.nativeBookmarkIds.length && !existing.deletedAt ? existing : undefined;
    const resource: ResourceRecord = {
      resourceKey, canonicalUrl: canonicalizeUrl(page.url, page.canonicalUrl), url: page.url, title: page.title,
      userNote: activeExisting?.userNote || "", summary: "", tags: activeExisting?.tags || [], tagsSource: activeExisting?.tagsSource, topics: [],
      contentExcerpt: page.excerpt, contentHash: await hashText(page.content), selectedText: page.selectedText,
      author: page.author, siteName: page.siteName, language: page.language, imageUrl: page.imageUrl, faviconUrl: page.faviconUrl,
      nativeBookmarkIds: [], nativeFolderPath: [], aiStatus: "pending", syncStatus: "local", createdAt: timestamp, updatedAt: timestamp,
    };
    let stopped: BookmarkAiPreview | undefined;
    if (tab?.incognito || policy.protected) stopped = { status: "protected", message: policy.userProtected ? "此收藏受保护，不会读取或发送页面内容。" : "此页面受隐私保护，AI 增强已跳过。仍可保存收藏。" };
    else if (!tab?.url || !deps.resourceMatchesLoadedUrl(resource, tab.url) || page.content.trim().length < 80 || !page.excerpt.trim()) stopped = { status: "no_content", message: "暂时无法读取足够的正文。保存后，正常访问此网页时再补全。" };
    else if (activeExisting && !needsAiEnrichment(activeExisting) && activeExisting.contentHash === resource.contentHash) {
      const result: BookmarkAiPreview = { status: "ready", summary: activeExisting.summary, tags: activeExisting.tags, reused: true };
      return { fingerprint: identity, resourceKey, createdAt: Date.now(), resource: activeExisting, result, done: Promise.resolve(result) };
    } else if (!runtime.apiKey) stopped = { status: "unconfigured", message: "尚未连接 AI 服务。可先保存收藏，在设置中连接后自动补全。" };

    if (stopped) return { fingerprint: identity, resourceKey, createdAt: Date.now(), result: stopped, done: Promise.resolve(stopped) };
    const stored = Object.values(await storedPreviews()).find(item => item.cacheKey === cacheKey);
    const cached = entries.get(cacheKey) || (stored ? { ...stored, done: Promise.resolve(stored.result!) } : undefined);
    if (cached && cached.result?.status !== "failed") return cached;
    if ([...entries.values()].filter(item => !item.result).length >= 4) {
      const result: BookmarkAiPreview = { status: "failed", message: "其他页面正在分析，请稍后重试。也可以先保存收藏。" };
      return { fingerprint: identity, resourceKey, createdAt: Date.now(), result, done: Promise.resolve(result) };
    }
    while (entries.size >= 12) {
      const oldest = [...entries].find(([, item]) => item.result);
      if (!oldest) break;
      entries.delete(oldest[0]);
    }
    const entry = { fingerprint: identity, resourceKey, cacheKey, createdAt: Date.now() } as PreparedSaveAi;
    entry.done = (async (): Promise<BookmarkAiPreview> => {
      try {
        const { enrichResourceLocally } = await import("../../lib/local-ai");
        entry.resource = preparedFields(await enrichResourceLocally(resource, page, AbortSignal.timeout(45_000)));
        return { status: "ready", summary: entry.resource.summary, tags: entry.resource.tags };
      } catch (error) {
        return { status: "failed", message: error instanceof Error ? error.message : "AI 增强暂时失败。可以重试，或先保存收藏。" };
      }
    })().then(result => { entry.result = result; return result; });
    entries.set(cacheKey, entry);
    return entry;
  }

  function prepare(input: PrepareBookmarkAiInput) {
    if (!input.requestId || input.requestId.length > 100) throw new Error("分析请求无效，请重新打开收藏面板。");
    let request = requests.get(input.requestId);
    if (!request) {
      // Request IDs only retain bounded metadata/results, never persisted captures.
      while (requests.size >= 32) requests.delete(requests.keys().next().value!);
      request = create(input);
      requests.set(input.requestId, request);
    }
    return request.then(async entry => {
      if (entry.fingerprint !== await fingerprint(input)) throw new Error("分析请求与当前页面不匹配，请重新打开收藏面板。");
      const result = await entry.done;
      await persist(input.requestId, entry).catch(() => undefined);
      return result;
    });
  }
  async function lookup(input: Omit<PrepareBookmarkAiInput, "requestId"> & { requestId?: string }) {
    const request = input.requestId ? requests.get(input.requestId) : undefined;
    const stored = !request && input.requestId ? (await storedPreviews())[input.requestId] : undefined;
    const entry = request ? await request.catch(() => undefined) : stored ? { ...stored, done: Promise.resolve(stored.result!) } : undefined;
    if (!entry || Date.now() - entry.createdAt > TTL || entry.fingerprint !== await fingerprint(input)) return undefined;
    return entry;
  }
  return { prepare, lookup };
}

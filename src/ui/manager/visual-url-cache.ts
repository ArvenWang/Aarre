import { getVisuals } from "../../lib/storage";

const MAX_ENTRIES = 200;

interface CacheEntry {
  url: string;
  version: string;
}

const cache = new Map<string, CacheEntry>();

export function cachedVisualUrl(key: string): string {
  const existing = cache.get(key);
  if (!existing) return "";
  cache.delete(key);
  cache.set(key, existing);
  return existing.url;
}

export function objectUrlFor(key: string, blob: Blob, version = ""): string {
  const existing = cache.get(key);
  if (existing?.version === version) {
    cache.delete(key);
    cache.set(key, existing);
    return existing.url;
  }
  if (existing) URL.revokeObjectURL(existing.url);
  const entry = { url: URL.createObjectURL(blob), version };
  cache.set(key, entry);
  while (cache.size > MAX_ENTRIES) {
    const oldestKey = cache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    const oldest = cache.get(oldestKey);
    if (oldest) URL.revokeObjectURL(oldest.url);
    cache.delete(oldestKey);
  }
  return entry.url;
}

interface PendingRequest {
  resolve(url: string): void;
  reject(error: unknown): void;
}

const pending = new Map<string, PendingRequest[]>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

async function flush(): Promise<void> {
  flushTimer = null;
  const batch = new Map(pending);
  pending.clear();
  const keys = [...batch.keys()];
  try {
    const visuals = await getVisuals(keys);
    for (const key of keys) {
      const visual = visuals[key];
      const url = visual
        ? objectUrlFor(key, visual.blob, visual.contentHash)
        : "";
      for (const request of batch.get(key) || []) request.resolve(url);
    }
  } catch (error) {
    for (const requests of batch.values()) {
      for (const request of requests) request.reject(error);
    }
  }
}

/** 同一帧内的卡片请求合并为一次 IndexedDB 批量读取。 */
export function requestVisualUrl(key: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const requests = pending.get(key) || [];
    requests.push({ resolve, reject });
    pending.set(key, requests);
    if (!flushTimer) flushTimer = setTimeout(() => void flush(), 16);
  });
}

export function clearVisualUrlCache(): void {
  for (const entry of cache.values()) URL.revokeObjectURL(entry.url);
  cache.clear();
}

import { getLocalIndexedDbSize, type LocalIndexedDbSize } from "./storage";

export interface LocalDataSize {
  totalBytes: number;
  indexedDbBytes: number;
  nativeBookmarkTreeBytes: number;
  chromeStorageLocalBytes: number;
  chromeStorageSessionBytes: number;
  extensionPageStorageBytes: number;
  indexedDb: LocalIndexedDbSize;
  calculatedAt: string;
}

function jsonByteLength(value: unknown): number {
  const serialized = JSON.stringify(value);
  return serialized ? new TextEncoder().encode(serialized).byteLength : 0;
}

/**
 * Measures all Aarre-owned logical data that is available to the extension
 * background context. Values are only read and sized; secrets are never
 * returned to the UI or uploaded by this function.
 */
export async function getLocalDataSize(): Promise<LocalDataSize> {
  const [indexedDb, bookmarkTree, localStorageValues, sessionStorageValues] =
    await Promise.all([
      getLocalIndexedDbSize(),
      chrome.bookmarks.getTree().catch(() => []),
      chrome.storage.local.get(null),
      chrome.storage.session?.get(null) ?? Promise.resolve({})
    ]);
  const nativeBookmarkTreeBytes = jsonByteLength(bookmarkTree);
  const chromeStorageLocalBytes = jsonByteLength(localStorageValues);
  const chromeStorageSessionBytes = jsonByteLength(sessionStorageValues);

  return {
    totalBytes:
      indexedDb.totalBytes +
      nativeBookmarkTreeBytes +
      chromeStorageLocalBytes +
      chromeStorageSessionBytes,
    indexedDbBytes: indexedDb.totalBytes,
    nativeBookmarkTreeBytes,
    chromeStorageLocalBytes,
    chromeStorageSessionBytes,
    extensionPageStorageBytes: 0,
    indexedDb,
    calculatedAt: new Date().toISOString()
  };
}

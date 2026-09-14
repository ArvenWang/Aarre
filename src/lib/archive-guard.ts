export const ARCHIVE_ACTIVE_KEY = "aarre:archive-restore-active:v1";
export async function archiveRestoreActive(): Promise<boolean> {
  return Boolean((await chrome.storage.local.get(ARCHIVE_ACTIVE_KEY))[ARCHIVE_ACTIVE_KEY]);
}
export async function archiveOwnsNode(parentId: string | undefined): Promise<boolean> {
  const active = (await chrome.storage.local.get(ARCHIVE_ACTIVE_KEY))[ARCHIVE_ACTIVE_KEY] as { rootId?: string } | undefined;
  if (!active?.rootId) return false;
  for (let depth = 0; parentId && depth < 100; depth++) {
    if (parentId === active.rootId) return true;
    const [node] = await chrome.bookmarks.get(parentId).catch(() => []);
    parentId = node?.parentId;
  }
  return false;
}

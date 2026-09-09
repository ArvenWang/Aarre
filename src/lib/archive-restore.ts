import { type AarreArchive, archiveUrlSupported, parseArchive } from "./archive-format";
import { database, normalizeResourceRecord } from "./storage";
import { ARCHIVE_ACTIVE_KEY } from "./archive-guard";
import { getAgentConversations, saveAgentConversation } from "./conversations";
import { getProtectionSettings, saveProtectionSettings } from "./protection";
import { getDisplaySettings, saveDisplaySettings } from "./display-settings";
import { dataUrlToBlob } from "./visuals";
import type { NativeBookmarkNode } from "./types";

interface Journal { id: string; rootId: string; map: Record<string, string>; originalKeys: string[]; phase: "bookmarks" | "metadata" | "complete" | "abandoned"; attempt?: string; created: number; skipped: number }
export interface RestoreResult { rootId: string; created: number; skipped: number; alreadyRestored: boolean }
export async function restoreArchive(archive: AarreArchive, onProgress: (label: string) => void = () => undefined): Promise<RestoreResult> {
  // Recheck even when called outside the preview component.
  await parseArchive(JSON.stringify(archive));
  return navigator.locks.request("aarre-archive-restore", { ifAvailable: true }, async (lock) => {
    if (!lock) throw new Error("另一个窗口正在恢复备份，请等待完成。");
    return restore(archive, onProgress);
  });
}
export async function abandonArchiveRestore(): Promise<void> {
  await navigator.locks.request("aarre-archive-restore", { ifAvailable: true }, async (lock) => {
    if (!lock) throw new Error("另一个窗口正在恢复，请等待当前操作结束。");
    const active = (await chrome.storage.local.get(ARCHIVE_ACTIVE_KEY))[ARCHIVE_ACTIVE_KEY] as { id?: string } | undefined;
    if (active?.id) {
      const db = await database(), key = `archive:${active.id}`;
      const journal = await db.get("syncMetadata", key) as Journal | undefined;
      if (journal && journal.phase !== "complete") await db.put("syncMetadata", { ...journal, phase: "abandoned" }, key);
    }
    await chrome.storage.local.remove(ARCHIVE_ACTIVE_KEY);
  });
}
async function restore(archive: AarreArchive, progress: (label: string) => void): Promise<RestoreResult> {
  const db = await database(), id = archive.integrity.payload, key = `archive:${id}`;
  let journal = await db.get("syncMetadata", key) as Journal | undefined;
  const active = (await chrome.storage.local.get(ARCHIVE_ACTIVE_KEY))[ARCHIVE_ACTIVE_KEY] as { id: string } | undefined;
  if (active && active.id !== id) throw new Error("上一份备份尚未恢复完成，请先重新选择那份文件继续。");
  const persist = async () => { await db.put("syncMetadata", journal!, key); };
  if (journal?.phase === "complete") {
    if (active?.id === id) await chrome.storage.local.remove(ARCHIVE_ACTIVE_KEY);
    return { rootId: journal.rootId, created: journal.created, skipped: journal.skipped, alreadyRestored: true };
  }
  if (!journal || journal.phase === "abandoned") {
    const attempt = journal?.phase === "abandoned" ? crypto.randomUUID().slice(0, 8) : undefined;
    journal = { id, attempt, rootId: "", map: {}, originalKeys: await db.getAllKeys("resources"), phase: "bookmarks", created: 0, skipped: 0 };
    await persist();
  }
  await chrome.storage.local.set({ [ARCHIVE_ACTIVE_KEY]: { id, rootId: journal.rootId } });
  if (!journal.rootId) {
    const tree = await chrome.bookmarks.getTree();
    const roots = tree[0]?.children?.filter((node) => !node.url && !node.unmodifiable) || [];
    const parent = roots.find((node) => (node as any).folderType === "other" || node.id === "2") || roots[0];
    if (!parent) throw new Error("Chrome 没有可写入的书签目录。");
    const title = `Aarre 恢复 ${archive.exportedAt.slice(0,10)} · ${id.slice(0,8)}${journal.attempt ? ` · ${journal.attempt}` : ""}`;
    // A crash between native creation and journaling is recoverable by this unique owned folder.
    const existing = (await chrome.bookmarks.getChildren(parent.id)).find((node) => !node.url && node.title === title);
    journal.rootId = (existing || await chrome.bookmarks.create({ parentId: parent.id, title })).id;
    await persist();
    await chrome.storage.local.set({ [ARCHIVE_ACTIVE_KEY]: { id, rootId: journal.rootId } });
  } else if (!(await chrome.bookmarks.get(journal.rootId).catch(() => [])).length) {
    throw new Error("恢复中的文件夹已被删除。可结束本次恢复，再选择备份重新恢复到新文件夹。");
  }
  async function visit(node: NativeBookmarkNode, parentId: string, index: number) {
    if (node.url && !archiveUrlSupported(node.url)) { if (!journal!.map[node.id]) { journal!.map[node.id] = "skipped"; journal!.skipped++; await persist(); } return; }
    let targetId = journal!.map[node.id];
    if (targetId === "skipped") return;
    if (targetId) {
      const [target] = await chrome.bookmarks.get(targetId).catch(() => []);
      if (!target || target.parentId !== parentId || target.url !== node.url) throw new Error("恢复目录在处理中被修改。请检查目录后继续，已有书签不会被覆盖。");
    } else {
      const siblings = await chrome.bookmarks.getChildren(parentId);
      const candidate = siblings[index];
      if (candidate && (candidate.title !== node.title || candidate.url !== node.url || Object.values(journal!.map).includes(candidate.id))) throw new Error("恢复目录出现额外条目，请将额外条目移出后再继续。");
      const created = candidate || await chrome.bookmarks.create({ parentId, index, title: node.title, ...(node.url ? { url: node.url } : {}) });
      targetId = created.id; journal!.map[node.id] = targetId; journal!.created++; await persist();
      progress(`已恢复 ${journal!.created} 个书签和文件夹`);
    }
    let childIndex = 0;
    for (const child of node.children || []) { await visit(child, targetId, childIndex); if (!child.url || archiveUrlSupported(child.url)) childIndex++; }
  }
  let rootIndex = 0;
  for (const root of archive.data.bookmarks) {
    // Chrome's synthetic root is represented by the restore folder; named roots stay as folders.
    if (root.id === "0") {
      journal.map[root.id] = journal.rootId;
      for (const child of root.children || []) await visit(child, journal.rootId, rootIndex++);
    } else await visit(root, journal.rootId, rootIndex++);
  }
  journal.phase = "metadata"; await persist(); progress("正在恢复备注、图片和会话…");
  const originals = new Set(journal.originalKeys);
  const transaction = db.transaction(["resources", "pageSnapshots", "siteBrands", "visuals"], "readwrite");
  for (const item of archive.data.resources) {
    const ids = item.nativeBookmarkIds.map((old) => journal!.map[old]).filter((next) => next && next !== "skipped");
    const existing = await transaction.objectStore("resources").get(item.resourceKey);
    const next = originals.has(item.resourceKey) && existing ? existing : normalizeResourceRecord({ ...item, syncStatus: "local", lastSyncedAt: undefined, deletedAt: undefined });
    await transaction.objectStore("resources").put({ ...next, nativeBookmarkIds: [...new Set([...(existing?.nativeBookmarkIds || []), ...ids])] });
  }
  for (const item of archive.data.pageSnapshots) {
    const current = await transaction.objectStore("pageSnapshots").get(item.canonicalUrl);
    if (!current || current.capturedAt < item.capturedAt) await transaction.objectStore("pageSnapshots").put(item);
  }
  for (const item of archive.data.siteBrands) {
    const current = await transaction.objectStore("siteBrands").get(item.host);
    if (!current || current.updatedAt < item.updatedAt) await transaction.objectStore("siteBrands").put(item);
  }
  for (const { dataUrl, ...item } of archive.data.visuals) {
    const current = await transaction.objectStore("visuals").get(item.key);
    if (!current || (current.origin !== "user" && current.updatedAt < item.updatedAt)) await transaction.objectStore("visuals").put({ ...item, blob: dataUrlToBlob(dataUrl).blob });
  }
  await transaction.done;
  const conversations = new Map((await getAgentConversations()).map((item) => [item.id, item]));
  for (const item of [...archive.data.conversations].reverse()) if (!conversations.has(item.id)) {
    await saveAgentConversation({ ...item, messages: item.messages.map((message) => ({ ...message, actions: [], status: message.status === "sending" ? "cancelled" : message.status })) });
  }
  // Permissions and credentials are never restored. Privacy exclusions are additive.
  const protection = await getProtectionSettings();
  await saveProtectionSettings({ resourceKeys: [...protection.resourceKeys, ...archive.data.protection.resourceKeys], folderIds: [...protection.folderIds, ...archive.data.protection.folderIds.map((old) => journal!.map[old]).filter((id) => id && id !== "skipped")] });
  const display = await getDisplaySettings();
  await saveDisplaySettings({ snapshotExcludedHosts: [...display.snapshotExcludedHosts, ...(archive.data.display.snapshotExcludedHosts || [])], publicFaviconFallback: display.publicFaviconFallback && archive.data.display.publicFaviconFallback });
  journal.phase = "complete"; await persist();
  await chrome.storage.local.remove(ARCHIVE_ACTIVE_KEY);
  return { rootId: journal.rootId, created: journal.created, skipped: journal.skipped, alreadyRestored: false };
}

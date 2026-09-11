import { validateFloatingHostSession } from "./session";
import type { BookmarkSaveState, PageCapture, SaveBookmarkInput, SaveBookmarkResult } from "../../lib/types";

export function createFloatingQuickSave(deps: {
  getBookmarkSaveState(url: string): Promise<BookmarkSaveState>;
  captureActivePage(tabId: number): Promise<PageCapture>;
  saveBookmark(input: SaveBookmarkInput, options?: { deferEnrichment?: boolean }): Promise<SaveBookmarkResult>;
}) {
  const pending = new Map<string, Promise<{ existing: boolean }>>();
  return async (sender: chrome.runtime.MessageSender, nonce: unknown) => {
    await validateFloatingHostSession(sender, nonce);
    const key = `${sender.tab!.id}:${sender.documentId}`;
    const inFlight = pending.get(key); if (inFlight) return inFlight;
    const save = async () => {
      const tab = await chrome.tabs.get(sender.tab!.id!);
      if (!tab.url || tab.url !== sender.url) throw new Error("网页已变化，请在当前网页重新收藏。");
      const state = await deps.getBookmarkSaveState(tab.url);
      // Quick save never changes existing titles, locations, notes or variants.
      if (state.matches.length) return { existing: true };
      const capture = await deps.captureActivePage(tab.id!).catch((): PageCapture => ({
        url: tab.url!, canonicalUrl: tab.url!, title: tab.title || tab.url!,
        description: "", content: "", excerpt: "", selectedText: "", author: "",
        siteName: new URL(tab.url!).hostname, language: "", imageUrl: "", faviconUrl: tab.favIconUrl || "",
      }));
      await validateFloatingHostSession(sender, nonce);
      if ((await chrome.tabs.get(tab.id!)).url !== tab.url || capture.url !== tab.url) throw new Error("网页已变化，请在当前网页重新收藏。");
      const result = await deps.saveBookmark({ capture, sourceTabId: tab.id, title: tab.title || capture.title, userNote: "", folderId: "", requestAi: true }, { deferEnrichment: true });
      return { existing: !result.nativeBookmarkCreated };
    };
    const request = save(); pending.set(key, request);
    try { return await request; } finally { if (pending.get(key) === request) pending.delete(key); }
  };
}

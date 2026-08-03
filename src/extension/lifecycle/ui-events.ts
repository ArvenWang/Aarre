import {
  CONTEXT_MENU_IMAGE_COVER_ID,
  CONTEXT_MENU_UPDATE_SNAPSHOT_ID
} from "./context-menu-core";
import type { NavigationSuggestion } from "../../lib/types";

interface UiEventDependencies {
  contextMenus: {
    handleUpdateSnapshot(tab?: chrome.tabs.Tab): Promise<void>;
    handleImageCover(info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab): Promise<void>;
    handleSave(info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab): Promise<void>;
  };
  flashActionBadge(tabId: number | undefined, text: string, color: string, title: string, durationMs?: number): void;
  errorMessage(error: unknown): string;
  getNavigationSuggestions(text: string): Promise<NavigationSuggestion[]>;
  navigate(input: { text: string; disposition: "current" | "new" }): Promise<unknown>;
}

function escapeOmniboxText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function registerUiEvents(dependencies: UiEventDependencies): void {
  const { contextMenus, flashActionBadge, errorMessage, getNavigationSuggestions, navigate } = dependencies;

  chrome.contextMenus.onClicked.addListener((info, tab) => {
    void chrome.storage.local.set({
      "aarre:context-menu-debug": {
        menuItemId: info.menuItemId,
        time: new Date().toISOString(),
        pageUrl: info.pageUrl || null,
        srcUrl: info.srcUrl || null,
        tabId: tab?.id ?? null,
        tabUrl: tab?.url || null
      }
    }).catch(() => undefined);
    if (info.menuItemId === CONTEXT_MENU_UPDATE_SNAPSHOT_ID) {
      void contextMenus.handleUpdateSnapshot(tab).catch((error) => {
        flashActionBadge(tab?.id, "!", "#a33b34", errorMessage(error));
      });
      return;
    }
    if (info.menuItemId === CONTEXT_MENU_IMAGE_COVER_ID) {
      const tabId = tab?.id;
      flashActionBadge(tabId, "…", "#205aef", "正在处理…", 60_000);
      const timeout = new Promise<never>((_, reject) => {
        globalThis.setTimeout(() => reject(new Error("处理超时，请重试。")), 60_000);
      });
      void Promise.race([contextMenus.handleImageCover(info, tab), timeout]).catch((error) => {
        void chrome.storage.local.set({
          "aarre:image-cover-debug": {
            stage: "error",
            time: new Date().toISOString(),
            extra: errorMessage(error).slice(0, 300)
          }
        }).catch(() => undefined);
        flashActionBadge(tabId, "!", "#a33b34", errorMessage(error), 6_000);
      });
      return;
    }
    void contextMenus.handleSave(info, tab);
  });

  chrome.omnibox.onInputChanged.addListener((text, suggest) => {
    void getNavigationSuggestions(text).then((items) => {
      suggest(items.slice(0, 8).map((item) => ({
        content: item.url,
        description: `<match>${escapeOmniboxText(item.title)}</match> <dim>${escapeOmniboxText(item.subtitle)}</dim>`
      })));
    });
  });

  chrome.omnibox.onInputEntered.addListener((text, disposition) => {
    void navigate({
      text,
      disposition: disposition === "currentTab" ? "current" : "new"
    });
  });
}

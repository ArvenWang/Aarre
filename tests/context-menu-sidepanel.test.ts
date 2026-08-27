import { readFile } from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createContextMenuLifecycle } from "../src/extension/lifecycle/context-menus";
import { CONTEXT_MENU_PAGE_ID } from "../src/extension/lifecycle/context-menu-core";
import { registerUiEvents } from "../src/extension/lifecycle/ui-events";
import type { PendingSaveDraft } from "../src/lib/types";

describe("context-menu side panel opening", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("opens during the original context-menu gesture before storage finishes", async () => {
    let finishStorage!: () => void;
    const storageWrite = new Promise<void>((resolve) => {
      finishStorage = resolve;
    });
    const open = vi.fn().mockResolvedValue(undefined);
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("chrome", {
      storage: { session: { set: vi.fn(() => storageWrite) } },
      sidePanel: { open },
      runtime: { sendMessage },
      contextMenus: {
        update: vi.fn(),
        removeAll: vi.fn(),
        create: vi.fn()
      }
    });

    const draft: PendingSaveDraft = {
      kind: "page",
      tabId: 7,
      url: "https://example.com/article",
      title: "Article",
      faviconUrl: "",
      selectedText: "",
      createdAt: "2026-08-28T00:00:00.000Z"
    };
    const lifecycle = createContextMenuLifecycle({
      activeTab: vi.fn(),
      getBookmarkSaveState: vi.fn(),
      getPrivacyProtectionContext: vi.fn(),
      bookmarkedResourceForLoadedUrl: vi.fn(),
      resourceProtectionState: vi.fn(),
      buildPendingSaveDraft: vi.fn(() => draft),
      rememberPendingSaveDraft: vi.fn(),
      flashActionBadge: vi.fn(),
      errorMessage: (error: unknown) => String(error),
      importNativeBookmarks: vi.fn(),
      prepareManualSnapshotTarget: vi.fn(),
      scheduleManualSnapshot: vi.fn(),
      markNativeBookmarksDirty: vi.fn(),
      upsertLocalResource: vi.fn()
    });

    const pending = lifecycle.handleSave(
      {
        menuItemId: CONTEXT_MENU_PAGE_ID,
        pageUrl: draft.url
      } as chrome.contextMenus.OnClickData,
      { id: 7, url: draft.url } as chrome.tabs.Tab
    );

    expect(open).toHaveBeenCalledWith({ tabId: 7 });
    expect(sendMessage).not.toHaveBeenCalled();

    finishStorage();
    await pending;
    expect(sendMessage).toHaveBeenCalledWith({
      type: "PENDING_SAVE_READY",
      tabId: 7
    });
  });

  it("starts opening before the lazy save handler runs", async () => {
    const order: string[] = [];
    let onClicked!: (
      info: chrome.contextMenus.OnClickData,
      tab?: chrome.tabs.Tab
    ) => void;
    const open = vi.fn(() => {
      order.push("open");
      return Promise.resolve();
    });
    const handleSave = vi.fn(
      (
        _info: chrome.contextMenus.OnClickData,
        _tab?: chrome.tabs.Tab,
        openPanelRequest?: Promise<void>
      ) => {
        order.push("handle-save");
        expect(openPanelRequest).toBeInstanceOf(Promise);
        return Promise.resolve();
      }
    );
    vi.stubGlobal("chrome", {
      sidePanel: { open },
      contextMenus: {
        onClicked: { addListener: (listener: typeof onClicked) => { onClicked = listener; } }
      },
      storage: { local: { set: vi.fn().mockResolvedValue(undefined) } },
      omnibox: {
        onInputChanged: { addListener: vi.fn() },
        onInputEntered: { addListener: vi.fn() }
      }
    });
    registerUiEvents({
      contextMenus: {
        handleSave,
        handleUpdateSnapshot: vi.fn(),
        handleImageCover: vi.fn()
      },
      flashActionBadge: vi.fn(),
      errorMessage: (error: unknown) => String(error),
      getNavigationSuggestions: vi.fn(),
      navigate: vi.fn()
    });

    onClicked(
      { menuItemId: CONTEXT_MENU_PAGE_ID } as chrome.contextMenus.OnClickData,
      { id: 9, url: "https://example.com" } as chrome.tabs.Tab
    );

    expect(order).toEqual(["open", "handle-save"]);
    expect(open).toHaveBeenCalledWith({ tabId: 9 });
  });

  it("keeps only the non-gesture work on the lazy background path", async () => {
    const bootstrap = await readFile(
      new URL("../src/extension/bootstrap.ts", import.meta.url),
      "utf8"
    );
    expect(bootstrap).toContain(
      'from "./lifecycle/context-menus-lazy"'
    );
  });
});

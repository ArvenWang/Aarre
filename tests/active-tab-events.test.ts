import { describe, expect, it, vi } from "vitest";
import {
  readActiveTabSummary,
  subscribeToActiveTabChanges
} from "../src/ui/sidepanel/active-tab-events";

function event<T extends (...args: any[]) => void>() {
  const listeners = new Set<T>();
  return {
    addListener: (listener: T) => listeners.add(listener),
    removeListener: (listener: T) => listeners.delete(listener),
    emit: (...args: Parameters<T>) => {
      for (const listener of listeners) listener(...args);
    }
  };
}

describe("side-panel active tab subscription", () => {
  it("reads the latest focused Chrome tab without waking the background", async () => {
    const query = vi.fn().mockResolvedValue([
      {
        id: 8,
        url: "https://example.com/new",
        title: "New page",
        favIconUrl: "https://example.com/favicon.ico"
      }
    ]);
    vi.stubGlobal("chrome", { tabs: { query } });

    await expect(readActiveTabSummary()).resolves.toEqual({
      id: 8,
      url: "https://example.com/new",
      title: "New page",
      faviconUrl: "https://example.com/favicon.ico",
      supported: true
    });
    expect(query).toHaveBeenCalledWith({
      active: true,
      lastFocusedWindow: true
    });
  });

  it("refreshes on activation, active navigation and window focus only", () => {
    const onActivated = event<(info: chrome.tabs.OnActivatedInfo) => void>();
    const onUpdated =
      event<(
        tabId: number,
        changeInfo: chrome.tabs.OnUpdatedInfo,
        tab: chrome.tabs.Tab
      ) => void>();
    const onFocusChanged = event<(windowId: number) => void>();
    const refresh = vi.fn();
    const unsubscribe = subscribeToActiveTabChanges(refresh, {
      tabs: { onActivated, onUpdated },
      windows: { onFocusChanged, WINDOW_ID_NONE: -1 }
    } as unknown as Parameters<typeof subscribeToActiveTabChanges>[1]);

    onActivated.emit({ tabId: 2, windowId: 1 });
    onUpdated.emit(2, { url: "https://new.example" }, { active: true } as chrome.tabs.Tab);
    onUpdated.emit(3, { url: "https://background.example" }, { active: false } as chrome.tabs.Tab);
    onUpdated.emit(2, { title: "Title only" }, { active: true } as chrome.tabs.Tab);
    onFocusChanged.emit(-1);
    onFocusChanged.emit(1);

    expect(refresh).toHaveBeenCalledTimes(3);

    unsubscribe();
    onActivated.emit({ tabId: 4, windowId: 1 });
    expect(refresh).toHaveBeenCalledTimes(3);
  });
});

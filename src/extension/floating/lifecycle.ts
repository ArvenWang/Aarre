import { FLOATING_SETTINGS_KEY } from "../../lib/floating-settings";
import { openManagerPage } from "../handlers/browser";
import { isSupportedPageUrl } from "../../lib/url";

const repairs = new Map<number, Promise<void>>();
/** A live host keeps its iframe/draft. Only a missing or obsolete connection is replaced. */
export function ensureFloatingHost(tabId: number): Promise<void> {
  const existing = repairs.get(tabId);
  if (existing) return existing;
  const work = (async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const reply = await Promise.race([
      chrome.tabs.sendMessage(tabId, { type: "FLOAT_PING" }, { frameId: 0 }).catch(() => null),
      new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 2_000); }),
    ]).finally(() => clearTimeout(timer));
    if (reply?.ok && reply.version === chrome.runtime.getManifest().version) return;
    await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, files: ["floating-host.js"] });
  })().finally(() => repairs.delete(tabId));
  repairs.set(tabId, work);
  return work;
}
const ordinaryTabs = () => chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });
const restoreTab = (tab: chrome.tabs.Tab) => tab.id && !tab.discarded && isSupportedPageUrl(tab.url || "")
  ? ensureFloatingHost(tab.id).catch(() => undefined) : Promise.resolve();
const restoreAll = () => ordinaryTabs().then(tabs => Promise.all(tabs.map(restoreTab))).catch(() => undefined);

export async function openFloatingMenu(tab: chrome.tabs.Tab, view = "library"): Promise<void> {
  if (!tab.id || !isSupportedPageUrl(tab.url || "")) {
    await openManagerPage(`manager.html?entry=restricted${view === "settings" ? "&settings=1" : ""}`, tab.windowId);
    return;
  }
  try {
    await ensureFloatingHost(tab.id);
    const response = await chrome.tabs.sendMessage(tab.id, { type: "FLOAT_OPEN", view }, { frameId: 0 });
    if (!response?.ok) throw new Error("网页菜单没有响应");
  } catch {
    await openManagerPage("manager.html?entry=restricted", tab.windowId);
  }
}
export function registerFloatingLifecycle(): void {
  chrome.action.onClicked.addListener((tab) => { void openFloatingMenu(tab); void restoreAll(); });
  chrome.runtime.onInstalled.addListener(() => { void restoreAll(); });
  chrome.runtime.onStartup.addListener(() => { void restoreAll(); });
  chrome.tabs.onActivated.addListener(({ tabId }) => { void chrome.tabs.get(tabId).then(restoreTab).catch(() => undefined); });
  chrome.tabs.onUpdated.addListener((_tabId, change, tab) => {
    if (change.status === "complete" || change.url) void restoreTab(tab).then(() => {
      if (change.url && tab.id) return chrome.tabs.sendMessage(tab.id, { type: "FLOAT_REFRESH" }, { frameId: 0 }).catch(() => undefined);
    });
  });
  chrome.permissions.onAdded.addListener(() => { void restoreAll(); });
  // Also covers extension reload / enable with documents already open.
  void restoreAll();
  let bookmarkRefresh: ReturnType<typeof setTimeout> | undefined;
  const refreshStars = () => {
    clearTimeout(bookmarkRefresh);
    bookmarkRefresh = setTimeout(() => { void ordinaryTabs().then(tabs => Promise.all(tabs.map(tab => tab.id
      ? chrome.tabs.sendMessage(tab.id, { type: "FLOAT_REFRESH" }, { frameId: 0 }).catch(() => undefined) : undefined))).catch(() => undefined); }, 150);
  };
  chrome.bookmarks.onCreated.addListener(refreshStars);
  chrome.bookmarks.onRemoved.addListener(refreshStars);
  chrome.bookmarks.onChanged.addListener(refreshStars);
  chrome.tabs.onRemoved.addListener((tabId) => { void chrome.storage.session.remove(`aarre:floating-session:${tabId}`); });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || ![FLOATING_SETTINGS_KEY, "aarre:onboarding:v1", "aarre:theme-sync:v1"].some((key) => key in changes)) return;
    void chrome.tabs.query({ url: ["http://*/*", "https://*/*"] }).then((tabs) => Promise.all(tabs.map((tab) =>
      tab.id ? chrome.tabs.sendMessage(tab.id, { type: "FLOAT_REFRESH" }, { frameId: 0 }).catch(() => undefined) : undefined)));
  });
}
export async function withFloatingHidden<T>(tabId: number, capture: () => Promise<T>): Promise<T> {
  // Absence is safe; an existing host that fails to acknowledge hiding is not.
  const [{ result: hasHost } = {}] = await chrome.scripting.executeScript({
    target: { tabId, frameIds: [0] },
    func: () => Boolean(document.querySelector("aarre-floating-host")),
  });
  if (!hasHost) return capture();
  const lease = crypto.randomUUID();
  try {
    const ack = await chrome.tabs.sendMessage(tabId, { type: "FLOAT_CAPTURE", hidden: true, lease }, { frameId: 0 });
    if (!ack?.ok || ack.lease !== lease) throw new Error("Aarre 菜单未能暂时隐藏，请重试截图。");
    return await capture();
  } finally {
    await chrome.tabs.sendMessage(tabId, { type: "FLOAT_CAPTURE", hidden: false, lease }, { frameId: 0 }).catch(() => undefined);
  }
}

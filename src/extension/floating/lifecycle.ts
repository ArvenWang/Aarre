import { FLOATING_SETTINGS_KEY } from "../../lib/floating-settings";
import { openManagerPage } from "../handlers/browser";
import { isSupportedPageUrl } from "../../lib/url";

export async function openFloatingMenu(tab: chrome.tabs.Tab, view = "library"): Promise<void> {
  if (!tab.id || !isSupportedPageUrl(tab.url || "")) {
    await openManagerPage(`manager.html?entry=restricted${view === "settings" ? "&settings=1" : ""}`, tab.windowId);
    return;
  }
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["floating-host.js"] });
    const response = await chrome.tabs.sendMessage(tab.id, { type: "FLOAT_OPEN", view }, { frameId: 0 });
    if (!response?.ok) throw new Error("网页菜单没有响应");
  } catch {
    await openManagerPage("manager.html?entry=restricted", tab.windowId);
  }
}
export function registerFloatingLifecycle(): void {
  chrome.action.onClicked.addListener((tab) => { void openFloatingMenu(tab); });
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

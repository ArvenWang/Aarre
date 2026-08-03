import { isSnapshotSensitiveUrl, waitForStablePageInDocument } from "../../lib/page-snapshot";
import { isSupportedPageUrl } from "../../lib/url";
import type { NativeFolderOption, PageCapture, ResourceRecord } from "../../lib/types";

interface PageCaptureDependencies {
  getFolderOptions(): Promise<NativeFolderOption[]>;
  activeTab(): Promise<chrome.tabs.Tab | null>;
  getPrivacyProtectionContext(): Promise<{ excludedHosts: string[] }>;
  bookmarkedResourceForLoadedUrl(url: string): Promise<ResourceRecord | undefined>;
  resourceProtectionState(resource: ResourceRecord, context: { excludedHosts: string[] }, loadedUrl?: string): { protected: boolean };
}

export function createPageCaptureHandlers(dependencies: PageCaptureDependencies) {
  const {
    getFolderOptions,
    activeTab,
    getPrivacyProtectionContext,
    bookmarkedResourceForLoadedUrl,
    resourceProtectionState
  } = dependencies;
async function folderPathForId(folderId: string): Promise<string[]> {
  const options = await getFolderOptions();
  return options.find((item) => item.id === folderId)?.path || [];
}

async function assertTabContentCaptureAllowed(
  tab: chrome.tabs.Tab
): Promise<void> {
  if (!tab.url || !isSupportedPageUrl(tab.url)) {
    throw new Error("当前页面受 Chrome 保护，无法读取网页内容。");
  }
  const [context, resource] = await Promise.all([
    getPrivacyProtectionContext(),
    bookmarkedResourceForLoadedUrl(tab.url)
  ]);
  const protectedPage = resource
    ? resourceProtectionState(resource, context, tab.url).protected
    : isSnapshotSensitiveUrl(tab.url, context.excludedHosts);
  if (protectedPage) {
    throw new Error(
      "此网页已受保护，Aarre 不会读取正文、生成截图或发送给 AI。"
    );
  }
}

async function captureActivePage(tabId?: number): Promise<PageCapture> {
  const tab =
    typeof tabId === "number"
      ? await chrome.tabs.get(tabId).catch(() => null)
      : await activeTab();
  if (!tab?.id || !tab.url || !isSupportedPageUrl(tab.url)) {
    throw new Error("当前页面受 Chrome 保护，无法读取网页内容。");
  }
  await assertTabContentCaptureAllowed(tab);

  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["content-capture.js"]
  });

  const response = (await chrome.tabs.sendMessage(tab.id, {
    type: "BOOKMARK_LAYER_CAPTURE_PAGE"
  })) as
    | { ok: true; data: PageCapture }
    | { ok: false; error: string };

  if (!response?.ok) {
    throw new Error(response?.error || "无法读取当前网页。");
  }

  return {
    ...response.data,
    faviconUrl: response.data.faviconUrl || tab.favIconUrl || ""
  };
}

async function captureRenderedPageForDocument(
  tabId: number,
  expectedDocumentId?: string
): Promise<PageCapture> {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab) throw new Error("页面标签已经关闭，等待下次访问。");
  await assertTabContentCaptureAllowed(tab);
  const [before] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => globalThis.location.href
  });
  if (
    !before?.result ||
    (expectedDocumentId && before.documentId !== expectedDocumentId)
  ) {
    throw new Error("页面文档已经变化，等待下次访问。");
  }
  const [stability] = await chrome.scripting.executeScript({
    target: { tabId },
    func: waitForStablePageInDocument,
    args: [900, 4_000]
  });
  if (
    stability?.result !== true ||
    stability.documentId !== before.documentId
  ) {
    throw new Error("页面尚未稳定，等待下次访问。");
  }
  const capture = await captureActivePage(tabId);
  const [after] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => globalThis.location.href
  });
  if (
    after?.result !== before.result ||
    after.documentId !== before.documentId
  ) {
    throw new Error("读取正文期间页面已变化，等待下次访问。");
  }
  return capture;
}

  return {
    folderPathForId,
    assertTabContentCaptureAllowed,
    captureActivePage,
    captureRenderedPageForDocument
  };
}

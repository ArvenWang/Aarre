import { extractPage } from "./extract";

declare global {
  interface Window {
    __bookmarkLayerCaptureInstalled?: boolean;
  }
}

if (!window.__bookmarkLayerCaptureInstalled) {
  window.__bookmarkLayerCaptureInstalled = true;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "BOOKMARK_LAYER_CAPTURE_PAGE") {
      return false;
    }

    try {
      const capture = extractPage(document, {
        pageUrl: window.location.href,
        selectedText: window.getSelection()?.toString() || ""
      });
      sendResponse({ ok: true, data: capture });
    } catch (error) {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : "无法读取当前网页。"
      });
    }

    return true;
  });
}

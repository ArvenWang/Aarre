import { showAarreToastInDocument } from "../lib/page-snapshot";

export interface NativeBookmarkFeedbackState {
  privacyBlocked: boolean;
  needsAi: boolean;
  aiConfigured: boolean;
}

export function nativeBookmarkFeedbackMessage(
  state: NativeBookmarkFeedbackState
): string {
  const prefix = "Chrome 收藏成功 · ";
  return prefix + (
    state.privacyBlocked
      ? "隐私保护，未做 AI 分析"
      : state.needsAi
        ? state.aiConfigured
          ? "AI 分析中"
          : "配置 AI 后自动分析"
        : "AI 信息已就绪"
  );
}

export function showNativeBookmarkFeedback(
  tabId: number,
  message: string
): Promise<chrome.scripting.InjectionResult<unknown>[]> {
  return chrome.scripting.executeScript({
    target: { tabId },
    func: showAarreToastInDocument,
    args: [message]
  });
}

import type {
  AppState,
  BookmarkSaveMatch,
  PageCapture,
  PendingSaveDraft,
} from "../../lib/types";

export function hostFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "") || url;
  } catch {
    return url;
  }
}

export function bookmarkMatchLocation(match: BookmarkSaveMatch): string {
  return match.folderPath.filter(Boolean).join(" / ") || "Chrome 书签";
}

export function emptyCapture(appState: AppState): PageCapture {
  const tab = appState.activeTab;
  if (!tab?.url) throw new Error("没有可收藏的当前页面。");
  return {
    url: tab.url,
    canonicalUrl: "",
    title: tab.title || tab.url,
    description: "",
    content: "",
    excerpt: "",
    selectedText: "",
    author: "",
    siteName: hostFromUrl(tab.url),
    language: "",
    imageUrl: "",
    faviconUrl: tab.faviconUrl,
  };
}

export function captureFromDraft(draft: PendingSaveDraft): PageCapture {
  return {
    url: draft.url,
    canonicalUrl: "",
    title: draft.title,
    description: "",
    content: "",
    excerpt: "",
    selectedText: draft.selectedText,
    author: "",
    siteName: hostFromUrl(draft.url),
    language: "",
    imageUrl: "",
    faviconUrl: draft.faviconUrl,
  };
}

export function conversationDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

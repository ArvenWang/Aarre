import type { PendingSaveDraft } from "./types";

export interface PendingSaveInput {
  kind: "page" | "link";
  tabId: number;
  url: string;
  tabTitle?: string;
  faviconUrl?: string;
  selectedText?: string;
  createdAt?: string;
}

export function createPendingSaveDraft(
  input: PendingSaveInput
): PendingSaveDraft {
  const url = input.url.trim();
  if (!url || /^(javascript|data|blob):/i.test(url)) {
    throw new Error("这个地址无法保存为安全的 Chrome 书签。");
  }

  let title = input.tabTitle?.trim() || url;
  if (input.kind === "link") {
    try {
      title = new URL(url).hostname.replace(/^www\./, "") || url;
    } catch {
      title = url;
    }
  }

  return {
    kind: input.kind,
    tabId: input.tabId,
    url,
    title,
    faviconUrl: input.kind === "link" ? "" : input.faviconUrl || "",
    selectedText: input.selectedText?.trim() || "",
    createdAt: input.createdAt || new Date().toISOString()
  };
}

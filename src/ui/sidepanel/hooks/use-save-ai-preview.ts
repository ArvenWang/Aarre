import { useEffect, useState } from "react";
import { sendExtensionRequest } from "../../../lib/messages";
import type { BookmarkAiPreview, PageCapture } from "../../../lib/types";

export type SaveAiPreviewState = BookmarkAiPreview | { status: "loading" };

export function useSaveAiPreview(enabled: boolean, capture: PageCapture | null, sourceTabId?: number) {
  const [preview, setPreview] = useState<SaveAiPreviewState>({ status: "loading" });
  const [requestId, setRequestId] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled || !capture) { setRequestId(undefined); return; }
    let active = true;
    const requestId = crypto.randomUUID();
    setRequestId(requestId);
    setPreview({ status: "loading" });
    const timeout = setTimeout(() => {
      if (active) setPreview({ status: "failed", message: "AI 响应超时。可以重试，或先保存收藏。" });
      active = false;
    }, 55_000);
    void sendExtensionRequest({ type: "PREPARE_BOOKMARK_AI", payload: { requestId, capture, sourceTabId } })
      .then(result => { if (active) setPreview(result); })
      .catch(error => { if (active) setPreview({ status: "failed", message: error instanceof Error ? error.message : "AI 增强暂时失败，可以先保存收藏。" }); })
      .finally(() => clearTimeout(timeout));
    // Leave a short-lived backend result reusable when closing and reopening.
    // This cleanup prevents old page results from changing the current draft.
    return () => { active = false; clearTimeout(timeout); };
  }, [enabled, capture, sourceTabId, attempt]);
  return { preview, requestId, retry: () => setAttempt(value => value + 1) };
}

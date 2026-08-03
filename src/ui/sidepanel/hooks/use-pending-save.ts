import { useEffect, useRef } from "react";
import { sendExtensionRequest } from "../../../lib/messages";
import { pendingSaveReadyTabId } from "../../../lib/pending-save";
import type { PendingSaveDraft } from "../../../lib/types";

interface UsePendingSaveInput {
  activeTabId?: number;
  startSave: (draft?: PendingSaveDraft) => Promise<void>;
  setError: (value: string) => void;
}

export function usePendingSave({
  activeTabId,
  startSave,
  setError,
}: UsePendingSaveInput) {
  const inFlight = useRef(false);
  const queue = useRef<number[]>([]);
  const startSaveRef = useRef(startSave);
  const setErrorRef = useRef(setError);
  startSaveRef.current = startSave;
  setErrorRef.current = setError;

  useEffect(() => {
    const consumeQueue = async () => {
      if (inFlight.current) return;
      inFlight.current = true;
      try {
        while (queue.current.length) {
          const tabId = queue.current.shift()!;
          try {
            const draft = await sendExtensionRequest({ type: "GET_PENDING_SAVE", tabId });
            if (draft) await startSaveRef.current(draft);
          } catch (caught) {
            setErrorRef.current(caught instanceof Error ? caught.message : "无法打开收藏表单");
          }
        }
      } finally {
        inFlight.current = false;
        if (queue.current.length) void consumeQueue();
      }
    };
    const enqueue = (tabId: number) => {
      if (!queue.current.includes(tabId)) queue.current.push(tabId);
      void consumeQueue();
    };
    const handlePendingSave = (message: unknown) => {
      const tabId = pendingSaveReadyTabId(message && typeof message === "object" ? message : {});
      if (typeof tabId === "number") enqueue(tabId);
    };
    const eventSource = typeof chrome !== "undefined" ? chrome.runtime?.onMessage : undefined;
    eventSource?.addListener(handlePendingSave);
    if (typeof activeTabId === "number") enqueue(activeTabId);
    return () => eventSource?.removeListener(handlePendingSave);
  }, [activeTabId]);
}

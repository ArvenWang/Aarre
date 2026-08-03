import { useEffect, useState } from "react";
import { sendExtensionRequest } from "../../../lib/messages";
import type { SyncStatus } from "../../../lib/sync-engine";

export function useSyncStatus(): SyncStatus | null {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  useEffect(() => {
    void sendExtensionRequest({ type: "GET_SYNC_STATUS" }).then(setStatus).catch(() => undefined);
    const listener = (message: unknown) => {
      if (!message || typeof message !== "object") return;
      const event = message as { type?: string; status?: SyncStatus };
      if (event.type === "SYNC_STATUS" && event.status) setStatus(event.status);
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);
  return status;
}

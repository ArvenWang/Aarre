import { useCallback } from "react";
import { requestPageSnapshotPermission } from "../../../lib/display-settings";
import { sendExtensionRequest } from "../../../lib/messages";

export function useNavigation(
  pageSnapshotsEnabled: boolean,
  setError: (value: string) => void,
) {
  return useCallback(async (
    input: { text: string; url?: string },
    newTab = false,
  ) => {
    setError("");
    try {
      if (input.url && pageSnapshotsEnabled) {
        await requestPageSnapshotPermission().catch(() => false);
      }
      await sendExtensionRequest({
        type: "NAVIGATE",
        payload: {
          text: input.text,
          url: input.url,
          disposition: newTab ? "new" : "current",
        },
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "无法打开");
    }
  }, [pageSnapshotsEnabled, setError]);
}

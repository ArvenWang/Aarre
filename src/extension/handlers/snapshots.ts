import type { ExtensionRequest } from "../../lib/messages";
import type { SnapshotBackfillStatus } from "../../lib/types";
import type { ExtensionHandler } from "./settings";

interface SnapshotHandlerDependencies {
  captureActivePage(tabId?: number): Promise<unknown>;
  getPageSnapshot(canonicalUrl: string): Promise<unknown>;
  startSnapshotBackfill(): Promise<SnapshotBackfillStatus>;
  getSnapshotBackfillStatus(
    includeCandidateCount: boolean
  ): Promise<SnapshotBackfillStatus>;
  updateSnapshotBackfillState(
    action: "paused" | "running" | "cancelled"
  ): Promise<SnapshotBackfillStatus>;
}

export function createSnapshotHandlers(
  dependencies: SnapshotHandlerDependencies
): Partial<Record<ExtensionRequest["type"], ExtensionHandler>> {
  return {
    CAPTURE_ACTIVE_PAGE: async (request) => {
      if (request.type !== "CAPTURE_ACTIVE_PAGE") {
        throw new Error("页面捕获消息类型不匹配。");
      }
      return dependencies.captureActivePage(request.tabId);
    },
    GET_PAGE_SNAPSHOT: async (request) => {
      if (request.type !== "GET_PAGE_SNAPSHOT") {
        throw new Error("封面读取消息类型不匹配。");
      }
      return (
        (await dependencies.getPageSnapshot(request.canonicalUrl)) || null
      );
    },
    START_SNAPSHOT_BACKFILL: async () =>
      dependencies.startSnapshotBackfill(),
    GET_SNAPSHOT_BACKFILL: async (request) => {
      if (request.type !== "GET_SNAPSHOT_BACKFILL") {
        throw new Error("补拍状态消息类型不匹配。");
      }
      return dependencies.getSnapshotBackfillStatus(
        Boolean(request.includeCandidateCount)
      );
    },
    PAUSE_SNAPSHOT_BACKFILL: async () =>
      dependencies.updateSnapshotBackfillState("paused"),
    RESUME_SNAPSHOT_BACKFILL: async () =>
      dependencies.updateSnapshotBackfillState("running"),
    CANCEL_SNAPSHOT_BACKFILL: async () =>
      dependencies.updateSnapshotBackfillState("cancelled")
  };
}

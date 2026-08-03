import {
  clearCloudResourceSyncTracking,
  listCloudConflicts,
  resolveCloudConflict,
} from "../../lib/cloud";
import { cloudRequest, signInWithGoogle, signOut } from "../../lib/auth";
import {
  getCloudSyncSettings,
  saveCloudSyncSettings,
  type CloudStorageUsage,
} from "../../lib/cloud-settings";
import { getCloudSyncEstimate } from "../../lib/cloud-estimate";
import { getLocalDataSize } from "../../lib/local-size";
import { clearDurableCloudStateTracking } from "../../lib/cloud-state";
import { clearCloudAssetSyncState } from "../../lib/cloud-assets";
import { getLocalResources } from "../../lib/storage";
import { readSyncStatus, requestSync, sync } from "../../lib/sync-engine";
import type { AppState } from "../../lib/types";

type Handler = (request: any) => Promise<unknown>;

interface CloudHandlerDependencies {
  getAppState(): Promise<AppState>;
}

export function createCloudHandlers({ getAppState }: CloudHandlerDependencies) {
  const resetTracking = () => Promise.all([
    clearCloudResourceSyncTracking(),
    clearDurableCloudStateTracking(),
    clearCloudAssetSyncState(),
  ]);

  const handlers: Record<string, Handler> = {
    SYNC_NOW: async () => {
      await sync("manual");
      return { synced: 0, failed: 0, resources: await getLocalResources() };
    },
    SIGN_IN_CLOUD: async () => {
      await signInWithGoogle();
      await resetTracking();
      requestSync("sign-in");
      return getAppState();
    },
    SIGN_OUT_CLOUD: async () => {
      await signOut();
      await resetTracking();
      await sync("sign-out");
      return getAppState();
    },
    GET_CLOUD_SETTINGS: async () => getCloudSyncSettings(),
    SAVE_CLOUD_SETTINGS: async () => {
      const next = await saveCloudSyncSettings({ enabled: true });
      requestSync("cloud-settings");
      return next;
    },
    GET_CLOUD_USAGE: async () => cloudRequest<CloudStorageUsage>("/v1/account/usage"),
    GET_CLOUD_SYNC_ESTIMATE: async () => getCloudSyncEstimate("complete"),
    GET_LOCAL_DATA_SIZE: async () => getLocalDataSize(),
    GET_CLOUD_SYNC_PROGRESS: async () => readSyncStatus(),
    GET_SYNC_STATUS: async () => readSyncStatus(),
    GET_CLOUD_CONFLICTS: async () => listCloudConflicts(),
    RESOLVE_CLOUD_CONFLICT: async (request) => {
      await resolveCloudConflict(request.conflictId, {
        resolution: request.resolution,
        ...(request.mergedUserNote !== undefined ? { mergedUserNote: request.mergedUserNote } : {}),
        ...(request.mergedTags !== undefined ? { mergedTags: request.mergedTags } : {}),
      });
      requestSync("conflict-resolved", 3_000);
      return { resolved: true };
    },
  };

  return { handlers };
}

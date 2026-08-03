import type { AppState } from "../../lib/types";

type Handler = (request: any) => Promise<unknown>;

interface CloudHandlerDependencies {
  getAppState(): Promise<AppState>;
}

const CLOUD_MESSAGE_TYPES = [
  "SYNC_NOW",
  "SIGN_IN_CLOUD",
  "SIGN_OUT_CLOUD",
  "GET_CLOUD_SETTINGS",
  "SAVE_CLOUD_SETTINGS",
  "GET_CLOUD_USAGE",
  "GET_CLOUD_SYNC_ESTIMATE",
  "GET_LOCAL_DATA_SIZE",
  "GET_CLOUD_SYNC_PROGRESS",
  "GET_SYNC_STATUS",
  "GET_CLOUD_CONFLICTS",
  "RESOLVE_CLOUD_CONFLICT",
] as const;

/** Keep the cloud data plane out of the MV3 worker's cold-start bundle. */
export function createCloudHandlers(dependencies: CloudHandlerDependencies) {
  let loaded: Promise<Record<string, Handler>> | undefined;
  const load = () =>
    loaded ||= import("./cloud").then(
      (module) => module.createCloudHandlers(dependencies).handlers,
    );
  const handlers: Record<string, Handler> = {};
  for (const type of CLOUD_MESSAGE_TYPES) {
    handlers[type] = async (request) => {
      const target = (await load())[type];
      if (!target) throw new Error(`云端处理器未注册：${type}`);
      return target(request);
    };
  }
  return { handlers };
}

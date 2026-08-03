import type { CloudSyncScope } from "./cloud-settings";

export const CLOUD_SYNC_PROGRESS_KEY = "aarre:cloud-sync-progress:v1";

export type CloudSyncProgressPhase =
  | "idle"
  | "syncing"
  | "completed"
  | "error";

export interface CloudSyncProgress {
  phase: CloudSyncProgressPhase;
  scope: CloudSyncScope;
  startedAt: string;
  updatedAt: string;
  resourceTotal: number;
  resourceProcessed: number;
  resourceFailed: number;
  assetTotal: number;
  assetProcessed: number;
  statusText: string;
  error?: string;
}

const EMPTY_PROGRESS: CloudSyncProgress = {
  phase: "idle",
  scope: "complete",
  startedAt: "",
  updatedAt: "",
  resourceTotal: 0,
  resourceProcessed: 0,
  resourceFailed: 0,
  assetTotal: 0,
  assetProcessed: 0,
  statusText: "",
};

function clampCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : 0;
}

function normalizeProgress(value: unknown): CloudSyncProgress {
  const stored = value && typeof value === "object"
    ? value as Partial<CloudSyncProgress>
    : {};
  const resourceTotal = clampCount(stored.resourceTotal);
  const resourceProcessed = Math.min(resourceTotal, clampCount(stored.resourceProcessed));
  const resourceFailed = Math.min(
    Math.max(0, resourceTotal - resourceProcessed),
    clampCount(stored.resourceFailed),
  );
  const storedError = typeof stored.error === "string" ? stored.error : "";
  const error = /refresh token replay/i.test(storedError)
    ? "云端登录会话已失效，请重新登录后继续同步。"
    : storedError;
  return {
    phase: stored.phase === "syncing" || stored.phase === "completed" || stored.phase === "error"
      ? stored.phase
      : "idle",
    scope: stored.scope === "complete" ? "complete" : "text",
    startedAt: typeof stored.startedAt === "string" ? stored.startedAt : "",
    updatedAt: typeof stored.updatedAt === "string" ? stored.updatedAt : "",
    resourceTotal,
    resourceProcessed,
    resourceFailed,
    assetTotal: clampCount(stored.assetTotal),
    assetProcessed: Math.min(clampCount(stored.assetTotal), clampCount(stored.assetProcessed)),
    statusText: typeof stored.statusText === "string" ? stored.statusText : "",
    ...(error ? { error } : {}),
  };
}

async function readProgress(): Promise<CloudSyncProgress> {
  const stored = (await chrome.storage.local.get(CLOUD_SYNC_PROGRESS_KEY))[
    CLOUD_SYNC_PROGRESS_KEY
  ];
  return normalizeProgress(stored);
}

async function writeProgress(progress: CloudSyncProgress): Promise<CloudSyncProgress> {
  const next = normalizeProgress(progress);
  await chrome.storage.local.set({ [CLOUD_SYNC_PROGRESS_KEY]: next });
  return next;
}

export async function getCloudSyncProgress(): Promise<CloudSyncProgress> {
  return readProgress();
}

export async function beginCloudSyncProgress(input: {
  scope: CloudSyncScope;
  resourceTotal: number;
}): Promise<CloudSyncProgress> {
  const now = new Date().toISOString();
  return writeProgress({
    ...EMPTY_PROGRESS,
    phase: "syncing",
    scope: input.scope,
    startedAt: now,
    updatedAt: now,
    resourceTotal: clampCount(input.resourceTotal),
    statusText: "正在准备同步…",
  });
}

export async function updateCloudSyncProgress(input: {
  resourceProcessedDelta?: number;
  resourceFailedDelta?: number;
  assetTotal?: number;
  assetProcessedDelta?: number;
  statusText?: string;
}): Promise<CloudSyncProgress> {
  const current = await readProgress();
  if (current.phase !== "syncing") return current;
  const resourceProcessed = Math.min(
    current.resourceTotal,
    current.resourceProcessed + clampCount(input.resourceProcessedDelta),
  );
  const resourceFailed = Math.min(
    Math.max(0, current.resourceTotal - resourceProcessed),
    current.resourceFailed + clampCount(input.resourceFailedDelta),
  );
  const assetTotal = input.assetTotal === undefined
    ? current.assetTotal
    : Math.max(current.assetTotal, clampCount(input.assetTotal));
  return writeProgress({
    ...current,
    updatedAt: new Date().toISOString(),
    resourceProcessed,
    resourceFailed,
    assetTotal,
    assetProcessed: Math.min(
      assetTotal,
      current.assetProcessed + clampCount(input.assetProcessedDelta),
    ),
    ...(input.statusText !== undefined ? { statusText: input.statusText } : {}),
  });
}

export async function completeCloudSyncProgress(input?: {
  resourceFailed?: number;
  statusText?: string;
}): Promise<CloudSyncProgress> {
  const current = await readProgress();
  if (current.phase !== "syncing") return current;
  const failed = Math.min(
    Math.max(0, current.resourceTotal - current.resourceProcessed),
    Math.max(current.resourceFailed, clampCount(input?.resourceFailed)),
  );
  return writeProgress({
    ...current,
    phase: "completed",
    updatedAt: new Date().toISOString(),
    resourceFailed: failed,
    statusText: input?.statusText || (failed ? "同步完成，但有部分项目稍后重试。" : "同步完成。"),
  });
}

export async function failCloudSyncProgress(error: unknown): Promise<CloudSyncProgress> {
  const current = await readProgress();
  const message = error instanceof Error ? error.message : "云端同步失败。";
  return writeProgress({
    ...current,
    phase: "error",
    updatedAt: new Date().toISOString(),
    error: message,
    statusText: "同步未完成。",
  });
}

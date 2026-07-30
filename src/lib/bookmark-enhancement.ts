export type BookmarkEnhancementPart = "ai" | "snapshot";

export type SnapshotEnhancementState =
  | "queued"
  | "waiting_page"
  | "waiting_foreground"
  | "stabilizing"
  | "capturing"
  | "retry"
  | "privacy_blocked";

export type AiEnhancementState =
  | "queued"
  | "waiting_for_key"
  | "waiting_for_content"
  | "processing"
  | "retry"
  | "privacy_blocked";

export interface AiEnhancementProgress {
  state: AiEnhancementState;
  updatedAt: string;
  tabId?: number;
  documentId?: string;
  lastError?: string;
}

export interface SnapshotEnhancementProgress {
  state: SnapshotEnhancementState;
  trigger:
    | "chrome_bookmark"
    | "aarre_save"
    | "aarre_open"
    | "normal_browse"
    | "batch_backfill"
    | "recovery";
  updatedAt: string;
  tabId?: number;
  documentId?: string;
  loadedUrl?: string;
  showToast?: boolean;
  refreshExisting?: boolean;
  lastError?: string;
}

export interface BookmarkEnhancementJob {
  resourceKey: string;
  url: string;
  pending: BookmarkEnhancementPart[];
  attempts: number;
  nextAttemptAt: string;
  createdAt: string;
  updatedAt: string;
  lastError?: string;
  snapshot?: SnapshotEnhancementProgress;
  ai?: AiEnhancementProgress;
}

export function enhancementTriggerAllowsRenderedAi(
  trigger: SnapshotEnhancementProgress["trigger"]
): boolean {
  // “补齐缺失封面”是零 AI 费用的截图任务。AI 全目录增强必须继续走
  // 另一个显式扫描入口、费用预估和用户确认，不能被截图队列暗中触发。
  return trigger !== "batch_backfill";
}

export function snapshotCapturePolicy(input: {
  hasSnapshot: boolean;
  snapshotIsStale: boolean;
  trigger: SnapshotEnhancementProgress["trigger"];
}): {
  capture: boolean;
  refreshExisting: boolean;
  showToast: boolean;
} {
  const openedForRecovery =
    input.trigger === "aarre_open" || input.trigger === "normal_browse";
  const refreshExisting =
    input.hasSnapshot && input.snapshotIsStale && openedForRecovery;
  return {
    capture: !input.hasSnapshot || refreshExisting,
    refreshExisting,
    // Chrome 星标与 Aarre 保存后的首拍保持无感；以后正常访问缺图收藏
    // 已属于自动补拍，成功后给出一次明确反馈。
    showToast: !input.hasSnapshot && openedForRecovery
  };
}

export function acceptsSnapshotNavigationCommit(input: {
  directMatch: boolean;
  redirectSourceMatches: boolean;
  transitionQualifiers: readonly string[];
}): boolean {
  if (input.directMatch) return true;
  if (!input.redirectSourceMatches) return false;
  return input.transitionQualifiers.some(
    (qualifier) =>
      qualifier === "server_redirect" ||
      qualifier === "client_redirect"
  );
}

const RETRY_DELAYS_MS = [
  60_000,
  5 * 60_000,
  30 * 60_000,
  2 * 60 * 60_000,
  12 * 60 * 60_000
] as const;

export function mergeEnhancementJob(
  existing: BookmarkEnhancementJob | undefined,
  input: {
    resourceKey: string;
    url: string;
    pending: BookmarkEnhancementPart[];
    snapshot?: SnapshotEnhancementProgress;
    ai?: AiEnhancementProgress;
  },
  timestamp = new Date().toISOString()
): BookmarkEnhancementJob {
  return {
    resourceKey: input.resourceKey,
    url: input.url,
    pending: [
      ...new Set([...(existing?.pending || []), ...input.pending])
    ],
    attempts: existing?.attempts || 0,
    nextAttemptAt: existing?.nextAttemptAt || timestamp,
    createdAt: existing?.createdAt || timestamp,
    updatedAt: timestamp,
    ...(existing?.lastError ? { lastError: existing.lastError } : {}),
    ...(input.snapshot || existing?.snapshot
      ? { snapshot: input.snapshot || existing?.snapshot }
      : {}),
    ...(input.ai || existing?.ai ? { ai: input.ai || existing?.ai } : {})
  };
}

export function updateAiProgress(
  job: BookmarkEnhancementJob,
  progress: Omit<AiEnhancementProgress, "updatedAt">,
  timestamp = new Date().toISOString()
): BookmarkEnhancementJob {
  return {
    ...job,
    updatedAt: timestamp,
    ai: {
      ...progress,
      updatedAt: timestamp
    }
  };
}

export function updateSnapshotProgress(
  job: BookmarkEnhancementJob,
  progress: Omit<SnapshotEnhancementProgress, "updatedAt">,
  timestamp = new Date().toISOString()
): BookmarkEnhancementJob {
  return {
    ...job,
    updatedAt: timestamp,
    snapshot: {
      ...progress,
      updatedAt: timestamp
    }
  };
}

export function completeEnhancementPart(
  job: BookmarkEnhancementJob,
  part: BookmarkEnhancementPart,
  timestamp = new Date().toISOString()
): BookmarkEnhancementJob | null {
  const pending = job.pending.filter((item) => item !== part);
  if (!pending.length) return null;
  return {
    ...job,
    pending,
    updatedAt: timestamp
  };
}

export function deferEnhancementJob(
  job: BookmarkEnhancementJob,
  error: string,
  timestampMs = Date.now()
): BookmarkEnhancementJob {
  const attempts = job.attempts + 1;
  const delay =
    RETRY_DELAYS_MS[Math.min(attempts - 1, RETRY_DELAYS_MS.length - 1)];
  const timestamp = new Date(timestampMs).toISOString();
  return {
    ...job,
    attempts,
    nextAttemptAt: new Date(timestampMs + delay).toISOString(),
    updatedAt: timestamp,
    lastError: error
  };
}

export function isEnhancementJobDue(
  job: BookmarkEnhancementJob,
  timestampMs = Date.now()
): boolean {
  const nextAttempt = Date.parse(job.nextAttemptAt);
  return !Number.isFinite(nextAttempt) || nextAttempt <= timestampMs;
}

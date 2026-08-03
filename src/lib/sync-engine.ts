import { getAuthState } from "./auth";
import { restoreCloudAssets, syncCloudAssets } from "./cloud-assets";
import { processOutbox, pullCloudResources } from "./cloud";
import { restoreDurableCloudState, syncDurableCloudState } from "./cloud-state";
import { getOutbox } from "./storage";

export const SYNC_STATUS_KEY = "aarre:sync-status:v1";

export type SyncPhase =
  | "idle"
  | "pulling"
  | "pushing"
  | "assets-up"
  | "assets-down"
  | "error"
  | "paused";

export interface SyncStatus {
  phase: SyncPhase;
  current: number;
  total: number;
  lastSyncedAt: string | null;
  error: string | null;
  nextRetryAt: string | null;
}

const EMPTY_STATUS: SyncStatus = {
  phase: "idle",
  current: 0,
  total: 0,
  lastSyncedAt: null,
  error: null,
  nextRetryAt: null,
};

const BACKOFF_MS = [30_000, 60_000, 120_000, 300_000, 900_000] as const;

function normalizeStatus(value: unknown): SyncStatus {
  const stored = value && typeof value === "object" ? value as Partial<SyncStatus> : {};
  const phase: SyncPhase = ["idle", "pulling", "pushing", "assets-up", "assets-down", "error", "paused"].includes(stored.phase || "")
    ? stored.phase as SyncPhase
    : "idle";
  const storedError = typeof stored.error === "string" ? stored.error : null;
  const error = storedError && /refresh token replay/i.test(storedError)
    ? "云端登录会话已失效，请重新登录后继续同步。"
    : storedError;
  return {
    phase,
    current: typeof stored.current === "number" ? Math.max(0, Math.floor(stored.current)) : 0,
    total: typeof stored.total === "number" ? Math.max(0, Math.floor(stored.total)) : 0,
    lastSyncedAt: typeof stored.lastSyncedAt === "string" ? stored.lastSyncedAt : null,
    error,
    nextRetryAt: typeof stored.nextRetryAt === "string" ? stored.nextRetryAt : null,
  };
}

export async function readSyncStatus(): Promise<SyncStatus> {
  const stored = (await chrome.storage.local.get(SYNC_STATUS_KEY))[SYNC_STATUS_KEY];
  return normalizeStatus(stored);
}

export async function writeSyncStatus(status: SyncStatus): Promise<SyncStatus> {
  const next = normalizeStatus(status);
  await chrome.storage.local.set({ [SYNC_STATUS_KEY]: next });
  try {
    await chrome.runtime.sendMessage({ type: "SYNC_STATUS", status: next });
  } catch {
    // No mounted UI is a normal state for a service worker.
  }
  return next;
}

interface SyncEngineDependencies {
  isReady(): Promise<boolean>;
  pullResources(): Promise<unknown>;
  pullEntities(): Promise<unknown>;
  countOutbox(): Promise<number>;
  pushOutboxBatch(): Promise<{ attempted: number; synced: number; failed: number }>;
  pushEntities(): Promise<unknown>;
  uploadAssets(): Promise<{ uploaded: number; remaining: boolean }>;
  downloadAssets(): Promise<{ restored: number; remaining: boolean }>;
  readStatus(): Promise<SyncStatus>;
  writeStatus(status: SyncStatus): Promise<SyncStatus>;
  now(): number;
}

export interface SyncEngine {
  sync(reason?: string): Promise<void>;
  requestSync(reason: string, debounceMs?: number): void;
  dispose(): void;
}

export function createSyncEngine(dependencies: SyncEngineDependencies): SyncEngine {
  let running: Promise<void> | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let failureCount = 0;

  const status = async (
    phase: SyncPhase,
    current: number,
    total: number,
    overrides: Partial<SyncStatus> = {},
  ) => {
    const previous = await dependencies.readStatus();
    return dependencies.writeStatus({
      ...previous,
      phase,
      current,
      total,
      error: null,
      nextRetryAt: null,
      ...overrides,
    });
  };

  const run = async () => {
    const previous = await dependencies.readStatus();
    const retryAt = previous.nextRetryAt ? Date.parse(previous.nextRetryAt) : 0;
    if (previous.phase === "error" && retryAt > dependencies.now()) return;
    if (!await dependencies.isReady()) {
      await status("paused", 0, 0);
      return;
    }
    try {
      await status("pulling", 0, 2);
      await dependencies.pullResources();
      await status("pulling", 1, 2);
      await dependencies.pullEntities();
      await status("pulling", 2, 2);

      const outboxTotal = await dependencies.countOutbox();
      await status("pushing", 0, outboxTotal + 1);
      let pushed = 0;
      for (let batch = 0; batch < 100; batch += 1) {
        const result = await dependencies.pushOutboxBatch();
        if (!result.attempted) break;
        pushed += result.synced + result.failed;
        await status("pushing", Math.min(pushed, outboxTotal), outboxTotal + 1);
      }
      await dependencies.pushEntities();
      await status("pushing", outboxTotal + 1, outboxTotal + 1);

      let uploaded = 0;
      await status("assets-up", 0, 0);
      for (let batch = 0; batch < 100; batch += 1) {
        const result = await dependencies.uploadAssets();
        uploaded += result.uploaded;
        await status("assets-up", uploaded, result.remaining ? uploaded + 1 : uploaded);
        if (!result.remaining) break;
      }

      let downloaded = 0;
      await status("assets-down", 0, 0);
      for (let batch = 0; batch < 100; batch += 1) {
        const result = await dependencies.downloadAssets();
        downloaded += result.restored;
        await status("assets-down", downloaded, result.remaining ? downloaded + 1 : downloaded);
        if (!result.remaining) break;
      }
      failureCount = 0;
      const completedAt = new Date(dependencies.now()).toISOString();
      await status("idle", 0, 0, { lastSyncedAt: completedAt });
    } catch (caught) {
      const delay = BACKOFF_MS[Math.min(failureCount, BACKOFF_MS.length - 1)];
      failureCount += 1;
      const message = caught instanceof Error ? caught.message : "云端同步失败。";
      await status("error", 0, 0, {
        error: message,
        nextRetryAt: new Date(dependencies.now() + delay).toISOString(),
      });
      throw caught;
    }
  };

  const sync = (_reason = "manual") => {
    if (running) return running;
    running = run().finally(() => { running = null; });
    return running;
  };

  return {
    sync,
    requestSync(reason, debounceMs = 0) {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        void sync(reason).catch(() => undefined);
      }, Math.max(0, debounceMs));
    },
    dispose() {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = null;
    },
  };
}

const defaultEngine = createSyncEngine({
  async isReady() {
    const auth = await getAuthState();
    return auth.configured && auth.signedIn && auth.accountMatches === true;
  },
  pullResources: pullCloudResources,
  pullEntities: () => restoreDurableCloudState({ skipCloudScope: true }),
  countOutbox: async () => (await getOutbox()).length,
  pushOutboxBatch: processOutbox,
  pushEntities: syncDurableCloudState,
  uploadAssets: () => syncCloudAssets(),
  downloadAssets: () => restoreCloudAssets(),
  readStatus: readSyncStatus,
  writeStatus: writeSyncStatus,
  now: () => Date.now(),
});

export const sync = (reason?: string) => defaultEngine.sync(reason);
export const requestSync = (reason: string, debounceMs?: number) =>
  defaultEngine.requestSync(reason, debounceMs);

import type { SnapshotBackfillLease } from "../../lib/snapshot-backfill";
import {
  cleanupDuplicateAutomaticVisuals,
  migrateLegacyVisualsBatch
} from "../../lib/visuals";
import { cleanupExpiredUndoSnapshots } from "../../lib/storage";

export const PERIODIC_SYNC_ALARM = "bookmark-layer-sync";
export const LIBRARY_SCAN_ALARM = "aarre-library-scan";
export const BOOKMARK_ENHANCEMENT_ALARM = "aarre-bookmark-enhancements";
export const SNAPSHOT_BACKFILL_TIMEOUT_ALARM =
  "aarre-snapshot-backfill-timeout";
export const VISUAL_MIGRATION_ALARM = "aarre-visual-migration";
export const DAILY_MAINTENANCE_ALARM = "daily-maintenance";

export function scheduleVisualMigration(delayInMinutes = 0.1): Promise<void> {
  return chrome.alarms.create(VISUAL_MIGRATION_ALARM, {
    delayInMinutes: Math.max(0.1, delayInMinutes)
  });
}

export function ensureVisualCleanupAlarm(): Promise<void> {
  return chrome.alarms.create(DAILY_MAINTENANCE_ALARM, {
    delayInMinutes: 24 * 60,
    periodInMinutes: 24 * 60
  });
}

export function ensurePeriodicSyncAlarm(): Promise<void> {
  return chrome.alarms.create(PERIODIC_SYNC_ALARM, {
    delayInMinutes: 1,
    periodInMinutes: 1
  });
}

export function scheduleBookmarkEnhancements(
  delayInMinutes = 1
): Promise<void> {
  return chrome.alarms.create(BOOKMARK_ENHANCEMENT_ALARM, {
    delayInMinutes: Math.max(0.5, delayInMinutes)
  });
}

export function scheduleLibraryScan(): Promise<void> {
  return chrome.alarms.create(LIBRARY_SCAN_ALARM, {
    delayInMinutes: 0.1,
    periodInMinutes: 0.5
  });
}

function snapshotBackfillTimeoutAlarmName(
  lease: SnapshotBackfillLease
): string {
  return `${SNAPSHOT_BACKFILL_TIMEOUT_ALARM}:${lease.jobId}:${lease.token}`;
}

export function snapshotBackfillTimeoutIdentity(
  alarmName: string
): { jobId: string; token: string } | undefined {
  const prefix = `${SNAPSHOT_BACKFILL_TIMEOUT_ALARM}:`;
  if (!alarmName.startsWith(prefix)) return undefined;
  const [jobId, token, extra] = alarmName.slice(prefix.length).split(":");
  if (!jobId || !token || extra) return undefined;
  return { jobId, token };
}

export async function clearSnapshotBackfillTimeouts(
  jobId: string
): Promise<void> {
  await chrome.alarms.clear(SNAPSHOT_BACKFILL_TIMEOUT_ALARM);
  const prefix = `${SNAPSHOT_BACKFILL_TIMEOUT_ALARM}:${jobId}:`;
  const alarms = await chrome.alarms.getAll().catch(() => []);
  await Promise.all(
    alarms
      .filter((alarm) => alarm.name.startsWith(prefix))
      .map((alarm) => chrome.alarms.clear(alarm.name))
  );
}

export async function clearSnapshotBackfillTimeout(
  lease: SnapshotBackfillLease
): Promise<void> {
  await chrome.alarms.clear(snapshotBackfillTimeoutAlarmName(lease));
}

export function scheduleSnapshotBackfillTimeout(
  lease: SnapshotBackfillLease,
  delayInMinutes = 0.75
): Promise<void> {
  return chrome.alarms.create(snapshotBackfillTimeoutAlarmName(lease), {
    delayInMinutes
  });
}

interface AlarmLifecycleDependencies {
  requestSync(reason: string): void;
  runLibraryScan(): Promise<unknown>;
  processBookmarkEnhancements(): Promise<unknown>;
  recoverSnapshotBackfill(): Promise<unknown>;
  timeoutOrFailSnapshotBackfillCurrent(
    message: string,
    identity: { jobId: string; token: string }
  ): Promise<unknown>;
}

export function createAlarmHandler(
  dependencies: AlarmLifecycleDependencies
): (alarm: chrome.alarms.Alarm) => void {
  return (alarm) => {
    if (alarm.name === PERIODIC_SYNC_ALARM) {
      dependencies.requestSync("periodic-alarm");
    } else if (alarm.name === LIBRARY_SCAN_ALARM) {
      void dependencies.runLibraryScan();
    } else if (alarm.name === BOOKMARK_ENHANCEMENT_ALARM) {
      void dependencies.processBookmarkEnhancements();
    } else if (alarm.name === VISUAL_MIGRATION_ALARM) {
      void migrateLegacyVisualsBatch().then((result) => {
        if (result.remaining) void scheduleVisualMigration();
      });
    } else if (alarm.name === DAILY_MAINTENANCE_ALARM) {
      void Promise.all([
        cleanupDuplicateAutomaticVisuals(),
        cleanupExpiredUndoSnapshots()
      ]);
    } else if (alarm.name === SNAPSHOT_BACKFILL_TIMEOUT_ALARM) {
      // 兼容升级前遗留的无身份 alarm：只恢复状态，不允许它直接推进任何
      // 新 job/attempt。新的 alarm 一律携带 jobId + lease。
      void dependencies.recoverSnapshotBackfill();
    } else {
      const timeout = snapshotBackfillTimeoutIdentity(alarm.name);
      if (timeout) {
        void dependencies.timeoutOrFailSnapshotBackfillCurrent(
          "网页在限定时间内没有完成稳定加载。",
          timeout
        );
      }
    }
  };
}

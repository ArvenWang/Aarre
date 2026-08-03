import type { ResourceRecord } from "./types";

/**
 * 参与云端同步的字段。顺序无关，但必须与 resourceCloudPayload 上传的字段保持一致，
 * 否则字段级裁决会退化：漏掉的字段会跟着记录级 updatedAt 走。
 */
export const SYNCED_FIELDS = [
  "canonicalUrl",
  "summary",
  "userNote",
  "tags",
  "tagsSource",
  "topics",
  "aliases",
  "useCases",
  "contentType",
  "questions",
  "entities",
  "aiSchemaVersion",
  "selectedText",
  "author",
  "siteName",
  "language",
  "contentHash",
  "linkHealth",
  "coverSource",
  "coverUpdatedAt",
  "coverOrigin",
  "coverContentHash",
  "categoryCoverId"
] as const satisfies readonly (keyof ResourceRecord)[];

export type SyncedField = (typeof SYNCED_FIELDS)[number];

/**
 * 空值代表「这台设备没有这份内容」，而不是「这台设备认为该内容应为空」。
 * 合并时空值一律不参与覆盖，多端才能互相补齐缺失的部分。
 */
export function isEmptyFieldValue(value: unknown): boolean {
  if (value === undefined || value === null || value === "") return true;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function serializeField(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/**
 * 同一字段的时钟必须单调递增。同一毫秒内连续写入、或本地时钟回拨时，
 * 直接采用 stamp 会让这次修改的时钟不大于上一次，云端比较时就会静默丢弃它。
 */
function advanceClock(previous: string | undefined, stamp: string): string {
  if (!previous || stamp > previous) return stamp;
  const parsed = Date.parse(previous);
  return Number.isNaN(parsed)
    ? stamp
    : new Date(parsed + 1).toISOString();
}

/**
 * 对比新旧记录，只为真正发生变化的字段推进时钟。
 *
 * 这是整套字段级合并的地基：时钟必须反映「该字段最后一次被改动」的时间。
 * 若每次同步都把所有字段刷成当前时间，一台设备的无关改动（例如重新截图）
 * 就会连带让它那份过时的摘要赢过另一台设备的新摘要。
 */
export function deriveFieldClocks(
  previous: ResourceRecord | undefined,
  next: ResourceRecord
): Record<string, string> {
  const stamp = next.updatedAt || new Date().toISOString();
  const clocks: Record<string, string> = { ...(next.fieldUpdatedAt || previous?.fieldUpdatedAt || {}) };
  for (const field of SYNCED_FIELDS) {
    const after = serializeField(next[field]);
    if (!previous) {
      clocks[field] = clocks[field] || stamp;
      continue;
    }
    if (serializeField(previous[field]) === after) {
      clocks[field] = clocks[field] || stamp;
      continue;
    }
    clocks[field] = advanceClock(clocks[field], stamp);
  }
  return clocks;
}

export interface FieldMergeResult {
  record: ResourceRecord;
  /** 本地存在云端没有或更新的字段，需要回传才能让云端补齐。 */
  localHasUnsyncedFields: boolean;
}

/**
 * 按字段时钟合并本地与云端记录，得到两端内容的并集。
 *
 * 规则依次为：
 * 1. 云端该字段为空 → 保留本地（云端只是没有，不代表要清空）。
 * 2. 用户显式指定的封面优先于自动采集的封面，不看时间。
 * 3. 其余字段比较字段时钟，较新者胜出。
 */
export function mergeResourceByFieldClocks(
  local: ResourceRecord | undefined,
  remote: ResourceRecord,
  remoteClocks: Record<string, string> = {}
): FieldMergeResult {
  const remoteResolved = { ...remote.fieldUpdatedAt, ...remoteClocks };
  if (!local) {
    return {
      record: { ...remote, fieldUpdatedAt: deriveFieldClocks(undefined, { ...remote, fieldUpdatedAt: remoteResolved }) },
      localHasUnsyncedFields: false
    };
  }

  const localClocks = local.fieldUpdatedAt || {};
  const merged: ResourceRecord = { ...local };
  const writable = merged as unknown as Record<string, unknown>;
  const clocks: Record<string, string> = { ...localClocks };
  let localHasUnsyncedFields = false;

  for (const field of SYNCED_FIELDS) {
    const remoteValue = remote[field];
    const localValue = local[field];
    const remoteClock = remoteResolved[field] || remote.updatedAt || "";
    const localClock =
      localClocks[field] ||
      (isEmptyFieldValue(localValue) ? "" : local.updatedAt || "");

    if (isEmptyFieldValue(remoteValue)) {
      if (!isEmptyFieldValue(localValue)) localHasUnsyncedFields = true;
      continue;
    }
    if (userCoverWins(field, local, remote)) {
      localHasUnsyncedFields = true;
      continue;
    }
    if (remoteClock >= localClock) {
      writable[field] = remoteValue;
      clocks[field] = remoteClock;
      continue;
    }
    localHasUnsyncedFields = true;
  }

  return {
    record: { ...merged, fieldUpdatedAt: clocks },
    localHasUnsyncedFields
  };
}

/**
 * 用户手动截取或指定的封面代表明确意图，自动抓取的封面无论多新都不能顶掉它。
 * 只有另一端同样是用户设定时，才回落到字段时钟比较。
 */
function userCoverWins(
  field: SyncedField,
  local: ResourceRecord,
  remote: ResourceRecord
): boolean {
  if (!field.startsWith("cover") && field !== "categoryCoverId") return false;
  return local.coverOrigin === "user" && remote.coverOrigin !== "user";
}

import { describe, expect, it } from "vitest";
import {
  AI_METADATA_SCHEMA_VERSION,
  hasCompleteAiFields,
  needsAiEnrichment
} from "./ai-fields";
import { bookmarkItemIdFor } from "./cloud-state";
import { mergeResourceByFieldClocks } from "./field-clocks";
import type { ResourceRecord } from "./types";

const EARLY = "2026-08-01T00:00:00.000Z";
const LATE = "2026-08-02T00:00:00.000Z";

function resource(overrides: Partial<ResourceRecord> = {}): ResourceRecord {
  return {
    resourceKey: "a".repeat(64),
    canonicalUrl: "https://example.com/",
    url: "https://example.com/",
    title: "Example",
    userNote: "",
    summary: "",
    tags: [],
    topics: [],
    contentExcerpt: "",
    contentHash: "",
    selectedText: "",
    author: "",
    siteName: "",
    language: "",
    imageUrl: "",
    faviconUrl: "",
    nativeBookmarkIds: [],
    nativeFolderPath: [],
    aiStatus: "not_requested",
    syncStatus: "local",
    createdAt: EARLY,
    updatedAt: EARLY,
    ...overrides
  };
}

/**
 * 两台设备通过云端同步同一份收藏。这里模拟一个来回：
 * 各自把本地记录推上去，再把对方的结果拉回来。
 */
function roundTrip(
  deviceA: ResourceRecord,
  deviceB: ResourceRecord
): { a: ResourceRecord; b: ResourceRecord } {
  const cloudAfterA = mergeResourceByFieldClocks(undefined, deviceA).record;
  const cloudAfterB = mergeResourceByFieldClocks(cloudAfterA, deviceB).record;
  return {
    a: mergeResourceByFieldClocks(deviceA, cloudAfterB).record,
    b: mergeResourceByFieldClocks(deviceB, cloudAfterB).record
  };
}

describe("bookmarkItemIdFor", () => {
  it("derives the same identifier on every device for the same bookmark", async () => {
    const onDeviceA = await bookmarkItemIdFor("resource-key", ["工作", "设计"]);
    const onDeviceB = await bookmarkItemIdFor("resource-key", ["工作", "设计"]);
    expect(onDeviceA).toBe(onDeviceB);
  });

  it("ignores incidental whitespace and empty folder segments", async () => {
    const tidy = await bookmarkItemIdFor("resource-key", ["工作", "设计"]);
    const messy = await bookmarkItemIdFor("resource-key", [" 工作 ", "", "设计"]);
    expect(messy).toBe(tidy);
  });

  it("separates the same page filed under different folders", async () => {
    const inWork = await bookmarkItemIdFor("resource-key", ["工作"]);
    const inRead = await bookmarkItemIdFor("resource-key", ["稍后读"]);
    expect(inWork).not.toBe(inRead);
  });

  it("separates different pages filed under the same folder", async () => {
    const first = await bookmarkItemIdFor("resource-a", ["工作"]);
    const second = await bookmarkItemIdFor("resource-b", ["工作"]);
    expect(first).not.toBe(second);
  });
});

describe("two-device convergence", () => {
  it("combines what each device knows instead of one erasing the other", () => {
    const deviceA = resource({
      summary: "A 生成的摘要",
      fieldUpdatedAt: { summary: LATE }
    });
    const deviceB = resource({
      userNote: "B 写的备注",
      tags: ["设计", "工具"],
      fieldUpdatedAt: { userNote: LATE, tags: LATE }
    });

    const { a, b } = roundTrip(deviceA, deviceB);

    for (const device of [a, b]) {
      expect(device.summary).toBe("A 生成的摘要");
      expect(device.userNote).toBe("B 写的备注");
      expect(device.tags).toEqual(["设计", "工具"]);
    }
  });

  it("reaches the same state no matter which device syncs first", () => {
    const deviceA = resource({
      summary: "A 摘要",
      author: "A 作者",
      fieldUpdatedAt: { summary: LATE, author: EARLY }
    });
    const deviceB = resource({
      summary: "B 摘要",
      userNote: "B 备注",
      fieldUpdatedAt: { summary: EARLY, userNote: LATE }
    });

    const aFirst = roundTrip(deviceA, deviceB);
    const bFirst = roundTrip(deviceB, deviceA);

    expect(aFirst.a.summary).toBe("A 摘要");
    expect(bFirst.a.summary).toBe("A 摘要");
    expect(aFirst.a.userNote).toBe(bFirst.a.userNote);
    expect(aFirst.a.author).toBe(bFirst.a.author);
  });

  it("protects a hand-picked cover from an automatically captured one", () => {
    const withUserCover = resource({
      coverSource: "user-capture",
      coverOrigin: "user",
      coverContentHash: "user-hash",
      fieldUpdatedAt: { coverSource: EARLY, coverOrigin: EARLY }
    });
    const withAutoCover = resource({
      coverSource: "og-image",
      coverOrigin: "auto",
      coverContentHash: "auto-hash",
      fieldUpdatedAt: { coverSource: LATE, coverOrigin: LATE }
    });

    const { a } = roundTrip(withUserCover, withAutoCover);

    expect(a.coverOrigin).toBe("user");
    expect(a.coverContentHash).toBe("user-hash");
  });

  it("keeps an empty device from wiping the device that holds the data", () => {
    const populated = resource({
      summary: "完整摘要",
      userNote: "完整备注",
      tags: ["标签"],
      fieldUpdatedAt: { summary: EARLY, userNote: EARLY, tags: EARLY }
    });
    const freshInstall = resource({ updatedAt: LATE });

    const { a } = roundTrip(populated, freshInstall);

    expect(a.summary).toBe("完整摘要");
    expect(a.userNote).toBe("完整备注");
    expect(a.tags).toEqual(["标签"]);
  });

  /**
   * aiStatus 不参与云端同步，合并又以本地记录为基底，因此 mergeLocalResources
   * 必须按合并结果重新判定它。漏掉这一步，收到云端摘要的设备仍会认为这条
   * 收藏欠一次 AI 调用，对同一个网页重复付费并覆盖对方已经写好的摘要。
   */
  it("stops asking for AI once the cloud has supplied a complete enrichment", () => {
    const enriched = resource({
      summary: "A 生成的摘要",
      tags: ["工具"],
      tagsSource: "ai",
      topics: ["效率"],
      aliases: ["别名"],
      useCases: ["查资料时打开"],
      contentType: "工具",
      questions: ["这个工具怎么用？"],
      aiSchemaVersion: AI_METADATA_SCHEMA_VERSION,
      aiStatus: "ready",
      fieldUpdatedAt: { summary: LATE }
    });
    const notYetEnriched = resource({ aiStatus: "not_requested" });

    const { record } = mergeResourceByFieldClocks(notYetEnriched, enriched);
    const afterMerge: ResourceRecord = {
      ...record,
      aiStatus: hasCompleteAiFields(record) ? "ready" : record.aiStatus
    };

    expect(hasCompleteAiFields(record)).toBe(true);
    expect(needsAiEnrichment(afterMerge)).toBe(false);
  });

  it("still asks for AI when the cloud only supplied part of the enrichment", () => {
    const partial = resource({
      summary: "只有摘要",
      fieldUpdatedAt: { summary: LATE }
    });
    const notYetEnriched = resource({ aiStatus: "not_requested" });

    const { record } = mergeResourceByFieldClocks(notYetEnriched, partial);

    expect(hasCompleteAiFields(record)).toBe(false);
    expect(needsAiEnrichment(record)).toBe(true);
  });

  it("propagates a deliberate edit rather than treating it as missing data", () => {
    const edited = resource({
      tags: ["保留"],
      fieldUpdatedAt: { tags: LATE }
    });
    const stale = resource({
      tags: ["保留", "已删除"],
      fieldUpdatedAt: { tags: EARLY }
    });

    const { a, b } = roundTrip(edited, stale);

    expect(a.tags).toEqual(["保留"]);
    expect(b.tags).toEqual(["保留"]);
  });
});

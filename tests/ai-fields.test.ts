import { describe, expect, it } from "vitest";
import {
  hasCompleteAiFields,
  missingAiFields,
  needsAiEnrichment,
  normalizeContentType,
  preservedAiRetrievalFields
} from "../src/lib/ai-fields";
import type { ResourceRecord } from "../src/lib/types";

const complete: ResourceRecord = {
  resourceKey: "complete",
  canonicalUrl: "https://example.com/a",
  url: "https://example.com/a",
  title: "完整记录",
  userNote: "",
  summary: "一段摘要。",
  tags: ["标签"],
  topics: ["主题"],
  aliases: ["别名"],
  useCases: ["场景"],
  contentType: "工具",
  questions: ["怎么用"],
  entities: ["Aarre"],
  aiSchemaVersion: 2,
  contentExcerpt: "",
  contentHash: "hash",
  selectedText: "",
  author: "",
  siteName: "",
  language: "zh-CN",
  imageUrl: "",
  faviconUrl: "",
  nativeBookmarkIds: ["1"],
  nativeFolderPath: ["书签栏"],
  aiStatus: "ready",
  syncStatus: "local",
  createdAt: "2026-07-29T00:00:00.000Z",
  updatedAt: "2026-07-29T00:00:00.000Z"
};

describe("AI field completeness", () => {
  it("treats a fully enriched record as done so a scan never re-bills it", () => {
    expect(hasCompleteAiFields(complete)).toBe(true);
    expect(needsAiEnrichment(complete)).toBe(false);
  });

  it("reports records enriched before the new fields existed as incomplete", () => {
    const legacy: ResourceRecord = {
      ...complete,
      useCases: undefined,
      contentType: undefined,
      questions: undefined,
      entities: undefined,
      aiSchemaVersion: undefined
    };

    // aiStatus 仍是 ready，光看状态会漏掉它们——这正是增量补齐要覆盖的存量。
    expect(legacy.aiStatus).toBe("ready");
    expect(missingAiFields(legacy)).toEqual([
      "useCases",
      "contentType",
      "questions",
      "schemaVersion"
    ]);
    expect(needsAiEnrichment(legacy)).toBe(true);
  });

  it("accepts an intentionally empty entity list on the current schema", () => {
    expect(
      hasCompleteAiFields({
        ...complete,
        entities: []
      })
    ).toBe(true);
  });

  it("copies the retrieval contract as one unit during bookmark re-indexing", () => {
    expect(preservedAiRetrievalFields(complete)).toEqual({
      aliases: ["别名"],
      useCases: ["场景"],
      contentType: "工具",
      questions: ["怎么用"],
      entities: ["Aarre"],
      aiSchemaVersion: 2
    });
  });

  it("re-runs everything only when the user explicitly forces a rescan", () => {
    expect(needsAiEnrichment(complete, true)).toBe(true);
  });

  it("rejects a content type outside the allowed list", () => {
    expect(normalizeContentType("教程")).toBe("教程");
    expect(normalizeContentType(" 工具 ")).toBe("工具");
    expect(normalizeContentType("自己发明的类型")).toBe("");
    expect(normalizeContentType(42)).toBe("");
    expect(
      missingAiFields({ ...complete, contentType: "模型自造类型" })
    ).toContain("contentType");
  });
});

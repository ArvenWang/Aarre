import type { ResourceRecord } from "./types";

export const AI_CONTENT_TYPES = [
  "工具",
  "文档",
  "教程",
  "文章",
  "视频",
  "代码仓库",
  "产品",
  "社区",
  "论文",
  "数据集",
  "课程",
  "其他"
] as const;

export type AiContentType = (typeof AI_CONTENT_TYPES)[number];

export const AI_METADATA_SCHEMA_VERSION = 2;

type AiRetrievalFields = Pick<
  ResourceRecord,
  | "aliases"
  | "useCases"
  | "contentType"
  | "questions"
  | "entities"
  | "aiSchemaVersion"
>;

/** Keep the complete retrieval contract together whenever a Chrome bookmark is
 * re-indexed. Copying these fields ad hoc caused newer metadata to disappear
 * while older summary/tag fields survived. */
export function preservedAiRetrievalFields(
  resource?: ResourceRecord
): AiRetrievalFields {
  return {
    aliases: resource?.aliases,
    useCases: resource?.useCases,
    contentType: resource?.contentType,
    questions: resource?.questions,
    entities: resource?.entities,
    aiSchemaVersion: resource?.aiSchemaVersion
  };
}

export function normalizeContentType(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return (AI_CONTENT_TYPES as readonly string[]).includes(trimmed)
    ? trimmed
    : "";
}

/** Records enriched before the useCases/contentType/questions fields
 *  existed still report `aiStatus: "ready"`. The backfill task uses this to
 *  find them without re-running anything that is already complete. */
export function missingAiFields(resource: ResourceRecord): string[] {
  const missing: string[] = [];
  if (!resource.summary?.trim()) missing.push("summary");
  if (!resource.tags?.length) missing.push("tags");
  if (!resource.topics?.length) missing.push("topics");
  if (!resource.aliases?.length) missing.push("aliases");
  if (!resource.useCases?.length) missing.push("useCases");
  if (!normalizeContentType(resource.contentType)) missing.push("contentType");
  if (!resource.questions?.length) missing.push("questions");
  // A page can legitimately contain no named entity. Schema version records
  // that the current contract was attempted without forcing a paid rescan.
  if ((resource.aiSchemaVersion || 0) < AI_METADATA_SCHEMA_VERSION) {
    missing.push("schemaVersion");
  }
  return missing;
}

export function hasCompleteAiFields(resource: ResourceRecord): boolean {
  return missingAiFields(resource).length === 0;
}

/** Single definition of "this bookmark still owes us an AI call", shared by the
 *  save path, the library scan and the backfill so they cannot disagree about
 *  what counts as done — disagreement is what makes a scan re-bill work it has
 *  already paid for. */
export function needsAiEnrichment(
  resource: ResourceRecord,
  force = false
): boolean {
  return (
    force || resource.aiStatus !== "ready" || !hasCompleteAiFields(resource)
  );
}

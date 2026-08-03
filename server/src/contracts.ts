import { z } from "zod";

const shortText = z.string().max(512);
const timestamp = z.string().datetime({ offset: true });
const stringList = (maximum: number, itemLength = 240) =>
  z.array(z.string().min(1).max(itemLength)).max(maximum);

const linkHealthSchema = z.object({
  status: z.enum(["healthy", "login_required", "temporary", "dead", "soft_404"]),
  checkedAt: timestamp,
  consecutiveFailures: z.number().int().min(0).max(10_000),
  httpStatus: z.number().int().min(100).max(599).optional(),
  finalUrl: z.string().url().max(4_096).optional(),
  reason: z.string().max(240).optional()
}).strict();

export const resourcePayloadSchema = z.object({
  canonicalUrl: z.string().url().max(8_192),
  summary: z.string().max(12_000).optional(),
  userNote: z.string().max(12_000).optional(),
  tags: stringList(80).optional(),
  tagsSource: z.enum(["ai", "user"]).optional(),
  topics: stringList(40).optional(),
  aliases: stringList(40, 4_096).optional(),
  useCases: stringList(40, 1_000).optional(),
  contentType: z.string().max(160).optional(),
  questions: stringList(60, 1_000).optional(),
  entities: stringList(120, 240).optional(),
  aiSchemaVersion: z.number().int().min(1).max(10_000).optional(),
  selectedText: z.string().max(8_192).optional(),
  author: shortText.optional(),
  siteName: shortText.optional(),
  language: z.string().max(40).optional(),
  contentHash: z.string().max(256).optional(),
  linkHealth: linkHealthSchema.optional(),
  coverSource: z.string().max(120).optional(),
  coverUpdatedAt: timestamp.optional(),
  coverOrigin: z.enum(["user", "auto"]).optional(),
  coverContentHash: z.string().max(256).optional(),
  categoryCoverId: z.string().max(120).optional(),
  createdAt: timestamp,
  updatedAt: timestamp
}).strict();

export type ResourcePayload = z.infer<typeof resourcePayloadSchema>;

export const resourceMutationSchema = z.object({
  operationId: z.string().uuid(),
  clientRevision: z.string().min(1).max(160),
  baseRevision: z.number().int().min(0).default(0),
  payload: resourcePayloadSchema,
  fieldUpdatedAt: z.record(z.string().max(80), timestamp).default({}),
  deleted: z.boolean().default(false)
}).strict();

export const conflictResolutionSchema = z.object({
  operationId: z.string().uuid(),
  resolution: z.enum(["current", "incoming", "merged"]),
  mergedUserNote: z.string().max(12_000).optional(),
  mergedTags: stringList(80).optional()
}).strict().superRefine((value, context) => {
  if (
    value.resolution === "merged" &&
    value.mergedUserNote === undefined &&
    value.mergedTags === undefined
  ) {
    context.addIssue({
      code: "custom",
      message: "A merged resolution must include a note or tags."
    });
  }
});

export const syncCursorSchema = z.object({
  cursor: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(500).default(200)
});

export const assetCreateSchema = z.object({
  assetId: z.string().uuid(),
  operationId: z.string().uuid(),
  resourceKey: z.string().regex(/^[a-f0-9]{64}$/),
  kind: z.enum(["cover", "snapshot", "site-icon", "user-cover"]),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  byteSize: z.number().int().min(1).max(20 * 1024 * 1024),
  width: z.number().int().min(1).max(16_384).optional(),
  height: z.number().int().min(1).max(16_384).optional(),
  mimeType: z.enum(["image/webp", "image/png", "image/jpeg", "image/gif"]),
  capturedAt: timestamp.optional(),
  binding: z.object({
    canonicalUrl: z.string().url().max(8_192).optional(),
    host: z.string().max(253).optional(),
    iconRenderVersion: z.number().int().min(1).max(1_000).optional(),
    iconAssetUrl: z.string().url().max(2_000).optional(),
    coverOrigin: z.enum(["user", "auto"]).optional()
  }).strict().optional()
}).strict().superRefine((value, context) => {
  if (value.kind === "snapshot" && !value.binding?.canonicalUrl) {
    context.addIssue({ code: "custom", path: ["binding", "canonicalUrl"], message: "Snapshot assets require a canonical URL binding." });
  }
  if (value.kind === "site-icon" && !value.binding?.host) {
    context.addIssue({ code: "custom", path: ["binding", "host"], message: "Site icon assets require a host binding." });
  }
});

export const assetCompleteSchema = z.object({
  operationId: z.string().uuid()
}).strict();

export const protectionRuleSchema = z.discriminatedUnion("kind", [
  z.object({
    ruleId: z.string().uuid(),
    kind: z.literal("resource"),
    resourceKey: z.string().regex(/^[a-f0-9]{64}$/),
    updatedAt: timestamp,
    deleted: z.boolean().default(false)
  }).strict(),
  z.object({
    ruleId: z.string().uuid(),
    kind: z.literal("folder"),
    path: stringList(32, 240),
    parentPath: stringList(32, 240),
    title: z.string().min(1).max(240),
    resourceKeys: z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(5_000).default([]),
    createdAt: timestamp,
    updatedAt: timestamp,
    deleted: z.boolean().default(false)
  }).strict()
]);

const sourceSchema = z.object({
  resourceKey: z.string().regex(/^[a-f0-9]{64}$/),
  title: z.string().max(1_000),
  url: z.string().url().max(8_192),
  siteName: z.string().max(512),
  faviconUrl: z.string().max(8_192)
}).strict();

const actionSchema = z.object({
  id: z.string().max(160),
  type: z.enum([
    "create_bookmark",
    "create_folder",
    "delete_bookmark",
    "delete_folder",
    "update_bookmark",
    "rename_folder",
    "move_bookmark",
    "move_folder",
    "update_metadata"
  ]),
  label: z.string().max(500),
  description: z.string().max(2_000),
  destructive: z.boolean(),
  status: z.enum(["pending", "executing", "completed", "failed", "cancelled"]),
  resourceKey: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  resultMessage: z.string().max(2_000).optional()
}).strip();

const conversationMessageSchema = z.object({
  id: z.string().max(160),
  role: z.enum(["user", "assistant"]),
  content: z.string().max(12_000),
  createdAt: timestamp,
  providerName: z.string().max(240).optional(),
  sources: z.array(sourceSchema).max(20).optional(),
  actions: z.array(actionSchema).max(40).optional(),
  status: z.enum(["complete", "failed", "cancelled"]).optional()
}).strict();

export const conversationSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(80),
  createdAt: timestamp,
  updatedAt: timestamp,
  messages: z.array(conversationMessageSchema).max(60)
}).strict();

export const displaySettingSchema = z.object({
  listCoverStyle: z.enum(["site", "page"]),
  pageSnapshotsEnabled: z.literal(true),
  snapshotExcludedHosts: stringList(100, 253),
  scanCostLimitCny: z.number().min(0.01).max(10_000)
}).strict();

export const aiModelSettingSchema = z.object({
  provider: z.enum(["gemini", "openai", "deepseek"]),
  models: z.record(
    z.enum(["gemini", "openai", "deepseek"]),
    z.string().min(1).max(240)
  )
}).strict();

export const cloudScopeSettingSchema = z.object({
  scope: z.enum(["text", "complete"]),
  enabled: z.boolean(),
  updatedAt: timestamp
}).strict();

export const themeSettingSchema = z.object({
  mode: z.enum(["light", "dark"])
}).strict();

export const usagePeriodSchema = z.object({
  period: z.string().regex(/^\d{4}-\d{2}$/),
  provider: z.enum(["gemini", "openai", "deepseek"]),
  model: z.string().max(240),
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  cachedInputTokens: z.number().int().min(0),
  estimatedTokens: z.number().int().min(0),
  estimatedCostCny: z.number().min(0),
  scanCount: z.number().int().min(0),
  priceUpdatedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  updatedAt: timestamp
}).strict();

export const entityMutationSchema = z.object({
  operationId: z.string().uuid(),
  entityType: z.enum([
    "bookmark-item",
    "protection-rule",
    "setting-display",
    "setting-ai-models",
    "setting-cloud-scope",
    "setting-theme",
    "conversation",
    "report",
    "usage-period",
    "operation-history"
  ]),
  entityId: z.string().min(1).max(200),
  updatedAt: timestamp,
  payload: z.unknown(),
  deleted: z.boolean().default(false)
}).strict();

const forbiddenField = /(?:api.?key|access.?token|refresh.?token|password|cookie|contentexcerpt|nativebookmarkid|nativefolderid|targetid|parentid|destinationid|creatednodeid|progress)/i;

export function assertNoForbiddenFields(value: unknown, path = "payload"): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoForbiddenFields(item, `${path}[${index}]`));
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (forbiddenField.test(key)) {
      throw new Error(`Cloud payload contains a forbidden field at ${path}.${key}.`);
    }
    assertNoForbiddenFields(child, `${path}.${key}`);
  }
}

export function jsonByteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

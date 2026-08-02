import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
import {
  aiModelSettingSchema,
  assertNoForbiddenFields,
  cloudScopeSettingSchema,
  conflictResolutionSchema,
  conversationSchema,
  displaySettingSchema,
  entityMutationSchema,
  jsonByteLength,
  protectionRuleSchema,
  themeSettingSchema,
  type ResourcePayload,
  resourceMutationSchema,
  usagePeriodSchema
} from "./contracts.js";
import type { Database } from "./db.js";
import type { EnvelopeEncryption } from "./encryption.js";
import type { AuthenticatedAccount } from "./auth.js";

type ResourceMutation = z.infer<typeof resourceMutationSchema>;
type EntityMutation = z.infer<typeof entityMutationSchema>;

type CloudResource = {
  resourceKey: string;
  payload: ResourcePayload;
  revision: number;
  fieldUpdatedAt: Record<string, string>;
  deleted: boolean;
  sequence?: number;
  conflictCount?: number;
};

type ConflictField = "userNote" | "tags";

type ConflictPayload = {
  resourceKey: string;
  fields: Array<{
    field: ConflictField;
    current: string | string[];
    incoming: string | string[];
  }>;
  createdAt: string;
};

export type CloudConflict = ConflictPayload & {
  conflictId: string;
  baseRevision: number;
  serverRevision: number;
  status?: "pending" | "resolved";
  resolution?: "current" | "incoming" | "merged" | null;
};

const bookmarkItemSchema = z.object({
  bookmarkItemId: z.string().uuid(),
  resourceKey: z.string().regex(/^[a-f0-9]{64}$/),
  userNote: z.string().max(12_000).default(""),
  tags: z.array(z.string().min(1).max(240)).max(80).default([]),
  bindingHint: z.object({
    title: z.string().max(1_000),
    url: z.string().url().max(8_192),
    folderPath: z.array(z.string().max(240)).max(32)
  }).strict(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true })
}).strict();

const reportSchema = z.object({
  reportId: z.string().uuid(),
  kind: z.string().min(1).max(120),
  title: z.string().min(1).max(500),
  generatedAt: z.string().datetime({ offset: true }),
  summary: z.string().max(24_000).optional(),
  data: z.unknown()
}).strict();

const operationHistorySchema = z.object({
  operationId: z.string().uuid(),
  kind: z.string().min(1).max(120),
  label: z.string().min(1).max(500),
  result: z.string().max(4_000),
  resourceKeys: z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(500),
  createdAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true })
}).strict();

function mergeResourceFields(
  existing: ResourcePayload | null,
  existingClocks: Record<string, string>,
  incoming: ResourcePayload,
  incomingClocks: Record<string, string>
): { payload: ResourcePayload; clocks: Record<string, string> } {
  if (!existing) {
    const clocks = Object.fromEntries(
      Object.keys(incoming).map((key) => [key, incomingClocks[key] || incoming.updatedAt])
    );
    return { payload: incoming, clocks };
  }
  const merged: Record<string, unknown> = { ...existing };
  const clocks = { ...existingClocks };
  for (const [field, value] of Object.entries(incoming)) {
    const incomingClock = incomingClocks[field] || incoming.updatedAt;
    const currentClock = clocks[field] || existing.updatedAt;
    if (incomingClock >= currentClock) {
      merged[field] = value;
      clocks[field] = incomingClock;
    }
  }
  return { payload: merged as ResourcePayload, clocks };
}

function resourceConflictPayload(
  resourceKey: string,
  existing: ResourcePayload | null,
  incoming: ResourcePayload,
  baseRevision: number,
  serverRevision: number
): ConflictPayload | null {
  if (!existing || baseRevision >= serverRevision) return null;
  const fields: ConflictPayload["fields"] = [];
  const currentNote = existing.userNote || "";
  const incomingNote = incoming.userNote || "";
  if (currentNote !== incomingNote) {
    fields.push({ field: "userNote", current: currentNote, incoming: incomingNote });
  }
  const currentTags = [...new Set(existing.tags || [])].sort();
  const incomingTags = [...new Set(incoming.tags || [])].sort();
  if (JSON.stringify(currentTags) !== JSON.stringify(incomingTags)) {
    fields.push({ field: "tags", current: currentTags, incoming: incomingTags });
  }
  return fields.length
    ? { resourceKey, fields, createdAt: new Date().toISOString() }
    : null;
}

function conflictSafeIncoming(
  existing: ResourcePayload,
  incoming: ResourcePayload,
  conflict: ConflictPayload
): ResourcePayload {
  const next = { ...incoming };
  if (conflict.fields.some((item) => item.field === "userNote")) {
    next.userNote = existing.userNote || "";
  }
  if (conflict.fields.some((item) => item.field === "tags")) {
    next.tags = [...new Set([...(existing.tags || []), ...(incoming.tags || [])])];
    next.tagsSource = "user";
  }
  return next;
}

export class SyncService {
  private readonly database: Database;
  private readonly encryption: EnvelopeEncryption;

  constructor(database: Database, encryption: EnvelopeEncryption) {
    this.database = database;
    this.encryption = encryption;
  }

  private async operationResult<T>(
    client: Pick<Database, "query">,
    userId: string,
    operationId: string
  ): Promise<T | null> {
    const existing = await client.query<{ response: T }>(
      "SELECT response FROM sync_operations WHERE user_id = $1 AND operation_id = $2",
      [userId, operationId]
    );
    return existing.rows[0]?.response || null;
  }

  private async activeResourceProtection(
    client: Pick<Database, "query">,
    userId: string,
    resourceKey: string
  ): Promise<boolean> {
    const result = await client.query(
      `SELECT 1
       FROM protection_rules rules
       WHERE rules.user_id = $1
         AND rules.deleted_at IS NULL
         AND (
           (rules.rule_kind = 'resource' AND rules.resource_key = $2)
           OR EXISTS (
             SELECT 1 FROM protection_rule_resources inherited
             WHERE inherited.user_id = rules.user_id
               AND inherited.protection_rule_id = rules.protection_rule_id
               AND inherited.resource_key = $2
           )
         )`,
      [userId, resourceKey]
    );
    return Boolean(result.rowCount);
  }

  async upsertResource(
    account: AuthenticatedAccount,
    resourceKey: string,
    rawInput: unknown
  ): Promise<CloudResource> {
    if (!/^[a-f0-9]{64}$/.test(resourceKey)) throw new Error("Invalid resource key.");
    const input = resourceMutationSchema.parse(rawInput);
    const client = await this.database.connect();
    try {
      await client.query("BEGIN");
      const repeated = await this.operationResult<CloudResource>(
        client,
        account.userId,
        input.operationId
      );
      if (repeated) {
        await client.query("COMMIT");
        return repeated;
      }
      if (await this.activeResourceProtection(client, account.userId, resourceKey)) {
        throw Object.assign(new Error("Protected resources cannot be uploaded."), { statusCode: 423 });
      }
      const stored = await client.query<{
        payload: Buffer;
        field_clocks: Record<string, string>;
        revision: string;
        deleted_at: Date | null;
      }>(
        `SELECT payload, field_clocks, revision, deleted_at
         FROM resources WHERE user_id = $1 AND resource_key = $2 FOR UPDATE`,
        [account.userId, resourceKey]
      );
      const row = stored.rows[0];
      const existing = row && !row.deleted_at
        ? await this.encryption.decryptJson<ResourcePayload>(
            account.userId,
            `resource:${resourceKey}`,
            row.payload
          )
        : null;
      const serverRevision = Number(row?.revision || 0);
      const conflict = resourceConflictPayload(
        resourceKey,
        existing,
        input.payload,
        input.baseRevision,
        serverRevision
      );
      const conflictId = conflict ? randomUUID() : null;
      const conflictEncrypted = conflict && conflictId
        ? await this.encryption.encryptJson(
            account.userId,
            `conflict:${conflictId}`,
            conflict
          )
        : null;
      const incomingPayload = conflict && existing
        ? conflictSafeIncoming(existing, input.payload, conflict)
        : input.payload;
      const incomingClocks = { ...input.fieldUpdatedAt };
      if (conflict) {
        for (const item of conflict.fields) {
          incomingClocks[item.field] = row?.field_clocks?.[item.field] || existing?.updatedAt || input.payload.updatedAt;
        }
      }
      const merged = mergeResourceFields(
        existing,
        row?.field_clocks || {},
        incomingPayload,
        incomingClocks
      );
      const revision = Number(row?.revision || 0) + 1;
      const encrypted = await this.encryption.encryptJson(
        account.userId,
        `resource:${resourceKey}`,
        merged.payload
      );
      const oldBytes = row?.payload.length || 0;
      const newBytes = input.deleted ? 0 : encrypted.length;
      const quota = await client.query<{
        quota_bytes: string;
        metadata_bytes: string;
        asset_bytes: string;
      }>(
        `SELECT u.quota_bytes, a.metadata_bytes, a.asset_bytes
         FROM users u JOIN account_usage a ON a.user_id = u.id
         WHERE u.id = $1 FOR UPDATE`,
        [account.userId]
      );
      const usage = quota.rows[0];
      if (
        usage &&
        Number(usage.metadata_bytes) + Number(usage.asset_bytes) - oldBytes + newBytes +
          (conflictEncrypted?.length || 0) > Number(usage.quota_bytes)
      ) {
        throw Object.assign(new Error("Cloud storage quota has been reached."), { statusCode: 413 });
      }
      await client.query(
        `INSERT INTO resources
          (user_id, resource_key, payload, field_clocks, revision, deleted_at, purge_after)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (user_id, resource_key) DO UPDATE SET
           payload = EXCLUDED.payload,
           field_clocks = EXCLUDED.field_clocks,
           revision = EXCLUDED.revision,
           updated_at = now(),
           deleted_at = EXCLUDED.deleted_at,
           purge_after = EXCLUDED.purge_after`,
        [
          account.userId,
          resourceKey,
          encrypted,
          JSON.stringify(merged.clocks),
          revision,
          input.deleted ? new Date() : null,
          input.deleted ? new Date(Date.now() + 30 * 24 * 60 * 60_000) : null
        ]
      );
      if (conflict && conflictId && conflictEncrypted) {
        await client.query(
          `INSERT INTO conflict_versions
            (user_id, conflict_id, entity_type, entity_id, base_revision, server_revision, payload)
           VALUES ($1, $2, 'resource', $3, $4, $5, $6)`,
          [
            account.userId,
            conflictId,
            resourceKey,
            input.baseRevision,
            serverRevision,
            conflictEncrypted
          ]
        );
      }
      await client.query(
        `UPDATE account_usage
         SET metadata_bytes = GREATEST(0, metadata_bytes - $2 + $3 + $4), updated_at = now()
         WHERE user_id = $1`,
        [account.userId, oldBytes, newBytes, conflictEncrypted?.length || 0]
      );
      const change = await client.query<{ sequence: string }>(
        `INSERT INTO sync_changes (user_id, entity_type, entity_id, revision, deleted)
         VALUES ($1, 'resource', $2, $3, $4) RETURNING sequence`,
        [account.userId, resourceKey, revision, input.deleted]
      );
      const response: CloudResource = {
        resourceKey,
        payload: merged.payload,
        revision,
        fieldUpdatedAt: merged.clocks,
        deleted: input.deleted,
        sequence: Number(change.rows[0].sequence),
        ...(conflict ? { conflictCount: 1 } : {})
      };
      await client.query(
        `INSERT INTO sync_operations (user_id, operation_id, response)
         VALUES ($1, $2, $3)`,
        [account.userId, input.operationId, JSON.stringify(response)]
      );
      await client.query("COMMIT");
      return response;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async listConflicts(account: AuthenticatedAccount): Promise<{ conflicts: CloudConflict[] }> {
    const result = await this.database.query<{
      conflict_id: string;
      base_revision: string;
      server_revision: string;
      payload: Buffer;
    }>(
      `SELECT conflict_id, base_revision, server_revision, payload
       FROM conflict_versions
       WHERE user_id = $1 AND status = 'pending'
       ORDER BY created_at DESC LIMIT 500`,
      [account.userId]
    );
    const conflicts = await Promise.all(result.rows.map(async (row) => ({
      conflictId: row.conflict_id,
      baseRevision: Number(row.base_revision),
      serverRevision: Number(row.server_revision),
      ...await this.encryption.decryptJson<ConflictPayload>(
        account.userId,
        `conflict:${row.conflict_id}`,
        row.payload
      )
    })));
    return { conflicts };
  }

  async exportConflicts(account: AuthenticatedAccount): Promise<{ conflicts: CloudConflict[] }> {
    const result = await this.database.query<{
      conflict_id: string;
      base_revision: string;
      server_revision: string;
      payload: Buffer;
      status: "pending" | "resolved";
      resolution: "current" | "incoming" | "merged" | null;
    }>(
      `SELECT conflict_id, base_revision, server_revision, payload, status, resolution
       FROM conflict_versions
       WHERE user_id = $1 ORDER BY created_at DESC LIMIT 2000`,
      [account.userId]
    );
    const conflicts = await Promise.all(result.rows.map(async (row) => ({
      conflictId: row.conflict_id,
      baseRevision: Number(row.base_revision),
      serverRevision: Number(row.server_revision),
      status: row.status,
      resolution: row.resolution,
      ...await this.encryption.decryptJson<ConflictPayload>(
        account.userId,
        `conflict:${row.conflict_id}`,
        row.payload
      )
    })));
    return { conflicts };
  }

  async resolveConflict(
    account: AuthenticatedAccount,
    conflictId: string,
    rawInput: unknown
  ): Promise<Record<string, unknown>> {
    if (!/^[0-9a-f-]{36}$/i.test(conflictId)) {
      throw Object.assign(new Error("Conflict is unavailable."), { statusCode: 404 });
    }
    const input = conflictResolutionSchema.parse(rawInput);
    const client = await this.database.connect();
    try {
      await client.query("BEGIN");
      const repeated = await this.operationResult<Record<string, unknown>>(
        client,
        account.userId,
        input.operationId
      );
      if (repeated) {
        await client.query("COMMIT");
        return repeated;
      }
      const conflictRow = await client.query<{
        entity_id: string;
        payload: Buffer;
        status: string;
      }>(
        `SELECT entity_id, payload, status FROM conflict_versions
         WHERE user_id = $1 AND conflict_id = $2 FOR UPDATE`,
        [account.userId, conflictId]
      );
      const storedConflict = conflictRow.rows[0];
      if (!storedConflict || storedConflict.status !== "pending") {
        throw Object.assign(new Error("Conflict is unavailable."), { statusCode: 404 });
      }
      const conflict = await this.encryption.decryptJson<ConflictPayload>(
        account.userId,
        `conflict:${conflictId}`,
        storedConflict.payload
      );
      const resourceRow = await client.query<{
        payload: Buffer;
        field_clocks: Record<string, string>;
        revision: string;
      }>(
        `SELECT payload, field_clocks, revision FROM resources
         WHERE user_id = $1 AND resource_key = $2 AND deleted_at IS NULL FOR UPDATE`,
        [account.userId, storedConflict.entity_id]
      );
      const resource = resourceRow.rows[0];
      if (!resource) {
        throw Object.assign(new Error("Conflict is unavailable."), { statusCode: 404 });
      }
      const payload = await this.encryption.decryptJson<ResourcePayload>(
        account.userId,
        `resource:${storedConflict.entity_id}`,
        resource.payload
      );
      const next = { ...payload };
      for (const field of conflict.fields) {
        if (field.field === "userNote") {
          next.userNote = input.resolution === "incoming"
            ? String(field.incoming)
            : input.resolution === "merged" && input.mergedUserNote !== undefined
              ? input.mergedUserNote
              : String(field.current);
        } else {
          next.tags = input.resolution === "incoming"
            ? [...field.incoming as string[]]
            : input.resolution === "merged" && input.mergedTags
              ? [...new Set(input.mergedTags)]
              : [...field.current as string[]];
          next.tagsSource = "user";
        }
      }
      const updatedAt = new Date().toISOString();
      next.updatedAt = updatedAt;
      const encrypted = await this.encryption.encryptJson(
        account.userId,
        `resource:${storedConflict.entity_id}`,
        next
      );
      const revision = Number(resource.revision) + 1;
      const clocks = { ...resource.field_clocks };
      for (const field of conflict.fields) clocks[field.field] = updatedAt;
      clocks.updatedAt = updatedAt;
      await client.query(
        `UPDATE resources SET payload = $3, field_clocks = $4, revision = $5, updated_at = now()
         WHERE user_id = $1 AND resource_key = $2`,
        [account.userId, storedConflict.entity_id, encrypted, JSON.stringify(clocks), revision]
      );
      await client.query(
        `UPDATE account_usage SET metadata_bytes = GREATEST(0, metadata_bytes - $2 + $3), updated_at = now()
         WHERE user_id = $1`,
        [account.userId, resource.payload.length, encrypted.length]
      );
      await client.query(
        `UPDATE conflict_versions SET status = 'resolved', resolution = $3, resolved_at = now()
         WHERE user_id = $1 AND conflict_id = $2`,
        [account.userId, conflictId, input.resolution]
      );
      const change = await client.query<{ sequence: string }>(
        `INSERT INTO sync_changes (user_id, entity_type, entity_id, revision, deleted)
         VALUES ($1, 'resource', $2, $3, false) RETURNING sequence`,
        [account.userId, storedConflict.entity_id, revision]
      );
      const response = {
        conflictId,
        resourceKey: storedConflict.entity_id,
        revision,
        sequence: Number(change.rows[0].sequence),
        resolved: true
      };
      await client.query(
        "INSERT INTO sync_operations (user_id, operation_id, response) VALUES ($1, $2, $3)",
        [account.userId, input.operationId, JSON.stringify(response)]
      );
      await client.query("COMMIT");
      return response;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async bootstrapResources(
    account: AuthenticatedAccount,
    offset: number,
    limit: number
  ): Promise<{ resources: CloudResource[]; nextOffset: number | null; cursor: number }> {
    const rows = await this.database.query<{
      resource_key: string;
      payload: Buffer;
      field_clocks: Record<string, string>;
      revision: string;
      deleted_at: Date | null;
    }>(
      `SELECT resource_key, payload, field_clocks, revision, deleted_at
       FROM resources
       WHERE user_id = $1 AND (deleted_at IS NULL OR purge_after > now())
       ORDER BY resource_key LIMIT $2 OFFSET $3`,
      [account.userId, limit + 1, offset]
    );
    const page = rows.rows.slice(0, limit);
    const resources = await Promise.all(
      page.map(async (row) => ({
        resourceKey: row.resource_key,
        payload: await this.encryption.decryptJson<ResourcePayload>(
          account.userId,
          `resource:${row.resource_key}`,
          row.payload
        ),
        revision: Number(row.revision),
        fieldUpdatedAt: row.field_clocks,
        deleted: Boolean(row.deleted_at)
      }))
    );
    const cursorResult = await this.database.query<{ cursor: string }>(
      "SELECT COALESCE(MAX(sequence), 0) AS cursor FROM sync_changes WHERE user_id = $1",
      [account.userId]
    );
    return {
      resources,
      nextOffset: rows.rows.length > limit ? offset + limit : null,
      cursor: Number(cursorResult.rows[0].cursor)
    };
  }

  async changes(
    account: AuthenticatedAccount,
    cursor: number,
    limit: number
  ): Promise<{ changes: Array<Record<string, unknown>>; cursor: number; hasMore: boolean; fullResyncRequired: boolean }> {
    const oldest = await this.database.query<{ sequence: string | null }>(
      `SELECT MIN(sequence) AS sequence FROM sync_changes
       WHERE user_id = $1 AND created_at >= now() - interval '180 days'`,
      [account.userId]
    );
    const oldestSequence = Number(oldest.rows[0].sequence || 0);
    if (cursor > 0 && oldestSequence > 0 && cursor < oldestSequence - 1) {
      return { changes: [], cursor, hasMore: false, fullResyncRequired: true };
    }
    const result = await this.database.query<{
      sequence: string;
      entity_type: string;
      entity_id: string;
      revision: string;
      deleted: boolean;
    }>(
      `SELECT sequence, entity_type, entity_id, revision, deleted
       FROM sync_changes
       WHERE user_id = $1 AND sequence > $2
       ORDER BY sequence LIMIT $3`,
      [account.userId, cursor, limit + 1]
    );
    const rows = result.rows.slice(0, limit);
    const changes = await Promise.all(rows.map(async (row) => {
      if (row.entity_type !== "resource" || row.deleted) {
        return {
          sequence: Number(row.sequence),
          entityType: row.entity_type,
          entityId: row.entity_id,
          revision: Number(row.revision),
          deleted: row.deleted
        };
      }
      const resource = await this.database.query<{
        payload: Buffer;
        field_clocks: Record<string, string>;
      }>(
        "SELECT payload, field_clocks FROM resources WHERE user_id = $1 AND resource_key = $2",
        [account.userId, row.entity_id]
      );
      const current = resource.rows[0];
      return {
        sequence: Number(row.sequence),
        entityType: row.entity_type,
        entityId: row.entity_id,
        revision: Number(row.revision),
        deleted: false,
        payload: current
          ? await this.encryption.decryptJson<ResourcePayload>(
              account.userId,
              `resource:${row.entity_id}`,
              current.payload
            )
          : null,
        fieldUpdatedAt: current?.field_clocks || {}
      };
    }));
    const nextCursor = rows.length ? Number(rows.at(-1)?.sequence) : cursor;
    await this.database.query(
      "UPDATE devices SET last_sequence = GREATEST(last_sequence, $3), last_seen_at = now() WHERE user_id = $1 AND device_id = $2",
      [account.userId, account.deviceId, nextCursor]
    );
    return {
      changes,
      cursor: nextCursor,
      hasMore: result.rows.length > limit,
      fullResyncRequired: false
    };
  }

  async bootstrapEntities(account: AuthenticatedAccount): Promise<{ entities: Array<Record<string, unknown>> }> {
    const entities: Array<Record<string, unknown>> = [];
    const appendRows = async (
      entityType: string,
      purposeType: string,
      rows: Array<{ entity_id: string; payload: Buffer; revision: string; deleted_at?: Date | null }>
    ) => {
      for (const row of rows) {
        entities.push({
          entityType,
          entityId: row.entity_id,
          payload: row.payload.length
            ? await this.encryption.decryptJson<unknown>(
                account.userId,
                `${purposeType}:${row.entity_id}`,
                row.payload
              )
            : null,
          revision: Number(row.revision),
          deleted: Boolean(row.deleted_at)
        });
      }
    };

    const bookmarkItems = await this.database.query<{
      entity_id: string;
      payload: Buffer;
      revision: string;
      deleted_at: Date | null;
    }>(
      `SELECT bookmark_item_id::text AS entity_id, payload, revision, deleted_at
       FROM bookmark_items WHERE user_id = $1`,
      [account.userId]
    );
    await appendRows("bookmark-item", "bookmark-item", bookmarkItems.rows);

    const settings = await this.database.query<{
      entity_id: string;
      payload: Buffer;
      revision: string;
      deleted_at: Date | null;
    }>(
      `SELECT setting_key AS entity_id, payload, revision, deleted_at
       FROM user_settings WHERE user_id = $1`,
      [account.userId]
    );
    for (const row of settings.rows) {
      const entityType = row.entity_id === "display"
        ? "setting-display"
        : row.entity_id === "ai-models"
          ? "setting-ai-models"
          : row.entity_id === "theme"
            ? "setting-theme"
            : "setting-cloud-scope";
      await appendRows(entityType, entityType, [row]);
    }

    const conversations = await this.database.query<{
      entity_id: string;
      payload: Buffer;
      revision: string;
      deleted_at: Date | null;
    }>(
      `SELECT conversation_id::text AS entity_id, payload, revision, deleted_at
       FROM conversations WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 50`,
      [account.userId]
    );
    await appendRows("conversation", "conversation", conversations.rows);

    const reports = await this.database.query<{
      entity_id: string;
      payload: Buffer;
      revision: string;
      deleted_at: Date | null;
    }>(
      `SELECT report_id::text AS entity_id, payload, revision, deleted_at
       FROM reports WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 100`,
      [account.userId]
    );
    await appendRows("report", "report", reports.rows);

    const rules = await this.database.query<{
      protection_rule_id: string;
      rule_kind: "resource" | "folder";
      resource_key: string | null;
      payload: Buffer | null;
      revision: string;
      created_at: Date;
      updated_at: Date;
      deleted_at: Date | null;
    }>(
      `SELECT protection_rule_id, rule_kind, resource_key, payload, revision,
              created_at, updated_at, deleted_at
       FROM protection_rules WHERE user_id = $1`,
      [account.userId]
    );
    for (const rule of rules.rows) {
      const payload = rule.rule_kind === "resource"
        ? {
            ruleId: rule.protection_rule_id,
            kind: "resource",
            resourceKey: rule.resource_key,
            updatedAt: rule.updated_at.toISOString(),
            deleted: Boolean(rule.deleted_at)
          }
        : rule.payload
          ? await this.encryption.decryptJson<unknown>(
              account.userId,
              `protection:${rule.protection_rule_id}`,
              rule.payload
            )
          : null;
      entities.push({
        entityType: "protection-rule",
        entityId: rule.protection_rule_id,
        payload,
        revision: Number(rule.revision),
        deleted: Boolean(rule.deleted_at)
      });
    }

    const usage = await this.database.query<{
      period: string;
      provider: string;
      model: string;
      payload: Buffer;
      revision: string;
    }>(
      `SELECT period, provider, model, payload, revision
       FROM usage_periods WHERE user_id = $1 ORDER BY period DESC LIMIT 120`,
      [account.userId]
    );
    for (const row of usage.rows) {
      const entityId = `${row.period}:${row.provider}:${row.model}`;
      entities.push({
        entityType: "usage-period",
        entityId,
        payload: await this.encryption.decryptJson<unknown>(
          account.userId,
          `usage:${entityId}`,
          row.payload
        ),
        revision: Number(row.revision),
        deleted: false
      });
    }

    const operationHistory = await this.database.query<{
      entity_id: string;
      payload: Buffer;
    }>(
      `SELECT operation_id::text AS entity_id, payload
       FROM operation_history
       WHERE user_id = $1 AND expires_at > now()
       ORDER BY created_at DESC LIMIT 500`,
      [account.userId]
    );
    for (const row of operationHistory.rows) {
      entities.push({
        entityType: "operation-history",
        entityId: row.entity_id,
        payload: await this.encryption.decryptJson<unknown>(
          account.userId,
          `operation-history:${row.entity_id}`,
          row.payload
        ),
        revision: 1,
        deleted: false
      });
    }

    return { entities };
  }

  private validateEntity(input: EntityMutation): unknown {
    assertNoForbiddenFields(input.payload);
    if (jsonByteLength(input.payload) > 512 * 1024) {
      throw Object.assign(new Error("Entity payload exceeds the 512 KiB limit."), { statusCode: 413 });
    }
    switch (input.entityType) {
      case "bookmark-item": return bookmarkItemSchema.parse(input.payload);
      case "protection-rule": return protectionRuleSchema.parse(input.payload);
      case "setting-display": return displaySettingSchema.parse(input.payload);
      case "setting-ai-models": return aiModelSettingSchema.parse(input.payload);
      case "setting-cloud-scope": return cloudScopeSettingSchema.parse(input.payload);
      case "setting-theme": return themeSettingSchema.parse(input.payload);
      case "conversation": return conversationSchema.parse(input.payload);
      case "report": return reportSchema.parse(input.payload);
      case "usage-period": return usagePeriodSchema.parse(input.payload);
      case "operation-history": return operationHistorySchema.parse(input.payload);
    }
  }

  async upsertEntity(account: AuthenticatedAccount, rawInput: unknown): Promise<Record<string, unknown>> {
    const input = entityMutationSchema.parse(rawInput);
    const payload = this.validateEntity(input);
    if (input.entityType === "protection-rule") {
      return this.upsertProtectionRule(account, input, payload as z.infer<typeof protectionRuleSchema>);
    }
    if (input.entityType === "usage-period") {
      return this.upsertUsage(account, input, payload as z.infer<typeof usagePeriodSchema>);
    }
    if (input.entityType === "bookmark-item" && !input.deleted) {
      const item = payload as z.infer<typeof bookmarkItemSchema>;
      if (await this.activeResourceProtection(this.database, account.userId, item.resourceKey)) {
        throw Object.assign(
          new Error("Protected resources cannot upload bookmark metadata."),
          { statusCode: 423 }
        );
      }
    }
    const encrypted = await this.encryption.encryptJson(
      account.userId,
      `${input.entityType}:${input.entityId}`,
      payload
    );
    const client = await this.database.connect();
    try {
      await client.query("BEGIN");
      const repeated = await this.operationResult<Record<string, unknown>>(client, account.userId, input.operationId);
      if (repeated) {
        await client.query("COMMIT");
        return repeated;
      }
      const current = await this.readEntityForUpdate(client, account.userId, input);
      const revision = current.revision + 1;
      const oldBytes = current.bytes;
      const storedPayload = input.deleted ? Buffer.alloc(0) : encrypted;
      const quota = await client.query<{
        quota_bytes: string;
        metadata_bytes: string;
        asset_bytes: string;
      }>(
        `SELECT u.quota_bytes, a.metadata_bytes, a.asset_bytes
         FROM users u JOIN account_usage a ON a.user_id = u.id
         WHERE u.id = $1 FOR UPDATE`,
        [account.userId]
      );
      const usage = quota.rows[0];
      if (
        usage &&
        Number(usage.metadata_bytes) + Number(usage.asset_bytes) - oldBytes + storedPayload.length > Number(usage.quota_bytes)
      ) {
        throw Object.assign(new Error("Cloud storage quota has been reached."), { statusCode: 413 });
      }
      await this.writeEntity(client, account.userId, input, payload, storedPayload, revision);
      await client.query(
        `UPDATE account_usage SET metadata_bytes = GREATEST(0, metadata_bytes - $2 + $3), updated_at = now()
         WHERE user_id = $1`,
        [account.userId, oldBytes, storedPayload.length]
      );
      const change = await client.query<{ sequence: string }>(
        `INSERT INTO sync_changes (user_id, entity_type, entity_id, revision, deleted)
         VALUES ($1, $2, $3, $4, $5) RETURNING sequence`,
        [account.userId, input.entityType, input.entityId, revision, input.deleted]
      );
      const response = {
        entityType: input.entityType,
        entityId: input.entityId,
        revision,
        sequence: Number(change.rows[0].sequence),
        deleted: input.deleted
      };
      await client.query(
        "INSERT INTO sync_operations (user_id, operation_id, response) VALUES ($1, $2, $3)",
        [account.userId, input.operationId, JSON.stringify(response)]
      );
      await client.query("COMMIT");
      return response;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async readEntityForUpdate(
    client: PoolClient,
    userId: string,
    input: EntityMutation
  ): Promise<{ revision: number; bytes: number }> {
    const query = input.entityType === "bookmark-item"
      ? "SELECT revision, payload FROM bookmark_items WHERE user_id = $1 AND bookmark_item_id = $2 FOR UPDATE"
      : input.entityType.startsWith("setting-")
        ? "SELECT revision, payload FROM user_settings WHERE user_id = $1 AND setting_key = $2 FOR UPDATE"
        : input.entityType === "conversation"
          ? "SELECT revision, payload FROM conversations WHERE user_id = $1 AND conversation_id = $2 FOR UPDATE"
          : input.entityType === "report"
            ? "SELECT revision, payload FROM reports WHERE user_id = $1 AND report_id = $2 FOR UPDATE"
            : "SELECT 1 AS revision, payload FROM operation_history WHERE user_id = $1 AND operation_id = $2 FOR UPDATE";
    const result = await client.query<{ revision: string; payload: Buffer }>(query, [userId, input.entityId]);
    return {
      revision: result.rows[0] ? Number(result.rows[0].revision) : 0,
      bytes: result.rows[0]?.payload.length || 0
    };
  }

  private async writeEntity(
    client: PoolClient,
    userId: string,
    input: EntityMutation,
    payload: unknown,
    encrypted: Buffer,
    revision: number
  ): Promise<void> {
    const deletedAt = input.deleted ? new Date() : null;
    if (input.entityType === "bookmark-item") {
      const item = payload as z.infer<typeof bookmarkItemSchema>;
      if (item.bookmarkItemId !== input.entityId) throw new Error("Bookmark item identity mismatch.");
      await client.query(
        `INSERT INTO bookmark_items
          (user_id, bookmark_item_id, resource_key, payload, revision, deleted_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (user_id, bookmark_item_id) DO UPDATE SET
           resource_key = EXCLUDED.resource_key, payload = EXCLUDED.payload,
           revision = EXCLUDED.revision, updated_at = now(), deleted_at = EXCLUDED.deleted_at`,
        [userId, input.entityId, item.resourceKey, encrypted, revision, deletedAt]
      );
      return;
    }
    if (input.entityType.startsWith("setting-")) {
      await client.query(
        `INSERT INTO user_settings (user_id, setting_key, payload, revision, deleted_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (user_id, setting_key) DO UPDATE SET
           payload = EXCLUDED.payload, revision = EXCLUDED.revision,
           updated_at = now(), deleted_at = EXCLUDED.deleted_at`,
        [userId, input.entityId, encrypted, revision, deletedAt]
      );
      return;
    }
    if (input.entityType === "conversation") {
      const conversation = payload as z.infer<typeof conversationSchema>;
      if (conversation.id !== input.entityId) throw new Error("Conversation identity mismatch.");
      await client.query(
        `INSERT INTO conversations (user_id, conversation_id, payload, revision, deleted_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (user_id, conversation_id) DO UPDATE SET
           payload = EXCLUDED.payload, revision = EXCLUDED.revision,
           updated_at = now(), deleted_at = EXCLUDED.deleted_at`,
        [userId, input.entityId, encrypted, revision, deletedAt]
      );
      return;
    }
    if (input.entityType === "report") {
      const report = payload as z.infer<typeof reportSchema>;
      if (report.reportId !== input.entityId) throw new Error("Report identity mismatch.");
      await client.query(
        `INSERT INTO reports (user_id, report_id, report_kind, payload, revision, deleted_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (user_id, report_id) DO UPDATE SET
           report_kind = EXCLUDED.report_kind, payload = EXCLUDED.payload,
           revision = EXCLUDED.revision, updated_at = now(), deleted_at = EXCLUDED.deleted_at`,
        [userId, input.entityId, report.kind, encrypted, revision, deletedAt]
      );
      return;
    }
    const history = payload as z.infer<typeof operationHistorySchema>;
    if (input.deleted) {
      await client.query(
        "DELETE FROM operation_history WHERE user_id = $1 AND operation_id = $2",
        [userId, input.entityId]
      );
      return;
    }
    if (history.operationId !== input.entityId) throw new Error("Operation identity mismatch.");
    await client.query(
      `INSERT INTO operation_history
        (user_id, operation_id, operation_kind, payload, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, operation_id) DO UPDATE SET
         operation_kind = EXCLUDED.operation_kind,
         payload = EXCLUDED.payload, expires_at = EXCLUDED.expires_at`,
      [userId, input.entityId, history.kind, encrypted, new Date(history.expiresAt)]
    );
  }

  private async upsertUsage(
    account: AuthenticatedAccount,
    input: EntityMutation,
    payload: z.infer<typeof usagePeriodSchema>
  ): Promise<Record<string, unknown>> {
    const encrypted = await this.encryption.encryptJson(account.userId, `usage:${input.entityId}`, payload);
    const client = await this.database.connect();
    try {
      await client.query("BEGIN");
      const repeated = await this.operationResult<Record<string, unknown>>(client, account.userId, input.operationId);
      if (repeated) {
        await client.query("COMMIT");
        return repeated;
      }
      const current = await client.query<{ revision: string; payload: Buffer }>(
        `SELECT revision, payload FROM usage_periods
         WHERE user_id = $1 AND period = $2 AND provider = $3 AND model = $4 FOR UPDATE`,
        [account.userId, payload.period, payload.provider, payload.model]
      );
      const revision = Number(current.rows[0]?.revision || 0) + 1;
      const oldBytes = current.rows[0]?.payload.length || 0;
      if (input.deleted) {
        await client.query(
          `DELETE FROM usage_periods
           WHERE user_id = $1 AND period = $2 AND provider = $3 AND model = $4`,
          [account.userId, payload.period, payload.provider, payload.model]
        );
      } else {
        await client.query(
          `INSERT INTO usage_periods (user_id, period, provider, model, payload, revision)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (user_id, period, provider, model) DO UPDATE
             SET payload = EXCLUDED.payload, revision = EXCLUDED.revision, updated_at = now()`,
          [account.userId, payload.period, payload.provider, payload.model, encrypted, revision]
        );
      }
      await client.query(
        `UPDATE account_usage SET metadata_bytes = GREATEST(0, metadata_bytes - $2 + $3), updated_at = now()
         WHERE user_id = $1`,
        [account.userId, oldBytes, input.deleted ? 0 : encrypted.length]
      );
      const change = await client.query<{ sequence: string }>(
        `INSERT INTO sync_changes (user_id, entity_type, entity_id, revision, deleted)
         VALUES ($1, 'usage-period', $2, $3, $4) RETURNING sequence`,
        [account.userId, input.entityId, revision, input.deleted]
      );
      const response = {
        entityType: input.entityType,
        entityId: input.entityId,
        revision,
        sequence: Number(change.rows[0].sequence),
        deleted: input.deleted
      };
      await client.query(
        "INSERT INTO sync_operations (user_id, operation_id, response) VALUES ($1, $2, $3)",
        [account.userId, input.operationId, JSON.stringify(response)]
      );
      await client.query("COMMIT");
      return response;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async upsertProtectionRule(
    account: AuthenticatedAccount,
    input: EntityMutation,
    rule: z.infer<typeof protectionRuleSchema>
  ): Promise<Record<string, unknown>> {
    const client = await this.database.connect();
    try {
      await client.query("BEGIN");
      const repeated = await this.operationResult<Record<string, unknown>>(client, account.userId, input.operationId);
      if (repeated) {
        await client.query("COMMIT");
        return repeated;
      }
      const row = await client.query<{ revision: string; payload: Buffer | null }>(
        `SELECT revision, payload FROM protection_rules
         WHERE user_id = $1 AND protection_rule_id = $2 FOR UPDATE`,
        [account.userId, rule.ruleId]
      );
      const revision = Number(row.rows[0]?.revision || 0) + 1;
      const encrypted = rule.kind === "folder"
        ? await this.encryption.encryptJson(account.userId, `protection:${rule.ruleId}`, rule)
        : null;
      const oldBytes = row.rows[0]?.payload?.length || 0;
      const newBytes = input.deleted || rule.deleted ? 0 : encrypted?.length || 0;
      const quota = await client.query<{
        quota_bytes: string;
        metadata_bytes: string;
        asset_bytes: string;
      }>(
        `SELECT u.quota_bytes, a.metadata_bytes, a.asset_bytes
         FROM users u JOIN account_usage a ON a.user_id = u.id
         WHERE u.id = $1 FOR UPDATE`,
        [account.userId]
      );
      const usage = quota.rows[0];
      if (
        usage &&
        Number(usage.metadata_bytes) + Number(usage.asset_bytes) - oldBytes + newBytes > Number(usage.quota_bytes)
      ) {
        throw Object.assign(new Error("Cloud storage quota has been reached."), { statusCode: 413 });
      }
      await client.query(
        `INSERT INTO protection_rules
          (user_id, protection_rule_id, rule_kind, resource_key, payload, revision, deleted_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (user_id, protection_rule_id) DO UPDATE SET
           rule_kind = EXCLUDED.rule_kind,
           resource_key = EXCLUDED.resource_key,
           payload = EXCLUDED.payload,
           revision = EXCLUDED.revision,
           updated_at = now(),
           deleted_at = EXCLUDED.deleted_at`,
        [
          account.userId,
          rule.ruleId,
          rule.kind,
          rule.kind === "resource" ? rule.resourceKey : null,
          encrypted,
          revision,
          input.deleted || rule.deleted ? new Date() : null
        ]
      );
      await client.query(
        `UPDATE account_usage
         SET metadata_bytes = GREATEST(0, metadata_bytes - $2 + $3), updated_at = now()
         WHERE user_id = $1`,
        [account.userId, oldBytes, newBytes]
      );
      if (rule.kind === "folder") {
        await client.query(
          `DELETE FROM protection_rule_resources
           WHERE user_id = $1 AND protection_rule_id = $2`,
          [account.userId, rule.ruleId]
        );
        if (!input.deleted && !rule.deleted && rule.resourceKeys.length) {
          await client.query(
            `INSERT INTO protection_rule_resources
              (user_id, protection_rule_id, resource_key)
             SELECT $1, $2, resource_key
             FROM unnest($3::text[]) AS resource_key
             ON CONFLICT DO NOTHING`,
            [account.userId, rule.ruleId, rule.resourceKeys]
          );
          await this.purgeProtectedResources(
            client,
            account.userId,
            rule.resourceKeys
          );
        }
      } else if (!input.deleted && !rule.deleted) {
        await this.purgeProtectedResources(client, account.userId, [rule.resourceKey]);
      }
      const change = await client.query<{ sequence: string }>(
        `INSERT INTO sync_changes (user_id, entity_type, entity_id, revision, deleted)
         VALUES ($1, 'protection-rule', $2, $3, $4) RETURNING sequence`,
        [account.userId, rule.ruleId, revision, input.deleted || rule.deleted]
      );
      const response = {
        entityType: "protection-rule",
        entityId: rule.ruleId,
        revision,
        sequence: Number(change.rows[0].sequence),
        deleted: input.deleted || rule.deleted
      };
      await client.query(
        "INSERT INTO sync_operations (user_id, operation_id, response) VALUES ($1, $2, $3)",
        [account.userId, input.operationId, JSON.stringify(response)]
      );
      await client.query("COMMIT");
      return response;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async purgeProtectedResources(
    client: PoolClient,
    userId: string,
    resourceKeys: readonly string[]
  ): Promise<void> {
    const uniqueKeys = [...new Set(resourceKeys)];
    if (!uniqueKeys.length) return;
    const resources = await client.query<{
      resource_key: string;
      payload: Buffer;
      revision: string;
    }>(
      `DELETE FROM resources
       WHERE user_id = $1 AND resource_key = ANY($2::text[])
       RETURNING resource_key, payload, revision`,
      [userId, uniqueKeys]
    );
    const resourceBytes = resources.rows.reduce(
      (sum, resource) => sum + resource.payload.length,
      0
    );
    if (resourceBytes) {
      await client.query(
        "UPDATE account_usage SET metadata_bytes = GREATEST(0, metadata_bytes - $2), updated_at = now() WHERE user_id = $1",
        [userId, resourceBytes]
      );
    }
    for (const resource of resources.rows) {
      await client.query(
        `INSERT INTO sync_changes (user_id, entity_type, entity_id, revision, deleted)
         VALUES ($1, 'resource', $2, $3, true)`,
        [userId, resource.resource_key, Number(resource.revision) + 1]
      );
    }

    const bookmarkItems = await client.query<{
      bookmark_item_id: string;
      payload: Buffer;
      revision: string;
    }>(
      `DELETE FROM bookmark_items
       WHERE user_id = $1 AND resource_key = ANY($2::text[])
       RETURNING bookmark_item_id, payload, revision`,
      [userId, uniqueKeys]
    );
    const bookmarkBytes = bookmarkItems.rows.reduce(
      (sum, item) => sum + item.payload.length,
      0
    );
    if (bookmarkBytes) {
      await client.query(
        "UPDATE account_usage SET metadata_bytes = GREATEST(0, metadata_bytes - $2), updated_at = now() WHERE user_id = $1",
        [userId, bookmarkBytes]
      );
    }
    for (const item of bookmarkItems.rows) {
      await client.query(
        `INSERT INTO sync_changes (user_id, entity_type, entity_id, revision, deleted)
         VALUES ($1, 'bookmark-item', $2, $3, true)`,
        [userId, item.bookmark_item_id, Number(item.revision) + 1]
      );
    }

    const conflicts = await client.query<{ bytes: string }>(
      `DELETE FROM conflict_versions
       WHERE user_id = $1 AND entity_type = 'resource'
         AND entity_id = ANY($2::text[])
       RETURNING octet_length(payload)::text AS bytes`,
      [userId, uniqueKeys]
    );
    const conflictBytes = conflicts.rows.reduce(
      (sum, conflict) => sum + Number(conflict.bytes),
      0
    );
    if (conflictBytes) {
      await client.query(
        "UPDATE account_usage SET metadata_bytes = GREATEST(0, metadata_bytes - $2), updated_at = now() WHERE user_id = $1",
        [userId, conflictBytes]
      );
    }

    const assets = await client.query<{ asset_id: string; object_key: string; byte_size: string }>(
      `UPDATE assets SET state = 'deleting', deleted_at = now(), updated_at = now()
       WHERE user_id = $1 AND resource_key = ANY($2::text[])
         AND state NOT IN ('deleting', 'deleted')
       RETURNING asset_id, object_key, byte_size`,
      [userId, uniqueKeys]
    );
    for (const asset of assets.rows) {
      await client.query(
        `INSERT INTO asset_delete_jobs (user_id, asset_id, object_key)
         VALUES ($1, $2, $3)`,
        [userId, asset.asset_id, asset.object_key]
      );
    }
    if (assets.rows.length) {
      const removedBytes = assets.rows.reduce(
        (sum, asset) => sum + Number(asset.byte_size),
        0
      );
      await client.query(
        `UPDATE account_usage
         SET asset_bytes = GREATEST(0, asset_bytes - $2),
             asset_count = GREATEST(0, asset_count - $3),
             updated_at = now()
         WHERE user_id = $1`,
        [userId, removedBytes, assets.rows.length]
      );
    }
  }
}

import assert from "node:assert/strict";
import test from "node:test";
import type { AuthenticatedAccount } from "../src/auth.js";
import type { Database } from "../src/db.js";
import type { EnvelopeEncryption } from "../src/encryption.js";
import { SyncService } from "../src/sync.js";

test("entity batches retry deadlocks and keep one account transaction active", async () => {
  const service = new SyncService(
    {} as Database,
    {} as EnvelopeEncryption
  );
  const attempts = new Map<string, number>();
  let active = 0;
  let maxActive = 0;

  service.upsertEntity = async (_account, rawInput) => {
    const mutation = rawInput as { entityId: string };
    const attempt = (attempts.get(mutation.entityId) || 0) + 1;
    attempts.set(mutation.entityId, attempt);
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    if (mutation.entityId === "theme" && attempt === 1) {
      throw Object.assign(new Error("deadlock detected"), { code: "40P01" });
    }
    return { entityId: mutation.entityId, attempt };
  };

  const mutations = ["theme", "cloud-scope"].map((entityId, index) => ({
    operationId: `00000000-0000-4000-8000-00000000000${index}`,
    entityType: index === 0 ? "setting-theme" : "setting-cloud-scope",
    entityId,
    updatedAt: "2026-08-05T15:00:00.000Z",
    payload: {},
    deleted: false
  }));
  const result = await service.upsertEntities(
    {} as AuthenticatedAccount,
    { mutations }
  );

  assert.equal(maxActive, 1);
  assert.equal(attempts.get("theme"), 2);
  assert.equal(attempts.get("cloud-scope"), 1);
  assert.deepEqual(result.results, [
    { entityId: "theme", attempt: 2 },
    { entityId: "cloud-scope", attempt: 1 }
  ]);
});

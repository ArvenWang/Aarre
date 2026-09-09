import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearCloudResourceTracking, readCloudResourceTracking, commitCloudResourceChanges } from "../src/lib/cloud-resource-store";
import { cloudRequest } from "../src/lib/auth";
import { pullCloudResources, syncOneResource, resourceCloudPayload } from "../src/lib/cloud";
import { syncCloudAssets } from "../src/lib/cloud-assets";
import { getLocalResource, getLocalResources, deleteLocalResource, upsertLocalResource } from "../src/lib/storage";
import { createSyncEngine, type SyncStatus } from "../src/lib/sync-engine";
import type { ResourceRecord } from "../src/lib/types";

vi.mock("../src/lib/auth", () => ({ cloudRequest: vi.fn(), getAuthState: vi.fn() }));
const request = vi.mocked(cloudRequest);
const CURSOR = "aarre:cloud-sync-cursor:v1";
let values: Record<string, unknown>;
const stamp = "2026-09-09T00:00:00.000Z";

function resource(key: string, overrides: Partial<ResourceRecord> = {}): ResourceRecord {
  return {
    resourceKey: key, canonicalUrl: `https://example.com/${key}`,
    url: `https://example.com/${key}`, title: key, userNote: "old note",
    summary: "old summary", tags: [], topics: [], contentExcerpt: "", contentHash: "",
    selectedText: "", author: "", siteName: "Example", language: "en", imageUrl: "",
    faviconUrl: "", nativeBookmarkIds: ["audit-native"], nativeFolderPath: [],
    aiStatus: "ready", syncStatus: "synced", createdAt: stamp, updatedAt: stamp,
    ...overrides
  };
}

beforeEach(async () => {
  request.mockReset();
  values = { "aarre:cloud-session:v1": { userId: "audit-user" }, "aarre:cloud-sync-settings:v1": { enabled:true, scope:"complete", consentVersion:1, consentedUserId:"audit-user" } };
  vi.stubGlobal("chrome", {
    storage: { local: {
      get: async (key: string | string[]) => Object.fromEntries((Array.isArray(key) ? key : [key]).map(k => [k, values[k]])),
      set: async (next: Record<string, unknown>) => Object.assign(values, next),
      remove: async (keys: string | string[]) => { for (const key of Array.isArray(keys) ? keys : [keys]) delete values[key]; }
    } },
    bookmarks: { getTree: async () => [{ id: "0", children: [] }] }
  });
  vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 200 })));
  await clearCloudResourceTracking();
  for (const item of await getLocalResources()) await deleteLocalResource(item.resourceKey);
});

async function seedCursor(cursor: number) {
  const tracking = await readCloudResourceTracking();
  await commitCloudResourceChanges(tracking.generation, [], cursor);
}

function change(key: string, sequence = 11) {
  return {
    sequence, entityType: "resource", entityId: key, revision: sequence,
    deleted: false,
    payload: { canonicalUrl: `https://example.com/${key}`, summary: "remote summary", userNote: "remote note", createdAt: stamp, updatedAt: stamp },
    fieldUpdatedAt: { summary: stamp, userNote: stamp }
  };
}

function harness(overrides: Partial<Parameters<typeof createSyncEngine>[0]> = {}) {
  let current: SyncStatus = { phase: "idle", current: 0, total: 0, lastSyncedAt: null, error: null, nextRetryAt: null };
  const deps: Parameters<typeof createSyncEngine>[0] = {
    isReady: async () => true, pullResources: vi.fn(async () => undefined), pullEntities: async () => undefined,
    countOutbox: async () => 0, pushOutboxBatch: async () => ({ attempted: 0, synced: 0, failed: 0 }),
    pushEntities: async () => ({ synced: 0, total: 0 }),
    uploadAssets: async () => ({ uploaded: 0, processed: 0, total: 0, remaining: false }),
    downloadAssets: async () => ({ restored: 0, processed: 0, total: 0, remaining: false }),
    readStatus: async () => current, writeStatus: async (next) => (current = next),
    now: () => Date.parse(stamp), ...overrides
  };
  return { engine: createSyncEngine(deps), deps, status: () => current };
}

describe("September audit: required sync recovery behavior", () => {
  it("A01 does not advance the cursor past changes that were never committed", async () => {
    await seedCursor(10);
    request.mockResolvedValueOnce({ changes: [change("cursor-case")], cursor: 11, hasMore: true, fullResyncRequired: false });
    request.mockRejectedValueOnce(new Error("injected second-page network failure"));
    await expect(pullCloudResources()).rejects.toThrow("second-page");
    const local = await getLocalResource("cursor-case");
    console.log("A01", { cursor: (await readCloudResourceTracking()).cursor, localDataPersisted: Boolean(local) });
    expect((await readCloudResourceTracking()).cursor === 10 || Boolean(local)).toBe(true);
  });

  it("A02 keeps an update followed by a tombstone deleted", async () => {
    await seedCursor(10);
    await upsertLocalResource(resource("deleted-case"));
    request.mockResolvedValueOnce({ changes: [change("deleted-case"), { sequence: 12, entityType: "resource", entityId: "deleted-case", revision: 12, deleted: true }], cursor: 12, hasMore: false, fullResyncRequired: false });
    await pullCloudResources();
    const local = await getLocalResource("deleted-case");
    console.log("A02", { resurrected: Boolean(local), nativeBookmarkIds: local?.nativeBookmarkIds });
    expect(local).toBeUndefined();
  });

  it("A03 never reports all data synced when a resource upload failed", async () => {
    const pushOutboxBatch = vi.fn().mockResolvedValueOnce({ attempted: 1, synced: 0, failed: 1 }).mockResolvedValue({ attempted: 0, synced: 0, failed: 0 });
    const test = harness({ countOutbox: async () => 1, pushOutboxBatch });
    await expect(test.engine.sync()).rejects.toThrow();
    console.log("A03", test.status());
    expect(test.status().lastSyncedAt).toBeNull();
  });

  it("A04 permits explicit retry after a recoverable network error", async () => {
    const pullResources = vi.fn().mockRejectedValueOnce(new Error("network unavailable")).mockResolvedValue(undefined);
    const test = harness({ pullResources });
    await expect(test.engine.sync("auto")).rejects.toThrow();
    await test.engine.sync("manual");
    console.log("A04", { requestsAfterManualRetry: pullResources.mock.calls.length, phase: test.status().phase });
    expect(pullResources).toHaveBeenCalledTimes(2);
  });

  it("A05 keeps a newer local note when an older upload response arrives", async () => {
    const old = resource("edit-race");
    await upsertLocalResource(old);
    request.mockImplementationOnce(async () => {
      await upsertLocalResource(resource("edit-race", { userNote: "new local note", updatedAt: "2026-09-09T01:00:00.000Z" }));
      return { resourceKey: old.resourceKey, payload: { canonicalUrl: old.canonicalUrl, userNote: old.userNote, createdAt: stamp, updatedAt: stamp }, revision: 1, fieldUpdatedAt: { userNote: stamp }, deleted: false };
    });
    await syncOneResource(old, "", "audit-operation");
    const local = await getLocalResource(old.resourceKey);
    console.log("A05", { userNoteAfterReply: local?.userNote });
    expect(local?.userNote).toBe("new local note");
  });

  it("A06 does not upload unchanged old image bytes over a newer remote cover", async () => {
    const key = "cover-race";
    const oldBytes = new Uint8Array([1, 2, 3]);
    const oldHash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", oldBytes)), b => b.toString(16).padStart(2, "0")).join("");
    const newHash = "b".repeat(64);
    await upsertLocalResource(resource(key, { thumbnailDataUrl: "data:image/webp;base64,AQID", coverContentHash: oldHash, coverOrigin: "user", coverUpdatedAt: stamp }));
    await seedCursor(10);
    const remoteChange = change(key);
    request.mockResolvedValueOnce({
      changes: [{ ...remoteChange,
        payload: { ...remoteChange.payload, coverContentHash: newHash, coverOrigin: "user", coverUpdatedAt: "2026-09-09T01:00:00.000Z", updatedAt: "2026-09-09T01:00:00.000Z" },
        fieldUpdatedAt: { coverContentHash: "2026-09-09T01:00:00.000Z", coverOrigin: "2026-09-09T01:00:00.000Z", coverUpdatedAt: "2026-09-09T01:00:00.000Z" }
      }], cursor: 11, hasMore: false, fullResyncRequired: false
    });
    await pullCloudResources();
    expect((await getLocalResource(key))?.coverContentHash).toBe(newHash);
    expect((await getLocalResource(key))?.thumbnailDataUrl).toBeUndefined();
    request.mockImplementation(async (path) => {
      if (path === "/v1/assets") return { assets: [{ assetId: "remote-slot", resourceKey: key, kind: "cover", sha256: newHash, revision: 2, binding: { canonicalUrl: `https://example.com/${key}`, coverOrigin: "user" } }] };
      if (path === "/v1/assets/upload") return { uploadUrl: "https://audit.invalid/upload", headers: {} };
      if (path.endsWith("/complete")) return { revision: 3 };
      throw new Error(`Unexpected audit request: ${path}`);
    });
    await syncCloudAssets();
    const upload = request.mock.calls.find(([path]) => path === "/v1/assets/upload");
    const payload = upload ? JSON.parse(String(upload[1]?.body)) : null;
    console.log("A06", { oldBytesUploaded: payload?.sha256 === oldHash, incomingRemoteHash: newHash, localBytesWereUnchanged: true });
    expect(upload).toBeUndefined();
  });

  it("A10 sends an explicit clear when the user deletes their note and last tag", async () => {
    await upsertLocalResource(resource("clear-fields", { userNote: "note", tags: ["tag"] }));
    await upsertLocalResource(resource("clear-fields", { userNote: "", tags: [], tagsSource: "user", updatedAt: "2026-09-09T01:00:00.000Z" }));
    const payload = resourceCloudPayload((await getLocalResource("clear-fields"))!);
    console.log("A10", { noteClearSent: Object.hasOwn(payload, "userNote"), tagsClearSent: Object.hasOwn(payload, "tags") });
    expect(payload).toHaveProperty("userNote", "");
    expect(payload).toHaveProperty("tags", []);
  });
});

it("does not upload an image just because an account is signed in", async () => {
  delete values["aarre:cloud-sync-settings:v1"];
  await expect(syncCloudAssets()).rejects.toThrow("完整备份未开启");
  expect(request).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
});

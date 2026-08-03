import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cloudRequest } from "../src/lib/auth";
import {
  pullCloudResources,
  syncOneResource
} from "../src/lib/cloud";
import {
  deleteLocalResource,
  enqueueOutbox,
  getLocalResource,
  getOutbox,
  upsertLocalResource
} from "../src/lib/storage";
import { createResourceTombstone } from "../src/extension/coordinators/bookmark-events";
import type { ResourceRecord } from "../src/lib/types";

vi.mock("../src/lib/auth", () => ({ cloudRequest: vi.fn() }));

const request = vi.mocked(cloudRequest);
let localValues: Record<string, unknown>;
const removeNativeBookmark = vi.fn();

function resource(key: string, overrides: Partial<ResourceRecord> = {}): ResourceRecord {
  return {
    resourceKey: key,
    canonicalUrl: `https://example.com/${key}`,
    url: `https://example.com/${key}`,
    title: key,
    userNote: "",
    summary: "",
    tags: [],
    topics: [],
    contentExcerpt: "",
    contentHash: "",
    selectedText: "",
    author: "",
    siteName: "Example",
    language: "en",
    imageUrl: "",
    faviconUrl: "",
    nativeBookmarkIds: ["native-bookmark"],
    nativeFolderPath: ["folder"],
    aiStatus: "not_requested",
    syncStatus: "synced",
    createdAt: "2026-08-04T00:00:00.000Z",
    updatedAt: "2026-08-04T00:00:00.000Z",
    ...overrides
  };
}

beforeEach(() => {
  request.mockReset();
  removeNativeBookmark.mockReset();
  localValues = {};
  vi.stubGlobal("chrome", {
    storage: {
      local: {
        get: async (key: string | string[]) => {
          if (Array.isArray(key)) {
            return Object.fromEntries(key.map((item) => [item, localValues[item]]));
          }
          return { [key]: localValues[key] };
        },
        set: async (next: Record<string, unknown>) => Object.assign(localValues, next),
        remove: async (key: string | string[]) => {
          for (const item of Array.isArray(key) ? key : [key]) delete localValues[item];
        }
      }
    },
    bookmarks: {
      getTree: async () => [{ id: "0", children: [] }],
      remove: removeNativeBookmark
    }
  });
});

describe("cloud deletion tombstones", () => {
  it("marks the resource and queues an outbox item after its final native location is removed", async () => {
    const key = `local-delete-${crypto.randomUUID()}`;
    const deletedAt = "2026-08-04T01:00:00.000Z";
    const tombstone = createResourceTombstone(resource(key), deletedAt);

    await upsertLocalResource(tombstone);
    await enqueueOutbox(tombstone, "");

    await expect(getLocalResource(key)).resolves.toMatchObject({
      nativeBookmarkIds: [],
      deletedAt,
      syncStatus: "pending"
    });
    expect((await getOutbox()).find((item) => item.resource.resourceKey === key)?.resource)
      .toMatchObject({ deletedAt, nativeBookmarkIds: [] });
    await deleteLocalResource(key);
  });

  it("uploads a deleted resource as a tombstone", async () => {
    const key = `upload-delete-${crypto.randomUUID()}`;
    const tombstone = createResourceTombstone(resource(key));
    request.mockResolvedValue({ resourceKey: key, revision: 2, deleted: true });

    await syncOneResource(tombstone, "", "operation-delete");

    const init = request.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toMatchObject({
      operationId: "operation-delete",
      deleted: true
    });
  });

  it("removes only Aarre local data when pulling a cloud tombstone", async () => {
    const key = `remote-delete-${crypto.randomUUID()}`;
    await upsertLocalResource(resource(key));
    localValues["aarre:cloud-sync-cursor:v1"] = 12;
    request.mockResolvedValue({
      changes: [{
        sequence: 13,
        entityType: "resource",
        entityId: key,
        revision: 2,
        deleted: true
      }],
      cursor: 13,
      hasMore: false,
      fullResyncRequired: false
    });

    await pullCloudResources();

    await expect(getLocalResource(key)).resolves.toBeUndefined();
    expect(removeNativeBookmark).not.toHaveBeenCalled();
  });
});

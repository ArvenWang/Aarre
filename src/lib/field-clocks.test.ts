import { describe, expect, it } from "vitest";
import {
  deriveFieldClocks,
  isEmptyFieldValue,
  mergeResourceByFieldClocks
} from "./field-clocks";
import type { ResourceRecord } from "./types";

const EARLY = "2026-08-01T00:00:00.000Z";
const LATE = "2026-08-02T00:00:00.000Z";

function resource(overrides: Partial<ResourceRecord> = {}): ResourceRecord {
  return {
    resourceKey: "key-1",
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

describe("isEmptyFieldValue", () => {
  it("treats missing, blank and empty collections as absent", () => {
    expect(isEmptyFieldValue(undefined)).toBe(true);
    expect(isEmptyFieldValue("")).toBe(true);
    expect(isEmptyFieldValue([])).toBe(true);
    expect(isEmptyFieldValue("a")).toBe(false);
    expect(isEmptyFieldValue(["a"])).toBe(false);
  });
});

describe("deriveFieldClocks", () => {
  it("only advances clocks for fields that actually changed", () => {
    const previous = resource({
      summary: "old summary",
      tags: ["a"],
      fieldUpdatedAt: { summary: EARLY, tags: EARLY }
    });
    const next = resource({
      summary: "old summary",
      tags: ["a", "b"],
      updatedAt: LATE
    });

    const clocks = deriveFieldClocks(previous, next);

    expect(clocks.summary).toBe(EARLY);
    expect(clocks.tags).toBe(LATE);
  });

  it("keeps clocks strictly increasing when the timestamp does not advance", () => {
    const previous = resource({
      summary: "old",
      fieldUpdatedAt: { summary: LATE }
    });
    const next = resource({ summary: "new", updatedAt: EARLY });

    expect(deriveFieldClocks(previous, next).summary > LATE).toBe(true);
  });

  it("stamps every field on first write", () => {
    const clocks = deriveFieldClocks(undefined, resource({ updatedAt: LATE }));
    expect(clocks.summary).toBe(LATE);
    expect(clocks.tags).toBe(LATE);
  });
});

describe("mergeResourceByFieldClocks", () => {
  it("fills in fields the local device is missing", () => {
    const local = resource({ tags: ["local-tag"] });
    const remote = resource({ summary: "cloud summary", tags: [] });

    const { record } = mergeResourceByFieldClocks(local, remote, {
      summary: LATE
    });

    expect(record.summary).toBe("cloud summary");
    expect(record.tags).toEqual(["local-tag"]);
  });

  it("never lets an absent remote field erase local content", () => {
    const local = resource({
      summary: "local summary",
      fieldUpdatedAt: { summary: EARLY }
    });
    const remote = resource({ summary: "", updatedAt: LATE });

    const { record, localHasUnsyncedFields } = mergeResourceByFieldClocks(
      local,
      remote,
      { updatedAt: LATE }
    );

    expect(record.summary).toBe("local summary");
    expect(localHasUnsyncedFields).toBe(true);
  });

  it("merges disjoint edits from two devices instead of picking a winner", () => {
    const local = resource({
      summary: "written on device A",
      fieldUpdatedAt: { summary: LATE, userNote: EARLY }
    });
    const remote = resource({
      summary: "",
      userNote: "written on device B",
      updatedAt: LATE
    });

    const { record } = mergeResourceByFieldClocks(local, remote, {
      userNote: LATE
    });

    expect(record.summary).toBe("written on device A");
    expect(record.userNote).toBe("written on device B");
  });

  it("does not resurrect a tag the user removed on another device", () => {
    const local = resource({
      tags: ["keep", "remove-me"],
      fieldUpdatedAt: { tags: EARLY }
    });
    const remote = resource({ tags: ["keep"], updatedAt: LATE });

    const { record } = mergeResourceByFieldClocks(local, remote, {
      tags: LATE
    });

    expect(record.tags).toEqual(["keep"]);
  });

  it("keeps a user-chosen cover over a newer automatic one", () => {
    const local = resource({
      coverSource: "user-capture",
      coverOrigin: "user",
      fieldUpdatedAt: { coverSource: EARLY, coverOrigin: EARLY }
    });
    const remote = resource({
      coverSource: "og-image",
      coverOrigin: "auto",
      updatedAt: LATE
    });

    const { record } = mergeResourceByFieldClocks(local, remote, {
      coverSource: LATE,
      coverOrigin: LATE
    });

    expect(record.coverSource).toBe("user-capture");
    expect(record.coverOrigin).toBe("user");
  });

  it("lets a newer user-chosen cover replace an older user-chosen one", () => {
    const local = resource({
      coverSource: "user-capture-old",
      coverOrigin: "user",
      fieldUpdatedAt: { coverSource: EARLY }
    });
    const remote = resource({
      coverSource: "user-capture-new",
      coverOrigin: "user",
      updatedAt: LATE
    });

    const { record } = mergeResourceByFieldClocks(local, remote, {
      coverSource: LATE
    });

    expect(record.coverSource).toBe("user-capture-new");
  });

  it("adopts the cloud record wholesale when the resource is new locally", () => {
    const remote = resource({ summary: "cloud only", updatedAt: LATE });

    const { record, localHasUnsyncedFields } = mergeResourceByFieldClocks(
      undefined,
      remote,
      { summary: LATE }
    );

    expect(record.summary).toBe("cloud only");
    expect(localHasUnsyncedFields).toBe(false);
  });

  it("converges to the same result regardless of which device syncs first", () => {
    const deviceA = resource({
      summary: "A summary",
      fieldUpdatedAt: { summary: LATE }
    });
    const deviceB = resource({
      userNote: "B note",
      tags: ["b-tag"],
      fieldUpdatedAt: { userNote: LATE, tags: LATE }
    });

    const aThenB = mergeResourceByFieldClocks(deviceA, deviceB).record;
    const bThenA = mergeResourceByFieldClocks(deviceB, deviceA).record;

    expect(aThenB.summary).toBe("A summary");
    expect(aThenB.userNote).toBe("B note");
    expect(aThenB.tags).toEqual(["b-tag"]);
    expect(bThenA.summary).toBe(aThenB.summary);
    expect(bThenA.userNote).toBe(aThenB.userNote);
    expect(bThenA.tags).toEqual(aThenB.tags);
  });
});

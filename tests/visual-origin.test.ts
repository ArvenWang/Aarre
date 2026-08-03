import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { deleteVisual, getVisual } from "../src/lib/storage";
import { putVisual } from "../src/lib/visuals";
import type { VisualAsset } from "../src/lib/types";

function asset(key: string, origin: VisualAsset["origin"], bytes: string): VisualAsset {
  return {
    key,
    kind: "cover",
    identity: key.slice("cover:".length),
    blob: new Blob([bytes], { type: "image/webp" }),
    mime: "image/webp",
    width: 800,
    height: 450,
    origin,
    source: origin === "user" ? "user-image" : "screenshot",
    contentHash: bytes,
    updatedAt: "2026-08-04T00:00:00.000Z",
    renderVersion: 1
  };
}

describe("visual origin guard", () => {
  it("rejects automatic replacement of a user cover", async () => {
    const key = `cover:${crypto.randomUUID()}`;
    await putVisual(asset(key, "user", "user"));

    await expect(putVisual(asset(key, "auto", "auto"))).resolves.toBe(false);
    expect(await (await getVisual(key))?.blob.text()).toBe("user");
    await deleteVisual(key);
  });

  it("allows an explicit forced replacement", async () => {
    const key = `cover:${crypto.randomUUID()}`;
    await putVisual(asset(key, "user", "user"));

    await expect(putVisual(asset(key, "auto", "forced"), { force: true })).resolves.toBe(true);
    expect(await (await getVisual(key))?.blob.text()).toBe("forced");
    await deleteVisual(key);
  });

  it("allows a newer user choice to replace an older user cover", async () => {
    const key = `cover:${crypto.randomUUID()}`;
    await putVisual(asset(key, "user", "first"));

    await expect(putVisual(asset(key, "user", "second"))).resolves.toBe(true);
    expect(await (await getVisual(key))?.blob.text()).toBe("second");
    await deleteVisual(key);
  });
});

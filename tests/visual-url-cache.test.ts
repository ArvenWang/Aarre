import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearVisualUrlCache,
  objectUrlFor
} from "../src/ui/manager/visual-url-cache";

afterEach(() => {
  clearVisualUrlCache();
  vi.unstubAllGlobals();
});

describe("manager visual URL cache", () => {
  it("reuses matching content and revokes the oldest object URLs above 200", () => {
    const revoked: string[] = [];
    let sequence = 0;
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => `blob:test-${sequence++}`),
      revokeObjectURL: vi.fn((url: string) => revoked.push(url))
    });
    const blob = new Blob(["cover"]);
    expect(objectUrlFor("cover:same", blob, "v1")).toBe("blob:test-0");
    expect(objectUrlFor("cover:same", blob, "v1")).toBe("blob:test-0");
    for (let index = 0; index < 200; index += 1) {
      objectUrlFor(`cover:${index}`, blob, String(index));
    }
    expect(revoked).toContain("blob:test-0");
  });

  it("uses direct IndexedDB batching, keeps offscreen covers, and requests async decoding", async () => {
    const source = await readFile(
      fileURLToPath(new URL("../src/ui/manager/components/LibraryCardCover.tsx", import.meta.url)),
      "utf8"
    );
    const cache = await readFile(
      fileURLToPath(new URL("../src/ui/manager/visual-url-cache.ts", import.meta.url)),
      "utf8"
    );
    expect(source).toContain('decoding="async"');
    expect(source).not.toContain("GET_PAGE_SNAPSHOT");
    expect(source).not.toContain("if (!nearViewport) {");
    expect(cache).toContain("getVisuals(keys)");
    expect(cache).toContain("setTimeout(() => void flush(), 16)");
    expect(cache).toContain("URL.revokeObjectURL");
  });
});

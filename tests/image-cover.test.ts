import { describe, expect, it } from "vitest";
import { blobToDataUrl } from "../src/lib/image-cover";

describe("blobToDataUrl", () => {
  it("converts an image blob to a data URL without FileReader", async () => {
    const bytes = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x00, 0xff]);
    const blob = new Blob([bytes], { type: "image/gif" });
    await expect(blobToDataUrl(blob)).resolves.toBe(
      `data:image/gif;base64,${Buffer.from(bytes).toString("base64")}`
    );
  });

  it("falls back to image/png when the blob has no type", async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])]);
    const dataUrl = await blobToDataUrl(blob);
    expect(dataUrl.startsWith("data:image/png;base64,")).toBe(true);
  });

  it("handles multi-chunk payloads", async () => {
    const big = new Uint8Array(200_000).fill(7);
    const blob = new Blob([big], { type: "image/webp" });
    const dataUrl = await blobToDataUrl(blob);
    expect(dataUrl.length).toBeGreaterThan(200_000);
    expect(dataUrl.startsWith("data:image/webp;base64,")).toBe(true);
  });
});

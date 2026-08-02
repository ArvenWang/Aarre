import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeSiteIconWithOffscreen } from "../src/extension/offscreen-icon-decoder";
import {
  OFFSCREEN_SITE_ICON_RESPONSE,
  OFFSCREEN_SITE_ICON_TARGET
} from "../src/lib/offscreen-icon-protocol";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("offscreen site-icon decoder client", () => {
  it("creates the hidden document and returns its validated render result", async () => {
    const createDocument = vi.fn(async () => undefined);
    const sendMessage = vi.fn(async (request: { requestId: string }) => ({
      type: OFFSCREEN_SITE_ICON_RESPONSE,
      target: OFFSCREEN_SITE_ICON_TARGET,
      requestId: request.requestId,
      ok: true,
      result: {
        iconDataUrl: "data:image/webp;base64,OFFSCREEN",
        iconDataUrlLight: "data:image/webp;base64,OFFSCREEN",
        iconRenderVersion: 6,
        nativeWidth: 192,
        nativeHeight: 192
      }
    }));
    vi.stubGlobal("chrome", {
      runtime: {
        getURL: (path: string) => `chrome-extension://test/${path}`,
        getContexts: vi.fn(async () => []),
        sendMessage
      },
      offscreen: {
        Reason: { BLOBS: "BLOBS" },
        createDocument
      }
    });

    const result = await decodeSiteIconWithOffscreen({
      source: new Blob(["image"], { type: "image/png" }),
      vector: false,
      nativeWidth: 192,
      nativeHeight: 192
    });

    expect(createDocument).toHaveBeenCalledWith({
      url: "icon-processor.html",
      reasons: ["BLOBS"],
      justification:
        "Decode validated site icons that a Manifest V3 service worker cannot render."
    });
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        target: OFFSCREEN_SITE_ICON_TARGET,
        dataUrl: expect.stringMatching(/^data:image\/png;base64,/),
        vector: false,
        nativeWidth: 192,
        nativeHeight: 192
      })
    );
    expect(result.iconDataUrlLight).toBe(
      "data:image/webp;base64,OFFSCREEN"
    );
  });
});

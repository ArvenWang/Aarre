import { describe, expect, it } from "vitest";
import {
  isOffscreenSiteIconRequest,
  isOffscreenSiteIconResponse,
  OFFSCREEN_SITE_ICON_REQUEST,
  OFFSCREEN_SITE_ICON_RESPONSE,
  OFFSCREEN_SITE_ICON_TARGET
} from "../src/lib/offscreen-icon-protocol";

describe("offscreen site-icon protocol", () => {
  it("accepts only targeted decode requests", () => {
    expect(
      isOffscreenSiteIconRequest({
        type: OFFSCREEN_SITE_ICON_REQUEST,
        target: OFFSCREEN_SITE_ICON_TARGET,
        requestId: "request-1",
        dataUrl: "data:image/svg+xml;base64,PHN2Zy8+",
        vector: true
      })
    ).toBe(true);
    expect(
      isOffscreenSiteIconRequest({
        type: OFFSCREEN_SITE_ICON_REQUEST,
        target: "background",
        requestId: "request-1",
        dataUrl: "data:image/svg+xml;base64,PHN2Zy8+",
        vector: true
      })
    ).toBe(false);
  });

  it("matches responses to the originating request", () => {
    const response = {
      type: OFFSCREEN_SITE_ICON_RESPONSE,
      target: OFFSCREEN_SITE_ICON_TARGET,
      requestId: "request-1",
      ok: true,
      result: { iconDataUrlLight: "data:image/webp;base64,RESULT" }
    };
    expect(isOffscreenSiteIconResponse(response, "request-1")).toBe(true);
    expect(isOffscreenSiteIconResponse(response, "request-2")).toBe(false);
  });
});

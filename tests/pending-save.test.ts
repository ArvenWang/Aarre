import { describe, expect, it } from "vitest";
import {
  createPendingSaveDraft,
  pendingSaveReadyTabId
} from "../src/lib/pending-save";

describe("createPendingSaveDraft", () => {
  it("preserves page context for the side panel form", () => {
    const draft = createPendingSaveDraft({
      kind: "page",
      tabId: 12,
      url: "https://example.com/article",
      tabTitle: "Useful article",
      faviconUrl: "https://example.com/favicon.ico",
      selectedText: "selected context",
      createdAt: "2026-07-29T00:00:00.000Z"
    });

    expect(draft).toMatchObject({
      kind: "page",
      tabId: 12,
      title: "Useful article",
      selectedText: "selected context"
    });
  });

  it("uses the destination host as a safe link title", () => {
    const draft = createPendingSaveDraft({
      kind: "link",
      tabId: 12,
      url: "https://docs.example.com/guide",
      tabTitle: "Current page"
    });

    expect(draft.title).toBe("docs.example.com");
    expect(draft.faviconUrl).toBe("");
  });

  it("rejects executable bookmark targets", () => {
    expect(() =>
      createPendingSaveDraft({
        kind: "link",
        tabId: 12,
        url: "javascript:alert(1)"
      })
    ).toThrow("无法保存");
  });

  it("uses the tab id carried by a ready message", () => {
    expect(
      pendingSaveReadyTabId({
        type: "PENDING_SAVE_READY",
        tabId: 42
      })
    ).toBe(42);
  });

  it("ignores unrelated or malformed ready messages", () => {
    expect(
      pendingSaveReadyTabId({
        type: "LIBRARY_SCAN_UPDATED",
        tabId: 42
      })
    ).toBeNull();
    expect(
      pendingSaveReadyTabId({
        type: "PENDING_SAVE_READY"
      })
    ).toBeNull();
  });
});

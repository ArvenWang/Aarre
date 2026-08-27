import { readFile } from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  nativeBookmarkFeedbackMessage,
  showNativeBookmarkFeedback
} from "../src/extension/bookmark-feedback";

describe("Chrome native bookmark feedback", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("describes the real AI state instead of claiming every save was analyzed", () => {
    expect(
      nativeBookmarkFeedbackMessage({
        privacyBlocked: false,
        needsAi: true,
        aiConfigured: true
      })
    ).toBe("Chrome 收藏成功 · AI 分析中");
    expect(
      nativeBookmarkFeedbackMessage({
        privacyBlocked: false,
        needsAi: true,
        aiConfigured: false
      })
    ).toBe("Chrome 收藏成功 · 配置 AI 后自动分析");
    expect(
      nativeBookmarkFeedbackMessage({
        privacyBlocked: true,
        needsAi: true,
        aiConfigured: true
      })
    ).toContain("隐私保护");
    expect(
      nativeBookmarkFeedbackMessage({
        privacyBlocked: false,
        needsAi: false,
        aiConfigured: true
      })
    ).toContain("AI 信息已就绪");
  });

  it("injects a transient page status into the exact bookmarked tab", async () => {
    const executeScript = vi.fn().mockResolvedValue([]);
    vi.stubGlobal("chrome", { scripting: { executeScript } });

    await showNativeBookmarkFeedback(42, "已收藏到 Chrome");

    expect(executeScript).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { tabId: 42 },
        args: [
          "已收藏到 Chrome"
        ],
        func: expect.any(Function)
      })
    );
  });

  it("only enables native feedback for external onCreated saves", async () => {
    const [events, resources] = await Promise.all([
      readFile(
        new URL(
          "../src/extension/coordinators/bookmark-events.ts",
          import.meta.url
        ),
        "utf8"
      ),
      readFile(
        new URL("../src/extension/handlers/resources.ts", import.meta.url),
        "utf8"
      )
    ]);

    expect(events).toContain("feedback: true");
    expect(resources).toContain("options.feedback");
    expect(resources).toContain("nativeBookmarkFeedbackMessage");
    expect(resources).toContain("resourceMatchesLoadedUrl(resource, current.url)");
  });
});

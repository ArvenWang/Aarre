import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from "vitest";
import { sendExtensionRequest } from "../src/lib/messages";

const sendMessage = vi.fn();

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  sendMessage.mockReset();
  vi.stubGlobal("chrome", {
    runtime: {
      sendMessage
    }
  });
});

describe("extension message compatibility", () => {
  it("returns valid background data", async () => {
    sendMessage.mockResolvedValue({
      ok: true,
      data: []
    });

    await expect(
      sendExtensionRequest({ type: "GET_LOCAL_RESOURCES" })
    ).resolves.toEqual([]);
  });

  it("reports an actionable error when an old background returns no data", async () => {
    sendMessage.mockResolvedValue({
      ok: true,
      data: undefined
    });

    await expect(
      sendExtensionRequest({ type: "GET_LOCAL_RESOURCES" })
    ).rejects.toThrow("界面与后台版本不一致");
  });

  it("keeps the foreground backfill status contract typed end to end", async () => {
    const status = {
      id: "backfill-1",
      state: "waiting_focus" as const,
      candidateCount: 9,
      total: 12,
      processed: 3,
      succeeded: 2,
      failed: 1,
      skipped: 0,
      currentTitle: "Example",
      errors: [],
      concurrency: 3 as const,
      requiresForeground: false as const,
      tabId: 42
    };
    sendMessage.mockResolvedValue({ ok: true, data: status });

    await expect(
      sendExtensionRequest({
        type: "GET_SNAPSHOT_BACKFILL",
        includeCandidateCount: true
      })
    ).resolves.toEqual(status);
  });
});

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
});

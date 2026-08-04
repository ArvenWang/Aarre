import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  conversationHasCompletedAnswer,
  getAgentConversations,
  saveAgentConversation,
  saveIncomingAgentConversation,
} from "../src/lib/conversations";
import type { AgentConversation } from "../src/lib/types";

let store: Record<string, unknown>;

function conversation(updatedAt: string, content: string): AgentConversation {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    title: "同步测试",
    createdAt: "2026-08-05T00:00:00.000Z",
    updatedAt,
    messages: [
      {
        id: "user-1",
        role: "user",
        content: "问题",
        createdAt: "2026-08-05T00:00:00.000Z",
        status: "complete",
      },
      {
        id: "assistant-1",
        role: "assistant",
        content,
        createdAt: "2026-08-05T00:00:00.000Z",
        status: content ? "complete" : "sending",
      },
    ],
  };
}

beforeEach(() => {
  store = {};
  vi.stubGlobal("chrome", {
    storage: {
      local: {
        async get(key: string) { return { [key]: store[key] }; },
        async set(next: Record<string, unknown>) { Object.assign(store, next); },
      },
    },
  });
});

describe("conversation sync guards", () => {
  it("keeps newer local content when cloud is older", async () => {
    await saveAgentConversation(conversation("2026-08-05T02:00:00.000Z", "完整答案"));
    await expect(
      saveIncomingAgentConversation(conversation("2026-08-05T01:00:00.000Z", "旧云端答案")),
    ).resolves.toBe(false);
    expect((await getAgentConversations())[0]?.messages[1]?.content).toBe("完整答案");
  });

  it("applies cloud content when it is newer", async () => {
    await saveAgentConversation(conversation("2026-08-05T01:00:00.000Z", "旧本地答案"));
    await expect(
      saveIncomingAgentConversation(conversation("2026-08-05T02:00:00.000Z", "较新云端答案")),
    ).resolves.toBe(true);
    expect((await getAgentConversations())[0]?.messages[1]?.content).toBe("较新云端答案");
  });

  it("rejects a conversation whose assistant answer is only an empty placeholder", () => {
    expect(conversationHasCompletedAnswer(conversation("2026-08-05T01:00:00.000Z", ""))).toBe(false);
    expect(conversationHasCompletedAnswer(conversation("2026-08-05T01:00:00.000Z", "真实回答"))).toBe(true);
  });
});

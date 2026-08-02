import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  deleteAgentConversation,
  getAgentConversations,
  saveAgentConversation
} from "../src/lib/conversations";
import type { AgentConversation } from "../src/lib/types";

let store: Record<string, unknown>;

beforeEach(() => {
  store = {};
  vi.stubGlobal("chrome", {
    storage: {
      local: {
        async get(key: string) {
          return { [key]: store[key] };
        },
        async set(value: Record<string, unknown>) {
          Object.assign(store, value);
        }
      }
    }
  });
});

function conversation(id: string, updatedAt: string): AgentConversation {
  return {
    id,
    title: `会话 ${id}`,
    createdAt: updatedAt,
    updatedAt,
    messages: [
      {
        id: `${id}-message`,
        role: "user",
        content: "寻找设计资料",
        createdAt: updatedAt,
        status: "complete"
      }
    ]
  };
}

describe("agent conversations", () => {
  it("stores real conversations in newest-first order", async () => {
    await saveAgentConversation(
      conversation("old", "2026-07-29T01:00:00.000Z")
    );
    await saveAgentConversation(
      conversation("new", "2026-07-29T02:00:00.000Z")
    );

    expect((await getAgentConversations()).map((item) => item.id)).toEqual([
      "new",
      "old"
    ]);
  });

  it("updates and deletes a conversation by id", async () => {
    await saveAgentConversation(
      conversation("one", "2026-07-29T01:00:00.000Z")
    );
    await saveAgentConversation({
      ...conversation("one", "2026-07-29T03:00:00.000Z"),
      title: "更新后的标题"
    });
    expect(await getAgentConversations()).toHaveLength(1);
    expect((await getAgentConversations())[0]?.title).toBe("更新后的标题");

    await deleteAgentConversation("one");
    expect(await getAgentConversations()).toEqual([]);
  });

  it("keeps the 50 most recently updated conversations", async () => {
    for (let index = 0; index < 51; index += 1) {
      await saveAgentConversation(
        conversation(
          `conversation-${index}`,
          new Date(
            Date.UTC(2026, 6, 29, 0, index)
          ).toISOString()
        )
      );
    }

    const saved = await getAgentConversations();
    expect(saved).toHaveLength(50);
    expect(saved[0]?.id).toBe("conversation-50");
    expect(
      saved.some((item) => item.id === "conversation-0")
    ).toBe(false);
  });

  it("ignores corrupted stored messages instead of crashing the chat UI", async () => {
    store["aarre:agent-conversations"] = [
      {
        ...conversation("valid", "2026-07-29T01:00:00.000Z")
      },
      {
        id: "broken",
        title: "坏数据",
        createdAt: "2026-07-29T01:00:00.000Z",
        updatedAt: "2026-07-29T01:00:00.000Z",
        messages: [{ role: "assistant", content: 42 }]
      }
    ];

    expect((await getAgentConversations()).map((item) => item.id)).toEqual([
      "valid"
    ]);
  });
});

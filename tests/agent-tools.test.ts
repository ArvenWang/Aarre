import { describe, expect, it, vi } from "vitest";
import {
  createReadTools,
  proposalsFromWriteTool,
  toolDefinitions,
  type AgentToolContext
} from "../src/lib/agent/tools";
import { MAX_TOOL_ROUNDS, runAgent, type AgentProvider } from "../src/lib/agent/runner";
import type { AgentToolCall } from "../src/lib/agent/types";
import type { ResourceRecord } from "../src/lib/types";

function context(): AgentToolContext {
  const resource: ResourceRecord = {
    resourceKey: "resource-design",
    canonicalUrl: "https://example.com/design",
    url: "https://example.com/design",
    title: "设计系统指南",
    userNote: "",
    summary: "组件与设计令牌",
    tags: ["设计"],
    topics: ["设计系统"],
    contentExcerpt: "",
    contentHash: "",
    selectedText: "",
    author: "",
    siteName: "Example",
    language: "zh",
    imageUrl: "",
    faviconUrl: "",
    nativeBookmarkIds: ["bookmark-1"],
    nativeFolderPath: ["书签栏", "设计"],
    aiStatus: "ready",
    syncStatus: "synced",
    createdAt: "2026-08-04T00:00:00.000Z",
    updatedAt: "2026-08-04T00:00:00.000Z"
  };
  return {
    resources: [resource],
    catalog: {
      bookmarks: [{
        id: "bookmark-1", parentId: "folder-design", title: resource.title,
        url: resource.url, path: ["书签栏", "设计"], writable: true
      }],
      folders: [{
        id: "folder-design", title: "设计", path: ["书签栏", "设计"], writable: true
      }]
    }
  };
}

function response(call?: AgentToolCall, text = "") {
  const toolCalls = call ? [call] : [];
  return {
    text,
    toolCalls,
    assistantMessage: { role: "assistant" as const, content: text, toolCalls },
    providerName: "Mock"
  };
}

describe("agent tools", () => {
  it("converts every zod schema to usable JSON Schema", () => {
    const definitions = toolDefinitions(context());
    expect(definitions).toHaveLength(12);
    for (const definition of definitions) {
      expect(definition.parameters).toMatchObject({ type: "object" });
    }
  });

  it("executes read tools against real local search and insights", async () => {
    const tools = createReadTools(context());
    await expect(tools.search_bookmarks.execute({ query: "设计", limit: 30 })).resolves.toMatchObject({
      results: [{ resourceKey: "resource-design", title: "设计系统指南" }]
    });
    await expect(tools.get_library_stats.execute()).resolves.toMatchObject({
      bookmarks: 1,
      folders: 1,
      untagged: 0
    });
  });

  it("turns write tools into a plan without calling Chrome mutation APIs", () => {
    const create = vi.fn();
    const move = vi.fn();
    vi.stubGlobal("chrome", { bookmarks: { create, move } });
    const proposals = proposalsFromWriteTool(context(), "plan_move_bookmarks", {
      moves: [{ bookmarkId: "bookmark-1", targetFolderPath: "书签栏/设计" }]
    });
    expect(proposals).toMatchObject([{ type: "move_bookmark", targetId: "bookmark-1", destinationId: "folder-design" }]);
    expect(create).not.toHaveBeenCalled();
    expect(move).not.toHaveBeenCalled();
  });

  it("forces a stop after twelve tool rounds", async () => {
    const provider: AgentProvider = {
      call: vi.fn(async () => response({ id: crypto.randomUUID(), name: "get_library_stats", arguments: {} }))
    };
    const result = await runAgent({ query: "继续分析", context: context(), provider });
    expect(result.stoppedByLimit).toBe(true);
    expect(result.rounds).toBe(MAX_TOOL_ROUNDS);
    expect(provider.call).toHaveBeenCalledTimes(MAX_TOOL_ROUNDS);
  });

  it("runs a complete multi-tool organization scenario and produces a pending plan", async () => {
    const sequence = [
      response({ id: "1", name: "get_library_stats", arguments: {} }),
      response({ id: "2", name: "list_folders", arguments: {} }),
      response({ id: "3", name: "search_bookmarks", arguments: { query: "设计", limit: 30 } }),
      response({ id: "4", name: "plan_create_folders", arguments: { folders: [{ path: "书签栏/设计", reason: "集中整理" }] } }),
      response({ id: "5", name: "plan_move_bookmarks", arguments: { moves: [{ bookmarkId: "bookmark-1", targetFolderPath: "书签栏/设计" }] } }),
      response(undefined, "已形成整理计划，请核对后执行。")
    ];
    const provider: AgentProvider = { call: vi.fn(async () => sequence.shift()!) };

    const result = await runAgent({ query: "把我的书签重新整理一下", context: context(), provider });

    expect(result.answer).toContain("整理计划");
    expect(result.plan.actions.map((action) => action.type)).toEqual(["create_folder", "move_bookmark"]);
    expect(result.plan.actions.every((action) => action.status === "pending")).toBe(true);
  });

  it("streams the final natural-language answer in chunks", async () => {
    const deltas: string[] = [];
    const provider: AgentProvider = {
      call: vi.fn(async () => response(undefined, "non-stream fallback")),
      streamFinal: vi.fn(async ({ onDelta }) => {
        onDelta("第一段");
        onDelta("，第二段");
        return { text: "第一段，第二段", providerName: "Mock Stream" };
      })
    };
    const result = await runAgent({
      query: "总结",
      context: context(),
      provider,
      onDelta: (text) => deltas.push(text)
    });
    expect(deltas).toEqual(["第一段", "，第二段"]);
    expect(result.answer).toBe("第一段，第二段");
    expect(provider.streamFinal).toHaveBeenCalledTimes(1);
  });
});

import { describe, expect, it, vi } from "vitest";
import { executeAgentPlan } from "../src/lib/agent/plan-execution";
import type { BookmarkAgentActionProposal } from "../src/lib/types";

function action(index: number, type: BookmarkAgentActionProposal["type"] = "move_bookmark"): BookmarkAgentActionProposal {
  return {
    id: `action-${index}`,
    type,
    label: `${type}-${index}`,
    description: "test",
    destructive: type.startsWith("delete_"),
    status: "pending",
    targetId: `bookmark-${index}`,
    destinationId: "folder"
  };
}

describe("agent plan execution", () => {
  it("executes 500 moves in batches and creates one undo batch", async () => {
    const prepareUndoBatch = vi.fn(async () => ({ id: "undo-one" }));
    const execute = vi.fn(async () => undefined);
    const progress = vi.fn();
    const result = await executeAgentPlan(
      Array.from({ length: 500 }, (_, index) => action(index)),
      { prepareUndoBatch, execute },
      { onProgress: progress }
    );
    expect(result.done).toBe(500);
    expect(execute).toHaveBeenCalledTimes(500);
    expect(progress).toHaveBeenCalledTimes(10);
    expect(prepareUndoBatch).toHaveBeenCalledTimes(1);
    expect(result.undoBatch).toEqual({ id: "undo-one" });
  });

  it("keeps completed work and skips the remainder after abort", async () => {
    const controller = new AbortController();
    let count = 0;
    const result = await executeAgentPlan(
      Array.from({ length: 100 }, (_, index) => action(index)),
      {
        prepareUndoBatch: async () => ({ id: "undo" }),
        execute: async () => {
          count += 1;
          if (count === 17) controller.abort();
        }
      },
      { signal: controller.signal }
    );
    expect(result.cancelled).toBe(true);
    expect(result.done).toBe(17);
    expect(count).toBe(17);
  });

  it("continues after individual failures", async () => {
    const result = await executeAgentPlan(
      Array.from({ length: 5 }, (_, index) => action(index)),
      {
        prepareUndoBatch: async () => ({ id: "undo" }),
        execute: async (step) => {
          if (step.id === "action-2") throw new Error("failed-two");
        }
      }
    );
    expect(result.done).toBe(5);
    expect(result.failures).toMatchObject([{ action: { id: "action-2" }, error: "failed-two" }]);
  });

  it("orders folders before moves, then rename, metadata, and deletion", async () => {
    const seen: string[] = [];
    const actions = [
      action(5, "delete_bookmark"),
      action(3, "update_metadata"),
      action(2, "update_bookmark"),
      action(1, "move_bookmark"),
      { ...action(0, "create_folder"), plannedPath: "A" }
    ];
    await executeAgentPlan(actions, {
      prepareUndoBatch: async () => ({ id: "one-batch" }),
      execute: async (step) => { seen.push(step.type); }
    });
    expect(seen).toEqual([
      "create_folder",
      "move_bookmark",
      "update_bookmark",
      "update_metadata",
      "delete_bookmark"
    ]);
  });
});

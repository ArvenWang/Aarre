import type { BookmarkAgentActionProposal } from "../types";

export const AGENT_PLAN_BATCH_SIZE = 50;

const ORDER: Record<BookmarkAgentActionProposal["type"], number> = {
  create_folder: 0,
  create_bookmark: 0,
  move_bookmark: 1,
  move_folder: 1,
  update_bookmark: 2,
  rename_folder: 2,
  update_metadata: 3,
  delete_bookmark: 4,
  delete_folder: 4
};

export function orderAgentPlanActions(
  actions: BookmarkAgentActionProposal[]
): BookmarkAgentActionProposal[] {
  return actions
    .map((action, index) => ({ action, index }))
    .sort((left, right) =>
      ORDER[left.action.type] - ORDER[right.action.type] ||
      (left.action.type === "create_folder" && right.action.type === "create_folder"
        ? (left.action.plannedPath?.split("/").length || 0) -
          (right.action.plannedPath?.split("/").length || 0)
        : left.index - right.index)
    )
    .map(({ action }) => action);
}

export interface PlanExecutionFailure {
  action: BookmarkAgentActionProposal;
  error: string;
}

export async function executeAgentPlan<TUndo>(
  actions: BookmarkAgentActionProposal[],
  dependencies: {
    prepareUndoBatch(actions: BookmarkAgentActionProposal[]): Promise<TUndo>;
    execute(action: BookmarkAgentActionProposal): Promise<void>;
  },
  options: {
    signal?: AbortSignal;
    onProgress?: (done: number, total: number) => void;
  } = {}
) {
  const ordered = orderAgentPlanActions(actions);
  const undoBatch = await dependencies.prepareUndoBatch(ordered);
  const failures: PlanExecutionFailure[] = [];
  let done = 0;
  for (let offset = 0; offset < ordered.length; offset += AGENT_PLAN_BATCH_SIZE) {
    const batch = ordered.slice(offset, offset + AGENT_PLAN_BATCH_SIZE);
    for (const action of batch) {
      if (options.signal?.aborted) {
        return { done, total: ordered.length, failures, undoBatch, cancelled: true };
      }
      try {
        await dependencies.execute(action);
      } catch (error) {
        failures.push({
          action,
          error: error instanceof Error ? error.message : String(error)
        });
      }
      done += 1;
    }
    options.onProgress?.(done, ordered.length);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return { done, total: ordered.length, failures, undoBatch, cancelled: false };
}

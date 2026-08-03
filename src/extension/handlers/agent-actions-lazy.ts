/** Lazy boundary for write-capable Agent plan execution and undo machinery. */
export function createAgentActionHandlers(dependencies: any) {
  let loaded: Promise<ReturnType<
    typeof import("./agent-actions")["createAgentActionHandlers"]
  >> | undefined;
  const load = () =>
    loaded ||= import("./agent-actions").then((module) =>
      module.createAgentActionHandlers(dependencies),
    );

  return {
    executeBookmarkAgentActions: async (...args: any[]) => {
      const run = (await load()).executeBookmarkAgentActions as (...input: any[]) => any;
      return run(...args);
    },
    cancelAgentPlanExecution: (...args: any[]) => {
      void load().then((handlers) => {
        const cancel = handlers.cancelAgentPlanExecution as (...input: any[]) => any;
        return cancel(...args);
      });
    },
    getRecentUndoSnapshots: async (...args: any[]) => {
      const get = (await load()).getRecentUndoSnapshots as (...input: any[]) => any;
      return get(...args);
    },
    undoStoredBookmarkBatch: async (...args: any[]) => {
      const undo = (await load()).undoStoredBookmarkBatch as (...input: any[]) => any;
      return undo(...args);
    },
  };
}

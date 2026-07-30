import { createUndoBatch } from "./bookmark-undo";
import type {
  UndoBatchResult,
  UndoMutation,
  UndoSnapshotBatch
} from "./types";

export interface ProtectedBookmarkMutationInput<T> {
  label: string;
  destructive: boolean;
  mutation: UndoMutation;
  perform: () => Promise<T>;
  createdNodeId?: (result: T) => string | undefined;
}

export interface ProtectedBookmarkMutationDependencies {
  putSnapshot: (batch: UndoSnapshotBatch) => Promise<void>;
  deleteSnapshot: (batchId: string) => Promise<void>;
  rollback: (
    batch: UndoSnapshotBatch
  ) => Promise<UndoBatchResult | null>;
}

/**
 * 先持久化可恢复数据，再执行 Chrome 写入；写入完成后的状态回写如果失败，
 * 必须立刻用刚才的快照回滚，避免留下无法撤销的半完成操作。
 */
export async function executeProtectedBookmarkMutation<T>(
  input: ProtectedBookmarkMutationInput<T>,
  dependencies: ProtectedBookmarkMutationDependencies
): Promise<T> {
  const batch = createUndoBatch({
    source: "manual",
    label: input.label,
    destructive: input.destructive,
    mutations: [{ ...input.mutation, applied: true }]
  });
  await dependencies.putSnapshot(batch);

  let result: T;
  try {
    result = await input.perform();
  } catch (error) {
    await dependencies
      .deleteSnapshot(batch.batchId)
      .catch(() => undefined);
    throw error;
  }

  const createdNodeId = input.createdNodeId?.(result);
  const ready: UndoSnapshotBatch = {
    ...batch,
    status: "ready",
    mutations: batch.mutations.map((mutation) => ({
      ...mutation,
      ...(createdNodeId ? { createdNodeId } : {})
    }))
  };
  try {
    await dependencies.putSnapshot(ready);
  } catch {
    const rolledBack = await dependencies
      .rollback(ready)
      .catch(() => null);
    if (rolledBack) {
      await dependencies
        .putSnapshot(rolledBack.batch)
        .catch(() => undefined);
    }
    throw new Error(
      rolledBack?.failed
        ? "撤销记录写入失败，且自动回滚未完全成功。请立即查看“最近的更改”。"
        : "撤销记录写入失败，本次修改已自动回滚，没有保留不可撤销的写入。"
    );
  }
  return result;
}

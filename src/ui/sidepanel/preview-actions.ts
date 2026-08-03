import type { BookmarkAgentActionExecutionResult, BookmarkAgentActionProposal, NativeBookmarkNode } from "../../lib/types";
import { findPreviewNode, movePreviewNode, previewRoot } from "./preview-state";

export function executePreviewAgentAction(
  action: BookmarkAgentActionProposal
): BookmarkAgentActionExecutionResult {
  const success = (message: string): BookmarkAgentActionExecutionResult => ({
    actionId: action.id,
    success: true,
    message
  });
  const target = action.targetId
    ? findPreviewNode(action.targetId)
    : null;
  const destination =
    action.destinationId === previewRoot.id ||
    action.parentId === previewRoot.id
      ? previewRoot
      : findPreviewNode(
          action.destinationId || action.parentId || ""
        )?.node;

  switch (action.type) {
    case "create_bookmark":
    case "create_folder": {
      if (!destination || destination.url || !action.title) {
        throw new Error("预览目标文件夹无效。");
      }
      const created: NativeBookmarkNode = {
        id: `preview-agent-${Date.now()}-${Math.random()}`,
        parentId: destination.id,
        title: action.title,
        ...(action.type === "create_bookmark" && action.url
          ? { url: action.url }
          : { children: [] })
      };
      destination.children = [...(destination.children || []), created];
      return success(`已在 Chrome 预览数据中创建「${created.title}」。`);
    }
    case "delete_bookmark":
    case "delete_folder": {
      if (!target) throw new Error("预览目标已不存在。");
      target.parent.children = (target.parent.children || []).filter(
        (node) => node.id !== target.node.id
      );
      return success(`已从 Chrome 预览数据中删除「${target.node.title}」。`);
    }
    case "update_bookmark":
    case "rename_folder": {
      if (!target) throw new Error("预览目标已不存在。");
      target.node.title = action.title || target.node.title;
      if (action.type === "update_bookmark" && action.url) {
        target.node.url = action.url;
      }
      return success(`已修改「${target.node.title}」。`);
    }
    case "move_bookmark":
    case "move_folder": {
      if (!action.targetId || !action.destinationId) {
        throw new Error("预览移动信息不完整。");
      }
      const moved = movePreviewNode(
        action.targetId,
        action.destinationId
      );
      if (!moved) throw new Error("预览移动失败。");
      return success(`已移动「${moved.title}」。`);
    }
    case "update_metadata": {
      // Preview mode has no Aarre storage, so there is nothing to write; the
      // point is only to show the confirmation flow.
      return success("已更新预览数据中的标签与备注。");
    }
  }
}

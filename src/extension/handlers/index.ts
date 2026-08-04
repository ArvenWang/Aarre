import { getLocalResources } from "../../lib/storage";
import {
  conversationHasCompletedAnswer,
  deleteAgentConversation,
  getAgentConversations,
  saveAgentConversation
} from "../../lib/conversations";
import { requestSync } from "../../lib/sync-request";
import { getAiUsageStats } from "../../lib/usage-stats";
import { getAiSettingsStatus } from "../../lib/settings";
import { getDisplaySettings } from "../../lib/display-settings";

export type MessageHandler = (
  request: any,
  sender?: chrome.runtime.MessageSender
) => Promise<unknown>;

type Action = (...args: any[]) => any;

export function createMessageHandlers(
  baseHandlers: Record<string, MessageHandler>,
  actions: Record<string, Action>
): Record<string, MessageHandler> {
  return {
    ...baseHandlers,
    GET_BOOTSTRAP: async () => {
      requestSync("ui-open");
      const [appState, aiSettings, displaySettings] = await Promise.all([
        actions.getAppStateLight(),
        getAiSettingsStatus(),
        getDisplaySettings()
      ]);
      return { appState, aiSettings, displaySettings };
    },
    GET_APP_STATE: async () => {
      return actions.getAppState();
    },
    GET_BOOKMARK_BAR: async () => actions.getBookmarkBarSnapshot(),
    GET_PENDING_SAVE: async (request) => actions.consumePendingSaveDraft(request.tabId),
    GET_BOOKMARK_SAVE_STATE: async (request) => actions.getBookmarkSaveState(request.url),
    GET_NAVIGATION_SUGGESTIONS: async (request) => actions.getNavigationSuggestions(request.query),
    NAVIGATE: async (request) => actions.navigate(request.payload, true),
    GET_FOLDERS: async () => actions.getFolderOptions(),
    GET_FOLDER_SUGGESTIONS: async (request) => actions.getFolderSuggestions(request.capture),
    SAVE_BOOKMARK: async (request) => actions.saveBookmark(request.payload),
    ASK_BOOKMARK_AGENT: async (request) => actions.askAgent(request.query, request.history, request.requestId),
    CANCEL_BOOKMARK_AGENT: async (request) => {
      actions.cancelAgent(request.requestId);
      return { cancelled: true };
    },
    EXECUTE_BOOKMARK_AGENT_ACTIONS: async (request) => actions.executeBookmarkAgentActions(
      request.actions,
      { requestId: request.requestId }
    ),
    CANCEL_AGENT_PLAN_EXECUTION: async (request) => {
      actions.cancelAgentPlanExecution(request.requestId);
      return { cancelled: true };
    },
    GET_LIBRARY_INSIGHTS: async () => actions.getLibraryInsights(),
    GET_ORGANIZATION_NOTICE: async () => actions.getOrganizationNotice(),
    DISMISS_ORGANIZATION_NOTICE: async () => actions.dismissOrganizationNotice(),
    GET_KNOWLEDGE_DASHBOARD: async () => actions.getKnowledgeDashboard(),
    GET_CONTEXT_RESURFACING: async () => actions.getContextResurfacing(),
    APPLY_ORGANIZATION_ACTIONS: async (request) =>
      actions.executeBookmarkAgentActions(request.actions, {
        maxActions: 200,
        label: `整理提案（${request.actions.length} 项）`
      }),
    GET_UNDO_SNAPSHOTS: async () => actions.getRecentUndoSnapshots(),
    UNDO_BOOKMARK_BATCH: async (request) => actions.undoStoredBookmarkBatch(request.batchId),
    GET_LOCAL_RESOURCES: async () => {
      await actions.importNativeBookmarks();
      return (await getLocalResources()).filter(
        (resource) => resource.nativeBookmarkIds.length > 0
      );
    },
    GET_SITE_BRANDS: async () => actions.getSiteBrands(),
    GET_AGENT_CONVERSATIONS: async () => getAgentConversations(),
    SAVE_AGENT_CONVERSATION: async (request) => {
      const conversation = await saveAgentConversation(request.conversation);
      if (conversationHasCompletedAnswer(conversation)) {
        requestSync("conversation-saved", 3_000);
      }
      return conversation;
    },
    DELETE_AGENT_CONVERSATION: async (request) => {
      await deleteAgentConversation(request.id);
      requestSync("conversation-deleted", 3_000);
      return { deleted: true };
    },
    START_LIBRARY_SCAN: async (request) => actions.startLibraryScan(Boolean(request.force)),
    GET_LIBRARY_SCAN_ESTIMATE: async (request) => actions.getLibraryScanEstimate(Boolean(request.force)),
    GET_LIBRARY_SCAN: async () => actions.publicLibraryScan(await actions.getStoredLibraryScan()),
    GET_AI_USAGE: async () => getAiUsageStats(),
    PAUSE_LIBRARY_SCAN: async () => actions.updateLibraryScanState("paused"),
    RESUME_LIBRARY_SCAN: async () => actions.updateLibraryScanState("running"),
    CANCEL_LIBRARY_SCAN: async () => actions.updateLibraryScanState("cancelled"),
    GET_RESOURCES: async (request) => actions.getResources(request.query),
    IMPORT_NATIVE_BOOKMARKS: async () => actions.importNativeBookmarks(true),
    RESTORE_MISSING_NATIVE_BOOKMARKS: async () => actions.restoreMissingNativeBookmarks(),
    UPDATE_NATIVE_BOOKMARK: async (request) => actions.updateNativeBookmark(request.payload),
    UPDATE_RESOURCE_TAGS: async (request) => actions.updateResourceTags(request.payload),
    UPDATE_BOOKMARK_DETAILS: async (request) => actions.updateBookmarkDetails(request.payload),
    CREATE_NATIVE_FOLDER: async (request) => actions.createNativeFolder(request.payload),
    MOVE_NATIVE_BOOKMARK: async (request) => actions.moveNativeBookmark(request.payload),
    DELETE_NATIVE_BOOKMARK: async (request) => actions.deleteNativeBookmark(request.payload),
    OPEN_MANAGER: async (request, sender) => {
      const params = new URLSearchParams();
      if (request.query) params.set("q", request.query);
      if (request.view) params.set("view", request.view);
      const suffix = params.size ? `?${params.toString()}` : "";
      return actions.openManagerPage(
        `manager.html${suffix}`,
        await actions.messageWindowId(sender)
      );
    },
    OPEN_SIDE_PANEL: async (_request, sender) => {
      const senderTab = sender?.tab;
      const current = senderTab || (await actions.activeTab());
      const windowId = current?.windowId ?? (await actions.messageWindowId(sender));
      if (typeof windowId !== "number") throw new Error("无法确定当前 Chrome 窗口。");
      await chrome.sidePanel.open(
        typeof current?.id === "number" ? { tabId: current.id } : { windowId }
      );
      return { opened: true };
    },
    AUTH_CHANGED: async () => {
      requestSync("auth-changed");
      return actions.getAppState();
    }
  };
}

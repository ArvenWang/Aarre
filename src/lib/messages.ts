import type {
  AiSettingsStatus,
  AiUsageStats,
  BookmarkAgentActionExecutionResult,
  BookmarkAgentActionProposal,
  AgentConversation,
  BookmarkAgentTurn,
  SaveAiSettingsInput,
  AppState,
  BookmarkAgentResponse,
  BookmarkBarSnapshot,
  BookmarkSaveState,
  ImportResult,
  NativeFolderOption,
  NativeBookmarkNode,
  NavigationInput,
  NavigationSuggestion,
  PendingSaveDraft,
  PageCapture,
  PageSnapshot,
  FolderSuggestion,
  KnowledgeDashboard,
  LibraryInsights,
  LibraryScanEstimate,
  LibraryScanStatus,
  OrganizationNotice,
  ResurfacingItem,
  ResourceRecord,
  RestoreResult,
  SnapshotBackfillStatus,
  SaveBookmarkInput,
  SaveBookmarkResult,
  SearchResult,
  SiteBrandRecord,
  UpdateBookmarkDetailsInput,
  UpdateBookmarkDetailsResult,
  UndoBatchResult,
  UndoSnapshotBatch
} from "./types";

export type ExtensionRequest =
  | { type: "GET_APP_STATE" }
  | { type: "GET_AI_SETTINGS" }
  | { type: "SAVE_AI_SETTINGS"; payload: SaveAiSettingsInput }
  | { type: "GET_BOOKMARK_BAR" }
  | { type: "GET_PENDING_SAVE"; tabId?: number }
  | { type: "GET_BOOKMARK_SAVE_STATE"; url: string }
  | { type: "GET_NAVIGATION_SUGGESTIONS"; query: string }
  | { type: "NAVIGATE"; payload: NavigationInput }
  | { type: "GET_FOLDERS" }
  | { type: "CAPTURE_ACTIVE_PAGE"; tabId?: number }
  | { type: "GET_FOLDER_SUGGESTIONS"; capture: PageCapture }
  | { type: "SAVE_BOOKMARK"; payload: SaveBookmarkInput }
  | {
      type: "ASK_BOOKMARK_AGENT";
      query: string;
      history?: BookmarkAgentTurn[];
    }
  | {
      type: "EXECUTE_BOOKMARK_AGENT_ACTIONS";
      actions: BookmarkAgentActionProposal[];
    }
  | { type: "GET_LIBRARY_INSIGHTS" }
  | { type: "GET_ORGANIZATION_NOTICE" }
  | { type: "DISMISS_ORGANIZATION_NOTICE" }
  | { type: "GET_KNOWLEDGE_DASHBOARD" }
  | { type: "GET_CONTEXT_RESURFACING" }
  | {
      type: "APPLY_ORGANIZATION_ACTIONS";
      actions: BookmarkAgentActionProposal[];
    }
  | { type: "GET_UNDO_SNAPSHOTS" }
  | { type: "UNDO_BOOKMARK_BATCH"; batchId: string }
  | { type: "GET_LOCAL_RESOURCES" }
  | { type: "GET_SITE_BRANDS" }
  | { type: "GET_PAGE_SNAPSHOT"; canonicalUrl: string }
  | { type: "GET_AGENT_CONVERSATIONS" }
  | { type: "SAVE_AGENT_CONVERSATION"; conversation: AgentConversation }
  | { type: "DELETE_AGENT_CONVERSATION"; id: string }
  | { type: "START_LIBRARY_SCAN"; force?: boolean }
  | { type: "GET_LIBRARY_SCAN_ESTIMATE"; force?: boolean }
  | { type: "GET_LIBRARY_SCAN" }
  | { type: "START_SNAPSHOT_BACKFILL" }
  | {
      type: "GET_SNAPSHOT_BACKFILL";
      includeCandidateCount?: boolean;
    }
  | { type: "PAUSE_SNAPSHOT_BACKFILL" }
  | { type: "RESUME_SNAPSHOT_BACKFILL" }
  | { type: "CANCEL_SNAPSHOT_BACKFILL" }
  | { type: "GET_AI_USAGE" }
  | { type: "PAUSE_LIBRARY_SCAN" }
  | { type: "RESUME_LIBRARY_SCAN" }
  | { type: "CANCEL_LIBRARY_SCAN" }
  | { type: "GET_RESOURCES"; query?: string; semantic?: boolean }
  | { type: "SYNC_NOW" }
  | { type: "IMPORT_NATIVE_BOOKMARKS" }
  | { type: "RESTORE_MISSING_NATIVE_BOOKMARKS" }
  | {
      type: "UPDATE_NATIVE_BOOKMARK";
      payload: { id: string; title: string; url?: string };
    }
  | {
      type: "UPDATE_RESOURCE_TAGS";
      payload: { resourceKey: string; tags: string[] };
    }
  | {
      type: "UPDATE_BOOKMARK_DETAILS";
      payload: UpdateBookmarkDetailsInput;
    }
  | {
      type: "CREATE_NATIVE_FOLDER";
      payload: { parentId: string; title: string };
    }
  | {
      type: "MOVE_NATIVE_BOOKMARK";
      payload: { id: string; parentId: string; index?: number };
    }
  | {
      type: "DELETE_NATIVE_BOOKMARK";
      payload: { id: string; recursive: boolean };
    }
  | {
      type: "OPEN_MANAGER";
      query?: string;
      view?: "organize" | "report" | "topics" | "resurface" | "reading";
    }
  | { type: "OPEN_SIDE_PANEL" }
  | { type: "AUTH_CHANGED" };

export type ResponseDataByRequest = {
  GET_APP_STATE: AppState;
  GET_AI_SETTINGS: AiSettingsStatus;
  SAVE_AI_SETTINGS: AiSettingsStatus;
  GET_BOOKMARK_BAR: BookmarkBarSnapshot;
  GET_PENDING_SAVE: PendingSaveDraft | null;
  GET_BOOKMARK_SAVE_STATE: BookmarkSaveState;
  GET_NAVIGATION_SUGGESTIONS: NavigationSuggestion[];
  NAVIGATE: { opened: true };
  GET_FOLDERS: NativeFolderOption[];
  CAPTURE_ACTIVE_PAGE: PageCapture;
  GET_FOLDER_SUGGESTIONS: FolderSuggestion[];
  SAVE_BOOKMARK: SaveBookmarkResult;
  ASK_BOOKMARK_AGENT: BookmarkAgentResponse;
  EXECUTE_BOOKMARK_AGENT_ACTIONS: {
    results: BookmarkAgentActionExecutionResult[];
    batchId?: string;
  };
  GET_LIBRARY_INSIGHTS: LibraryInsights;
  GET_ORGANIZATION_NOTICE: OrganizationNotice | null;
  DISMISS_ORGANIZATION_NOTICE: { dismissed: true };
  GET_KNOWLEDGE_DASHBOARD: KnowledgeDashboard;
  GET_CONTEXT_RESURFACING: ResurfacingItem[];
  APPLY_ORGANIZATION_ACTIONS: {
    results: BookmarkAgentActionExecutionResult[];
    batchId?: string;
  };
  GET_UNDO_SNAPSHOTS: UndoSnapshotBatch[];
  UNDO_BOOKMARK_BATCH: UndoBatchResult;
  GET_LOCAL_RESOURCES: ResourceRecord[];
  GET_SITE_BRANDS: SiteBrandRecord[];
  GET_PAGE_SNAPSHOT: PageSnapshot | null;
  GET_AGENT_CONVERSATIONS: AgentConversation[];
  SAVE_AGENT_CONVERSATION: AgentConversation;
  DELETE_AGENT_CONVERSATION: { deleted: true };
  START_LIBRARY_SCAN: LibraryScanStatus;
  GET_LIBRARY_SCAN_ESTIMATE: LibraryScanEstimate;
  GET_LIBRARY_SCAN: LibraryScanStatus;
  START_SNAPSHOT_BACKFILL: SnapshotBackfillStatus;
  GET_SNAPSHOT_BACKFILL: SnapshotBackfillStatus;
  PAUSE_SNAPSHOT_BACKFILL: SnapshotBackfillStatus;
  RESUME_SNAPSHOT_BACKFILL: SnapshotBackfillStatus;
  CANCEL_SNAPSHOT_BACKFILL: SnapshotBackfillStatus;
  GET_AI_USAGE: AiUsageStats;
  PAUSE_LIBRARY_SCAN: LibraryScanStatus;
  RESUME_LIBRARY_SCAN: LibraryScanStatus;
  CANCEL_LIBRARY_SCAN: LibraryScanStatus;
  GET_RESOURCES: SearchResult[] | ResourceRecord[];
  SYNC_NOW: { synced: number; failed: number; resources: ResourceRecord[] };
  IMPORT_NATIVE_BOOKMARKS: ImportResult;
  RESTORE_MISSING_NATIVE_BOOKMARKS: RestoreResult;
  UPDATE_NATIVE_BOOKMARK: NativeBookmarkNode;
  UPDATE_RESOURCE_TAGS: ResourceRecord;
  UPDATE_BOOKMARK_DETAILS: UpdateBookmarkDetailsResult;
  CREATE_NATIVE_FOLDER: NativeBookmarkNode;
  MOVE_NATIVE_BOOKMARK: NativeBookmarkNode;
  DELETE_NATIVE_BOOKMARK: { deleted: true };
  OPEN_MANAGER: { opened: true };
  OPEN_SIDE_PANEL: { opened: true };
  AUTH_CHANGED: AppState;
};

export type ExtensionResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export async function sendExtensionRequest<
  TRequest extends ExtensionRequest,
  TType extends TRequest["type"] = TRequest["type"]
>(
  request: TRequest
): Promise<ResponseDataByRequest[TType]> {
  const response = (await chrome.runtime.sendMessage(
    request
  )) as ExtensionResponse<ResponseDataByRequest[TType]>;

  if (!response?.ok) {
    throw new Error(response?.error || "扩展后台没有返回有效结果。");
  }

  if (!("data" in response) || response.data === undefined) {
    throw new Error(
      "Aarre 的界面与后台版本不一致。请在 chrome://extensions 中重新加载 Aarre 后再试。"
    );
  }

  return response.data;
}

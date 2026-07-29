import type {
  AppState,
  BookmarkBarSnapshot,
  ImportResult,
  NativeFolderOption,
  NativeBookmarkNode,
  NavigationInput,
  NavigationSuggestion,
  PendingSaveDraft,
  PageCapture,
  ResourceRecord,
  RestoreResult,
  SaveBookmarkInput,
  SaveBookmarkResult,
  SearchResult
} from "./types";

export type ExtensionRequest =
  | { type: "GET_APP_STATE" }
  | { type: "GET_BOOKMARK_BAR" }
  | { type: "GET_PENDING_SAVE"; tabId?: number }
  | { type: "GET_NAVIGATION_SUGGESTIONS"; query: string }
  | { type: "NAVIGATE"; payload: NavigationInput }
  | { type: "GET_FOLDERS" }
  | { type: "CAPTURE_ACTIVE_PAGE" }
  | { type: "SAVE_BOOKMARK"; payload: SaveBookmarkInput }
  | { type: "GET_RESOURCES"; query?: string; semantic?: boolean }
  | { type: "SYNC_NOW" }
  | { type: "IMPORT_NATIVE_BOOKMARKS" }
  | { type: "RESTORE_MISSING_NATIVE_BOOKMARKS" }
  | {
      type: "UPDATE_NATIVE_BOOKMARK";
      payload: { id: string; title: string; url?: string };
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
  | { type: "OPEN_MANAGER"; query?: string }
  | { type: "AUTH_CHANGED" };

export type ResponseDataByRequest = {
  GET_APP_STATE: AppState;
  GET_BOOKMARK_BAR: BookmarkBarSnapshot;
  GET_PENDING_SAVE: PendingSaveDraft | null;
  GET_NAVIGATION_SUGGESTIONS: NavigationSuggestion[];
  NAVIGATE: { opened: true };
  GET_FOLDERS: NativeFolderOption[];
  CAPTURE_ACTIVE_PAGE: PageCapture;
  SAVE_BOOKMARK: SaveBookmarkResult;
  GET_RESOURCES: SearchResult[] | ResourceRecord[];
  SYNC_NOW: { synced: number; failed: number; resources: ResourceRecord[] };
  IMPORT_NATIVE_BOOKMARKS: ImportResult;
  RESTORE_MISSING_NATIVE_BOOKMARKS: RestoreResult;
  UPDATE_NATIVE_BOOKMARK: NativeBookmarkNode;
  CREATE_NATIVE_FOLDER: NativeBookmarkNode;
  MOVE_NATIVE_BOOKMARK: NativeBookmarkNode;
  DELETE_NATIVE_BOOKMARK: { deleted: true };
  OPEN_MANAGER: { opened: true };
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

  return response.data;
}

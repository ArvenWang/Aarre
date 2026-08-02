import type { BookmarkBarSnapshot, ResourceRecord } from "../../lib/types";
import {
  buildBookmarkEditorModel,
  mergeBookmarkEditorTags,
  parseBookmarkEditorTags,
} from "../../lib/bookmark-editor";

export type {
  BookmarkEditorFolder as LibraryBookmarkFolder,
  BookmarkEditorLocation as LibraryBookmarkLocation,
  BookmarkEditorModel as LibraryBookmarkEditorModel,
} from "../../lib/bookmark-editor";

export function buildLibraryBookmarkEditorModel(
  resource: ResourceRecord,
  snapshot: BookmarkBarSnapshot,
) {
  return buildBookmarkEditorModel(resource.nativeBookmarkIds, snapshot);
}

export const parseLibraryEditorTags = parseBookmarkEditorTags;
export const mergeLibraryEditorTags = mergeBookmarkEditorTags;

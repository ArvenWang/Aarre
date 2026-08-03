import { useEffect, useMemo, useRef, useState } from "react";
import { buildBookmarkEditorModel, mergeBookmarkEditorTags } from "../../../lib/bookmark-editor";
import { buildBookmarkSaveState } from "../../../lib/bookmark-save-state";
import { requestPageSnapshotPermission } from "../../../lib/display-settings";
import { initialSaveFolderId } from "../../../lib/folder-options";
import { sendExtensionRequest } from "../../../lib/messages";
import type {
  AppState,
  BookmarkBarSnapshot,
  BookmarkSaveState,
  FolderSuggestion,
  NativeBookmarkNode,
  NativeFolderOption,
  PageCapture,
  PendingSaveDraft,
  ResourceRecord,
} from "../../../lib/types";
import { canonicalizeUrl } from "../../../lib/url";
import { captureFromDraft, emptyCapture } from "../utils";

export type EditorState =
  | { kind: "bookmark"; node: NativeBookmarkNode; resourceKey?: string }
  | { kind: "folder"; parentId: string }
  | { kind: "save" }
  | null;

interface UseBookmarkEditorInput {
  appState: AppState | null;
  snapshot: BookmarkBarSnapshot | null;
  resources: ResourceRecord[];
  pageSnapshotsEnabled: boolean;
  busy: string;
  setBusy: (value: string) => void;
  setError: (value: string) => void;
  setNotice: (value: string) => void;
  refresh: () => Promise<void>;
  dismissPreview: () => void;
}

function resourceForUrl(resources: ResourceRecord[], url: string) {
  const canonical = (() => { try { return canonicalizeUrl(url); } catch { return url; } })();
  return resources.find((resource) => resource.url === url || resource.canonicalUrl === canonical);
}

export function useBookmarkEditor({
  appState,
  snapshot,
  resources,
  pageSnapshotsEnabled,
  busy,
  setBusy,
  setError,
  setNotice,
  refresh,
  dismissPreview,
}: UseBookmarkEditorInput) {
  const [editor, setEditor] = useState<EditorState>(null);
  const [editBookmarkId, setEditBookmarkId] = useState("");
  const [editParentId, setEditParentId] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [editUrl, setEditUrl] = useState("");
  const [editTags, setEditTags] = useState<string[]>([]);
  const [editTagInput, setEditTagInput] = useState("");
  const [editTagsChanged, setEditTagsChanged] = useState(false);
  const [capture, setCapture] = useState<PageCapture | null>(null);
  const [captureSourceTabId, setCaptureSourceTabId] = useState<number>();
  const [note, setNote] = useState("");
  const [folderId, setFolderId] = useState("");
  const [folders, setFolders] = useState<NativeFolderOption[]>([]);
  const [folderSuggestions, setFolderSuggestions] = useState<FolderSuggestion[]>([]);
  const [bookmarkSaveState, setBookmarkSaveState] = useState<BookmarkSaveState | null>(null);
  const [saveDisposition, setSaveDisposition] = useState<"reuse" | "new" | "">("");
  const [selectedBookmarkId, setSelectedBookmarkId] = useState("");
  const [captureWarning, setCaptureWarning] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState("");
  const [removedNodeIds, setRemovedNodeIds] = useState<string[]>([]);
  const dialogRef = useRef<HTMLElement | null>(null);

  const currentPageSaveState = useMemo(() => {
    if (!snapshot || !appState?.activeTab?.url) return null;
    try {
      return buildBookmarkSaveState(snapshot.roots || [snapshot.root], appState.activeTab.url);
    } catch {
      return null;
    }
  }, [appState, snapshot]);
  const selectedSaveMatch = useMemo(
    () => bookmarkSaveState?.matches.find((match) => match.id === selectedBookmarkId),
    [bookmarkSaveState, selectedBookmarkId],
  );
  const editorResource = useMemo(() => {
    if (editor?.kind !== "bookmark" || !editor.node.url) return undefined;
    return (editor.resourceKey ? resources.find((item) => item.resourceKey === editor.resourceKey) : undefined)
      || resourceForUrl(resources, editor.node.url);
  }, [editor, resources]);
  const editorModel = useMemo(() => {
    if (editor?.kind !== "bookmark") return { locations: [], folders: [] };
    const bookmarkIds = editorResource?.nativeBookmarkIds?.length ? editorResource.nativeBookmarkIds : [editor.node.id];
    if (snapshot) {
      const model = buildBookmarkEditorModel(bookmarkIds, snapshot);
      if (model.locations.length) return model;
    }
    return {
      locations: [{
        bookmarkId: editor.node.id,
        parentId: editor.node.parentId || "",
        title: editor.node.title,
        url: editor.node.url || "",
        label: "根目录",
        writable: !editor.node.unmodifiable && !editor.node.folderType,
      }],
      folders: [],
    };
  }, [editor, editorResource, snapshot]);
  const selectedEditorLocation = useMemo(
    () => editorModel.locations.find((item) => item.bookmarkId === editBookmarkId) || editorModel.locations[0],
    [editBookmarkId, editorModel.locations],
  );

  useEffect(() => {
    if (!editor) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => {
      const dialog = dialogRef.current;
      const preferred = dialog?.querySelector<HTMLElement>("[autofocus]");
      (preferred || dialog?.querySelector<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]"))?.focus();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      const dialog = dialogRef.current;
      if (!dialog) return;
      if (event.key === "Escape") {
        if (busy) return;
        event.preventDefault();
        setEditor(null);
        setConfirmDeleteId("");
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]")];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      previousFocus?.focus();
    };
  }, [busy, editor]);

  async function startSave(draft?: PendingSaveDraft) {
    if (!appState) return;
    dismissPreview();
    setEditor({ kind: "save" });
    setConfirmDeleteId("");
    setBusy("capture");
    setError("");
    setCaptureWarning("");
    setCaptureSourceTabId(draft?.tabId || appState.activeTab?.id);
    setFolderSuggestions([]);
    setNote("");
    setBookmarkSaveState(null);
    setSaveDisposition("");
    setSelectedBookmarkId("");
    try {
      const targetUrl = draft?.url || appState.activeTab?.url || "";
      const [folderOptions, saveState] = await Promise.all([
        sendExtensionRequest({ type: "GET_FOLDERS" }),
        sendExtensionRequest({ type: "GET_BOOKMARK_SAVE_STATE", url: targetUrl }),
      ]);
      setBookmarkSaveState(saveState);
      const initialMatch = saveState.status === "exact" || saveState.status === "readonly" ? saveState.matches[0] : undefined;
      setNote(resourceForUrl(resources, targetUrl)?.userNote || "");
      setSelectedBookmarkId(initialMatch?.id || "");
      setSaveDisposition(saveState.status === "none" ? "new" : initialMatch ? "reuse" : "");
      setFolders(folderOptions);
      setFolderId(initialSaveFolderId(folderOptions, initialMatch?.parentId));
      if (draft?.kind === "link") {
        const page = captureFromDraft(draft);
        setCapture(page);
        setEditTitle(initialMatch?.title || page.title);
        setFolderSuggestions(await sendExtensionRequest({ type: "GET_FOLDER_SUGGESTIONS", capture: page }).catch(() => []));
        setCaptureWarning("这是链接收藏。保存后打开该网页，可继续补充正文摘要和 AI 标签。");
      } else {
        try {
          const page = await sendExtensionRequest({ type: "CAPTURE_ACTIVE_PAGE", tabId: draft?.tabId });
          const merged = draft ? { ...page, selectedText: draft.selectedText || page.selectedText } : page;
          setCapture(merged);
          setEditTitle(initialMatch?.title || draft?.title || merged.title);
          setFolderSuggestions(await sendExtensionRequest({ type: "GET_FOLDER_SUGGESTIONS", capture: merged }).catch(() => []));
        } catch {
          const page = draft ? captureFromDraft(draft) : emptyCapture(appState);
          setCapture(page);
          setEditTitle(initialMatch?.title || page.title);
          setFolderSuggestions(await sendExtensionRequest({ type: "GET_FOLDER_SUGGESTIONS", capture: page }).catch(() => []));
          setCaptureWarning("此页面受 Chrome 保护，仍可保存原生书签，但不会读取正文。");
        }
      }
    } catch (caught) {
      setEditor(null);
      setError(caught instanceof Error ? caught.message : "无法读取当前页面");
    } finally {
      setBusy("");
    }
  }

  function startEdit(node: NativeBookmarkNode) {
    dismissPreview();
    const resource = node.url ? resourceForUrl(resources, node.url) : undefined;
    setEditor({ kind: "bookmark", node, ...(resource ? { resourceKey: resource.resourceKey } : {}) });
    setConfirmDeleteId("");
    setBusy("");
    setEditBookmarkId(node.id);
    setEditParentId(node.parentId || "");
    setEditTitle(node.title);
    setEditUrl(node.url || "");
    setEditTags(resource?.tags || []);
    setEditTagInput("");
    setEditTagsChanged(false);
    setNote(resource?.userNote || "");
    setError("");
  }

  function startCreateFolder(parentId: string) {
    dismissPreview();
    setEditor({ kind: "folder", parentId });
    setConfirmDeleteId(""); setBusy(""); setEditBookmarkId(""); setEditParentId("");
    setEditTitle(""); setEditUrl(""); setEditTags([]); setEditTagInput(""); setEditTagsChanged(false); setError("");
  }

  function addEditTags(value = editTagInput) {
    if (!mergeBookmarkEditorTags([], value).length) return;
    setEditTags((current) => mergeBookmarkEditorTags(current, value));
    setEditTagInput("");
    setEditTagsChanged(true);
  }

  function resetEditLocation(bookmarkId: string) {
    const location = editorModel.locations.find((item) => item.bookmarkId === bookmarkId);
    if (!location) return;
    setEditBookmarkId(location.bookmarkId); setEditParentId(location.parentId);
    setEditTitle(location.title); setEditUrl(location.url); setEditTagInput(""); setConfirmDeleteId("");
  }

  async function saveEditor() {
    if (!editor) return;
    setBusy("save"); setError(""); setNotice("");
    try {
      if (editor.kind === "folder") {
        await sendExtensionRequest({ type: "CREATE_NATIVE_FOLDER", payload: { parentId: editor.parentId, title: editTitle } });
      } else if (editor.kind === "bookmark") {
        const bookmarkId = editBookmarkId || editor.node.id;
        if (editor.resourceKey && editorResource) {
          const result = await sendExtensionRequest({
            type: "UPDATE_BOOKMARK_DETAILS",
            payload: {
              bookmarkId, resourceKey: editor.resourceKey, title: editTitle, url: editUrl, parentId: editParentId,
              tags: mergeBookmarkEditorTags(editTags, editTagInput),
              tagsChanged: editTagsChanged || Boolean(editTagInput.trim()), userNote: note,
            },
          });
          setNotice(result.urlChanged ? "收藏信息已更新；新网址将在下次打开时重新生成摘要和封面。" : "收藏信息已更新");
        } else {
          await sendExtensionRequest({ type: "UPDATE_NATIVE_BOOKMARK", payload: { id: bookmarkId, title: editTitle, ...(editor.node.url ? { url: editUrl } : {}) } });
        }
      } else {
        if (!capture) throw new Error("当前页面尚未读取完成。");
        if (pageSnapshotsEnabled) await requestPageSnapshotPermission().catch(() => false);
        const result = await sendExtensionRequest({
          type: "SAVE_BOOKMARK",
          payload: {
            capture, ...(typeof captureSourceTabId === "number" ? { sourceTabId: captureSourceTabId } : {}),
            title: editTitle, userNote: note, folderId, requestAi: true,
            ...(saveDisposition === "reuse" && selectedBookmarkId ? { existingBookmarkId: selectedBookmarkId } : {}),
            ...(saveDisposition === "new" && bookmarkSaveState?.status !== "none" ? { createSeparate: true } : {}),
            ...(saveDisposition === "reuse" && bookmarkSaveState?.matches.find((match) => match.id === selectedBookmarkId)?.matchKind === "canonical" ? { confirmedCanonicalReuse: true } : {}),
          },
        });
        if (result.aiWarning) setNotice(result.aiWarning);
        else if (result.enhancementPending) setNotice("收藏已保存，Aarre 正在后台补全摘要、标签和封面。");
      }
      setEditor(null); setConfirmDeleteId(""); await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存失败");
    } finally {
      setBusy("");
    }
  }

  async function deleteEditorNode() {
    if (editor?.kind !== "bookmark") return;
    const targetId = editBookmarkId || editor.node.id;
    setRemovedNodeIds((current) => current.includes(targetId) ? current : [...current, targetId]);
    const recursive = !editor.node.url;
    setEditor(null); setConfirmDeleteId(""); setBusy(""); setError("");
    try {
      await sendExtensionRequest({ type: "DELETE_NATIVE_BOOKMARK", payload: { id: targetId, recursive } });
      await refresh();
      setRemovedNodeIds((current) => current.filter((id) => id !== targetId));
    } catch (caught) {
      setRemovedNodeIds((current) => current.filter((id) => id !== targetId));
      setError(caught instanceof Error ? caught.message : "删除失败");
    }
  }

  return {
    editor, setEditor, dialogRef, editBookmarkId, editParentId, setEditParentId, editTitle, setEditTitle,
    editUrl, setEditUrl, editTags, setEditTags, editTagInput, setEditTagInput, setEditTagsChanged,
    capture, note, setNote, folderId, setFolderId, folders, folderSuggestions,
    bookmarkSaveState, saveDisposition, setSaveDisposition, selectedBookmarkId,
    setSelectedBookmarkId, captureWarning, confirmDeleteId, setConfirmDeleteId,
    removedNodeIds, currentSaved: Boolean(currentPageSaveState && currentPageSaveState.status !== "none"),
    selectedSaveMatch, editorResource, editorModel, selectedEditorLocation,
    editorWritable: selectedEditorLocation?.writable ?? true,
    startSave, startEdit, startCreateFolder, addEditTags, resetEditLocation,
    saveEditor, deleteEditorNode,
  };
}

import { ScrollSurface } from "@/ui/components/ui/scroll-area";
import { AppModal } from "@/ui/components/ui/modal";
import { Button } from "@/ui/components/ui/button";
import { bookmarkMatchLocation } from "../utils";
import type { useBookmarkEditor } from "../hooks/use-bookmark-editor";
import { visibleFolderPath } from "../../../lib/folder-options";
import { BookmarkEditorFields } from "../../components/BookmarkEditorFields";
import { CloudConflictNotice } from "../../components/CloudConflictNotice";
import { FluidInput, FluidTextarea } from "@/ui/components/ui/input";
import { ArrowLeftIcon, CloseIcon, TrashIcon } from "../../components/Icons";
import { ProtectionControl } from "../../components/ProtectionControl";
import { FolderSelect } from "./FolderSelect";

interface BookmarkEditorDialogProps {
  presentation?: "dialog" | "page";
  error?: string;
  controller: ReturnType<typeof useBookmarkEditor>;
  busy: string;
  setNotice: (value: string) => void;
  refresh: () => Promise<void>;
}

export function BookmarkEditorDialog({
  presentation = "dialog",
  error,
  controller,
  busy,
  setNotice,
  refresh,
}: BookmarkEditorDialogProps) {
  const {
    editor, setEditor, editBookmarkId, editParentId, setEditParentId,
    editTitle, setEditTitle, editUrl, setEditUrl, editTags, setEditTags,
    editTagInput, setEditTagInput, setEditTagsChanged, capture, note, setNote,
    folderId, setFolderId, folders, folderSuggestions, bookmarkSaveState,
    saveDisposition, setSaveDisposition, selectedBookmarkId,
    setSelectedBookmarkId, captureWarning, confirmDeleteId, setConfirmDeleteId,
    selectedSaveMatch, editorResource, editorModel, selectedEditorLocation,
    editorWritable, addEditTags, resetEditLocation, saveEditor, deleteEditorNode,
  } = controller;
  if (!editor) return null;

  const close = () => {
    setEditor(null);
    setConfirmDeleteId("");
  };

  return (
    <AppModal onClose={close} busy={Boolean(busy)} onEscape={confirmDeleteId ? () => setConfirmDeleteId("") : undefined} labelledBy="native-dialog-title"
      backdropClassName={`native-dialog-backdrop${presentation === "page" ? " save-page-backdrop" : ""}`}
      className={`native-dialog ${presentation === "page" ? "floating-save-page" : ""} ${editor.kind === "bookmark" && editor.node.url ? "bookmark-detail-dialog" : ""}`}>
        <div className="native-dialog-heading">
          <div className="native-dialog-title-line">
            {presentation === "page" && <Button variant="ghost" size="icon-sm" onClick={close} disabled={Boolean(busy)} aria-label="返回菜单"><ArrowLeftIcon /></Button>}
            <h2 id="native-dialog-title">
              {editor.kind === "save"
                ? !bookmarkSaveState || bookmarkSaveState.status === "none" ? "添加到收藏" : "管理此收藏"
                : editor.kind === "folder" ? "新建文件夹"
                  : editor.node.url ? "编辑收藏" : "编辑文件夹"}
            </h2>
          </div>
          {presentation !== "page" && <Button variant="ghost" size="icon-sm" className="dialog-close" onClick={close} disabled={Boolean(busy)} aria-label="关闭">
            <CloseIcon />
          </Button>}
        </div>

        {presentation === "page" && error && <p className="save-page-error" role="alert">{error}</p>}
        <ScrollSurface as="div" className="native-dialog-scroll">
        {editor.kind === "save" && busy === "capture" ? (
          <div className="empty-state dialog-loading">正在读取当前页面…</div>
        ) : (
          <>
            {editor.kind === "save" && presentation === "page" && capture?.url && <div className="save-source"><span>当前网页</span><a href={capture.url} target="_blank" rel="noreferrer noopener">{capture.url}</a></div>}
            {editor.kind === "bookmark" && editor.node.url ? null : (
              <label className="native-field">
                <span>名称</span>
                <FluidInput
                  value={editTitle}
                  onChange={(event) => setEditTitle(event.target.value)}
                  maxLength={240}
                  autoFocus
                  disabled={editor.kind === "save" && saveDisposition === "reuse" && Boolean(selectedSaveMatch?.unmodifiable)}
                />
              </label>
            )}

            {editor.kind === "bookmark" && !editor.node.url ? (
              <ProtectionControl
                target={{ kind: "folder", id: editor.node.id }}
                disabled={Boolean(busy)}
                onChanged={() => { setNotice("保护设置已更新"); void refresh(); }}
              />
            ) : null}

            {editor.kind === "bookmark" && editor.node.url ? (
              <>
                {editorResource ? (
                  <CloudConflictNotice
                    resourceKey={editorResource.resourceKey}
                    currentUserNote={note}
                    currentTags={editTags}
                    disabled={Boolean(busy)}
                    onResolved={() => setNotice("云端编辑冲突已处理")}
                  />
                ) : null}
                <BookmarkEditorFields
                  resource={editorResource}
                  locations={editorModel.locations}
                  folders={editorModel.folders}
                  selectedLocation={selectedEditorLocation}
                  title={editTitle}
                  url={editUrl}
                  parentId={editParentId}
                  tags={editTags}
                  tagInput={editTagInput}
                  userNote={note}
                  writable={editorWritable}
                  disabled={Boolean(busy)}
                  autoFocusTitle
                  onLocationChange={resetEditLocation}
                  onTitleChange={setEditTitle}
                  onUrlChange={setEditUrl}
                  onParentIdChange={setEditParentId}
                  onTagInputChange={setEditTagInput}
                  onAddTag={addEditTags}
                  onRemoveTag={(tag) => {
                    setEditTags((current) => current.filter((item) => item !== tag));
                    setEditTagsChanged(true);
                  }}
                  onUserNoteChange={setNote}
                  onProtectionChanged={() => { setNotice("保护设置已更新"); void refresh(); }}
                />
              </>
            ) : null}

            {editor.kind === "save" ? (
              <>
                {bookmarkSaveState?.status === "exact" ? (
                  <div className="save-state-note" role="status">
                    <strong>此页面已经收藏</strong>
                    <span>保存后会更新原记录，不会创建重复收藏。</span>
                  </div>
                ) : null}
                {bookmarkSaveState?.status === "readonly" ? (
                  <div className="save-state-note" role="status">
                    <strong>这是受管理的 Chrome 收藏</strong>
                    <span>Aarre 只更新摘要、标签和封面，不改动名称与文件夹。</span>
                  </div>
                ) : null}
                {bookmarkSaveState && ["canonical", "multiple"].includes(bookmarkSaveState.status) ? (
                  <fieldset className="save-match-picker">
                    <legend>{bookmarkSaveState.status === "multiple" ? "发现多条相同收藏，请选择" : "发现可能相同的收藏，请确认"}</legend>
                    {bookmarkSaveState.matches.map((match) => (
                      <label key={match.id}>
                        <FluidInput
                          type="radio"
                          name="save-target"
                          checked={saveDisposition === "reuse" && selectedBookmarkId === match.id}
                          onChange={() => {
                            setSaveDisposition("reuse"); setSelectedBookmarkId(match.id);
                            setFolderId(match.parentId); setEditTitle(match.title);
                          }}
                        />
                        <span>
                          <strong>{match.title}</strong>
                          <small>{bookmarkMatchLocation(match)}{match.unmodifiable ? " · 受 Chrome 管理" : ""}</small>
                        </span>
                      </label>
                    ))}
                    <label>
                      <FluidInput
                        type="radio"
                        name="save-target"
                        checked={saveDisposition === "new"}
                        onChange={() => {
                          setSaveDisposition("new"); setSelectedBookmarkId("");
                          setEditTitle(capture?.title || editTitle);
                        }}
                      />
                      <span><strong>另存为一条新收藏</strong><small>仅在你明确需要两个副本时使用</small></span>
                    </label>
                  </fieldset>
                ) : null}
                <div className="native-field">
                  <span>文件夹</span>
                  {saveDisposition === "reuse" && selectedSaveMatch?.unmodifiable ? (
                    <div className="readonly-folder-value">{bookmarkMatchLocation(selectedSaveMatch)}</div>
                  ) : (
                    <FolderSelect options={folders} value={folderId} onChange={setFolderId} />
                  )}
                  {folderSuggestions.length && !selectedSaveMatch?.unmodifiable ? (
                    <div className="folder-suggestions" aria-label="推荐文件夹">
                      <small>本地推荐</small>
                      {folderSuggestions.map((suggestion) => (
                        <Button
                          type="button"
                          variant="ghost"
                          key={suggestion.folderId}
                          data-selected={folderId === suggestion.folderId}
                          onClick={() => setFolderId(suggestion.folderId)}
                          title={suggestion.reason}
                        >
                          {visibleFolderPath(suggestion.path).join(" / ")}<span>{suggestion.reason}</span>
                        </Button>
                      ))}
                    </div>
                  ) : null}
                </div>
                <label className="native-field">
                  <span>备注</span>
                  <FluidTextarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} maxLength={2_000} placeholder="可选。记录你保存它的原因。" />
                </label>
                {captureWarning ? <p className="dialog-warning">{captureWarning}</p> : null}
              </>
            ) : null}

          </>
        )}
        </ScrollSurface>
        {!(editor.kind === "save" && busy === "capture") && (
            <div className="native-dialog-actions">
              {editor.kind === "bookmark" && !editor.node.folderType && confirmDeleteId === (editBookmarkId || editor.node.id) ? (
                <div className="delete-confirmation" role="group" aria-label="确认删除">
                  <p role="alert">
                    <TrashIcon aria-hidden="true" />
                    <span>
                      {editorModel.locations.length > 1 ? "只删除当前选中的收藏位置？" : "确认从 Chrome 删除？"}
                      <small>{editorModel.locations.length > 1 ? "其他位置与 Aarre 智能信息保留" : "30 天内可在设置的最近动作中撤销"}</small>
                    </span>
                  </p>
                  <div>
                    <Button variant="ghost" type="button" onClick={() => setConfirmDeleteId("")}>取消</Button>
                    <Button variant="danger" type="button" data-confirming="true" onClick={() => void deleteEditorNode()}>确认删除</Button>
                  </div>
                </div>
              ) : (
                <>
                  {editor.kind === "bookmark" && !editor.node.folderType ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      type="button"
                      className="editor-delete-action quiet-danger-action"
                      onClick={() => setConfirmDeleteId(editBookmarkId || editor.node.id)}
                      disabled={Boolean(busy)}
                    >删除</Button>
                  ) : <span />}
                  <div>
                    <Button variant="ghost" type="button" onClick={close} disabled={Boolean(busy)}>取消</Button>
                    <Button
                      variant="primary"
                      type="button"

                      onClick={() => void saveEditor()}
                      disabled={Boolean(busy) || !editTitle.trim() || (editor.kind === "bookmark" && Boolean(editor.node.url) && (!editBookmarkId || !editUrl.trim() || !editParentId)) || (editor.kind === "save" && (!capture || !folderId || !saveDisposition))}
                    >
                      {busy === "save" ? "正在保存…" : editor.kind === "save" ? saveDisposition === "reuse" ? "更新收藏" : "添加到 Chrome" : editor.kind === "bookmark" ? "保存修改" : "保存"}
                    </Button>
                  </div>
                </>
              )}
            </div>
        )}
    </AppModal>
  );
}

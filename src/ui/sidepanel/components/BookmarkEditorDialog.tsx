import { Button } from "@/ui/components/ui/button";
import { bookmarkMatchLocation } from "../utils";
import type { useBookmarkEditor } from "../hooks/use-bookmark-editor";
import { visibleFolderPath } from "../../../lib/folder-options";
import { BookmarkEditorFields } from "../../components/BookmarkEditorFields";
import { CloudConflictNotice } from "../../components/CloudConflictNotice";
import { FluidInput, FluidTextarea } from "@/ui/components/ui/input";
import { CloseIcon, TrashIcon } from "../../components/Icons";
import { ProtectionControl } from "../../components/ProtectionControl";
import { FolderSelect } from "./FolderSelect";

interface BookmarkEditorDialogProps {
  controller: ReturnType<typeof useBookmarkEditor>;
  busy: string;
  setNotice: (value: string) => void;
  refresh: () => Promise<void>;
}

export function BookmarkEditorDialog({
  controller,
  busy,
  setNotice,
  refresh,
}: BookmarkEditorDialogProps) {
  const {
    editor, setEditor, dialogRef, editBookmarkId, editParentId, setEditParentId,
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
    <div
      className="native-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) close();
      }}
    >
      <section
        ref={dialogRef}
        className={`native-dialog ${editor.kind === "bookmark" && editor.node.url ? "bookmark-detail-dialog" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="native-dialog-title"
      >
        <div className="native-dialog-heading">
          <div>
            <h2 id="native-dialog-title">
              {editor.kind === "save"
                ? bookmarkSaveState?.status === "none" ? "添加到收藏" : "管理此收藏"
                : editor.kind === "folder" ? "新建文件夹"
                  : editor.node.url ? "编辑收藏" : "编辑文件夹"}
            </h2>
            {editor.kind === "bookmark" && editor.node.url ? (
              <p>Chrome 保存名称、网址和文件夹；Aarre 保存备注与自定义标签。</p>
            ) : null}
          </div>
          <Button variant="ghost" size="icon-sm" className="dialog-close" onClick={close} disabled={Boolean(busy)} aria-label="关闭">
            <CloseIcon />
          </Button>
        </div>

        {editor.kind === "save" && busy === "capture" ? (
          <div className="empty-state dialog-loading">正在读取当前页面…</div>
        ) : (
          <>
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
                <div className="native-check smart-layer-required">
                  <span aria-hidden="true">✓</span>
                  <span>
                    <strong>自动生成摘要</strong>
                  </span>
                </div>
                {captureWarning ? <p className="dialog-warning">{captureWarning}</p> : null}
              </>
            ) : null}

            <div className="native-dialog-actions">
              {editor.kind === "bookmark" && !editor.node.folderType && confirmDeleteId === (editBookmarkId || editor.node.id) ? (
                <div className="delete-confirmation" role="group" aria-label="确认删除">
                  <p role="alert">
                    <TrashIcon aria-hidden="true" />
                    <span>
                      {editorModel.locations.length > 1 ? "只删除当前选中的收藏位置？" : "确认从 Chrome 删除？"}
                      <small>{editorModel.locations.length > 1 ? "其他位置与 Aarre 智能信息保留" : "30 天内可在侧边栏设置撤销"}</small>
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
                      variant="danger-quiet"
                      type="button"

                      onClick={() => setConfirmDeleteId(editBookmarkId || editor.node.id)}
                      disabled={Boolean(busy)}
                    ><TrashIcon />删除</Button>
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
          </>
        )}
      </section>
    </div>
  );
}

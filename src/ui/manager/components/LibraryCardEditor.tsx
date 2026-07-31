import { FluidInput, FluidTextarea, FluidSelect } from "../../components/FluidControls";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent
} from "react";
import { createPortal } from "react-dom";
import { sendExtensionRequest } from "../../../lib/messages";
import type {
  BookmarkBarSnapshot,
  ResourceRecord
} from "../../../lib/types";
import {
  CloseIcon,
  EllipsisIcon,
  TrashIcon
} from "../../components/Icons";
import { Button } from "../../../components/ui/button";
import { Tooltip } from "../../../components/ui/tooltip";
import {
  buildLibraryBookmarkEditorModel,
  mergeLibraryEditorTags
} from "../bookmark-editor";

interface LibraryCardEditorProps {
  resource: ResourceRecord;
  bookmarkSnapshot: BookmarkBarSnapshot;
  onChanged: (message: string) => void;
}

type EditorAction = "saving" | "deleting" | "";

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
    )
  ).filter((element) => !element.hasAttribute("hidden"));
}

export function LibraryCardEditor({
  resource,
  bookmarkSnapshot,
  onChanged
}: LibraryCardEditorProps) {
  const model = useMemo(
    () => buildLibraryBookmarkEditorModel(resource, bookmarkSnapshot),
    [bookmarkSnapshot, resource]
  );
  const [open, setOpen] = useState(false);
  const [bookmarkId, setBookmarkId] = useState(
    model.locations[0]?.bookmarkId || ""
  );
  const [title, setTitle] = useState(model.locations[0]?.title || "");
  const [url, setUrl] = useState(model.locations[0]?.url || resource.url);
  const [parentId, setParentId] = useState(
    model.locations[0]?.parentId || ""
  );
  const [tags, setTags] = useState(resource.tags);
  const [tagsChanged, setTagsChanged] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const [userNote, setUserNote] = useState(resource.userNote);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [action, setAction] = useState<EditorAction>("");
  const [error, setError] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  const selectedLocation =
    model.locations.find(
      (location) => location.bookmarkId === bookmarkId
    ) || model.locations[0];
  const writable = selectedLocation?.writable === true;
  const hasOtherLocations = model.locations.length > 1;

  function resetForLocation(nextBookmarkId: string) {
    const location = model.locations.find(
      (candidate) => candidate.bookmarkId === nextBookmarkId
    );
    if (!location) return;
    setBookmarkId(location.bookmarkId);
    setTitle(location.title);
    setUrl(location.url);
    setParentId(location.parentId);
    setConfirmDelete(false);
    setError("");
  }

  function openEditor() {
    const first = model.locations[0];
    setOpen(true);
    setTags(resource.tags);
    setTagsChanged(false);
    setTagInput("");
    setUserNote(resource.userNote);
    setConfirmDelete(false);
    setAction("");
    setError(
      first
        ? ""
        : "没有找到对应的 Chrome 收藏位置，请刷新收藏库后再试。"
    );
    if (first) resetForLocation(first.bookmarkId);
  }

  function closeEditor() {
    if (action) return;
    setOpen(false);
    setConfirmDelete(false);
    setError("");
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function focusLibrarySearch() {
    window.requestAnimationFrame(() => {
      document
        .querySelector<HTMLInputElement>(
          '[role="search"][aria-label="搜索收藏库"] input'
        )
        ?.focus();
    });
  }

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => {
      (writable ? titleRef.current : dialogRef.current)?.focus();
    });
    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, writable]);

  function handleDialogKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" && !action) {
      event.preventDefault();
      if (confirmDelete) {
        setConfirmDelete(false);
      } else {
        closeEditor();
      }
      return;
    }
    if (event.key !== "Tab" || !dialogRef.current) return;
    const focusable = focusableElements(dialogRef.current);
    if (!focusable.length) {
      event.preventDefault();
      dialogRef.current.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function addTags() {
    if (!tagInput.trim()) return;
    setTags((current) => mergeLibraryEditorTags(current, tagInput));
    setTagsChanged(true);
    setTagInput("");
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!selectedLocation || action) return;
    const pendingTags = mergeLibraryEditorTags(tags, tagInput);
    setAction("saving");
    setError("");
    try {
      const result = await sendExtensionRequest({
        type: "UPDATE_BOOKMARK_DETAILS",
        payload: {
          bookmarkId: selectedLocation.bookmarkId,
          resourceKey: resource.resourceKey,
          title,
          url,
          parentId,
          tags: pendingTags,
          tagsChanged: tagsChanged || Boolean(tagInput.trim()),
          userNote
        }
      });
      setOpen(false);
      if (result.urlChanged) {
        focusLibrarySearch();
      } else {
        window.requestAnimationFrame(() => triggerRef.current?.focus());
      }
      onChanged(
        result.urlChanged
          ? "收藏信息已更新；新网址将在下次打开时重新生成摘要和封面。"
          : "收藏信息已更新"
      );
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "收藏信息更新失败"
      );
    } finally {
      setAction("");
    }
  }

  async function deleteSelectedLocation() {
    if (!selectedLocation || action) return;
    setAction("deleting");
    setError("");
    try {
      await sendExtensionRequest({
        type: "DELETE_NATIVE_BOOKMARK",
        payload: {
          id: selectedLocation.bookmarkId,
          recursive: false
        }
      });
      setOpen(false);
      focusLibrarySearch();
      onChanged(
        hasOtherLocations
          ? "已删除所选收藏位置，其余位置仍然保留。"
          : "收藏已删除，可在侧边栏设置的“最近的更改”中恢复。"
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "删除失败");
    } finally {
      setAction("");
    }
  }

  function changeLocation(event: ChangeEvent<HTMLSelectElement>) {
    resetForLocation(event.currentTarget.value);
  }

  return (
    <>
      <Tooltip content="编辑收藏" side="left">
        <Button
          ref={triggerRef}
          type="button"
          variant="ghost"
          size="icon-sm"
          className="library-card-editor-trigger"
          aria-haspopup="dialog"
          aria-label={`编辑 ${resource.title}`}
          onClick={openEditor}
        >
          <EllipsisIcon />
        </Button>
      </Tooltip>

      {open
        ? createPortal(
          <div
          className="library-card-editor-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeEditor();
          }}
        >
          <div
            ref={dialogRef}
            className="library-card-editor-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby={`library-editor-title-${resource.resourceKey}`}
            aria-describedby={`library-editor-description-${resource.resourceKey}`}
            tabIndex={-1}
            onKeyDown={handleDialogKeyDown}
          >
            <header className="library-card-editor-heading">
              <div>
                <h2
                  id={`library-editor-title-${resource.resourceKey}`}
                >
                  编辑收藏
                </h2>
                <p
                  id={`library-editor-description-${resource.resourceKey}`}
                >
                  Chrome 保存名称、网址和文件夹；Aarre 保存备注与自定义标签。
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="library-card-editor-close"
                aria-label="关闭编辑窗口"
                onClick={closeEditor}
                disabled={Boolean(action)}
              >
                <CloseIcon />
              </Button>
            </header>

            <form onSubmit={(event) => void save(event)}>
              {model.locations.length > 1 ? (
                <label className="library-card-editor-field">
                  <span>收藏位置</span>
                  <FluidSelect
                    value={selectedLocation?.bookmarkId || ""}
                    onChange={changeLocation}
                    disabled={Boolean(action)}
                  >
                    {model.locations.map((location) => (
                      <option
                        value={location.bookmarkId}
                        key={location.bookmarkId}
                      >
                        {location.label}
                        {location.writable ? "" : "（只读）"}
                      </option>
                    ))}
                  </FluidSelect>
                  <small>
                    这个网站在 Chrome 中保存了 {model.locations.length} 次。编辑和删除只作用于当前选中的位置。
                  </small>
                </label>
              ) : (
                <div className="library-card-editor-location">
                  <span>收藏位置</span>
                  <strong>
                    {selectedLocation?.label || "未找到 Chrome 收藏位置"}
                  </strong>
                </div>
              )}

              {!writable && selectedLocation ? (
                <div className="library-card-editor-readonly" role="status">
                  这条收藏由 Chrome 或组织管理。名称、网址、文件夹和删除操作不可用，但仍可修改 Aarre 备注和标签。
                </div>
              ) : null}

              <div className="library-card-editor-grid">
                <label className="library-card-editor-field">
                  <span>名称</span>
                  <FluidInput
                    ref={titleRef}
                    value={title}
                    maxLength={240}
                    required
                    disabled={!writable || Boolean(action)}
                    onChange={(event) => setTitle(event.target.value)}
                  />
                </label>

                <label className="library-card-editor-field">
                  <span>网址</span>
                  <FluidInput
                    type="url"
                    value={url}
                    required
                    disabled={!writable || Boolean(action)}
                    onChange={(event) => setUrl(event.target.value)}
                  />
                  {selectedLocation && url !== selectedLocation.url ? (
                    <small>
                      更换网址后，旧站点的 AI 摘要和封面不会沿用；下次打开新网址时会自动重建。
                    </small>
                  ) : null}
                </label>

                <label className="library-card-editor-field">
                  <span>文件夹</span>
                  <FluidSelect
                    value={parentId}
                    required
                    disabled={!writable || Boolean(action)}
                    onChange={(event) =>
                      setParentId(event.currentTarget.value)
                    }
                  >
                    {model.folders.map((folder) => (
                      <option
                        value={folder.id}
                        key={folder.id}
                        disabled={!folder.writable}
                      >
                        {folder.label}
                      </option>
                    ))}
                  </FluidSelect>
                </label>
              </div>

              <section
                className="library-card-editor-ai"
                aria-labelledby={`library-editor-ai-${resource.resourceKey}`}
              >
                <div>
                  <strong
                    id={`library-editor-ai-${resource.resourceKey}`}
                  >
                    AI 摘要
                  </strong>
                  <p>
                    {resource.summary ||
                      "尚未生成摘要。下次打开网页时，Aarre 会继续完成智能增强。"}
                  </p>
                  <small>
                    摘要由网页内容生成，因此这里保持只读，避免把人工文字误标为 AI 结果。
                  </small>
                </div>

                <div className="library-card-editor-tags">
                  <span>自定义标签</span>
                  <div aria-label="当前标签">
                    {tags.length ? (
                      tags.map((tag) => (
                        <span key={tag}>
                          {tag}
                          <Button
                            type="button"
                            aria-label={`移除标签 ${tag}`}
                            disabled={Boolean(action)}
                            onClick={() => {
                              setTags((current) =>
                                current.filter((item) => item !== tag)
                              );
                              setTagsChanged(true);
                            }}
                          >
                            <CloseIcon />
                          </Button>
                        </span>
                      ))
                    ) : (
                      <small>还没有自定义标签</small>
                    )}
                  </div>
                  <div>
                    <FluidInput
                      value={tagInput}
                      maxLength={120}
                      disabled={Boolean(action)}
                      aria-label="添加标签"
                      placeholder="输入标签，按回车添加"
                      onChange={(event) =>
                        setTagInput(event.target.value)
                      }
                      onKeyDown={(event) => {
                        if (
                          event.key === "Enter" ||
                          event.key === "," ||
                          event.key === "，"
                        ) {
                          event.preventDefault();
                          addTags();
                        }
                      }}
                    />
                    <Button
                      type="button"
                      onClick={addTags}
                      disabled={!tagInput.trim() || Boolean(action)}
                    >
                      添加
                    </Button>
                  </div>
                </div>

                <label className="library-card-editor-field">
                  <span>备注</span>
                  <FluidTextarea
                    value={userNote}
                    rows={4}
                    maxLength={2_000}
                    disabled={Boolean(action)}
                    placeholder="记录收藏原因、后续行动或重要上下文。"
                    onChange={(event) => setUserNote(event.target.value)}
                  />
                  <small>{userNote.length.toLocaleString("zh-CN")} / 2,000</small>
                </label>
              </section>

              {error ? (
                <p className="library-card-editor-error" role="alert">
                  {error}
                </p>
              ) : null}

              {confirmDelete ? (
                <div
                  className="library-card-editor-confirm"
                  role="group"
                  aria-label="确认删除收藏"
                >
                  <p role="alert">
                    {hasOtherLocations
                      ? "只会删除当前选中的 Chrome 收藏位置；其他位置和 Aarre 智能信息会保留。"
                      : "将删除这条 Chrome 收藏。Aarre 会保留恢复所需记录，30 天内可从侧边栏设置撤销。"}
                  </p>
                  <div>
                    <Button
                      type="button"
                      className="button button-quiet"
                      disabled={Boolean(action)}
                      onClick={() => setConfirmDelete(false)}
                    >
                      取消删除
                    </Button>
                    <Button
                      type="button"
                      className="button button-danger"
                      disabled={Boolean(action)}
                      onClick={() => void deleteSelectedLocation()}
                    >
                      {action === "deleting"
                        ? "正在删除…"
                        : "确认删除"}
                    </Button>
                  </div>
                </div>
              ) : (
                <footer className="library-card-editor-actions">
                  <Button
                    type="button"
                    className="button button-danger"
                    disabled={!writable || Boolean(action)}
                    onClick={() => setConfirmDelete(true)}
                  >
                    <TrashIcon />
                    删除
                  </Button>
                  <div>
                    <Button
                      type="button"
                      className="button button-quiet"
                      onClick={closeEditor}
                      disabled={Boolean(action)}
                    >
                      取消
                    </Button>
                    <Button
                      type="submit"
                      className="button button-dark"
                      disabled={
                        Boolean(action) ||
                        !selectedLocation ||
                        !title.trim() ||
                        !url.trim() ||
                        !parentId
                      }
                    >
                      {action === "saving" ? "正在保存…" : "保存修改"}
                    </Button>
                  </div>
                </footer>
              )}
            </form>
          </div>
          </div>,
          document.body
        )
        : null}
    </>
  );
}

import { BookmarkEditorFields } from "../../components/BookmarkEditorFields";
import { CloudConflictNotice } from "../../components/CloudConflictNotice";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { sendExtensionRequest } from "../../../lib/messages";
import type { BookmarkBarSnapshot, ResourceRecord } from "../../../lib/types";
import { CloseIcon, EllipsisIcon, TrashIcon } from "../../components/Icons";
import { Button } from "@/ui/components/ui/button";
import { Tooltip } from "@/ui/components/ui/tooltip";
import {
  buildLibraryBookmarkEditorModel,
  mergeLibraryEditorTags,
} from "../bookmark-editor";

interface LibraryCardEditorProps {
  resource: ResourceRecord;
  bookmarkSnapshot: BookmarkBarSnapshot;
  onChanged: (
    message: string,
    detail?: {
      resourceKey: string;
      kind: "updated" | "removed" | "location-removed";
    },
  ) => void;
}

type EditorAction = "saving" | "deleting" | "";

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    ),
  ).filter(
    (element) =>
      !element.hasAttribute("hidden") &&
      // Radix Select parks a hidden native <select> next to its trigger to
      // carry the value for form submission; tabbing into it is a dead stop.
      element.getAttribute("aria-hidden") !== "true" &&
      element.tabIndex !== -1,
  );
}

export function LibraryCardEditor({
  resource,
  bookmarkSnapshot,
  onChanged,
}: LibraryCardEditorProps) {
  const model = useMemo(
    () => buildLibraryBookmarkEditorModel(resource, bookmarkSnapshot),
    [bookmarkSnapshot, resource],
  );
  const [open, setOpen] = useState(false);
  const [bookmarkId, setBookmarkId] = useState(
    model.locations[0]?.bookmarkId || "",
  );
  const [title, setTitle] = useState(model.locations[0]?.title || "");
  const [url, setUrl] = useState(model.locations[0]?.url || resource.url);
  const [parentId, setParentId] = useState(model.locations[0]?.parentId || "");
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
    model.locations.find((location) => location.bookmarkId === bookmarkId) ||
    model.locations[0];
  const writable = selectedLocation?.writable === true;
  const hasOtherLocations = model.locations.length > 1;

  function resetForLocation(nextBookmarkId: string) {
    const location = model.locations.find(
      (candidate) => candidate.bookmarkId === nextBookmarkId,
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
      first ? "" : "没有找到对应的 Chrome 收藏位置，请刷新收藏库后再试。",
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
          '[role="search"][aria-label="搜索收藏库"] input',
        )
        // preventScroll：删除/更新卡片后保持瀑布流滚动位置，
        // 不要被聚焦搜索框拉回页面顶部。
        ?.focus({ preventScroll: true });
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
          userNote,
        },
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
          : "收藏信息已更新",
        { resourceKey: resource.resourceKey, kind: "updated" },
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "收藏信息更新失败");
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
          recursive: false,
        },
      });
      setOpen(false);
      focusLibrarySearch();
      onChanged(
        hasOtherLocations
          ? "已删除所选收藏位置，其余位置仍然保留。"
          : "收藏已删除，可在侧边栏设置的“最近的更改”中恢复。",
        {
          resourceKey: resource.resourceKey,
          kind: hasOtherLocations ? "location-removed" : "removed",
        },
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "删除失败");
    } finally {
      setAction("");
    }
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
                    <h2 id={`library-editor-title-${resource.resourceKey}`}>
                      编辑收藏
                    </h2>
                    <p
                      id={`library-editor-description-${resource.resourceKey}`}
                    >
                      Chrome 保存名称、网址和文件夹；Aarre
                      保存备注与自定义标签。
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
                  <CloudConflictNotice
                    resourceKey={resource.resourceKey}
                    currentUserNote={userNote}
                    currentTags={tags}
                    disabled={Boolean(action)}
                    onResolved={() => onChanged("云端编辑冲突已处理")}
                  />
                  <BookmarkEditorFields
                    resource={resource}
                    locations={model.locations}
                    folders={model.folders}
                    selectedLocation={selectedLocation}
                    title={title}
                    url={url}
                    parentId={parentId}
                    tags={tags}
                    tagInput={tagInput}
                    userNote={userNote}
                    writable={writable}
                    disabled={Boolean(action)}
                    titleRef={titleRef}
                    onLocationChange={resetForLocation}
                    onTitleChange={setTitle}
                    onUrlChange={setUrl}
                    onParentIdChange={setParentId}
                    onTagInputChange={setTagInput}
                    onAddTag={addTags}
                    onRemoveTag={(tag) => {
                      setTags((current) =>
                        current.filter((item) => item !== tag),
                      );
                      setTagsChanged(true);
                    }}
                    onUserNoteChange={setUserNote}
                    onProtectionChanged={() =>
                      onChanged("保护设置已更新")
                    }
                  />

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
                        <TrashIcon aria-hidden="true" />
                        <span>
                          {hasOtherLocations
                            ? "只删除当前选中的收藏位置？"
                            : "确认从 Chrome 删除？"}
                          <small>
                            {hasOtherLocations
                              ? "其他位置与 Aarre 智能信息保留"
                              : "30 天内可在侧边栏设置撤销"}
                          </small>
                        </span>
                      </p>
                      <div>
                        <Button
                          variant="ghost"
                          type="button"

                          disabled={Boolean(action)}
                          onClick={() => setConfirmDelete(false)}
                        >
                          取消
                        </Button>
                        <Button
                          variant="danger"
                          type="button"

                          disabled={Boolean(action)}
                          onClick={() => void deleteSelectedLocation()}
                        >
                          {action === "deleting" ? "正在删除…" : "确认删除"}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <footer className="library-card-editor-actions">
                      <Button
                        variant="ghost"
                        size="sm"
                        type="button"
                        className="library-card-editor-delete quiet-danger-action"
                        disabled={!writable || Boolean(action)}
                        onClick={() => setConfirmDelete(true)}
                      >
                        删除
                      </Button>
                      <div>
                        <Button
                          variant="ghost"
                          type="button"

                          onClick={closeEditor}
                          disabled={Boolean(action)}
                        >
                          取消
                        </Button>
                        <Button
                          variant="primary"
                          type="submit"

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
            document.body,
          )
        : null}
    </>
  );
}

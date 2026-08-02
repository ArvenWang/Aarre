import { type Ref } from "react";
import { FluidInput, FluidTextarea } from "./FluidControls";
import type {
  BookmarkEditorFolder,
  BookmarkEditorLocation,
} from "../../lib/bookmark-editor";
import type { ResourceRecord } from "../../lib/types";
import { CloseIcon } from "./Icons";
import { Button } from "../../components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "../../components/ui/select";
import { ProtectionControl } from "./ProtectionControl";

interface BookmarkEditorFieldsProps {
  resource?: Pick<
    ResourceRecord,
    | "summary"
    | "aiStatus"
    | "enhancementBlockReason"
    | "enhancementBlockMessage"
  >;
  locations: BookmarkEditorLocation[];
  folders: BookmarkEditorFolder[];
  selectedLocation?: BookmarkEditorLocation;
  title: string;
  url: string;
  parentId: string;
  tags: string[];
  tagInput: string;
  userNote: string;
  writable: boolean;
  disabled?: boolean;
  titleRef?: Ref<HTMLInputElement>;
  autoFocusTitle?: boolean;
  onLocationChange: (bookmarkId: string) => void;
  onTitleChange: (value: string) => void;
  onUrlChange: (value: string) => void;
  onParentIdChange: (value: string) => void;
  onTagInputChange: (value: string) => void;
  onAddTag: () => void;
  onRemoveTag: (tag: string) => void;
  onUserNoteChange: (value: string) => void;
  onProtectionChanged?: () => void;
}

function aiStatusLabel(
  resource: NonNullable<BookmarkEditorFieldsProps["resource"]>
): string {
  if (resource.enhancementBlockReason === "privacy") return "受隐私保护";
  if (resource.aiStatus === "processing") return "分析中";
  if (resource.aiStatus === "failed") return "分析失败";
  if (resource.aiStatus === "pending") return "等待增强";
  if (resource.aiStatus === "unavailable") return "暂不可用";
  return "待分析";
}

export function BookmarkEditorFields({
  resource,
  locations,
  folders,
  selectedLocation,
  title,
  url,
  parentId,
  tags,
  tagInput,
  userNote,
  writable,
  disabled = false,
  titleRef,
  autoFocusTitle = false,
  onLocationChange,
  onTitleChange,
  onUrlChange,
  onParentIdChange,
  onTagInputChange,
  onAddTag,
  onRemoveTag,
  onUserNoteChange,
  onProtectionChanged,
}: BookmarkEditorFieldsProps) {
  return (
    <>
      {locations.length > 1 ? (
        <div className="library-card-editor-field library-card-editor-location-picker">
          <Select
            value={selectedLocation?.bookmarkId || ""}
            onValueChange={onLocationChange}
            disabled={disabled}
          >
            <SelectTrigger
              className="editor-select-trigger"
              aria-label="选择要编辑的收藏副本"
              placeholder="选择要编辑的收藏副本"
            />
            <SelectContent className="editor-select-content">
              {locations.map((location, index) => (
                <SelectItem
                  value={location.bookmarkId}
                  key={location.bookmarkId}
                  index={index}
                >
                  {location.label}
                  {location.writable ? "" : "（只读）"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      {!writable && selectedLocation ? (
        <div className="library-card-editor-readonly" role="status">
          这条收藏由 Chrome 或组织管理。名称、网址、文件夹和删除操作不可用，但仍可修改
          Aarre 备注和标签。
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
            autoFocus={autoFocusTitle}
            disabled={!writable || disabled}
            onChange={(event) => onTitleChange(event.target.value)}
          />
        </label>

        <label className="library-card-editor-field">
          <span>网址</span>
          <FluidInput
            type="url"
            value={url}
            required
            disabled={!writable || disabled}
            onChange={(event) => onUrlChange(event.target.value)}
          />
        </label>

        <div className="library-card-editor-field">
          <span>文件夹</span>
          <Select
            value={parentId}
            required
            disabled={!writable || disabled}
            onValueChange={onParentIdChange}
          >
            <SelectTrigger
              className="editor-select-trigger"
              aria-label="选择文件夹"
              placeholder="选择文件夹"
            />
            <SelectContent className="editor-select-content">
              {folders.map((folder, index) => (
                <SelectItem
                  value={folder.id}
                  key={folder.id}
                  index={index}
                  disabled={!folder.writable}
                >
                  {folder.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {selectedLocation ? (
        <ProtectionControl
          target={{ kind: "bookmark", id: selectedLocation.bookmarkId }}
          disabled={disabled}
          onChanged={onProtectionChanged}
        />
      ) : null}

      <section className="library-card-editor-ai" aria-label="AI 分析">
        <header className="library-card-editor-ai-heading">
          <strong>AI 分析</strong>
          {resource &&
          (resource.enhancementBlockReason === "privacy" ||
            resource.aiStatus !== "ready") ? (
            <span className="library-card-editor-status" data-tone="pending">
              {aiStatusLabel(resource)}
            </span>
          ) : null}
        </header>

        <div>
          <p>
            {resource?.summary ||
              resource?.enhancementBlockMessage ||
              "尚未生成摘要。下次打开网页时，Aarre 会继续完成智能增强。"}
          </p>
          <small>
            摘要由网页内容生成，因此这里保持只读，避免把人工文字误标为 AI 结果。
          </small>
        </div>

        <div className="library-card-editor-tags">
          <div
            className="library-card-editor-tag-list"
            role="group"
            aria-label="当前标签"
          >
            {tags.length ? (
              tags.map((tag) => (
                <span className="tag-chip" key={tag}>
                  {tag}
                  <Button
                    type="button"
                    variant="unstyled"
                    size="unstyled"
                    className="tag-chip-remove"
                    aria-label={`移除标签 ${tag}`}
                    disabled={disabled}
                    onClick={() => onRemoveTag(tag)}
                  >
                    <CloseIcon />
                  </Button>
                </span>
              ))
            ) : (
              <small>还没有自定义标签</small>
            )}
          </div>
          <div className="library-card-editor-tag-entry">
            <FluidInput
              value={tagInput}
              maxLength={120}
              disabled={disabled}
              aria-label="添加标签"
              placeholder="输入标签，按回车添加"
              onChange={(event) => onTagInputChange(event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" ||
                  event.key === "," ||
                  event.key === "，"
                ) {
                  event.preventDefault();
                  onAddTag();
                }
              }}
            />
            <Button
              type="button"
              variant="unstyled"
              className="library-card-editor-tag-submit"
              onClick={onAddTag}
              disabled={!tagInput.trim() || disabled}
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
            disabled={disabled}
            placeholder="记录收藏原因、后续行动或重要上下文。"
            onChange={(event) => onUserNoteChange(event.target.value)}
          />
          <small>{userNote.length.toLocaleString("zh-CN")} / 2,000</small>
        </label>
      </section>
    </>
  );
}

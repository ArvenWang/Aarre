import React, { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/ui/components/ui/button";
import { FluidInput } from "@/ui/components/ui/input";
import { ChevronDownIcon, FolderIcon } from "../../components/Icons";
import { sendExtensionRequest } from "../../../lib/messages";
import type { NativeFolderOption } from "../../../lib/types";
interface FolderSelectProps {
  options: NativeFolderOption[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

function FolderSelect({
  options,
  value,
  onChange,
  disabled = false,
}: FolderSelectProps) {
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [liveOptions, setLiveOptions] = useState(options);
  const selectedIndex = Math.max(
    0,
    liveOptions.findIndex((option) => option.id === value),
  );
  const selected = liveOptions[selectedIndex];
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(selectedIndex);
  const [creating, setCreating] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState("");

  useEffect(() => {
    setLiveOptions(options);
  }, [options]);

  useEffect(() => {
    setActiveIndex(selectedIndex);
  }, [selectedIndex]);

  useEffect(() => {
    if (!open) return;
    const handleOutsidePointer = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !rootRef.current?.contains(event.target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", handleOutsidePointer);
    return () =>
      document.removeEventListener("pointerdown", handleOutsidePointer);
  }, [open]);

  function focusOption(index: number) {
    const next = Math.max(0, Math.min(index, liveOptions.length - 1));
    setActiveIndex(next);
    window.requestAnimationFrame(() => optionRefs.current[next]?.focus());
  }

  function openMenu(index = selectedIndex) {
    if (!liveOptions.length) return;
    setOpen(true);
    focusOption(index);
  }

  function selectOption(index: number) {
    const option = liveOptions[index];
    if (!option) return;
    onChange(option.id);
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    if (creating) {
      if (event.key === "Escape") {
        event.preventDefault();
        setCreating(false);
        setFolderName("");
        setCreateError("");
      }
      return;
    }
    if (!open) {
      if (
        event.key === "ArrowDown" ||
        event.key === "ArrowUp" ||
        event.key === "Enter" ||
        event.key === " "
      ) {
        event.preventDefault();
        openMenu(event.key === "ArrowUp" ? liveOptions.length - 1 : selectedIndex);
      }
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusOption((activeIndex + 1) % liveOptions.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      focusOption((activeIndex - 1 + liveOptions.length) % liveOptions.length);
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      focusOption(event.key === "Home" ? 0 : liveOptions.length - 1);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectOption(activeIndex);
    }
  }

  async function createFolder() {
    const title = folderName.trim();
    if (!title || createBusy || !selected) return;
    setCreateBusy(true);
    setCreateError("");
    try {
      const created = await sendExtensionRequest({
        type: "CREATE_NATIVE_FOLDER",
        payload: { parentId: selected.id, title },
      });
      const refreshed = await sendExtensionRequest({ type: "GET_FOLDERS" });
      setLiveOptions(refreshed);
      onChange(created.id);
      setCreating(false);
      setFolderName("");
      setOpen(false);
      window.requestAnimationFrame(() => triggerRef.current?.focus());
    } catch (caught) {
      setCreateError(caught instanceof Error ? caught.message : "无法新建文件夹。");
    } finally {
      setCreateBusy(false);
    }
  }

  return (
    <div
      ref={rootRef}
      className="folder-select"
      data-open={open}
      onKeyDown={handleKeyDown}
    >
      <Button
        variant="ghost"
        ref={triggerRef}
        type="button"
        className="folder-select-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        onClick={() => (open ? setOpen(false) : openMenu())}
        disabled={disabled || !liveOptions.length}
      >
        <span>
          {selected?.name || (liveOptions.length ? "选择文件夹" : "暂无自建文件夹")}
        </span>
        <ChevronDownIcon />
      </Button>
      {open ? (
        <div
          id={listboxId}
          className="folder-select-popover"
          role="listbox"
          aria-label="文件夹"
        >
          {liveOptions.map((option, index) => (
            <Button
              key={option.id}
              ref={(element) => {
                optionRefs.current[index] = element;
              }}
              type="button"
              variant="ghost"
              role="option"
              aria-selected={option.id === value}
              tabIndex={index === activeIndex ? 0 : -1}
              className="folder-select-option"
              data-active={index === activeIndex}
              style={
                {
                  "--folder-depth": option.depth,
                } as React.CSSProperties
              }
              onPointerMove={() => setActiveIndex(index)}
              onClick={() => selectOption(index)}
            >
              <FolderIcon />
              <span>{option.name}</span>
              {option.id === value ? <span aria-hidden="true">✓</span> : null}
            </Button>
          ))}
          <div className="folder-select-create">
            {creating ? (
              <>
                <div className="folder-select-create-fields">
                  <FluidInput
                    value={folderName}
                    maxLength={100}
                    autoFocus
                    placeholder="文件夹名称"
                    aria-label="新文件夹名称"
                    disabled={createBusy}
                    onChange={(event) => setFolderName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void createFolder();
                      }
                    }}
                  />
                  <Button type="button" variant="primary" size="sm" disabled={!folderName.trim() || createBusy} onClick={() => void createFolder()}>
                    {createBusy ? "创建中…" : "确认"}
                  </Button>
                  <Button type="button" variant="ghost" size="sm" disabled={createBusy} onClick={() => { setCreating(false); setFolderName(""); setCreateError(""); }}>
                    取消
                  </Button>
                </div>
                {createError ? <p className="folder-select-create-error" role="alert">{createError}</p> : null}
              </>
            ) : (
              <Button type="button" variant="ghost" className="folder-select-create-trigger" onClick={() => { setCreating(true); setCreateError(""); }}>
                <span aria-hidden="true">＋</span>
                <span>新建文件夹</span>
              </Button>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}



export { FolderSelect };

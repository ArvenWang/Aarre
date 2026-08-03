import React, { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/ui/components/ui/button";
import { ChevronDownIcon, FolderIcon } from "../../components/Icons";
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
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.id === value),
  );
  const selected = options[selectedIndex];
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(selectedIndex);

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
    const next = Math.max(0, Math.min(index, options.length - 1));
    setActiveIndex(next);
    window.requestAnimationFrame(() => optionRefs.current[next]?.focus());
  }

  function openMenu(index = selectedIndex) {
    if (!options.length) return;
    setOpen(true);
    focusOption(index);
  }

  function selectOption(index: number) {
    const option = options[index];
    if (!option) return;
    onChange(option.id);
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    if (!open) {
      if (
        event.key === "ArrowDown" ||
        event.key === "ArrowUp" ||
        event.key === "Enter" ||
        event.key === " "
      ) {
        event.preventDefault();
        openMenu(event.key === "ArrowUp" ? options.length - 1 : selectedIndex);
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
      focusOption((activeIndex + 1) % options.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      focusOption((activeIndex - 1 + options.length) % options.length);
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      focusOption(event.key === "Home" ? 0 : options.length - 1);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectOption(activeIndex);
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
        disabled={disabled || !options.length}
      >
        <span>
          {selected?.name || (options.length ? "选择文件夹" : "暂无自建文件夹")}
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
          {options.map((option, index) => (
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
        </div>
      ) : null}
    </div>
  );
}



export { FolderSelect };

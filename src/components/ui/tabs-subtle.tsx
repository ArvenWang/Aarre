"use client";

import {
  Children,
  useRef,
  useState,
  useCallback,
  useEffect,
  createContext,
  useContext,
  forwardRef,
  type ReactNode,
  type HTMLAttributes,
} from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import type { IconComponent } from "@/lib/icon-context";
import { cn } from "@/lib/utils";
import { fontWeights } from "@/lib/font-weight";
import { useProximityHover } from "@/ui/hooks/use-proximity-hover";

// The moving pill and the tab it sits under must share one radius, and that
// radius must be the concentric inset of the strip's own radius — otherwise the
// pill reads as a capsule floating inside a rounded-rectangle shell. Call sites
// override it by setting --tabs-pill-radius on the strip.
const TAB_PILL_RADIUS = "rounded-[var(--tabs-pill-radius,var(--radius-nested-md))]";

interface TabsSubtleContextValue {
  registerTab: (index: number, element: HTMLElement | null) => void;
  hoveredIndex: number | null;
  selectedIndex: number;
  idPrefix: string | undefined;
  activeLabel: boolean;
}

const TabsSubtleContext = createContext<TabsSubtleContextValue | null>(null);

function useTabsSubtle() {
  const ctx = useContext(TabsSubtleContext);
  if (!ctx) throw new Error("useTabsSubtle must be used within a TabsSubtle");
  return ctx;
}

interface TabsSubtleProps extends Omit<HTMLAttributes<HTMLDivElement>, "onSelect"> {
  children: ReactNode;
  selectedIndex: number;
  onSelect: (index: number) => void;
  idPrefix?: string;
  /** Stretch every tab to an equal-width, single-row segmented control. */
  equalWidth?: boolean;
  /** When true, only the selected tab shows its text label. Requires icons on tabs. */
  activeLabel?: boolean;
}

const TabsSubtle = forwardRef<HTMLDivElement, TabsSubtleProps>(
  (
    {
      children,
      selectedIndex,
      onSelect,
      idPrefix,
      equalWidth = false,
      activeLabel = false,
      className,
      style,
      ...props
    },
    ref
  ) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const isMouseInside = useRef(false);

    const {
      activeIndex: hoveredIndex,
      setActiveIndex: setHoveredIndex,
      itemRects: tabRects,
      handlers,
      registerItem,
      measureItems: measureTabs,
    } = useProximityHover(containerRef, { axis: "x" });

    // Track tab elements locally so we can observe their individual resizes
    const tabElementsRef = useRef(new Map<number, HTMLElement>());
    const registerTab = useCallback(
      (index: number, element: HTMLElement | null) => {
        registerItem(index, element);
        if (element) {
          tabElementsRef.current.set(index, element);
        } else {
          tabElementsRef.current.delete(index);
        }
      },
      [registerItem]
    );

    useEffect(() => {
      measureTabs();
    }, [measureTabs, children]);

    // Observe individual tab buttons for resize (label expand/collapse in activeLabel mode)
    useEffect(() => {
      const elements = tabElementsRef.current;
      if (elements.size === 0) return;
      const ro = new ResizeObserver(() => measureTabs());
      elements.forEach((el) => ro.observe(el));
      return () => ro.disconnect();
    }, [measureTabs, children]);

    // Wrap handlers to track isMouseInside
    const handleMouseMove = useCallback(
      (e: React.MouseEvent) => {
        isMouseInside.current = true;
        handlers.onMouseMove(e);
      },
      [handlers]
    );

    const handleMouseLeave = useCallback(() => {
      isMouseInside.current = false;
      handlers.onMouseLeave();
    }, [handlers]);

    const [focusedIndex, setFocusedIndex] = useState<number | null>(null);

    const selectedRect = tabRects[selectedIndex];
    const hoverRect =
      hoveredIndex !== null ? tabRects[hoveredIndex] : null;
    const focusRect = focusedIndex !== null ? tabRects[focusedIndex] : null;
    const isHoveringSelected = hoveredIndex === selectedIndex;
    const isHovering = hoveredIndex !== null && !isHoveringSelected;
    const showHoverPill = Boolean(
      hoverRect && !isHoveringSelected && selectedRect
    );

    return (
      <TabsSubtleContext.Provider
        value={{ registerTab, hoveredIndex, selectedIndex, idPrefix, activeLabel }}
      >
        {/* Root is merged into List via `asChild` so a single <div> is
            emitted. Radix owns
            role="tablist", roving tabindex, and Arrow/Home/End keyboard
            navigation. Radix tab values are strings, so the numeric
            selectedIndex is mapped through String()/Number().
            `activationMode="manual"` keeps manual activation: arrows move
            focus, Enter/Space selects. */}
        <TabsPrimitive.Root
          asChild
          value={String(selectedIndex)}
          onValueChange={(value) => onSelect(Number(value))}
          activationMode="manual"
        >
          <TabsPrimitive.List
            ref={(node: HTMLDivElement | null) => {
              containerRef.current = node;
              if (typeof ref === "function") ref(node);
              else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = node;
            }}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            onFocus={(e: React.FocusEvent<HTMLDivElement>) => {
              const indexAttr = (e.target as HTMLElement)
                .closest("[data-proximity-index]")
                ?.getAttribute("data-proximity-index");
              if (indexAttr != null) {
                const idx = Number(indexAttr);
                setHoveredIndex(idx);
                setFocusedIndex(
                  (e.target as HTMLElement).matches(":focus-visible") ? idx : null
                );
              }
            }}
            onBlur={(e: React.FocusEvent<HTMLDivElement>) => {
              if (containerRef.current?.contains(e.relatedTarget as Node)) return;
              setFocusedIndex(null);
              if (isMouseInside.current) return;
              setHoveredIndex(null);
            }}
            className={cn(
              // -mx-1 px-1 / -my-1 py-1 give the 2px-outset focus ring room
              // to draw without being clipped by overflow-x-auto. The
              // max-width allows for the negative margins: fit-content
              // parents size against the margin box (8px narrower than the
              // border box), so a plain max-w-full would clamp the list 8px
              // too small and clip the first/last tab's ring.
              "relative flex items-center gap-0.5 select-none overflow-x-auto max-w-[calc(100%_+_8px)] scrollbar-hide -mx-1 px-1 -my-1 py-1",
              className
            )}
            style={{
              ...style,
              ...(equalWidth
                ? {
                    display: "grid",
                    gridTemplateColumns: `repeat(${Children.count(
                      children
                    )}, minmax(0, 1fr))`,
                    overflowX: "visible"
                  }
                : {})
            }}
            {...props}
          >
            {/* Selected pill. Kept mounted so switching tabs slides the same
                element rather than cross-fading two of them. */}
            <div
              aria-hidden
              className={cn(
                "absolute bg-[var(--tabs-pill-bg,var(--color-active))] pointer-events-none",
                "transition-[top,left,width,height,opacity] duration-240 ease-out",
                TAB_PILL_RADIUS
              )}
              style={{
                left: selectedRect?.left ?? 0,
                width: selectedRect?.width ?? 0,
                top: selectedRect?.top ?? 0,
                height: selectedRect?.height ?? 0,
                opacity: !selectedRect ? 0 : isHovering ? 0.8 : 1,
              }}
            />

            {/* Hover pill. Parks on the selected rect when idle so it grows out
                of the current selection instead of appearing from nowhere. */}
            <div
              aria-hidden
              className={cn(
                "absolute bg-[var(--tabs-pill-bg,var(--color-active))] pointer-events-none",
                "transition-[top,left,width,height,opacity] duration-160 ease-out",
                TAB_PILL_RADIUS
              )}
              style={{
                left: (showHoverPill ? hoverRect : selectedRect)?.left ?? 0,
                width: (showHoverPill ? hoverRect : selectedRect)?.width ?? 0,
                top: (showHoverPill ? hoverRect : selectedRect)?.top ?? 0,
                height: (showHoverPill ? hoverRect : selectedRect)?.height ?? 0,
                opacity: showHoverPill ? 0.4 : 0,
              }}
            />

            {/* Focus ring sits on the tab box (not inflated outside it). */}
            <div
              aria-hidden
              className={cn(
                "absolute pointer-events-none z-20 border border-[color:var(--focus-ring)]",
                "transition-[top,left,width,height,opacity] duration-160 ease-out",
                TAB_PILL_RADIUS
              )}
              style={{
                left: focusRect?.left ?? 0,
                top: focusRect?.top ?? 0,
                width: focusRect?.width ?? 0,
                height: focusRect?.height ?? 0,
                opacity: focusRect ? 1 : 0,
              }}
            />

            {children}
          </TabsPrimitive.List>
        </TabsPrimitive.Root>
      </TabsSubtleContext.Provider>
    );
  }
);

TabsSubtle.displayName = "TabsSubtle";

interface TabsSubtleItemProps extends HTMLAttributes<HTMLButtonElement> {
  icon?: IconComponent;
  label: string;
  index: number;
}

const TabsSubtleItem = forwardRef<HTMLButtonElement, TabsSubtleItemProps>(
  ({ icon: Icon, label, index, className, ...props }, ref) => {
    const internalRef = useRef<HTMLButtonElement | null>(null);
    const { registerTab, hoveredIndex, selectedIndex, idPrefix, activeLabel } =
      useTabsSubtle();

    useEffect(() => {
      registerTab(index, internalRef.current);
      return () => registerTab(index, null);
    }, [index, registerTab]);

    const isSelected = selectedIndex === index;
    const isActive = hoveredIndex === index || isSelected;
    const collapseLabel = activeLabel && !!Icon;
    const showLabel = !collapseLabel || isSelected;

    const labelContent = (
      // Both stacked spans carry the text-box trim so the invisible bold
      // sizer and the visible label keep identical boxes.
      <span className="inline-grid text-[13px] whitespace-nowrap">
        <span
          className="col-start-1 row-start-1 invisible [text-box:trim-both_cap_alphabetic]"
          style={{ fontVariationSettings: fontWeights.semibold }}
          aria-hidden="true"
        >
          {label}
        </span>
        <span
          className={cn(
            "col-start-1 row-start-1 transition-[color,font-variation-settings] duration-80 [text-box:trim-both_cap_alphabetic]",
            isActive ? "text-foreground" : "text-muted-foreground"
          )}
          style={{
            fontVariationSettings: isSelected
              ? fontWeights.semibold
              : fontWeights.normal,
          }}
        >
          {label}
        </span>
      </span>
    );

    return (
      // Radix Trigger renders a native <button type="button"> and wires
      // role="tab", aria-selected, roving tabindex, and activation for us.
      // id/aria-controls are only overridden when an idPrefix is supplied so
      // externally rendered TabsSubtlePanel elements stay linked.
      <TabsPrimitive.Trigger
        ref={(node: HTMLButtonElement | null) => {
          internalRef.current = node;
          if (typeof ref === "function") ref(node);
          else if (ref) (ref as React.MutableRefObject<HTMLButtonElement | null>).current = node;
        }}
        value={String(index)}
        data-proximity-index={index}
        id={idPrefix ? `${idPrefix}-tab-${index}` : undefined}
        aria-controls={idPrefix ? `${idPrefix}-panel-${index}` : undefined}
        aria-label={collapseLabel && !showLabel ? label : undefined}
        className={cn(
          // Fixed heights (was py-2 around a 19.5px line box ≈ 35.5px) so the
          // text-box trim on the label doesn't shrink the tab.
          "relative z-10 flex items-center justify-center px-3 cursor-pointer bg-transparent border-none outline-none",
          collapseLabel
            ? "h-[var(--control-h-sm)]"
            : "h-[var(--control-h-md)] gap-2",
          TAB_PILL_RADIUS,
          className
        )}
        {...props}
      >
        {Icon && (
          <Icon
            size={16}
            strokeWidth={isActive ? 2 : 1.5}
            className={cn(
              "shrink-0 transition-[color,stroke-width] duration-80",
              isActive ? "text-foreground" : "text-muted-foreground"
            )}
          />
        )}
        {collapseLabel ? (
          // grid-template-columns animates between 0fr and 1fr, which is the
          // CSS way to transition to an intrinsic width.
          <span
            className={cn(
              "grid overflow-hidden",
              "transition-[grid-template-columns,opacity,margin-left] duration-160 ease-out",
              showLabel
                ? "grid-cols-[1fr] opacity-100 ml-2"
                : "grid-cols-[0fr] opacity-0 ml-0"
            )}
          >
            <span className="min-w-0 overflow-hidden">{labelContent}</span>
          </span>
        ) : (
          labelContent
        )}
      </TabsPrimitive.Trigger>
    );
  }
);

TabsSubtleItem.displayName = "TabsSubtleItem";

interface TabsSubtlePanelProps extends HTMLAttributes<HTMLDivElement> {
  index: number;
  selectedIndex: number;
  idPrefix: string;
  children: ReactNode;
}

// Rendered outside <TabsSubtle> at every call site, so it cannot use Radix's
// Tabs.Content (which requires the Tabs.Root context). It stays a plain
// tabpanel linked to its tab through the shared idPrefix.
const TabsSubtlePanel = forwardRef<HTMLDivElement, TabsSubtlePanelProps>(
  ({ index, selectedIndex, idPrefix, children, className, ...props }, ref) => {
    const isSelected = selectedIndex === index;

    return (
      <div
        ref={ref}
        id={`${idPrefix}-panel-${index}`}
        role="tabpanel"
        aria-labelledby={`${idPrefix}-tab-${index}`}
        hidden={!isSelected}
        tabIndex={-1}
        className={cn("outline-none", className)}
        {...props}
      >
        {isSelected && children}
      </div>
    );
  }
);

TabsSubtlePanel.displayName = "TabsSubtlePanel";

export { TabsSubtle, TabsSubtleItem, TabsSubtlePanel };
export default TabsSubtle;

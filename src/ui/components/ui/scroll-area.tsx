import { createElement, forwardRef, useCallback, useEffect, useId, useRef, useState, type HTMLAttributes, type KeyboardEvent, type PointerEvent, type RefObject } from "react";
import { cn } from "@/lib/utils";
import { scrollAxis, scrollFromPointer, type ScrollAxis } from "./scroll-geometry";

const IDLE_MS = 850;
type Metrics = { x: ScrollAxis; y: ScrollAxis; top: number; left: number; width: number; height: number };
const empty: Metrics = { x: scrollAxis(0, 0, 0), y: scrollAxis(0, 0, 0), top: 0, left: 0, width: 0, height: 0 };

export function DocumentScrollbar() {
  const viewportRef = useRef(document.scrollingElement as HTMLElement | null);
  return <FloatingScrollbars viewportRef={viewportRef} documentViewport label="页面" />;
}

/** Sibling overlay: never wraps/moves the viewport's content or takes a gutter. */
export function FloatingScrollbars({ viewportRef, documentViewport = false, label = "内容", keyboardAccess = true }: {
  viewportRef: RefObject<HTMLElement | null>; documentViewport?: boolean; label?: string; keyboardAccess?: boolean;
}) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const latest = useRef(empty);
  const [metrics, setMetrics] = useState(empty);
  const [active, setActive] = useState(false);
  const [dragging, setDragging] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const frame = useRef(0);
  const drag = useRef<{ id: number; axis: "x" | "y"; pointer: number; scroll: number; handle: HTMLElement } | null>(null);
  const id = useId();
  const [controls, setControls] = useState("");

  const reveal = useCallback(() => {
    clearTimeout(timer.current);
    setActive(true);
    timer.current = setTimeout(() => { if (!drag.current) setActive(false); }, IDLE_MS);
  }, []);

  const measure = useCallback(() => {
    const el = viewportRef.current, overlay = overlayRef.current;
    if (!el?.isConnected || !overlay?.isConnected) return;
    const style = getComputedStyle(el);
    const width = documentViewport ? document.documentElement.clientWidth : el.clientWidth;
    const height = documentViewport ? window.innerHeight : el.clientHeight;
    const rect = el.getBoundingClientRect();
    const parent = overlay.parentElement!;
    const parentRect = parent.getBoundingClientRect();
    const contentWidth = documentViewport ? Math.max(el.scrollWidth, document.body.scrollWidth) : el.scrollWidth;
    const contentHeight = documentViewport ? Math.max(el.scrollHeight, document.body.scrollHeight) : el.scrollHeight;
    const inset = parseFloat(style.getPropertyValue("--scrollbar-inset")) || 6;
    const minimum = parseFloat(style.getPropertyValue("--scrollbar-thumb-min")) || 30;
    const hit = parseFloat(style.getPropertyValue("--scrollbar-hit-size")) || 12;
    const horizontal = (documentViewport || /auto|scroll/.test(style.overflowX)) && contentWidth > width + 1;
    const vertical = (documentViewport || /auto|scroll/.test(style.overflowY)) && contentHeight > height + 1;
    const resizeGrip = el.tagName === "TEXTAREA" && style.resize !== "none";
    const next: Metrics = {
      x: scrollAxis(width, horizontal ? contentWidth : width, el.scrollLeft, inset, minimum, vertical ? hit : 0),
      y: scrollAxis(height, vertical ? contentHeight : height, el.scrollTop, inset, minimum, horizontal || resizeGrip ? hit : 0),
      left: documentViewport ? 0 : rect.left - parentRect.left + parent.scrollLeft + el.clientLeft - parent.clientLeft,
      top: documentViewport ? 0 : rect.top - parentRect.top + parent.scrollTop + el.clientTop - parent.clientTop,
      width, height,
    };
    latest.current = next;
    setMetrics(old => JSON.stringify(old) === JSON.stringify(next) ? old : next);
  }, [viewportRef, documentViewport]);

  const queueMeasure = useCallback(() => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => { frame.current = 0; measure(); });
  }, [measure]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const ownedId = !el.id;
    if (ownedId) el.id = `scroll-${id}`;
    setControls(el.id);
    const scroll = () => { queueMeasure(); reveal(); };
    const nearEdge = (event: globalThis.PointerEvent) => {
      const r = documentViewport ? { right: window.innerWidth, bottom: window.innerHeight } : el.getBoundingClientRect();
      if ((latest.current.y.overflow && r.right - event.clientX < 18) || (latest.current.x.overflow && r.bottom - event.clientY < 18)) reveal();
    };
    const observed = new Set<Element>();
    const resize = new ResizeObserver(queueMeasure);
    const observeContent = () => {
      const targets = new Set<Element>([el, ...Array.from(el.children).filter(e => !e.classList.contains("floating-scrollbars"))]);
      if (documentViewport) targets.add(document.body);
      for (const target of observed) if (!targets.has(target)) { resize.unobserve(target); observed.delete(target); }
      for (const target of targets) if (!observed.has(target)) { resize.observe(target); observed.add(target); }
    };
    const mutation = new MutationObserver(records => {
      if (records.every(r => (r.target instanceof Element ? r.target : r.target.parentElement)?.closest(".floating-scrollbars"))) return;
      observeContent(); queueMeasure();
    });
    observeContent();
    mutation.observe(el, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["class", "style", "hidden"] });
    const scrollTarget = documentViewport ? document : el;
    scrollTarget.addEventListener("scroll", scroll, { passive: true });
    el.addEventListener("wheel", reveal, { passive: true });
    el.addEventListener("pointermove", nearEdge, { passive: true });
    el.addEventListener("input", queueMeasure);
    el.addEventListener("load", queueMeasure, true);
    window.addEventListener("resize", queueMeasure);
    const blur = () => {
      const current = drag.current;
      if (!current) return;
      drag.current = null; setDragging(false);
      if (current?.handle.hasPointerCapture(current.id)) current.handle.releasePointerCapture(current.id);
      reveal();
    };
    window.addEventListener("blur", blur);
    measure();
    return () => {
      clearTimeout(timer.current); cancelAnimationFrame(frame.current); frame.current = 0;
      resize.disconnect(); mutation.disconnect();
      scrollTarget.removeEventListener("scroll", scroll);
      el.removeEventListener("wheel", reveal); el.removeEventListener("pointermove", nearEdge);
      el.removeEventListener("input", queueMeasure); el.removeEventListener("load", queueMeasure, true);
      window.removeEventListener("resize", queueMeasure); window.removeEventListener("blur", blur);
      const current = drag.current; drag.current = null;
      if (current?.handle.hasPointerCapture(current.id)) current.handle.releasePointerCapture(current.id);
      if (ownedId && el.id === `scroll-${id}`) el.removeAttribute("id");
    };
  }, [viewportRef, documentViewport, id, measure, queueMeasure, reveal]);

  function begin(axis: "x" | "y", event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || event.isPrimary === false || drag.current || !latest.current[axis].overflow) return;
    event.preventDefault(); event.stopPropagation();
    const el = viewportRef.current!;
    drag.current = { id: event.pointerId, axis, pointer: axis === "x" ? event.clientX : event.clientY, scroll: axis === "x" ? el.scrollLeft : el.scrollTop, handle: event.currentTarget };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true); reveal();
  }
  function move(event: PointerEvent<HTMLDivElement>) {
    const current = drag.current, el = viewportRef.current;
    if (!current || !el || current.id !== event.pointerId) return;
    const pointer = current.axis === "x" ? event.clientX : event.clientY;
    el[current.axis === "x" ? "scrollLeft" : "scrollTop"] = scrollFromPointer(latest.current[current.axis], current.scroll, pointer - current.pointer);
    queueMeasure(); reveal();
  }
  function end(event: PointerEvent<HTMLDivElement>) {
    if (drag.current?.id !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setDragging(false); reveal();
  }
  function key(axis: "x" | "y", event: KeyboardEvent<HTMLDivElement>) {
    const el = viewportRef.current;
    if (!el) return;
    const m = latest.current[axis], property = axis === "x" ? "scrollLeft" : "scrollTop";
    const step = axis === "x" ? el.clientWidth : documentViewport ? window.innerHeight : el.clientHeight;
    const delta: Record<string, number> = { ArrowDown: 40, ArrowRight: 40, ArrowUp: -40, ArrowLeft: -40, PageDown: step * .9, PageUp: -step * .9, " ": step * (event.shiftKey ? -.9 : .9) };
    if (!(event.key in delta) && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault(); event.stopPropagation();
    el[property] = event.key === "Home" ? 0 : event.key === "End" ? m.max : Math.max(0, Math.min(m.max, el[property] + delta[event.key]));
    queueMeasure(); reveal();
  }
  return <div ref={overlayRef} className={cn("floating-scrollbars", documentViewport && "floating-scrollbars-document")} data-active={active} data-dragging={dragging}
    style={{ top: metrics.top, left: metrics.left, width: metrics.width, height: metrics.height }}>
    {(["y", "x"] as const).map(axis => metrics[axis].overflow && <div key={axis} className="floating-scrollbar-thumb" data-axis={axis}
      role="scrollbar" tabIndex={keyboardAccess ? 0 : -1} aria-hidden={keyboardAccess ? undefined : true} aria-label={`${label}${axis === "y" ? "纵向" : "横向"}滚动条`} aria-controls={controls}
      aria-orientation={axis === "y" ? "vertical" : "horizontal"} aria-valuemin={0} aria-valuemax={Math.round(metrics[axis].max)} aria-valuenow={Math.round(metrics[axis].scroll)}
      style={axis === "y" ? { height: metrics.y.size, transform: `translateY(${metrics.y.offset}px)` } : { width: metrics.x.size, transform: `translateX(${metrics.x.offset}px)` }}
      onPointerDown={event => begin(axis, event)} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end}
      onClick={event => { event.preventDefault(); event.stopPropagation(); }} onPointerEnter={reveal} onFocus={reveal} onKeyDown={event => key(axis, event)}><span /></div>)}
  </div>;
}

export const ScrollArea = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement> & { frameClassName?: string; label?: string }>(
  ({ children, className, frameClassName, label, ...props }, forwardedRef) => {
    const viewportRef = useRef<HTMLDivElement>(null);
    return <div className={cn("scroll-area", frameClassName)}>
      <div {...props} ref={node => { viewportRef.current = node; if (typeof forwardedRef === "function") forwardedRef(node); else if (forwardedRef) forwardedRef.current = node; }} className={cn("scroll-area-viewport", className)}>{children}</div>
      <FloatingScrollbars viewportRef={viewportRef} label={label || props["aria-label"]} />
    </div>;
  },
);
ScrollArea.displayName = "ScrollArea";

/** Preserves an existing surface's layout and scroll/focus identity. The overlay
 * is positioned at its scroll offset, so it stays over the viewport. */
export const ScrollSurface = forwardRef<HTMLElement, HTMLAttributes<HTMLElement> & { as?: "div" | "section" | "main"; label?: string }>(
  ({ as = "div", children, label, ...props }, forwardedRef) => {
    const viewportRef = useRef<HTMLElement>(null);
    return createElement(as, { ...props, "data-scroll-viewport": "", ref: (node: HTMLElement | null) => {
      viewportRef.current = node; if (typeof forwardedRef === "function") forwardedRef(node); else if (forwardedRef) forwardedRef.current = node;
    } }, children, <FloatingScrollbars viewportRef={viewportRef} label={label || props["aria-label"]} keyboardAccess={props["aria-hidden"] !== true && props["aria-hidden"] !== "true"} />);
  },
);
ScrollSurface.displayName = "ScrollSurface";

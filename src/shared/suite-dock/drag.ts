import { dockRatio } from "./geometry";
import type { DockSide } from "./contract";

/** Follow both axes while dragging, then park at the closest horizontal edge. */
export function installDockDrag(element: HTMLElement, options: {
  allowed: (event: Event) => boolean;
  bounds: () => { min: number; max: number; left: number; right: number; maxRatio: number; scale?: number };
  ratio: () => number;
  side: () => DockSide;
  change: (ratio: number, xRatio: number) => void;
  commit: (side: DockSide) => void;
  dragging: (active: boolean) => void;
}) {
  const events = new AbortController();
  let gesture: { id: number; x: number; y: number; ratio: number; originX: number; xRatio: number; moved: boolean; target: HTMLElement } | undefined;
  let suppressClick = false;
  const finish = () => {
    const current = gesture;
    if (!current) return;
    gesture = undefined;
    try { if (current.target.hasPointerCapture(current.id)) current.target.releasePointerCapture(current.id); } catch { /* The page lost its pointer target. */ }
    options.dragging(false);
    if (current.moved) {
      suppressClick = true;
      options.commit(current.xRatio === .5 ? options.side() : current.xRatio < .5 ? "left" : "right");
    }
  };
  element.addEventListener("pointerdown", event => {
    if (!event.isTrusted || !event.isPrimary || event.button !== 0 || !options.allowed(event)) return;
    finish(); suppressClick = false;
    const target = event.target instanceof HTMLElement ? event.target : element;
    const originX = options.side() === "left" ? 0 : 1;
    gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, ratio: Math.min(options.ratio(), options.bounds().maxRatio), originX, xRatio: originX, moved: false, target };
    target.setPointerCapture(event.pointerId);
  }, { signal: events.signal });
  element.addEventListener("pointermove", event => {
    const current = gesture;
    if (!event.isTrusted || !current || current.id !== event.pointerId) return;
    const dx = event.clientX - current.x, dy = event.clientY - current.y;
    if (!current.moved && Math.hypot(dx, dy) < 5) return;
    if (!current.moved) { current.moved = true; options.dragging(true); }
    event.preventDefault(); event.stopPropagation();
    const { min, max, left, right, maxRatio, scale = 1 } = options.bounds();
    current.xRatio = dockRatio(current.originX + dx / scale / Math.max(1, right - left));
    options.change(Math.min(maxRatio, dockRatio(current.ratio + dy / scale / Math.max(1, max - min))), current.xRatio);
  }, { signal: events.signal });
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) element.addEventListener(type, event => {
    if ((event as PointerEvent).pointerId === gesture?.id) finish();
  }, { signal: events.signal });
  element.addEventListener("click", event => {
    if (!suppressClick || (event as MouseEvent).detail === 0) return;
    suppressClick = false; event.preventDefault(); event.stopImmediatePropagation();
  }, { capture: true, signal: events.signal });
  element.addEventListener("keydown", event => {
    if (!event.isTrusted || event.metaKey || event.ctrlKey || event.altKey || !options.allowed(event) || !["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const { min, max, maxRatio } = options.bounds(), step = (event.shiftKey ? 40 : 12) / Math.max(1, max - min);
    const ratio = Math.min(options.ratio(), maxRatio);
    const horizontal = event.key === "ArrowLeft" || event.key === "ArrowRight";
    const side = horizontal ? event.key === "ArrowLeft" ? "left" : "right" : options.side();
    options.change(horizontal ? ratio : event.key === "Home" ? 0 : event.key === "End" ? maxRatio : Math.min(maxRatio, dockRatio(ratio + (event.key === "ArrowDown" ? step : -step))), side === "left" ? 0 : 1);
    options.commit(side);
  }, { signal: events.signal });
  element.addEventListener("dragstart", event => event.preventDefault(), { signal: events.signal });
  window.addEventListener("blur", finish, { signal: events.signal });
  return { get active() { return !!gesture; }, destroy() { finish(); events.abort(); } };
}

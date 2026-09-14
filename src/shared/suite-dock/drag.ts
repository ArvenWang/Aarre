import { dockRatio } from "./geometry";

/** A drag moves vertically; a short click keeps the original button action. */
export function installDockDrag(element: HTMLElement, options: {
  allowed: (event: Event) => boolean;
  bounds: () => { min: number; max: number; scale?: number };
  ratio: () => number;
  change: (ratio: number) => void;
  commit: () => void;
  dragging: (active: boolean) => void;
}) {
  const events = new AbortController();
  let gesture: { id: number; x: number; y: number; ratio: number; moved: boolean; target: HTMLElement } | undefined;
  let suppressClick = false;
  const finish = () => {
    const current = gesture;
    if (!current) return;
    gesture = undefined;
    if (current.target.hasPointerCapture(current.id)) current.target.releasePointerCapture(current.id);
    options.dragging(false);
    if (current.moved) { suppressClick = true; options.commit(); }
  };
  element.addEventListener("pointerdown", event => {
    if (!event.isTrusted || !event.isPrimary || event.button !== 0 || !options.allowed(event)) return;
    finish(); suppressClick = false;
    const target = event.target instanceof HTMLElement ? event.target : element;
    gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, ratio: options.ratio(), moved: false, target };
    target.setPointerCapture(event.pointerId);
  }, { signal: events.signal });
  element.addEventListener("pointermove", event => {
    const current = gesture;
    if (!event.isTrusted || !current || current.id !== event.pointerId) return;
    const dx = event.clientX - current.x, dy = event.clientY - current.y;
    if (!current.moved && Math.hypot(dx, dy) < 5) return;
    if (!current.moved) { current.moved = true; options.dragging(true); }
    event.preventDefault(); event.stopPropagation();
    const { min, max, scale = 1 } = options.bounds();
    options.change(dockRatio(current.ratio + dy / scale / Math.max(1, max - min)));
  }, { signal: events.signal });
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) element.addEventListener(type, event => {
    if ((event as PointerEvent).pointerId === gesture?.id) finish();
  }, { signal: events.signal });
  element.addEventListener("click", event => {
    if (!suppressClick || (event as MouseEvent).detail === 0) return;
    suppressClick = false; event.preventDefault(); event.stopImmediatePropagation();
  }, { capture: true, signal: events.signal });
  element.addEventListener("keydown", event => {
    if (!event.isTrusted || event.metaKey || event.ctrlKey || event.altKey || !options.allowed(event) || !["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const { min, max } = options.bounds(), step = (event.shiftKey ? 40 : 12) / Math.max(1, max - min);
    options.change(event.key === "Home" ? 0 : event.key === "End" ? 1 : dockRatio(options.ratio() + (event.key === "ArrowDown" ? step : -step)));
    options.commit();
  }, { signal: events.signal });
  element.addEventListener("dragstart", event => event.preventDefault(), { signal: events.signal });
  window.addEventListener("blur", finish, { signal: events.signal });
  return { get active() { return !!gesture; }, destroy() { finish(); events.abort(); } };
}

import type { DockSide } from "./contract";

export type DockRect = { x: number; y: number; width: number; height: number };
export type DockViewport = { width: number; height: number; left?: number; top?: number };
export const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
export const DOCK_EDGE = 12;
export const DOCK_GAP = 8;
/** One app's handle. The bar keeps this slot put and grows past it. */
export const DOCK_SLOT = 52;
export const dockWidth = (width: number) => Math.max(320, Math.min(640, width));
export const dockRatio = (ratio: number) => Number.isFinite(ratio) ? Math.max(0, Math.min(1, ratio)) : .5;

/** Use the current usable viewport, including native scrollbar changes. */
export function dockViewport(): DockViewport {
  const viewport = window.visualViewport;
  return {
    width: viewport?.width || innerWidth,
    height: viewport?.height || innerHeight, left: viewport?.offsetLeft || 0, top: viewport?.offsetTop || 0,
  };
}

/** Both main workspaces fill the same viewport; compact tasks size separately. */
export function dockRects(viewport: DockViewport, preferredWidth = 400, handleHeight = 52, ratio = .5, side: DockSide = "right", dragRatio?: number, widthLimits = { min: 320, max: 640 }) {
  const left = viewport.left || 0, top = viewport.top || 0;
  const w = Math.max(1, viewport.width), h = Math.max(1, viewport.height);
  const gap = Math.min(DOCK_GAP, w / 8, h / 8), available = w - gap * 2;
  const margin = Math.min(DOCK_EDGE, h / 8), width = Math.min(clamp(preferredWidth, widthLimits.min, widthLimits.max), available);
  const barWidth = Math.min(DOCK_SLOT, available), barHeight = Math.min(handleHeight, h - gap * 2);
  // The second app joins the bar the moment its page gains a host, which can
  // land in the middle of the user's click. Anchoring the first slot instead
  // of the bar's centre lets the bar grow downward, so a handle that is
  // already on screen never slides out from under the pointer.
  const anchor = Math.min(DOCK_SLOT, h - gap * 2);
  const barTop = Math.min(top + gap + (h - gap * 2 - anchor) * dockRatio(ratio), top + h - gap - barHeight);
  return {
    bar: { x: left + gap + (available - barWidth) * dockRatio(dragRatio ?? (side === "left" ? 0 : 1)), y: Math.max(top + gap, barTop), width: barWidth, height: barHeight },
    menu: { x: side === "left" ? left + gap : left + w - gap - width, y: top + margin, width, height: h - margin * 2 },
  };
}

/** Ratios use the first slot's travel even when a paired bar reaches bottom. */
export function dockDragBounds(viewport: DockViewport, handleHeight = DOCK_SLOT) {
  const first = dockRects(viewport, 400, DOCK_SLOT, 0, "left").bar;
  const last = dockRects(viewport, 400, DOCK_SLOT, 1).bar;
  const bottom = dockRects(viewport, 400, handleHeight, 1).bar;
  return { min: first.y, max: last.y, left: first.x, right: last.x,
    maxRatio: dockRatio((bottom.y - first.y) / Math.max(1, last.y - first.y)) };
}

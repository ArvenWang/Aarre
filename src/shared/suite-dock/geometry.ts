export type DockRect = { x: number; y: number; width: number; height: number };
export type DockViewport = { width: number; height: number; left?: number; top?: number };
export const DOCK_EDGE = 12;
export const DOCK_GAP = 8;
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
export function dockRects(viewport: DockViewport, preferredWidth = 400, handleHeight = 52, ratio = .5) {
  const left = viewport.left || 0, top = viewport.top || 0;
  const w = Math.max(1, viewport.width), h = Math.max(1, viewport.height);
  const gap = Math.min(DOCK_GAP, w / 8, h / 8), available = w - gap * 2;
  const margin = Math.min(DOCK_EDGE, h / 8), width = Math.min(dockWidth(preferredWidth), available);
  const barWidth = Math.min(52, available), barHeight = Math.min(handleHeight, h - gap * 2);
  return {
    bar: { x: left + w - gap - barWidth, y: top + gap + (h - gap * 2 - barHeight) * dockRatio(ratio), width: barWidth, height: barHeight },
    menu: { x: left + w - gap - width, y: top + margin, width, height: h - margin * 2 },
  };
}

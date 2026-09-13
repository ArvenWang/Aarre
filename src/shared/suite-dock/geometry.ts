export type DockRect = { x: number; y: number; width: number; height: number };
export type DockViewport = { width: number; height: number; left?: number; top?: number };
export const DOCK_EDGE = 12;
export const dockWidth = (width: number) => Math.max(320, Math.min(640, width));

/** Both main workspaces fill the same viewport; compact tasks size separately. */
export function dockRects(viewport: DockViewport, preferredWidth = 400, handleHeight = 52) {
  const left = viewport.left || 0, top = viewport.top || 0;
  const w = Math.max(1, viewport.width), h = Math.max(1, viewport.height);
  const margin = Math.min(DOCK_EDGE, h / 8), width = Math.min(dockWidth(preferredWidth), w);
  const barWidth = Math.min(52, w), barHeight = Math.min(handleHeight, h);
  return {
    bar: { x: left + w - barWidth, y: top + (h - barHeight) / 2, width: barWidth, height: barHeight },
    menu: { x: left + w - width, y: top + margin, width, height: h - margin * 2 },
  };
}

export const BALL_SIZE = 52;
export const FLOAT_EDGE = 12;
export interface FloatingPosition { edge: "left" | "right"; ratio: number; width: number; height: number }
export interface Viewport { width: number; height: number; left?: number; top?: number }
export const defaultFloatingPosition: FloatingPosition = { edge: "right", ratio: 0.72, width: 400, height: 600 };
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, Math.max(min, max)));
export function floatingRects(position: FloatingPosition, viewport: Viewport, menuOpen = true) {
  const left = viewport.left || 0, top = viewport.top || 0;
  const w = Math.max(1, viewport.width), h = Math.max(1, viewport.height);
  const margin = Math.min(FLOAT_EDGE, Math.max(0, (Math.min(w, h) - BALL_SIZE) / 2));
  const x = left + (position.edge === "left" ? margin : Math.max(margin, w - BALL_SIZE - margin));
  let y = top + margin + clamp(position.ratio, 0, 1) * Math.max(0, h - BALL_SIZE - margin * 2);
  const width = Math.min(clamp(position.width, 320, 560), Math.max(1, w - FLOAT_EDGE * 2));
  let height = Math.min(clamp(position.height, 360, 800), Math.max(1, h - FLOAT_EDGE * 2));
  // Prefer a side-by-side menu. On narrow pages place it above/below the ball when space permits.
  const beside = w >= width + BALL_SIZE + FLOAT_EDGE * 3;
  let menuX = position.edge === "left" ? x + BALL_SIZE + FLOAT_EDGE : x - width - FLOAT_EDGE;
  let menuY = y + BALL_SIZE - height;
  if (!beside) {
    menuX = left + (w - width) / 2;
    // Reserve a separate ball row on narrow pages; opening never obscures its close target.
    height = Math.min(height, Math.max(1, h - BALL_SIZE - FLOAT_EDGE * 3));
    if (menuOpen) y = top + h - BALL_SIZE - margin;
    menuY = y - height - FLOAT_EDGE;
  }
  menuX = clamp(menuX, left + FLOAT_EDGE, left + w - width - FLOAT_EDGE);
  menuY = clamp(menuY, top + FLOAT_EDGE, top + h - height - FLOAT_EDGE);
  return { ball: { x, y, width: BALL_SIZE, height: BALL_SIZE }, menu: { x: menuX, y: menuY, width, height } };
}
export function floatingPositionAt(x: number, y: number, viewport: Viewport, previous: FloatingPosition): FloatingPosition {
  return { ...previous, edge: x + BALL_SIZE / 2 < (viewport.left || 0) + viewport.width / 2 ? "left" : "right",
    ratio: clamp((y - (viewport.top || 0) - FLOAT_EDGE) / Math.max(1, viewport.height - BALL_SIZE - FLOAT_EDGE * 2), 0, 1) };
}

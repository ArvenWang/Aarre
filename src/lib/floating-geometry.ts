import { dockRects } from "../shared/suite-dock/geometry";
export { DOCK_EDGE as FLOAT_EDGE, dockWidth as floatingWidth } from "../shared/suite-dock/geometry";
export const BAR_WIDTH = 52;
export const BAR_HEIGHT = 52;
export const SAVE_PANEL_WIDTH = 360;
// Reserve a compact task surface before reading the page. Content scrolls
// inside it so loading and AI results never cause a second window expansion.
export const SAVE_PANEL_INITIAL_HEIGHT = 560;
export interface FloatingPosition { width: number; handleRatio?: number }
export interface Viewport { width: number; height: number; left?: number; top?: number }
export const defaultFloatingPosition: FloatingPosition = { width: 400 };
export function floatingRects(position: FloatingPosition, viewport: Viewport, handleHeight = BAR_HEIGHT) {
  return dockRects(viewport, position.width, handleHeight, position.handleRatio);
}

/** A short task stays near its launcher; long forms scroll within the viewport. */
export function floatingSaveRect(viewport: Viewport, contentHeight = SAVE_PANEL_INITIAL_HEIGHT, position = defaultFloatingPosition, handleHeight = BAR_HEIGHT) {
  const { bar, menu } = floatingRects(position, viewport, handleHeight);
  const width = Math.min(SAVE_PANEL_WIDTH, menu.width);
  const requested = Number.isFinite(contentHeight) ? contentHeight : SAVE_PANEL_INITIAL_HEIGHT;
  const height = Math.min(Math.max(160, Math.ceil(requested)), 640, menu.height);
  return { x: bar.x + bar.width - width, y: Math.max(menu.y, Math.min(menu.y + menu.height - height, bar.y + (bar.height - height) / 2)), width, height };
}

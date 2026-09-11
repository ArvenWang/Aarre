export const BAR_WIDTH = 52;
export const BAR_HEIGHT = 100;
export const FLOAT_EDGE = 12;
export interface FloatingPosition { width: number }
export interface Viewport { width: number; height: number; left?: number; top?: number }
export const defaultFloatingPosition: FloatingPosition = { width: 400 };
export const floatingWidth = (width: number) => Math.max(320, Math.min(640, width));

export function floatingRects(position: FloatingPosition, viewport: Viewport) {
  const left = viewport.left || 0, top = viewport.top || 0;
  const w = Math.max(1, viewport.width), h = Math.max(1, viewport.height);
  const margin = Math.min(FLOAT_EDGE, h / 8);
  const width = Math.min(floatingWidth(position.width), w);
  const barWidth = Math.min(BAR_WIDTH, w), barHeight = Math.min(BAR_HEIGHT, h);
  return {
    bar: { x: left + w - barWidth, y: top + (h - barHeight) / 2, width: barWidth, height: barHeight },
    menu: { x: left + w - width, y: top + margin, width, height: h - margin * 2 },
  };
}

export interface ScrollAxis { overflow: boolean; max: number; scroll: number; size: number; travel: number; offset: number }
const clamp = (n: number, max: number) => Math.max(0, Math.min(max, n));
export function scrollAxis(viewport: number, content: number, position: number, inset = 6, minimum = 30, corner = 0): ScrollAxis {
  const max = Math.max(0, content - viewport), track = Math.max(0, viewport - inset * 2 - corner);
  const size = max > 1 ? Math.min(track, Math.max(minimum, track * viewport / content)) : track;
  const travel = Math.max(0, track - size), scroll = clamp(position, max);
  return { overflow: max > 1 && travel > 0, max, scroll, size, travel, offset: max ? scroll / max * travel : 0 };
}
export function scrollFromPointer(axis: ScrollAxis, start: number, delta: number) {
  return axis.travel ? clamp(start + delta / axis.travel * axis.max, axis.max) : 0;
}

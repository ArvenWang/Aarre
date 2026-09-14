import type { DockRect } from "./geometry";

const motion = { open: 280, close: 210, contentOpen: 140, contentClose: 120, delay: 100, easing: "cubic-bezier(.22,1,.36,1)" };
export const dockDuration = (open: boolean) => matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : open ? motion.open : motion.close;

/** Animate only the neutral surface; text and iframe contents keep their actual size. */
export function createDockMorph(surface: HTMLElement, panel: HTMLElement) {
  let animation: Animation | undefined, content: Animation | undefined;
  let rect: DockRect | undefined;
  let open = false;
  // The controller owns content styles in both hosts, independent of host CSS
  // and asynchronous iframe readiness or broker acknowledgements.
  panel.style.opacity = "0"; panel.style.transform = "translateX(12px)";
  return {
    layout(target: DockRect, nextOpen: boolean, animate = false) {
      const current = surface.getBoundingClientRect();
      const from = current.width ? current : rect;
      const changed = !rect || rect.x !== target.x || rect.y !== target.y || rect.width !== target.width || rect.height !== target.height;
      const stateChanged = nextOpen !== open;
      const duration = dockDuration(nextOpen);
      if (changed || stateChanged) {
        const running = animation?.playState === "running";
        // A viewport/content resize during a transition keeps its deadline;
        // repeated state notifications neither restart nor cancel the motion.
        const remaining = running && !stateChanged
          ? Math.max(0, Number(animation!.effect?.getComputedTiming().endTime ?? duration) - Number(animation!.currentTime ?? 0)) : duration;
        animation?.cancel(); animation = undefined;
        Object.assign(surface.style, { left: `${target.x}px`, top: `${target.y}px`, width: `${target.width}px`, height: `${target.height}px` });
        if ((animate || running) && from && surface.animate && duration > 0 && remaining > 0) {
          animation = surface.animate([
            { transform: `translate(${from.x - target.x}px,${from.y - target.y}px) scale(${from.width / target.width},${from.height / target.height})` },
            { transform: "none" },
          ], { duration: Math.min(duration, remaining), easing: motion.easing });
        }
        rect = target;
      }
      if (stateChanged) {
        const computed = getComputedStyle(panel);
        const opacity = panel.hidden ? 0 : Number(computed.opacity);
        const transform = nextOpen && opacity === 0 ? "translateX(12px)" : computed.transform;
        content?.cancel(); content = undefined;
        panel.style.opacity = nextOpen ? "1" : "0";
        panel.style.transform = nextOpen ? "none" : "translateX(8px)";
        if (animate && panel.animate && duration > 0) {
          content = panel.animate([{ opacity, transform }, { opacity: nextOpen ? 1 : 0, transform: panel.style.transform }], {
            duration: nextOpen ? motion.contentOpen : motion.contentClose, delay: nextOpen && opacity === 0 ? motion.delay : 0,
            fill: "backwards", easing: "ease-out",
          });
        }
        open = nextOpen;
      }
    },
    destroy() { animation?.cancel(); content?.cancel(); },
  };
}

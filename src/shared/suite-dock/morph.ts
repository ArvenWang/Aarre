import type { DockRect } from "./geometry";

const motion = { open: 280, close: 210, contentOpen: 140, contentClose: 120, delay: 100, easing: "cubic-bezier(.22,1,.36,1)" };
export const dockDuration = (open: boolean) => matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : open ? motion.open : motion.close;

/** Scale only the surface; content and controls share its moving right edge. */
export function createDockMorph(surface: HTMLElement, panel: HTMLElement, controls: HTMLElement[] = []) {
  let animation: Animation | undefined, content: Animation | undefined;
  let edges: Animation[] = [];
  let rect: DockRect | undefined;
  let open = false;
  // The controller owns content styles in both hosts, independent of host CSS
  // and asynchronous iframe readiness or broker acknowledgements.
  panel.style.opacity = "0"; panel.style.transform = "none";
  return {
    layout(target: DockRect, nextOpen: boolean, animate = false) {
      const current = surface.getBoundingClientRect();
      const from = current.width ? current : rect;
      const changed = !rect || rect.x !== target.x || rect.y !== target.y || rect.width !== target.width || rect.height !== target.height;
      const stateChanged = nextOpen !== open;
      const duration = dockDuration(nextOpen);
      if (changed || stateChanged) {
        const running = animation?.playState === "running";
        const edgeChanged = rect && Math.abs(target.x + target.width - rect.x - rect.width) > .5;
        // A viewport/content resize during a transition keeps its deadline;
        // repeated state notifications neither restart nor cancel the motion.
        const remaining = running && !stateChanged
          ? Math.max(0, Number(animation!.effect?.getComputedTiming().endTime ?? duration) - Number(animation!.currentTime ?? 0)) : duration;
        animation?.cancel(); animation = undefined;
        Object.assign(surface.style, { left: `${target.x}px`, top: `${target.y}px`, width: `${target.width}px`, height: `${target.height}px` });
        edges.forEach(edge => edge.cancel()); edges = [];
        if ((animate || running || edgeChanged) && from && surface.animate && duration > 0 && remaining > 0) {
          const timing = { duration: Math.min(duration, remaining), easing: motion.easing };
          animation = surface.animate([
            { transform: `translate(${from.x - target.x}px,${from.y - target.y}px) scale(${from.width / target.width},${from.height / target.height})` },
            { transform: "none" },
          ], timing);
          // Only follow a real edge change, never add a decorative entrance offset.
          // This also retargets an in-flight open/close without a second deadline.
          const dx = from.x + from.width - target.x - target.width;
          if (Math.abs(dx) > .01) edges = [panel, ...controls].map(element => element.animate([
            { transform: `translateX(${dx}px)` }, { transform: "none" },
          ], timing));
        }
        rect = target;
      }
      if (stateChanged) {
        const computed = getComputedStyle(panel);
        const opacity = panel.hidden ? 0 : Number(computed.opacity);
        content?.cancel(); content = undefined;
        panel.style.opacity = nextOpen ? "1" : "0";
        if (animate && panel.animate && duration > 0) {
          content = panel.animate([{ opacity }, { opacity: nextOpen ? 1 : 0 }], {
            duration: nextOpen ? motion.contentOpen : motion.contentClose, delay: nextOpen && opacity === 0 ? motion.delay : 0,
            fill: "backwards", easing: "ease-out",
          });
        }
        open = nextOpen;
      }
    },
    destroy() { animation?.cancel(); content?.cancel(); edges.forEach(edge => edge.cancel()); },
  };
}

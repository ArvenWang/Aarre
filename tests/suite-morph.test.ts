// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createDockMorph, dockDuration } from "../src/shared/suite-dock/morph";
import { SUITE_BAR_HEIGHT } from "../src/shared/suite-dock/ui";
import { dockRects } from "../src/shared/suite-dock/geometry";

beforeEach(() => vi.stubGlobal("matchMedia", () => ({ matches: false })));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

function fixture() {
  const surface = document.createElement("div"), panel = document.createElement("section");
  document.body.append(surface, panel);
  const animate = () => vi.fn((_frames: Keyframe[], options: KeyframeAnimationOptions) => ({
    cancel: vi.fn(), playState: "running", currentTime: 0,
    effect: { getComputedTiming: () => ({ endTime: options.duration }) },
  } as unknown as Animation));
  const base = animate(), content = animate(); surface.animate = base; panel.animate = content;
  const controller = createDockMorph(surface, panel);
  const rects = dockRects({ width: 1280, height: 900 }, 400, SUITE_BAR_HEIGHT);
  controller.layout(rects.bar, false);
  return { surface, panel, base, content, controller, ...rects };
}

it("does not replay or cancel opening when readiness and broker state repeat", () => {
  const f = fixture(); f.controller.layout(f.menu, true, true);
  const animation = f.base.mock.results[0].value;
  f.controller.layout(f.menu, true); f.controller.layout(f.menu, true, true);
  expect(f.base).toHaveBeenCalledTimes(1); expect(f.content).toHaveBeenCalledTimes(1);
  expect(animation.cancel).not.toHaveBeenCalled();
});

it("reverses from the currently rendered surface and opacity without shifting content", () => {
  const f = fixture(); f.controller.layout(f.menu, true, true);
  vi.spyOn(f.surface, "getBoundingClientRect").mockReturnValue({ x: 1022, y: 200, width: 250, height: 500 } as DOMRect);
  const native = getComputedStyle;
  vi.stubGlobal("getComputedStyle", (el: Element) => el === f.panel ? { opacity: "0.45", transform: "none" } : native(el));
  f.controller.layout(f.bar, false, true);
  expect(f.content.mock.calls[1][0][0]).toEqual({ opacity: .45 });
  expect(f.base.mock.calls[1][0][0].transform).toContain(`scale(${250 / 52},${500 / SUITE_BAR_HEIGHT})`);
  expect(f.panel.style.opacity).toBe("0"); expect(f.panel.style.transform).toBe("none");
  f.controller.destroy(); expect(f.base.mock.results[1].value.cancel).toHaveBeenCalled();
});

it("retargets a changed viewport without extending the current transition deadline", () => {
  const f = fixture(); f.controller.layout(f.menu, true, true);
  const first = f.base.mock.results[0].value; first.currentTime = 80;
  f.controller.layout({ ...f.menu, height: 700 }, true);
  expect(first.cancel).toHaveBeenCalled();
  expect(f.base.mock.calls[1][1].duration).toBe(200);
  expect(f.content).toHaveBeenCalledTimes(1);
});

it("keeps content at its final position while using the common enter and exit motion", () => {
  const f = fixture(); f.controller.layout(f.menu, true, true);
  const [frames, options] = f.content.mock.calls[0];
  expect(frames).toEqual([{ opacity: 0 }, { opacity: 1 }]);
  expect(options).toMatchObject({ duration: 140, delay: 100 });
  f.controller.layout(f.bar, false, true);
  expect(f.content.mock.calls[1][1]).toMatchObject({ duration: 120, delay: 0 });
  expect(f.base.mock.calls.map(call => call[1].duration)).toEqual([280, 210]);
});

it("moves the visible content with a changed right edge within the opening deadline", () => {
  const f = fixture(); f.controller.layout(f.menu, true, true);
  const first = f.base.mock.results[0].value; first.currentTime = 80;
  vi.spyOn(f.surface, "getBoundingClientRect").mockReturnValue({ x: 1022, y: 200, width: 250, height: 500 } as DOMRect);
  f.controller.layout({ ...f.menu, x: f.menu.x + 18 }, true);
  const [frames, timing] = f.content.mock.calls[1];
  expect(frames).toEqual([{ transform: "translateX(-18px)" }, { transform: "none" }]);
  expect(timing).toMatchObject({ duration: 200, easing: f.base.mock.calls[1][1].easing });
  expect(f.content.mock.calls.filter(([keys]) => "opacity" in keys[0])).toHaveLength(1);
});

it("animates a late viewport edge change without replaying content appearance", () => {
  const f = fixture(); f.controller.layout(f.menu, true, true);
  f.base.mock.results[0].value.playState = "finished";
  vi.spyOn(f.surface, "getBoundingClientRect").mockReturnValue({ ...f.menu } as DOMRect);
  f.controller.layout({ ...f.menu, x: f.menu.x + 18 }, true);
  expect(f.base.mock.calls[1][0][0].transform).toContain("translate(-18px,0px)");
  expect(f.content.mock.calls[1][0]).toEqual([{ transform: "translateX(-18px)" }, { transform: "none" }]);
});

it("shows and hides immediately for reduced motion without creating animations", () => {
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  const f = fixture(); f.controller.layout(f.menu, true, true);
  expect(f.panel.style.opacity).toBe("1"); expect(f.surface.style.height).toBe("876px");
  f.controller.layout(f.bar, false, true);
  expect(f.panel.style.opacity).toBe("0"); expect(f.surface.style.height).toBe(`${SUITE_BAR_HEIGHT}px`);
  expect(f.base).not.toHaveBeenCalled(); expect(f.content).not.toHaveBeenCalled();
  expect(dockDuration(false)).toBe(0);
});

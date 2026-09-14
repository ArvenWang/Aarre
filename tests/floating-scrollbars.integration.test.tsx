// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScrollSurface } from "../src/ui/components/ui/scroll-area";
import { scrollAxis, scrollFromPointer } from "../src/ui/components/ui/scroll-geometry";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement, viewport: HTMLElement;
let height = 900, width = 600;
const capture = new Set<number>();
beforeEach(() => {
  vi.useFakeTimers(); height = 900; width = 600; capture.clear();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(() => callback(0), 16));
  vi.stubGlobal("cancelAnimationFrame", clearTimeout);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });
function frame() { act(() => { window.dispatchEvent(new Event("resize")); vi.advanceTimersByTime(20); }); }
function mount(onClick = vi.fn()) {
  act(() => root.render(<ScrollSurface label="收藏" style={{overflowY:"auto",overflowX:"auto"}} onClick={onClick}><p>真实内容节点</p></ScrollSurface>));
  viewport = host.firstElementChild as HTMLElement;
  Object.defineProperties(viewport, { clientHeight:{get:()=>300}, clientWidth:{get:()=>200}, scrollHeight:{get:()=>height}, scrollWidth:{get:()=>width} });
  viewport.getBoundingClientRect = () => new DOMRect(0, 0, 200, 300);
  frame();
  for (const thumb of host.querySelectorAll<HTMLElement>('[role="scrollbar"]')) {
    thumb.setPointerCapture = id => { capture.add(id); };
    thumb.hasPointerCapture = id => capture.has(id);
    thumb.releasePointerCapture = id => { capture.delete(id); };
  }
}
function pointer(target: Element, type: string, y: number) {
  const event = new MouseEvent(type, {bubbles:true,cancelable:true,button:0,clientY:y});
  Object.defineProperty(event,"pointerId",{value:7});
  act(() => target.dispatchEvent(event));
}
const vertical = () => host.querySelector<HTMLElement>('[aria-orientation="vertical"]')!;

describe("floating scrollbar behavior", () => {
  it("has no control for fitting content and clamps tiny or overscrolled geometry", () => {
    expect(scrollAxis(300,300,0).overflow).toBe(false);
    expect(scrollAxis(8,900,0).overflow).toBe(false);
    const axis = scrollAxis(300,900,9999);
    expect(axis.scroll).toBe(600); expect(axis.offset).toBe(axis.travel);
    expect(scrollFromPointer(axis,0,-100)).toBe(0);
    height=300;width=200;mount();expect(host.querySelector('[role="scrollbar"]')).toBeNull();
  });
  it("exposes both axes and the controlled content without duplicating or replacing it", () => {
    mount(); expect(host.querySelectorAll('[role="scrollbar"]')).toHaveLength(2);
    expect(vertical().getAttribute("aria-controls")).toBe(viewport.id);
    expect(viewport.querySelectorAll('p')).toHaveLength(1);
    expect(vertical().getAttribute("aria-valuemax")).toBe("600");
  });
  it("reveals on wheel and becomes idle after 850 ms even if the pointer does not leave", () => {
    mount(); const overlay = host.querySelector('.floating-scrollbars')!;
    act(() => viewport.dispatchEvent(new WheelEvent('wheel',{deltaY:120})));
    expect(overlay.getAttribute('data-active')).toBe('true');
    act(() => vi.advanceTimersByTime(849));expect(overlay.getAttribute('data-active')).toBe('true');
    act(() => vi.advanceTimersByTime(1));expect(overlay.getAttribute('data-active')).toBe('false');
  });
  it("drags the actual viewport, stays visible while held and does not activate a parent row", () => {
    const rowClick = vi.fn();mount(rowClick);const thumb=vertical();
    pointer(thumb,'pointerdown',0);act(()=>vi.advanceTimersByTime(2000));
    expect(host.querySelector('.floating-scrollbars')!.getAttribute('data-dragging')).toBe('true');
    pointer(thumb,'pointermove',1000);expect(viewport.scrollTop).toBe(600);
    pointer(thumb,'pointerup',1000);act(()=>thumb.click());expect(rowClick).not.toHaveBeenCalled();
    expect(capture.size).toBe(0);act(()=>vi.advanceTimersByTime(850));
    expect(host.querySelector('.floating-scrollbars')!.getAttribute('data-active')).toBe('false');
  });
  it("supports Home/End, page and horizontal keyboard movement on the real scroll offsets", () => {
    mount();const key=(el:HTMLElement,key:string)=>act(()=>el.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true})));
    key(vertical(),'End');expect(viewport.scrollTop).toBe(600);
    key(vertical(),'PageUp');expect(viewport.scrollTop).toBe(330);
    key(vertical(),'Home');expect(viewport.scrollTop).toBe(0);
    key(host.querySelector('[aria-orientation="horizontal"]')!,'End');expect(viewport.scrollLeft).toBe(400);
  });
  it("updates after content growth and drops obsolete scrollbars after shrink", async () => {
    mount();height=1200;
    await act(async()=>{viewport.querySelector('p')!.textContent='新增的长内容';await Promise.resolve();vi.advanceTimersByTime(20);});
    expect(vertical().getAttribute('aria-valuemax')).toBe('900');
    height=300;width=200;frame();expect(host.querySelector('[role="scrollbar"]')).toBeNull();
  });
  it("releases a drag when the window loses focus", () => {
    mount();pointer(vertical(),'pointerdown',0);
    act(()=>window.dispatchEvent(new Event('blur')));expect(capture.size).toBe(0);
    expect(host.querySelector('.floating-scrollbars')!.getAttribute('data-dragging')).toBe('false');
  });
  it("keeps decorative card overlays out of keyboard navigation", () => {
    mount();act(()=>root.render(<ScrollSurface aria-hidden="true" style={{overflowY:'auto'}}>摘要</ScrollSurface>));frame();
    expect(vertical().tabIndex).toBe(-1);
  });
});

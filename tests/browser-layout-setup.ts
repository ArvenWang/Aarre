// jsdom has no layout engine. Integration tests exercise business DOM behavior;
// actual size, clipping and scrollbar appearance are verified in the browser.
if (typeof window !== "undefined" && !globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

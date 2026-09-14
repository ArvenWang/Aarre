import { useCallback, useEffect, useRef, useState } from "react";

/** Only the list's fading content edge lives here; scrollbar interaction is shared. */
export function useScrollBoundary(viewKey: string) {
  const contentRef = useRef<HTMLElement | null>(null);
  const [atEnd, setAtEnd] = useState(false);
  const sync = useCallback(() => {
    const el = contentRef.current;
    if (el) setAtEnd(el.scrollHeight - el.clientHeight - el.scrollTop <= 1);
  }, []);
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const resize = new ResizeObserver(sync);
    const mutation = new MutationObserver(sync);
    resize.observe(el);
    mutation.observe(el, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-expanded"] });
    const frame = requestAnimationFrame(sync);
    return () => { resize.disconnect(); mutation.disconnect(); cancelAnimationFrame(frame); };
  }, [sync, viewKey]);
  return { contentRef, atEnd, sync };
}

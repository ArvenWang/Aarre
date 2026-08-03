import { useCallback, useEffect, useRef, useState } from "react";

export function useScrollThumb(viewKey: string) {
  const contentRef = useRef<HTMLElement | null>(null);
  const hideTimer = useRef<number | undefined>(undefined);
  const drag = useRef<{
    pointerId: number;
    startY: number;
    startScrollTop: number;
  } | null>(null);
  const [thumb, setThumb] = useState({
    scrollable: false,
    visible: false,
    height: 36,
    offset: 10,
    atEnd: false,
  });

  const sync = useCallback((show = false) => {
    const content = contentRef.current;
    if (!content) return;
    const maxScroll = Math.max(0, content.scrollHeight - content.clientHeight);
    const trackHeight = Math.max(0, content.clientHeight - 20);
    const height = maxScroll > 0
      ? Math.max(36, trackHeight * (content.clientHeight / content.scrollHeight))
      : trackHeight;
    const maxOffset = Math.max(0, trackHeight - height);
    const offset = 10 + (maxScroll > 0 ? (content.scrollTop / maxScroll) * maxOffset : 0);
    setThumb((current) => ({
      scrollable: maxScroll > 1,
      visible: maxScroll > 1 && (show || current.visible),
      height,
      offset,
      atEnd: maxScroll <= 1 || content.scrollTop >= maxScroll - 1,
    }));
  }, []);

  const scheduleHide = useCallback(() => {
    if (hideTimer.current !== undefined) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      setThumb((current) => ({ ...current, visible: false }));
    }, 900);
  }, []);

  const reveal = useCallback(() => {
    sync(true);
    scheduleHide();
  }, [scheduleHide, sync]);

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const content = contentRef.current;
    if (!content) return;
    if (hideTimer.current !== undefined) window.clearTimeout(hideTimer.current);
    drag.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startScrollTop: content.scrollTop,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    sync(true);
  }, [sync]);

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const content = contentRef.current;
    const active = drag.current;
    if (!content || !active || active.pointerId !== event.pointerId) return;
    const maxScroll = Math.max(0, content.scrollHeight - content.clientHeight);
    const trackHeight = Math.max(0, content.clientHeight - 20);
    const maxThumbTravel = Math.max(1, trackHeight - thumb.height);
    content.scrollTop = active.startScrollTop +
      (event.clientY - active.startY) * (maxScroll / maxThumbTravel);
  }, [thumb.height]);

  const onPointerEnd = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    scheduleHide();
  }, [scheduleHide]);

  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const resizeObserver = new ResizeObserver(() => sync());
    resizeObserver.observe(content);
    const mutationObserver = new MutationObserver(() => {
      window.requestAnimationFrame(() => sync());
    });
    mutationObserver.observe(content, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-expanded"],
    });
    const frame = window.requestAnimationFrame(() => sync());
    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      window.cancelAnimationFrame(frame);
      if (hideTimer.current !== undefined) window.clearTimeout(hideTimer.current);
    };
  }, [sync, viewKey]);

  return { contentRef, thumb, sync, reveal, onPointerDown, onPointerMove, onPointerEnd };
}

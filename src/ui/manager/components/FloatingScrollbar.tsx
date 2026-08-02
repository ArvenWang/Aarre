import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

type ScrollMetrics = {
  hasOverflow: boolean;
  maxScroll: number;
  maxThumbOffset: number;
  scrollTop: number;
  thumbHeight: number;
};

type DragState = {
  pointerId: number;
  startClientY: number;
  startScrollTop: number;
  trackSize: number;
};

const INITIAL_METRICS: ScrollMetrics = {
  hasOverflow: false,
  maxScroll: 0,
  maxThumbOffset: 0,
  scrollTop: 0,
  thumbHeight: 0,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function cssPixelValue(name: string): number {
  const value = Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue(name),
  );
  return Number.isFinite(value) ? value : 0;
}

function getScrollElement(): HTMLElement {
  return (document.scrollingElement as HTMLElement | null) ||
    document.documentElement;
}

export function FloatingScrollbar() {
  const thumbRef = useRef<HTMLDivElement | null>(null);
  const scrollElementRef = useRef<HTMLElement | null>(null);
  const metricsRef = useRef(INITIAL_METRICS);
  const dragRef = useRef<DragState | null>(null);
  const hideTimerRef = useRef<number | null>(null);
  const measureFrameRef = useRef<number | null>(null);
  const [metrics, setMetrics] = useState(INITIAL_METRICS);
  const [visible, setVisible] = useState(false);
  const [dragging, setDragging] = useState(false);

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const scheduleHide = useCallback(() => {
    clearHideTimer();
    hideTimerRef.current = window.setTimeout(() => {
      if (!dragRef.current) setVisible(false);
    }, 900);
  }, [clearHideTimer]);

  const measure = useCallback(() => {
    const scrollElement = getScrollElement();
    scrollElementRef.current = scrollElement;

    const viewportHeight = Math.max(window.innerHeight, 1);
    const contentHeight = Math.max(
      scrollElement.scrollHeight,
      document.documentElement.scrollHeight,
      document.body?.scrollHeight || 0,
    );
    const inset = cssPixelValue("--scrollbar-inset");
    const minimumThumbHeight = cssPixelValue("--scrollbar-thumb-min");
    const trackHeight = Math.max(viewportHeight - inset * 2, 0);
    const maxScroll = Math.max(contentHeight - viewportHeight, 0);
    const thumbHeight = maxScroll
      ? Math.min(
          trackHeight,
          Math.max(
            minimumThumbHeight,
            (viewportHeight / contentHeight) * trackHeight,
          ),
        )
      : trackHeight;
    const maxThumbOffset = Math.max(trackHeight - thumbHeight, 0);
    const scrollTop = clamp(
      window.scrollY || scrollElement.scrollTop,
      0,
      maxScroll,
    );
    const nextMetrics: ScrollMetrics = {
      hasOverflow: maxScroll > 0 && maxThumbOffset > 0,
      maxScroll,
      maxThumbOffset,
      scrollTop,
      thumbHeight,
    };

    thumbRef.current?.style.setProperty(
      "--manager-scrollbar-thumb-height",
      `${thumbHeight}px`,
    );
    thumbRef.current?.style.setProperty(
      "--manager-scrollbar-thumb-offset",
      `${maxScroll ? (scrollTop / maxScroll) * maxThumbOffset : 0}px`,
    );
    const overflowStarted = !metricsRef.current.hasOverflow &&
      nextMetrics.hasOverflow;
    metricsRef.current = nextMetrics;
    setMetrics((current) => {
      if (
        current.hasOverflow === nextMetrics.hasOverflow &&
        current.maxScroll === nextMetrics.maxScroll &&
        current.maxThumbOffset === nextMetrics.maxThumbOffset &&
        current.scrollTop === nextMetrics.scrollTop &&
        current.thumbHeight === nextMetrics.thumbHeight
      ) {
        return current;
      }
      return nextMetrics;
    });
    if (overflowStarted) {
      setVisible(true);
      scheduleHide();
    }
    if (!nextMetrics.hasOverflow && !dragRef.current) setVisible(false);
  }, [scheduleHide]);

  const queueMeasure = useCallback(() => {
    if (measureFrameRef.current !== null) return;
    measureFrameRef.current = window.requestAnimationFrame(() => {
      measureFrameRef.current = null;
      measure();
    });
  }, [measure]);

  const showDuringInteraction = useCallback(() => {
    setVisible(true);
    scheduleHide();
    queueMeasure();
  }, [queueMeasure, scheduleHide]);

  useEffect(() => {
    const handleScroll = () => {
      showDuringInteraction();
    };
    const handleResize = () => {
      queueMeasure();
    };
    const resizeObserver = new ResizeObserver(queueMeasure);
    const mutationObserver = new MutationObserver(queueMeasure);

    resizeObserver.observe(document.documentElement);
    if (document.body) resizeObserver.observe(document.body);
    mutationObserver.observe(document.getElementById("root") || document.body, {
      childList: true,
      subtree: true,
    });
    document.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", handleResize);
    showDuringInteraction();

    return () => {
      document.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleResize);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      clearHideTimer();
      if (measureFrameRef.current !== null) {
        window.cancelAnimationFrame(measureFrameRef.current);
        measureFrameRef.current = null;
      }
    };
  }, [clearHideTimer, queueMeasure, showDuringInteraction]);

  function beginDrag(event: PointerEvent<HTMLDivElement>) {
    const current = metricsRef.current;
    if (!current.hasOverflow) return;

    event.preventDefault();
    clearHideTimer();
    dragRef.current = {
      pointerId: event.pointerId,
      startClientY: event.clientY,
      startScrollTop: current.scrollTop,
      trackSize: Math.max(current.maxThumbOffset, 1),
    };
    setDragging(true);
    setVisible(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveDrag(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    const current = metricsRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    const scrollElement = scrollElementRef.current || getScrollElement();
    const scrollDelta =
      ((event.clientY - drag.startClientY) / drag.trackSize) * current.maxScroll;
    scrollElement.scrollTop = clamp(
      drag.startScrollTop + scrollDelta,
      0,
      current.maxScroll,
    );
    queueMeasure();
  }

  function endDrag(event: PointerEvent<HTMLDivElement>) {
    if (!dragRef.current || dragRef.current.pointerId !== event.pointerId) {
      return;
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
    setDragging(false);
    scheduleHide();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!metricsRef.current.hasOverflow) return;

    const scrollElement = scrollElementRef.current || getScrollElement();
    const pageStep = Math.max(window.innerHeight * 0.9, 1);
    const stepByKey: Record<string, number> = {
      ArrowDown: pageStep * 0.2,
      ArrowUp: -pageStep * 0.2,
      PageDown: pageStep,
      PageUp: -pageStep,
    };
    if (event.key === "Home") {
      event.preventDefault();
      scrollElement.scrollTop = 0;
    } else if (event.key === "End") {
      event.preventDefault();
      scrollElement.scrollTop = metricsRef.current.maxScroll;
    } else if (stepByKey[event.key]) {
      event.preventDefault();
      scrollElement.scrollTop = clamp(
        scrollElement.scrollTop + stepByKey[event.key],
        0,
        metricsRef.current.maxScroll,
      );
    } else {
      return;
    }
    showDuringInteraction();
  }

  return (
    <div
      className="manager-floating-scrollbar"
      data-dragging={dragging ? "true" : "false"}
      data-overflow={metrics.hasOverflow ? "true" : "false"}
      data-visible={visible ? "true" : "false"}
      aria-hidden={metrics.hasOverflow ? undefined : true}
    >
      <div
        ref={thumbRef}
        className="manager-floating-scrollbar-thumb"
        role="scrollbar"
        tabIndex={metrics.hasOverflow ? 0 : -1}
        aria-label="页面滚动条"
        aria-orientation="vertical"
        aria-valuemin={0}
        aria-valuemax={Math.round(metrics.maxScroll)}
        aria-valuenow={Math.round(metrics.scrollTop)}
        onKeyDown={handleKeyDown}
        onPointerDown={beginDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerEnter={() => {
          clearHideTimer();
          setVisible(true);
        }}
        onPointerLeave={() => {
          if (!dragRef.current) scheduleHide();
        }}
      />
    </div>
  );
}

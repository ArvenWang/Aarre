import { useCallback, useEffect, useRef, useState } from "react";
import { sendExtensionRequest } from "../../../lib/messages";
import type { NativeBookmarkNode, PageSnapshot } from "../../../lib/types";
import { canonicalizeUrl } from "../../../lib/url";

export function useBookmarkPreview() {
  const [placement, setPlacement] = useState<{
    node: NativeBookmarkNode;
    flip: boolean;
    offset: number;
  } | null>(null);
  const [snapshot, setSnapshot] = useState<PageSnapshot | null>(null);
  const closeTimer = useRef<number | undefined>(undefined);
  const requestedUrl = useRef("");

  const keepOpen = useCallback(() => {
    if (closeTimer.current !== undefined) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = undefined;
    }
  }, []);

  const dismiss = useCallback(() => {
    requestedUrl.current = "";
    if (closeTimer.current !== undefined) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = undefined;
    }
    setPlacement(null);
    setSnapshot(null);
  }, []);

  const close = useCallback(() => {
    requestedUrl.current = "";
    if (closeTimer.current !== undefined) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => {
      setPlacement(null);
      setSnapshot(null);
      closeTimer.current = undefined;
    }, 200);
  }, []);

  const show = useCallback((node: NativeBookmarkNode, rect: DOMRect) => {
    if (!node.url) return;
    keepOpen();
    setPlacement(null);
    setSnapshot(null);
    let canonicalUrl = "";
    try {
      canonicalUrl = canonicalizeUrl(node.url);
    } catch {
      return;
    }
    requestedUrl.current = canonicalUrl;
    void sendExtensionRequest({ type: "GET_PAGE_SNAPSHOT", canonicalUrl })
      .then((next) => {
        if (requestedUrl.current !== canonicalUrl || !next) return;
        const gap = 14;
        const spaceBelow = window.innerHeight - rect.bottom - gap;
        const spaceAbove = rect.top - gap;
        const width = Math.min(286, Math.max(0, window.innerWidth - 72));
        const height = (width * 10) / 16 + 2;
        const flip = spaceBelow < height && spaceAbove > spaceBelow;
        setPlacement({
          node,
          flip,
          offset: flip
            ? Math.max(12, window.innerHeight - rect.top + gap)
            : Math.max(12, rect.bottom + gap),
        });
        setSnapshot(next);
      })
      .catch(() => undefined);
  }, [keepOpen]);

  useEffect(() => () => {
    if (closeTimer.current !== undefined) window.clearTimeout(closeTimer.current);
  }, []);

  useEffect(() => {
    if (!placement) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [dismiss, placement]);

  return { placement, snapshot, show, close, keepOpen, dismiss };
}

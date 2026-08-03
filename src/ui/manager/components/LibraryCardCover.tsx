import { useEffect, useRef, useState } from "react";
import genericFallbackCoverUrl from "../../../assets/covers/generic-webpage-v1.webp?url";
import {
  aarreFallbackCoverId,
  categoryCoverBackground,
  categoryCoverUrl,
} from "../../../lib/cover-registry";
import { sendExtensionRequest } from "../../../lib/messages";
import type { ResourceRecord } from "../../../lib/types";

interface LibraryCardCoverImageProps {
  snapshotImageUrl?: string;
  fallbackImageUrl?: string;
  fallbackCoverId?: string;
  label: string;
}

export function LibraryCardCoverImage({
  snapshotImageUrl = "",
  fallbackImageUrl = genericFallbackCoverUrl,
  fallbackCoverId = "generic-webpage",
  label,
}: LibraryCardCoverImageProps) {
  const [snapshotFailed, setSnapshotFailed] = useState(false);
  const [fallbackFailed, setFallbackFailed] = useState(false);

  useEffect(() => {
    setSnapshotFailed(false);
  }, [snapshotImageUrl]);

  useEffect(() => {
    setFallbackFailed(false);
  }, [fallbackImageUrl]);

  const useSnapshot = Boolean(snapshotImageUrl) && !snapshotFailed;
  const resolvedFallbackImageUrl = fallbackFailed
    ? genericFallbackCoverUrl
    : fallbackImageUrl || genericFallbackCoverUrl;
  const resolvedFallbackCoverId = fallbackFailed
    ? "generic-webpage"
    : fallbackCoverId;

  return (
    <span
      className="site-thumbnail manager-site-thumbnail"
      aria-hidden="true"
      title={label || undefined}
      style={
        useSnapshot
          ? undefined
          : {
              backgroundColor: categoryCoverBackground(
                resolvedFallbackCoverId,
              ),
            }
      }
    >
      <picture>
        <img
          className="site-thumbnail-image"
          src={useSnapshot ? snapshotImageUrl : resolvedFallbackImageUrl}
          alt=""
          loading="lazy"
          data-cover-kind={useSnapshot ? "page-snapshot" : "aarre-fallback"}
          data-fallback-cover-id={
            useSnapshot ? undefined : resolvedFallbackCoverId
          }
          onError={() => {
            if (useSnapshot) {
              setSnapshotFailed(true);
            } else if (resolvedFallbackImageUrl !== genericFallbackCoverUrl) {
              setFallbackFailed(true);
            }
          }}
        />
      </picture>
    </span>
  );
}

interface LibraryCardCoverProps {
  canonicalUrl: string;
  label: string;
  snapshotRevision?: string;
  fallbackResource?: Pick<
    ResourceRecord,
    | "canonicalUrl"
    | "url"
    | "title"
    | "topics"
    | "tags"
    | "summary"
    | "categoryCoverId"
  >;
}

// 会话级快照缓存：瀑布流删除/排序导致卡片重挂时，直接用上次取到的
// 封面初始化，避免“先显示兜底图、再变回封面”的闪烁。
const sessionSnapshotCache = new Map<string, string>();

export function LibraryCardCover({
  canonicalUrl,
  label,
  snapshotRevision = "",
  fallbackResource,
}: LibraryCardCoverProps) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const [nearViewport, setNearViewport] = useState(false);
  const [snapshotImageUrl, setSnapshotImageUrl] = useState(
    () => sessionSnapshotCache.get(canonicalUrl) || "",
  );
  const fallbackCoverId = aarreFallbackCoverId(
    fallbackResource || {
      canonicalUrl,
      url: canonicalUrl,
      title: label,
      topics: [],
      tags: [],
      summary: "",
    },
  );
  const fallbackImageUrl = categoryCoverUrl(fallbackCoverId);

  useEffect(() => {
    const node = containerRef.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      setNearViewport(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => setNearViewport(Boolean(entry?.isIntersecting)),
      { rootMargin: "600px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!nearViewport) {
      // 瀑布流可能有上千条收藏，离开预加载区后释放 Base64 快照，
      // 避免管理页把整个快照库同时保留在内存中。
      setSnapshotImageUrl("");
      return;
    }
    const cached = sessionSnapshotCache.get(canonicalUrl);
    if (cached) {
      setSnapshotImageUrl(cached);
    }
    let cancelled = false;
    void sendExtensionRequest({
      type: "GET_PAGE_SNAPSHOT",
      canonicalUrl,
    })
      .then((snapshot) => {
        if (!cancelled) {
          setSnapshotImageUrl(snapshot?.imageDataUrl || "");
          if (snapshot?.imageDataUrl) {
            sessionSnapshotCache.set(canonicalUrl, snapshot.imageDataUrl);
          }
        }
      })
      .catch(() => {
        if (!cancelled) setSnapshotImageUrl("");
      });
    return () => {
      cancelled = true;
    };
  }, [canonicalUrl, nearViewport, snapshotRevision]);

  return (
    <span ref={containerRef} className="library-card-cover-loader">
      <LibraryCardCoverImage
        snapshotImageUrl={snapshotImageUrl}
        fallbackImageUrl={fallbackImageUrl}
        fallbackCoverId={fallbackCoverId}
        label={label}
      />
    </span>
  );
}

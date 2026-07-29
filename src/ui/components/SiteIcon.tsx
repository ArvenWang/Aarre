import { useEffect, useMemo, useState } from "react";
import {
  aarreIconUrl,
  siteIconCandidates
} from "../../lib/favicon";

interface SiteIconProps {
  url: string;
  faviconUrl?: string;
  label?: string;
  className?: string;
  size?: number;
  requestSize?: number;
}

export function SiteIcon({
  url,
  faviconUrl = "",
  label = "",
  className = "",
  size = 32,
  requestSize = size
}: SiteIconProps) {
  const candidates = useMemo(
    () => siteIconCandidates(url, faviconUrl, requestSize),
    [faviconUrl, requestSize, url]
  );
  const [candidateIndex, setCandidateIndex] = useState(0);

  useEffect(() => {
    setCandidateIndex(0);
  }, [candidates]);

  const source = candidates[candidateIndex];
  const isAarreFallback = source === aarreIconUrl();
  const isChromeFavicon = source?.includes("/_favicon/") || false;

  return (
    <span
      className={`site-icon ${className}`.trim()}
      style={{ "--site-icon-size": `${size}px` } as React.CSSProperties}
      aria-hidden="true"
      title={label || undefined}
    >
      {source ? (
        <img
          src={source}
          alt=""
          loading="lazy"
          data-fallback={isAarreFallback || undefined}
          data-chrome-favicon={isChromeFavicon || undefined}
          onError={() => setCandidateIndex((index) => index + 1)}
        />
      ) : null}
    </span>
  );
}

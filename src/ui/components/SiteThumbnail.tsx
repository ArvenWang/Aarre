import { useEffect, useState } from "react";
import { SiteIcon } from "./SiteIcon";

interface SiteThumbnailProps {
  url: string;
  imageUrl?: string;
  faviconUrl?: string;
  label?: string;
  className?: string;
}

export function SiteThumbnail({
  url,
  imageUrl = "",
  faviconUrl = "",
  label = "",
  className = ""
}: SiteThumbnailProps) {
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    setImageFailed(false);
  }, [imageUrl]);

  const showPreview = Boolean(imageUrl) && !imageFailed;

  return (
    <span
      className={`site-thumbnail ${className}`.trim()}
      aria-hidden="true"
      title={label || undefined}
    >
      {showPreview ? (
        <img
          className="site-thumbnail-image"
          src={imageUrl}
          alt=""
          loading="lazy"
          onError={() => setImageFailed(true)}
        />
      ) : (
        <SiteIcon
          url={url}
          faviconUrl={faviconUrl}
          label={label}
          className="site-thumbnail-favicon"
          size={32}
          requestSize={16}
        />
      )}
    </span>
  );
}

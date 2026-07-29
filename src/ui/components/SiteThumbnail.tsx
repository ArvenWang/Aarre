import { useEffect, useState } from "react";
import {
  categoryCoverUrl,
  coverBrightnessForHost,
  listCoverPipeline
} from "../../lib/cover-registry";
import type { ListCoverStyle } from "../../lib/display-settings";

interface SiteThumbnailProps {
  url: string;
  imageUrl?: string;
  brandImageUrl?: string;
  categoryCoverId?: string;
  coverStyle?: ListCoverStyle;
  label?: string;
  className?: string;
}

export function SiteThumbnail({
  url,
  imageUrl = "",
  brandImageUrl = "",
  categoryCoverId = "",
  coverStyle = "site",
  label = "",
  className = ""
}: SiteThumbnailProps) {
  const categoryImageUrl = categoryCoverUrl(categoryCoverId);
  const preferredImageUrl =
    (coverStyle === "page" ||
      listCoverPipeline(url) === "page-image") &&
    imageUrl
      ? imageUrl
      : brandImageUrl || categoryImageUrl;
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    setImageFailed(false);
  }, [preferredImageUrl]);

  const displayImageUrl =
    imageFailed && preferredImageUrl !== categoryImageUrl
      ? categoryImageUrl
      : preferredImageUrl;
  const usingCategory = displayImageUrl === categoryImageUrl;

  return (
    <span
      className={`site-thumbnail ${className}`.trim()}
      aria-hidden="true"
      title={label || undefined}
    >
      <img
        className="site-thumbnail-image"
        src={displayImageUrl}
        alt=""
        loading="lazy"
        data-cover-kind={usingCategory ? "category" : "site"}
        style={
          usingCategory
            ? {
                filter: `brightness(${coverBrightnessForHost(url)})`
              }
            : undefined
        }
        onError={() => setImageFailed(true)}
      />
    </span>
  );
}

import { useEffect, useState } from "react";
import {
  categoryCoverUrl,
  coverBrightnessForHost,
  listCoverPipeline
} from "../../lib/cover-registry";
import type { ListCoverStyle } from "../../lib/display-settings";

export interface SiteThumbnailProps {
  url: string;
  imageUrl?: string;
  brandImageUrl?: string;
  brandImageUrlDark?: string;
  categoryCoverId?: string;
  coverStyle?: ListCoverStyle;
  forceSiteBrand?: boolean;
  label?: string;
  className?: string;
}

export function SiteThumbnail({
  url,
  imageUrl = "",
  brandImageUrl = "",
  brandImageUrlDark = "",
  categoryCoverId = "",
  coverStyle = "site",
  forceSiteBrand = false,
  label = "",
  className = ""
}: SiteThumbnailProps) {
  const categoryImageUrl = categoryCoverUrl(categoryCoverId);
  const preferredImageUrl =
    !forceSiteBrand &&
    (coverStyle === "page" || listCoverPipeline(url) === "page-image") &&
    imageUrl
      ? imageUrl
      : brandImageUrl || categoryImageUrl;
  const preferredDarkImageUrl =
    preferredImageUrl === brandImageUrl && brandImageUrlDark
      ? brandImageUrlDark
      : preferredImageUrl;
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    setImageFailed(false);
  }, [preferredDarkImageUrl, preferredImageUrl]);

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
      <picture>
        {!usingCategory &&
        preferredDarkImageUrl !== displayImageUrl ? (
          <source
            media="(prefers-color-scheme: dark)"
            srcSet={preferredDarkImageUrl}
          />
        ) : null}
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
      </picture>
    </span>
  );
}

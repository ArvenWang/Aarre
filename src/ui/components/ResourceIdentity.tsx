import type { ReactNode } from "react";
import { SiteThumbnail, type SiteThumbnailProps } from "./SiteThumbnail";

interface ResourceIdentityProps extends Omit<SiteThumbnailProps, "className"> {
  title: ReactNode;
  meta?: ReactNode;
  className?: string;
  thumbnailClassName?: string;
}

/**
 * 侧边栏和网页端共用的收藏身份组件。
 * 尺寸与字阶由根节点的 density 决定，数据与缩略图来源保持一致。
 */
export function ResourceIdentity({
  title,
  meta,
  className = "",
  thumbnailClassName = "",
  ...thumbnail
}: ResourceIdentityProps) {
  return (
    <span className={`resource-identity ${className}`.trim()}>
      <SiteThumbnail {...thumbnail} className={thumbnailClassName} />
      <span className="resource-identity-copy">
        <strong>{title}</strong>
        {meta ? <small>{meta}</small> : null}
      </span>
    </span>
  );
}

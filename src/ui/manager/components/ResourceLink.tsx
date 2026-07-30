import type {
  AnchorHTMLAttributes,
  MouseEvent,
  ReactNode
} from "react";

interface ResourceLinkProps
  extends Omit<
    AnchorHTMLAttributes<HTMLAnchorElement>,
    "children" | "href" | "onClick" | "rel" | "target"
  > {
  children: ReactNode;
  url: string;
  onOpenResource: (url: string) => void;
}

/**
 * 普通左键通过 Aarre 打开，以便后台登记“旧收藏补图”的交互来源。
 * 修饰键和中键保留浏览器原生行为，并由普通浏览兜底自动补齐。
 */
export function ResourceLink({
  children,
  url,
  onOpenResource,
  ...attributes
}: ResourceLinkProps) {
  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    event.preventDefault();
    onOpenResource(url);
  }

  return (
    <a
      {...attributes}
      href={url}
      target="_blank"
      rel="noreferrer"
      onClick={handleClick}
    >
      {children}
    </a>
  );
}

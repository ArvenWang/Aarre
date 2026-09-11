import { useLayoutEffect, useState, type ReactNode } from "react";
import { postToFloatingHost } from "./bridge";
import { SAVE_PANEL_INITIAL_HEIGHT } from "../../lib/floating-geometry";

/** Measure intrinsic content, never the stretched viewport (which would feed back). */
export function SaveFormBody({ compact, loading, children }: { compact: boolean; loading: boolean; children: ReactNode }) {
  const [content, setContent] = useState<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    if (!compact || !content) return;
    const dialog = content.closest(".floating-save-page");
    const heading = dialog?.querySelector<HTMLElement>(".native-dialog-heading");
    const actions = dialog?.querySelector<HTMLElement>(".native-dialog-actions");
    const viewport = content.parentElement;
    if (!heading || !viewport) return;
    let lastHeight = 0;
    const measure = () => {
      const padding = getComputedStyle(viewport);
      const height = loading ? SAVE_PANEL_INITIAL_HEIGHT : Math.ceil(
        // Modal entry transforms must not inflate the host's final dimensions.
        heading.offsetHeight + content.offsetHeight + (actions?.offsetHeight || 0)
        + parseFloat(padding.paddingTop) + parseFloat(padding.paddingBottom),
      );
      if (height > 0 && height !== lastHeight) {
        lastHeight = height;
        postToFloatingHost({ type: "FLOAT_SAVE_LAYOUT", height });
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    for (const element of [heading, content, actions]) if (element) observer.observe(element);
    return () => observer.disconnect();
  }, [compact, content, loading]);
  useLayoutEffect(() => {
    if (compact) return () => postToFloatingHost({ type: "FLOAT_WORKSPACE_LAYOUT" });
  }, [compact]);
  return compact ? <div className="save-form-content" ref={setContent}>{children}</div> : children;
}

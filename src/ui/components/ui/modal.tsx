import { Modal } from "@heroui/react/modal";
import { useEffect, useRef, type ReactNode } from "react";
import { FloatingScrollbars } from "./scroll-area";
interface Props {
  onEscape?: () => void;
  children: ReactNode; onClose: () => void; busy?: boolean;
  className?: string; backdropClassName?: string; labelledBy: string; describedBy?: string;
}
/** HeroUI owns focus containment, focus return, outside dismissal and Escape ordering. */
export function AppModal({ children, onClose, busy, className, backdropClassName, labelledBy, describedBy, onEscape }: Props) {
  const dialog = useRef<HTMLSpanElement>(null);
  const scrollRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!onEscape) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing || !dialog.current?.closest('[role="dialog"]')?.contains(event.target as Node)) return;
      event.preventDefault(); event.stopPropagation(); onEscape();
    };
    document.addEventListener("keydown", escape, true);
    return () => document.removeEventListener("keydown", escape, true);
  }, [onEscape]);
  return <Modal.Backdrop isOpen isDismissable={!busy} isKeyboardDismissDisabled={busy || Boolean(onEscape)} onOpenChange={(open) => { if (!open && !busy) onClose(); }}
    className={`aarre-modal-backdrop ${backdropClassName || ""}`}>
    <Modal.Container className="aarre-modal-container" size="lg" scroll="inside">
      <Modal.Dialog data-scroll-viewport="" className={className} aria-labelledby={labelledBy} aria-describedby={describedBy}>
        <span hidden aria-hidden="true" ref={node => { dialog.current = node; scrollRef.current = node?.closest('[role="dialog"]') as HTMLElement | null; }} />
        {children}
        <FloatingScrollbars viewportRef={scrollRef} label="对话框" />
      </Modal.Dialog>
    </Modal.Container>
  </Modal.Backdrop>;
}

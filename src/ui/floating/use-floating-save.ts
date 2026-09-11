import { useEffect, useLayoutEffect, useState } from "react";
import { acceptFloatingSave, deferFloatingSave, FLOATING_SAVE_EVENT, getFloatingSaveRequest } from "./bridge";

export function useFloatingSave({ enabled, ready, busy, editorKind, onOpen, onDeferred }: {
  enabled: boolean; ready: boolean; busy: boolean; editorKind?: string;
  onOpen: () => void; onDeferred?: () => void;
}) {
  const [requestId, setRequestId] = useState(getFloatingSaveRequest);
  useEffect(() => {
    if (!enabled) return;
    const receive = () => setRequestId(getFloatingSaveRequest());
    window.addEventListener(FLOATING_SAVE_EVENT, receive);
    receive();
    return () => window.removeEventListener(FLOATING_SAVE_EVENT, receive);
  }, [enabled]);
  useLayoutEffect(() => {
    if (!enabled || !ready || !requestId || getFloatingSaveRequest() !== requestId) return;
    // An existing save form is the requested destination: keep its draft.
    // Other editors must finish before a new save can replace them.
    if ((editorKind && editorKind !== "save") || (!editorKind && busy)) {
      deferFloatingSave(requestId); setRequestId(null); onDeferred?.(); return;
    }
    if (!editorKind) { if (!busy) onOpen(); return; }
    // Acknowledge only after the destination exists in the committed DOM.
    // The host keeps its loading surface above the iframe until this point.
    acceptFloatingSave(requestId);
    setRequestId(null);
  }, [enabled, ready, busy, editorKind, requestId, onOpen, onDeferred]);
}

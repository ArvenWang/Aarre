import { useEffect, useState } from "react";
import { acceptFloatingSave, FLOATING_SAVE_EVENT, getFloatingSaveRequest } from "./bridge";

export function useFloatingSave({ enabled, ready, busy, editorKind, onOpen }: {
  enabled: boolean; ready: boolean; busy: boolean; editorKind?: string;
  onOpen: () => void;
}) {
  const [requestId, setRequestId] = useState(getFloatingSaveRequest);
  useEffect(() => {
    if (!enabled) return;
    const receive = () => setRequestId(getFloatingSaveRequest());
    window.addEventListener(FLOATING_SAVE_EVENT, receive);
    receive();
    return () => window.removeEventListener(FLOATING_SAVE_EVENT, receive);
  }, [enabled]);
  useEffect(() => {
    if (!enabled || !ready || busy || !requestId || getFloatingSaveRequest() !== requestId) return;
    // An existing save form is the requested destination: keep its draft.
    // Other editors must finish before a new save can replace them.
    if (editorKind && editorKind !== "save") return;
    acceptFloatingSave(requestId);
    setRequestId(null);
    if (!editorKind) onOpen();
  }, [enabled, ready, busy, editorKind, requestId, onOpen]);
}

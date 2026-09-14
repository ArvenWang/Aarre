// This channel is available before the privileged UI connection exists. It can
// only prove this document's identity or report a failure to its actual parent.
function startupParentOrigin(): string | null {
  const ancestor = location.ancestorOrigins?.[0];
  const referrer = ancestor || document.referrer;
  try {
    const url = new URL(referrer);
    return /^https?:$/.test(url.protocol) ? url.origin : null;
  } catch { return null; }
}

export function listenForFrameChallenge(nonce: string): () => void {
  const parentOrigin = startupParentOrigin();
  const receive = (event: MessageEvent) => {
    if (window.parent === window || !parentOrigin || event.source !== window.parent || event.origin !== parentOrigin ||
        event.data?.session !== nonce || event.data.type !== "FLOAT_IDENTITY_CHALLENGE" || typeof event.data.challenge !== "string") return;
    void chrome.runtime.sendMessage({ type: "FLOAT_PROVE_FRAME", challenge: event.data.challenge, nonce }).catch(() => undefined);
  };
  window.addEventListener("message", receive);
  return () => window.removeEventListener("message", receive);
}

export function reportFloatingStartupError(message: string): void {
  const parentOrigin = startupParentOrigin();
  const nonce = new URLSearchParams(location.search).get("session");
  if (window.parent !== window && parentOrigin && nonce) {
    window.parent.postMessage({ type: "FLOAT_LOAD_ERROR", message, session: nonce }, parentOrigin);
  }
}

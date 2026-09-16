import { AARRE_ID } from "./contract";

const PORT = "nex-suite-viewport-v1";
const validTab = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const post = (port: chrome.runtime.Port, message: unknown) => {
  try { port.postMessage(message); } catch { /* Disconnect retires this lease. */ }
};

/** Background-only, tab-scoped lease; no website or persistent preference is involved. */
export function createSuiteViewportPublisher() {
  let tabId: number | null = null;
  let port: chrome.runtime.Port | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  const publish = () => { if (port) post(port, { type: "VIEWPORT", tabId }); };
  const connect = () => {
    if (port || tabId === null) return;
    try {
      const next = chrome.runtime.connect(AARRE_ID, { name: PORT });
      port = next;
      next.onMessage.addListener(message => {
        if (next === port && message?.type === "PING") post(next, { type: "VIEWPORT", tabId, id: message.id });
      });
      next.onDisconnect.addListener(() => {
        Reflect.get(chrome.runtime ?? {}, "lastError");
        if (port !== next) return;
        port = undefined;
        if (tabId !== null) retry = setTimeout(connect, 4_000);
      });
      publish();
    } catch { retry = setTimeout(connect, 4_000); }
  };
  return (next: number | null) => {
    if (tabId === next) return;
    tabId = validTab(next) ? next : null;
    clearTimeout(retry);
    if (tabId !== null) { if (port) publish(); else connect(); }
    else if (port) {
      const old = port;
      publish(); port = undefined;
      try { old.disconnect(); } catch { /* Already gone. */ }
    }
  };
}

export function installSuiteViewportBroker(changed: () => void) {
  const leases = new Map<chrome.runtime.Port, number | null>();
  const ids = chrome.runtime.getManifest().externally_connectable?.ids ?? [];
  chrome.runtime.onConnectExternal.addListener(port => {
    if (port.name !== PORT) return;
    const sender = port.sender;
    // A content script has sender.tab and must never suppress a different tab.
    if (!sender || sender.tab || !ids.includes(sender.id ?? "")
      || !sender.url?.startsWith(`chrome-extension://${sender.id}/`)) { port.disconnect(); return; }
    leases.set(port, null);
    let probe: string | undefined;
    const retire = () => { clearInterval(timer); if (leases.delete(port)) changed(); };
    const timer = setInterval(() => {
      if (probe) { retire(); try { port.disconnect(); } catch { /* Unloaded. */ } }
      else { probe = crypto.randomUUID(); post(port, { type: "PING", id: probe }); }
    }, 2_000);
    port.onMessage.addListener(message => {
      if (!leases.has(port) || message?.type !== "VIEWPORT"
        || (message.tabId !== null && !validTab(message.tabId))) return;
      if (message.id === probe) probe = undefined;
      if (leases.get(port) !== message.tabId) { leases.set(port, message.tabId); changed(); }
    });
    port.onDisconnect.addListener(() => { Reflect.get(chrome.runtime ?? {}, "lastError"); retire(); });
  });
  return (tabId: number) => [...leases.values()].includes(tabId);
}

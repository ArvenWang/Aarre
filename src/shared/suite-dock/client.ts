import { AARRE_ID, isApp, isRatio, isTheme, resolvedTheme, SUITE_DOCK_PORT, SUITE_THEME_PORT, type SuiteApp, type SuiteState, type SuiteTheme } from "./contract";

export function createSuiteClient(app: SuiteApp, hooks: {
  state: (state: SuiteState) => void; theme: (theme: "light" | "dark") => void;
  retire: () => void; open: () => boolean | void | Promise<boolean | void>; close: () => void | Promise<void>; error: (message: string) => void;
}) {
  let disposed = false, enabled = false, opened = false, remoteCommand = false, connected = false;
  let dock: chrome.runtime.Port | undefined, themes: chrome.runtime.Port | undefined;
  let currentTheme: SuiteTheme | undefined;
  let state: SuiteState = { paired: false, active: null };
  let retry: ReturnType<typeof setTimeout> | undefined;
  const post = (port: chrome.runtime.Port | undefined, message: unknown) => { try { port?.postMessage(message); } catch { /* Reconnect on disconnect. */ } };
  const alive = () => {
    try { if (chrome.runtime.id && chrome.runtime.getManifest()) return true; } catch { /* Unloaded extension. */ }
    if (!disposed) hooks.retire(); return false;
  };
  const hello = () => post(dock, { type: "HELLO", version: 1, enabled, opened });
  const media = matchMedia("(prefers-color-scheme: dark)");
  const paint = () => { if (currentTheme) hooks.theme(resolvedTheme(currentTheme.mode)); };
  media.addEventListener("change", paint);
  const disconnectDock = () => {
    dock = undefined; connected = false; if (disposed || !alive()) return; state = { paired: false, active: opened ? app : null }; hooks.state(state);
    clearTimeout(retry); if (!disposed) retry = setTimeout(connect, 4_000);
  };
  function connect() {
    if (disposed || dock) return;
    try {
      const port = app === "aarre" ? chrome.runtime.connect({ name: SUITE_DOCK_PORT }) : chrome.runtime.connect(AARRE_ID, { name: SUITE_DOCK_PORT });
      dock = port;
      port.onDisconnect.addListener(() => { void chrome.runtime.lastError; if (dock === port) disconnectDock(); });
      port.onMessage.addListener(message => {
        if (dock !== port || disposed) return;
        if (message?.type === "STATE" && typeof message.paired === "boolean" && (message.active === null || isApp(message.active))) {
          connected = true; state = { paired: message.paired, active: message.active, ...(isRatio(message.ratio) ? { ratio: message.ratio } : {}) }; hooks.state(state);
        }
        if (message?.type === "THEME" && isTheme(message.theme)) post(themes, { type: "MERGE", theme: message.theme });
        if (message?.type === "PING" && typeof message.id === "string" && alive()) post(port, { type: "PONG", id: message.id });
        if (message?.type === "ERROR") hooks.error(String(message.message));
        if ((message?.type === "OPEN" || message?.type === "CLOSE") && typeof message.id === "string") {
          remoteCommand = true;
          void Promise.resolve().then(() => message.type === "OPEN" ? hooks.open() : hooks.close()).then(result => {
            const ok = result !== false; if (ok) opened = message.type === "OPEN"; post(port, { type: "ACK", id: message.id, ok });
          }, error => { hooks.error(error instanceof Error ? error.message : String(error)); post(port, { type: "ACK", id: message.id, ok: false }); }).finally(() => { remoteCommand = false; });
        }
      });
      hello(); if (currentTheme) post(port, { type: "THEME", theme: currentTheme });
    } catch { disconnectDock(); }
  }
  const connectThemes = () => {
    if (disposed || themes) return;
    try {
      const port = chrome.runtime.connect({ name: SUITE_THEME_PORT }); themes = port;
      port.onMessage.addListener(message => {
        if (message?.type !== "THEME" || !isTheme(message.theme)) return;
        currentTheme = message.theme; paint(); post(dock, message);
      });
      port.onDisconnect.addListener(() => { void chrome.runtime.lastError; if (themes === port) { themes = undefined; alive(); } });
    } catch { /* The extension was unloaded. */ }
  };
  connectThemes(); connect();
  // A bounded heartbeat also reconnects after worker suspension. No DOM event grants peer authority.
  const heartbeat = setInterval(() => { connectThemes(); connect(); post(dock, { type: "PING" }); post(themes, { type: "PING" }); }, 20_000);
  return {
    get paired() { return state.paired; },
    position(ratio: number) { if (isRatio(ratio)) post(dock, { type: "POSITION", ratio }); },
    enabled(value: boolean) { if (enabled !== value) { enabled = value; hello(); } },
    changed(value: boolean) {
      if (opened === value) return;
      opened = value; if (!remoteCommand) post(dock, { type: value ? "OPENED" : "CLOSED" });
    },
    activate(target: SuiteApp) {
      if (!connected || !enabled || (!state.paired && target !== app)) return false;
      post(dock, { type: "REQUEST", app: state.active === target ? null : target }); return true;
    },
    destroy() {
      disposed = true; clearTimeout(retry); clearInterval(heartbeat); media.removeEventListener("change", paint);
      const oldDock = dock, oldThemes = themes; dock = themes = undefined;
      // Uninstall invalidates the runtime before host teardown. A dead Port
      // must not prevent removing the old UI and its recovery observers.
      for (const port of [oldDock, oldThemes]) {
        try { port?.disconnect(); } catch { /* The extension is already gone. */ }
      }
    },
  };
}

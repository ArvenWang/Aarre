import { AARRE_ID, NEXALIGN_IDS, isApp, isDockSide, isRatio, isTheme, resolvedTheme, SUITE_DOCK_PORT, SUITE_THEME_PORT, type DockSide, type SuiteApp, type SuiteState, type SuiteTheme } from "./contract";

export function createSuiteClient(app: SuiteApp, hooks: {
  state: (state: SuiteState) => void; theme: (theme: "light" | "dark") => void;
  retire: () => void; open: () => boolean | void | Promise<boolean | void>; close: () => void | Promise<void>; error: (message: string) => void;
}) {
  let disposed = false, enabled = false, opened = false, remoteCommand = false, connected = false;
  let dock: chrome.runtime.Port | undefined, themes: chrome.runtime.Port | undefined;
  let currentTheme: SuiteTheme | undefined;
  let state: SuiteState = { paired: false, active: null };
  let retry: ReturnType<typeof setTimeout> | undefined;
  let discovering = false, coordinator: string | undefined;
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
  async function connect() {
    if (disposed || discovering || dock && (coordinator === AARRE_ID || app === "aarre")) return;
    discovering = true;
    try {
      // 固定优先级选已安装的协调者；少装 Aarre 时，NexAlign 与 NexCatcher 仍可融合。
      const candidates = app === "aarre" ? [] : [AARRE_ID, ...(app === "nexcatcher" ? NEXALIGN_IDS : [])];
      const available = await Promise.all(candidates.map(async id => {
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
          const response = await Promise.race([chrome.runtime.sendMessage(id, { type: "SUITE_DOCK_DISCOVER" }), new Promise<null>(resolve => { timeout = setTimeout(() => resolve(null), 1000); })]);
          return response?.version === 2 && response.app === (id === AARRE_ID ? "aarre" : "nexalign") ? id : null;
        } catch { return null; } finally { clearTimeout(timeout); }
      }));
      if (disposed || !alive()) return;
      const id = available.find(Boolean) ?? chrome.runtime.id;
      if (dock && coordinator === id) return;
      const old = dock;
      const port = id === chrome.runtime.id ? chrome.runtime.connect({ name: SUITE_DOCK_PORT }) : chrome.runtime.connect(id, { name: SUITE_DOCK_PORT });
      dock = port;
      coordinator = id; connected = false;
      try { old?.disconnect(); } catch { /* 旧协调者已卸载。 */ }
      // Reading lastError consumes Chrome's expected disconnect diagnostic.
      // Reflect keeps the getter side effect through release minification;
      // an unused optional property read would be optimized away.
      port.onDisconnect.addListener(() => { Reflect.get(chrome.runtime ?? {}, "lastError"); if (dock === port) disconnectDock(); });
      let commandRevision = 0;
      port.onMessage.addListener(message => {
        if (dock !== port || disposed) return;
        if (message?.type === "STATE" && typeof message.paired === "boolean" && (message.active === null || isApp(message.active))) {
          const members = Array.isArray(message.members) && message.members.length <= 3 && message.members.every(isApp) ? [...new Set<SuiteApp>(message.members)] : message.paired ? ["aarre", "nexalign"] as SuiteApp[] : [app];
          connected = true; state = { paired: members.length > 1, members, owner: members[0] ?? null, active: message.active, suppressed: message.suppressed === true, ...(isRatio(message.ratio) ? { ratio: message.ratio } : {}), ...(isDockSide(message.side) ? { side: message.side } : {}) }; hooks.state(state);
        }
        if (message?.type === "THEME" && isTheme(message.theme)) post(themes, { type: "MERGE", theme: message.theme });
        if (message?.type === "PING" && typeof message.id === "string" && alive()) post(port, { type: "PONG", id: message.id });
        if (message?.type === "ERROR") hooks.error(String(message.message));
        if ((message?.type === "OPEN" || message?.type === "CLOSE") && typeof message.id === "string") {
          const revision = Number.isSafeInteger(message.revision) ? message.revision : commandRevision + 1;
          if (revision < commandRevision) { post(port, { type: "ACK", id: message.id, ok: false }); return; }
          commandRevision = revision;
          opened = message.type === "OPEN";
          remoteCommand = true;
          let result: boolean | void | Promise<boolean | void>;
          try { result = message.type === "OPEN" ? hooks.open() : hooks.close(); }
          catch (error) { result = Promise.reject(error); }
          finally { remoteCommand = false; }
          void Promise.resolve(result).then(value => {
            const ok = value !== false;
            if (revision === commandRevision && !ok) opened = false;
            post(port, { type: "ACK", id: message.id, ok });
          }, error => {
            if (revision === commandRevision) hooks.error(error instanceof Error ? error.message : String(error));
            post(port, { type: "ACK", id: message.id, ok: false });
          });
        }
      });
      hello(); if (currentTheme) post(port, { type: "THEME", theme: currentTheme });
    } catch { disconnectDock(); }
    finally { discovering = false; }
  }
  const connectThemes = () => {
    if (disposed || themes) return;
    try {
      const port = chrome.runtime.connect({ name: SUITE_THEME_PORT }); themes = port;
      port.onMessage.addListener(message => {
        if (message?.type !== "THEME" || !isTheme(message.theme)) return;
        currentTheme = message.theme; paint(); post(dock, message);
      });
      port.onDisconnect.addListener(() => { Reflect.get(chrome.runtime ?? {}, "lastError"); if (themes === port) { themes = undefined; alive(); } });
    } catch { /* The extension was unloaded. */ }
  };
  connectThemes(); connect();
  // A bounded heartbeat also reconnects after worker suspension. No DOM event grants peer authority.
  const heartbeat = setInterval(() => { connectThemes(); connect(); post(dock, { type: "PING" }); post(themes, { type: "PING" }); }, 20_000);
  return {
    get paired() { return state.paired; },
    get members() { return state.members ?? [app]; },
    get owner() { return state.owner ?? app; },
    position(ratio: number, side: DockSide = "right") { if (isRatio(ratio) && isDockSide(side)) post(dock, { type: "POSITION", ratio, side }); },
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

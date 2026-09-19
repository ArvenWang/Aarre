import { installSuiteViewportBroker } from "./viewport";
import { canonicalTheme, compareTheme, isApp, isDockSide, isMode, isRatio, isTheme, peerApp, SUITE_APPS, SUITE_DOCK_PORT, SUITE_THEME_KEY, SUITE_THEME_PORT, type DockSide, type SuiteApp, type SuiteMode, type SuiteTheme } from "./contract";

export function installSuiteBackground(app: SuiteApp, saveTheme?: (mode: SuiteMode) => Promise<void>) {
  const ownApp = app;
  const settingsMode = (value: unknown) => typeof value === "object" && value !== null && "theme" in value ? value.theme : undefined;
  const themePorts = new Set<chrome.runtime.Port>();
  const dockPorts = new Set<chrome.runtime.Port>();
  let theme: SuiteTheme | undefined;
  let writes = Promise.resolve();
  const safePost = (port: chrome.runtime.Port, message: unknown) => { try { port.postMessage(message); } catch { /* Disconnected document. */ } };
  const read = async () => {
    if (theme) return theme;
    const key = app === "aarre" ? "aarre:theme-sync:v1" : app === "nexalign" ? "layerscope-ui-theme" : "settings";
    const stored = await chrome.storage.local.get([SUITE_THEME_KEY, key]);
    const mode = app === "nexcatcher" ? settingsMode(stored[key]) : stored[key];
    return theme ??= isTheme(stored[SUITE_THEME_KEY]) ? canonicalTheme(stored[SUITE_THEME_KEY]) : {
      mode: isMode(mode) ? mode : "system", clock: 0, writer: app, id: "migration",
    } satisfies SuiteTheme;
  };
  const publish = (next: SuiteTheme) => {
    for (const port of [...themePorts, ...dockPorts]) safePost(port, { type: "THEME", theme: next });
  };
  const update = (input: unknown, explicit = false) => {
    const operation = writes.catch(() => undefined).then(async () => {
      const previous = await read();
      const candidate = explicit && isMode(input)
        ? { mode: input, clock: Math.max(Date.now(), previous.clock + 1), writer: app, id: crypto.randomUUID() }
        : input;
      if (!isTheme(candidate) || compareTheme(candidate, previous) <= 0) return previous;
      const next = canonicalTheme(candidate);
      theme = next;
      const native: Record<string, unknown> = app === "nexcatcher" ? {} : app === "nexalign" ? { "layerscope-ui-theme": next.mode }
        : next.mode === "system" ? {} : { "aarre:theme-sync:v1": next.mode };
      await chrome.storage.local.set({ [SUITE_THEME_KEY]: next, ...native });
      await saveTheme?.(next.mode);
      publish(next);
      return next;
    });
    writes = operation.then(() => undefined);
    return operation;
  };
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message?.type !== "SUITE_THEME_SET") return false;
    // Only extension UI may mint a user preference revision. Content scripts only merge authenticated peers' revisions.
    if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL("")) || !isMode(message.mode)) {
      respond({ ok: false }); return false;
    }
    void update(message.mode, true).then(theme => respond({ ok: true, theme }), () => respond({ ok: false }));
    return true;
  });
  chrome.runtime.onConnect.addListener(port => {
    if (port.name !== SUITE_THEME_PORT || port.sender?.id !== chrome.runtime.id) return;
    themePorts.add(port);
    void read().then(theme => safePost(port, { type: "THEME", theme }));
    port.onMessage.addListener(message => {
      if (message?.type === "MERGE") void update(message.theme).catch(() => undefined);
      if (message?.type === "PING") safePost(port, { type: "PONG" });
    });
    port.onDisconnect.addListener(() => {
      // 页面进入前进/后退缓存时 Chrome 会主动断连；须在回调内读取原因，再清理连接。
      void chrome.runtime.lastError;
      themePorts.delete(port);
    });
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    const next = changes[SUITE_THEME_KEY]?.newValue;
    if (area === "local" && isTheme(next) && (!theme || compareTheme(next, theme) > 0)) { theme = next; publish(next); }
    const mode = settingsMode(changes.settings?.newValue);
    if (app === "nexcatcher" && area === "local" && isMode(mode) && mode !== settingsMode(changes.settings?.oldValue) && mode !== theme?.mode) void update(mode, true).catch(() => undefined);
  });
  const allowedIds = chrome.runtime.getManifest().externally_connectable?.ids ?? [];
  chrome.runtime.onMessageExternal?.addListener((message, sender, respond) => {
    if (message?.type !== "SUITE_DOCK_DISCOVER") return false;
    if (peerApp(sender.id, allowedIds)) respond({ version: 2, app });
    return false;
  });

  type Client = { port: chrome.runtime.Port; app: SuiteApp; enabled: boolean; opened: boolean };
  type Group = { clients: Map<SuiteApp, Client>; active: SuiteApp | null; tabId: number; ratio?: number; side?: DockSide; sequence: number };
  const groups = new Map<string, Group>();
  const replies = new Map<string, { port: chrome.runtime.Port; finish: (ok: boolean) => void }>();
  const members = (group: Group) => SUITE_APPS.filter(app => group.clients.get(app)?.enabled);
  const paired = (group: Group) => members(group).length > 1;
  const broadcast = (group: Group) => {
    const present = members(group);
    for (const client of group.clients.values()) safePost(client.port, { type: "STATE", paired: present.length > 1, members: present, owner: present[0] ?? null, active: group.active, suppressed: mobileViewport(group.tabId), ratio: group.ratio, side: group.side });
  };
  const mobileViewport = installSuiteViewportBroker(() => { for (const group of groups.values()) broadcast(group); }, app);
  const command = (client: Client, type: "OPEN" | "CLOSE", revision: number) => new Promise<boolean>(resolve => {
    const id = crypto.randomUUID();
    const timer = setTimeout(() => finish(false), 4_000);
    const finish = (ok: boolean) => { clearTimeout(timer); replies.delete(id); resolve(ok); };
    replies.set(id, { port: client.port, finish });
    safePost(client.port, { type, id, revision });
  });
  const activate = async (group: Group, target: SuiteApp | null) => {
    if (target && (mobileViewport(group.tabId) || !group.clients.get(target)?.enabled)) return;
    const sequence = ++group.sequence, previous = group.active;
    // Visibility/input ownership changes first. Saving an outgoing iframe is a
    // separate lifecycle, never a prerequisite for showing the destination.
    group.active = target;
    broadcast(group);
    for (const other of group.clients.values()) {
      if (other.app === target || !other.opened && other.app !== previous) continue;
      other.opened = false;
      void command(other, "CLOSE", sequence);
    }
    if (!target) return;
    const client = group.clients.get(target);
    if (!client?.enabled) return;
    client.opened = true;
    const ok = await command(client, "OPEN", sequence);
    if (sequence !== group.sequence || group.clients.get(target) !== client) return;
    // A late ACK is not evidence that the document is dead. Keep the shell
    // available; explicit CLOSED/disconnect or a newer intent owns its exit.
    if (!ok) safePost(client.port, { type: "ERROR", message: "内容仍在准备，侧栏可以继续操作。" });
  };
  const connect = (port: chrome.runtime.Port, external: boolean) => {
    if (port.name !== SUITE_DOCK_PORT) return;
    const sender = port.sender;
    const sourceApp = external ? peerApp(sender?.id, allowedIds) : sender?.id === chrome.runtime.id ? ownApp : undefined;
    if (!sender || !sourceApp
      || sender.frameId !== 0 || typeof sender.tab?.id !== "number" || !sender.documentId
      || sender.documentLifecycle !== "active" || !/^https?:\/\//.test(sender.url ?? "")) { port.disconnect(); return; }
    const app = sourceApp;
    const key = `${sender.tab.id}:${sender.documentId}`;
    const group: Group = groups.get(key) ?? { clients: new Map(), active: null, tabId: sender.tab.id, sequence: 0 };
    groups.set(key, group);
    const old = group.clients.get(app);
    const client: Client = { port, app, enabled: false, opened: false };
    group.clients.set(app, client); old?.port.disconnect(); dockPorts.add(port);
    let probe: string | undefined, probeAt = 0;
    let watchdog: ReturnType<typeof setInterval> | undefined;
    const disconnected = () => {
      clearInterval(watchdog);
      dockPorts.delete(port);
      for (const reply of replies.values()) if (reply.port === port) reply.finish(false);
      if (group.clients.get(app) !== client) return;
      group.clients.delete(app); group.sequence++;
      if (group.active === app) group.active = null;
      if (!group.clients.size) groups.delete(key); else broadcast(group);
    };
    // Ports can survive an uninstalled extension. Still bound stale ownership,
    // but tolerate temporary page long tasks instead of evicting after one miss.
    if (external) watchdog = setInterval(() => {
      if (probe && Date.now() - probeAt >= 15_000) {
        disconnected();
        try { port.disconnect(); } catch { /* Already invalidated. */ }
      } else if (!probe) {
        probeAt = Date.now(); probe = crypto.randomUUID(); safePost(port, { type: "PING", id: probe });
      }
    }, 2_000);
    void read().then(theme => safePost(port, { type: "THEME", theme }));
    port.onMessage.addListener(message => {
      if (group.clients.get(app) !== client) return;
      if (message?.type === "PONG" && message.id === probe) probe = undefined;
      // Only the visible handle's owning host can move the paired surface.
      // The hosts persist the accepted ratio through their existing settings.
      if (message?.type === "POSITION" && isRatio(message.ratio) && client.enabled
        && app === members(group)[0] && !group.active) {
        group.ratio = message.ratio;
        group.side = isDockSide(message.side) ? message.side : "right";
        broadcast(group);
      }
      if (message?.type === "HELLO" && message.version === 1) {
        if (client.enabled && message.enabled !== true) group.sequence++;
        client.enabled = message.enabled === true; client.opened = message.opened === true;
        if (client.opened && !group.active) group.active = app;
        if (!client.enabled && group.active === app) group.active = null;
        broadcast(group);
        if (paired(group) && client.opened && group.active !== app) void activate(group, app);
      }
      if (message?.type === "REQUEST" && (isApp(message.app) || message.app === null) && (paired(group) || message.app === app || message.app === null)) void activate(group, message.app);
      if (message?.type === "ACK" && typeof message.id === "string") {
        const reply = replies.get(message.id);
        if (reply?.port === port) reply.finish(message.ok === true);
      }
      if (message?.type === "CLOSED") { client.opened = false; if (group.active === app) { group.active = null; broadcast(group); } }
      if (message?.type === "OPENED") {
        client.opened = true;
        if (paired(group)) void activate(group, app);
      }
      if (message?.type === "THEME") void update(message.theme).catch(() => undefined);
      if (message?.type === "PING") safePost(port, { type: "PONG" });
    });
    port.onDisconnect.addListener(() => { void chrome.runtime.lastError; disconnected(); });
  };
  chrome.runtime.onConnect.addListener(port => connect(port, false));
  chrome.runtime.onConnectExternal.addListener(port => connect(port, true));
}

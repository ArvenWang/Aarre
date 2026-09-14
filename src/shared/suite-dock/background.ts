import { canonicalTheme, compareTheme, isApp, isMode, isRatio, isTheme, NEXALIGN_IDS, SUITE_DOCK_PORT, SUITE_THEME_KEY, SUITE_THEME_PORT, type SuiteApp, type SuiteTheme } from "./contract";

export function installSuiteBackground(app: SuiteApp) {
  const themePorts = new Set<chrome.runtime.Port>();
  const dockPorts = new Set<chrome.runtime.Port>();
  let theme: SuiteTheme | undefined;
  let writes = Promise.resolve();
  const safePost = (port: chrome.runtime.Port, message: unknown) => { try { port.postMessage(message); } catch { /* Disconnected document. */ } };
  const read = async () => {
    if (theme) return theme;
    const key = app === "aarre" ? "aarre:theme-sync:v1" : "layerscope-ui-theme";
    const stored = await chrome.storage.local.get([SUITE_THEME_KEY, key]);
    return theme ??= isTheme(stored[SUITE_THEME_KEY]) ? canonicalTheme(stored[SUITE_THEME_KEY]) : {
      mode: isMode(stored[key]) ? stored[key] : "system", clock: 0, writer: app, id: "migration",
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
      const native: Record<string, unknown> = app === "nexalign" ? { "layerscope-ui-theme": next.mode }
        : next.mode === "system" ? {} : { "aarre:theme-sync:v1": next.mode };
      await chrome.storage.local.set({ [SUITE_THEME_KEY]: next, ...native });
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
    port.onDisconnect.addListener(() => { themePorts.delete(port); });
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    const next = changes[SUITE_THEME_KEY]?.newValue;
    if (area === "local" && isTheme(next) && (!theme || compareTheme(next, theme) > 0)) { theme = next; publish(next); }
  });
  if (app !== "aarre") return;

  type Client = { port: chrome.runtime.Port; app: SuiteApp; enabled: boolean; opened: boolean };
  type Group = { clients: Map<SuiteApp, Client>; active: SuiteApp | null; ratio?: number; sequence: number; queue?: Promise<void> };
  const groups = new Map<string, Group>();
  const replies = new Map<string, { port: chrome.runtime.Port; finish: (ok: boolean) => void }>();
  const paired = (group: Group) => group.clients.get("aarre")?.enabled === true && group.clients.get("nexalign")?.enabled === true;
  const broadcast = (group: Group) => {
    for (const client of group.clients.values()) safePost(client.port, { type: "STATE", paired: paired(group), active: group.active, ratio: group.ratio });
  };
  const command = (client: Client, type: "OPEN" | "CLOSE") => new Promise<boolean>(resolve => {
    const id = crypto.randomUUID();
    const timer = setTimeout(() => finish(false), 4_000);
    const finish = (ok: boolean) => { clearTimeout(timer); replies.delete(id); resolve(ok); };
    replies.set(id, { port: client.port, finish });
    safePost(client.port, { type, id });
  });
  const performActivation = async (group: Group, target: SuiteApp | null, sequence: number) => {
    if (sequence !== group.sequence || (target && !group.clients.get(target)?.enabled)) return;
    const other = [...group.clients.values()].find(client => target ? client.app !== target : client.app === group.active);
    if (other && !await command(other, "CLOSE")) {
      if (group.sequence === sequence) {
        safePost(group.clients.get(target!)?.port ?? other.port, { type: "ERROR", message: "上一个侧栏暂未关闭，请重试。" });
        broadcast(group);
      }
      return;
    }
    if (other) other.opened = false;
    if (sequence !== group.sequence) return;
    group.active = target;
    broadcast(group);
    if (target) {
      const client = group.clients.get(target);
      if (client?.enabled) {
        const ok = await command(client, "OPEN");
        if (sequence !== group.sequence) return;
        client.opened = ok;
        if (!ok) { group.active = null; broadcast(group); }
      }
    }
  };
  const activate = (group: Group, target: SuiteApp | null) => {
    const sequence = ++group.sequence;
    // Finish any admitted close before a newer intent can reopen the same app.
    const operation = (group.queue ?? Promise.resolve()).catch(() => undefined)
      .then(() => performActivation(group, target, sequence));
    group.queue = operation; return operation;
  };
  const connect = (port: chrome.runtime.Port, external: boolean) => {
    if (port.name !== SUITE_DOCK_PORT) return;
    const sender = port.sender;
    const app: SuiteApp = external ? "nexalign" : "aarre";
    if (!sender || (external ? !NEXALIGN_IDS.includes(sender.id ?? "") : sender.id !== chrome.runtime.id)
      || sender.frameId !== 0 || typeof sender.tab?.id !== "number" || !sender.documentId
      || sender.documentLifecycle !== "active" || !/^https?:\/\//.test(sender.url ?? "")) { port.disconnect(); return; }
    const key = `${sender.tab.id}:${sender.documentId}`;
    const group: Group = groups.get(key) ?? { clients: new Map(), active: null, sequence: 0 };
    groups.set(key, group);
    const old = group.clients.get(app);
    const client: Client = { port, app, enabled: false, opened: false };
    group.clients.set(app, client); old?.port.disconnect(); dockPorts.add(port);
    let probe: string | undefined;
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
    // Chrome can retain an external content-script Port after its extension
    // is uninstalled on a loading document. Require a live peer, not a Port
    // object: two-second probes bound this stale ownership to four seconds.
    if (external) watchdog = setInterval(() => {
      if (probe) {
        disconnected();
        try { port.disconnect(); } catch { /* Already invalidated. */ }
      } else {
        probe = crypto.randomUUID(); safePost(port, { type: "PING", id: probe });
      }
    }, 2_000);
    void read().then(theme => safePost(port, { type: "THEME", theme }));
    port.onMessage.addListener(message => {
      if (group.clients.get(app) !== client) return;
      if (message?.type === "PONG" && message.id === probe) probe = undefined;
      // Only the visible handle's owning host can move the paired surface.
      // The hosts persist the accepted ratio through their existing settings.
      if (message?.type === "POSITION" && isRatio(message.ratio) && client.enabled
        && (!paired(group) || app === "aarre") && !group.active) {
        group.ratio = message.ratio; broadcast(group);
      }
      if (message?.type === "HELLO" && message.version === 1) {
        if (client.enabled && message.enabled !== true) group.sequence++;
        client.enabled = message.enabled === true; client.opened = message.opened === true;
        if (client.opened && !group.active) group.active = app;
        if (!client.enabled && group.active === app) group.active = null;
        broadcast(group);
        if (paired(group) && client.opened && group.active !== app) void command(client, "CLOSE");
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
    port.onDisconnect.addListener(disconnected);
  };
  chrome.runtime.onConnect.addListener(port => connect(port, false));
  chrome.runtime.onConnectExternal.addListener(port => connect(port, true));
}

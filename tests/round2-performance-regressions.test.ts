import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const appStateHookUrl = new URL(
  "../src/ui/sidepanel/hooks/use-app-state.ts",
  import.meta.url,
);
const managerAppUrl = new URL(
  "../src/ui/manager/ManagerApp.tsx",
  import.meta.url,
);
const viteConfigUrl = new URL("../vite.config.ts", import.meta.url);
const backgroundConfigUrl = new URL("../vite.background.config.ts", import.meta.url);
const buildScriptUrl = new URL("../scripts/build.mjs", import.meta.url);
const artifactGuardUrl = new URL("../scripts/check-built-javascript.mjs", import.meta.url);
const agentHookUrl = new URL("../src/ui/sidepanel/hooks/use-agent-chat.ts", import.meta.url);
const agentPageUrl = new URL("../src/ui/sidepanel/pages/AgentChatPage.tsx", import.meta.url);
const cloudStateUrl = new URL("../src/lib/cloud-state.ts", import.meta.url);

describe("Round 2 startup performance guardrails", () => {
  it("renders the native bookmark tree without waiting for service-worker bootstrap", async () => {
    const source = await readFile(appStateHookUrl, "utf8");
    const initialEffect = source.slice(
      source.indexOf("useEffect(() => {"),
      source.indexOf("const deferredTimer"),
    );

    expect(initialEffect).not.toContain("Promise.all");
    expect(initialEffect).toContain("readNativeBookmarkSnapshot()");
    expect(initialEffect).toContain("setSnapshot(nextSnapshot)");
    expect(initialEffect).toContain('sendExtensionRequest({ type: "GET_BOOTSTRAP" })');
  });

  it("never gates the manager's local resource load on cloud sync", async () => {
    const source = await readFile(managerAppUrl, "utf8");
    const refresh = source.slice(
      source.indexOf("const refresh = useCallback("),
      source.indexOf("useEffect(() => {", source.indexOf("const refresh = useCallback(")),
    );

    expect(refresh).toContain("await loadResources()");
    expect(refresh).toContain('void sendExtensionRequest({ type: "SYNC_NOW" })');
    expect(refresh).not.toContain('await sendExtensionRequest({ type: "SYNC_NOW" })');
  });

  it("preloads static page dependencies and keeps JSX runtime out of markdown", async () => {
    const source = await readFile(viteConfigUrl, "utf8");
    const reactRule = source.indexOf('id.includes("/node_modules/react/")');

    expect(source).toContain("modulePreload: true");
    expect(reactRule).toBeGreaterThan(-1);
    expect(source).toContain('id.includes("/node_modules/react/jsx-runtime")');
    expect(source).toContain('id.includes("/node_modules/react/jsx-dev-runtime")');
    expect(source).not.toContain('return "markdown"');
  });

  it("minifies the single-file MV3 worker instead of shipping readable library output", async () => {
    const [source, buildScript, artifactGuard] = await Promise.all([
      readFile(backgroundConfigUrl, "utf8"),
      readFile(buildScriptUrl, "utf8"),
      readFile(artifactGuardUrl, "utf8"),
    ]);
    expect(source).toContain("codeSplitting: false");
    expect(buildScript).toContain('from "terser"');
    expect(buildScript).toContain("compress: { passes: 3 }");
    expect(artifactGuard).toContain("> 330_000");
  });

  it("keeps all four message-level recovery actions wired to real handlers", async () => {
    const [hook, page] = await Promise.all([
      readFile(agentHookUrl, "utf8"),
      readFile(agentPageUrl, "utf8"),
    ]);
    expect(hook).toContain("function regenerate(messageId: string)");
    expect(hook).toContain("function editQuestion(messageId: string)");
    expect(hook).toContain("async function copyAnswer(messageId: string)");
    expect(page).toContain("编辑并重发");
    expect(page).toContain("重新生成");
    expect(page).toContain('message.status === "failed" ? "重试"');
    expect(page).toContain("复制");
  });

  it("keeps batch entity sync compatible with servers deployed in either order", async () => {
    const source = await readFile(cloudStateUrl, "utf8");
    expect(source).toContain('"/v1/sync/entities/batch"');
    expect(source).toContain("status !== 404 && status !== 405");
    expect(source).toContain("fallbackOffset += 12");
    expect(source).toContain('"/v1/sync/entities"');
  });
});

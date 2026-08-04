import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";

const root = resolve(new URL("..", import.meta.url).pathname);
const dist = join(root, "dist");
const output = join(root, "docs", "PERF_BASELINE.md");

async function bytes(path) {
  return (await stat(path)).size;
}

async function matchingAssetSize(pattern) {
  const files = await readdir(join(dist, "assets"));
  const matches = files.filter((file) => pattern.test(file));
  return matches.reduce(async (total, file) => (await total) + await bytes(join(dist, "assets", file)), Promise.resolve(0));
}

const staticMetrics = {
  measuredAt: new Date().toISOString(),
  backgroundBytes: await bytes(join(dist, "background.js")),
  sidepanelCssBytes: await matchingAssetSize(/^sidepanel-(?!lazy).*\.css$/),
  sidepanelEntryBytes: await matchingAssetSize(/^sidepanel-.*\.js$/),
};

let runtime = null;
let runtimeNote = "";
const profile = await mkdtemp(join(tmpdir(), "aarre-perf-"));
try {
  const channel = process.env.AARRE_CHROME_CHANNEL;
  const context = await chromium.launchPersistentContext(profile, {
    ...(channel ? { channel } : {}),
    headless: true,
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  });
  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent("serviceworker", { timeout: 15_000 });
  const extensionId = new URL(worker.url()).host;
  await worker.evaluate(async () => {
    const tree = await chrome.bookmarks.getTree();
    const root = tree[0]?.children?.[0];
    if (root) await chrome.bookmarks.create({ parentId: root.id, title: "Performance fixture", url: "https://example.com/aarre-perf" });
  });
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.__aarreListAt = 0;
    new MutationObserver(() => {
      if (!window.__aarreListAt && document.querySelector(".bookmark-row")) {
        window.__aarreListAt = performance.now();
      }
    }).observe(document, { childList: true, subtree: true });
  });
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.documentElement.dataset.aarreReactCommitted === "true", null, { timeout: 10_000 });
  await page.waitForFunction(() => window.__aarreListAt > 0, null, { timeout: 10_000 });
  const firstMessageMs = await page.evaluate(async () => {
    const start = performance.now();
    await chrome.runtime.sendMessage({ type: "GET_BOOTSTRAP" });
    return performance.now() - start;
  });
  runtime = await page.evaluate((messageMs) => {
    const navigation = performance.getEntriesByType("navigation")[0];
    const commit = performance.getEntriesByName("aarre-react-first-commit")[0];
    const scripts = performance.getEntriesByType("resource").filter((entry) => entry.name.endsWith(".js"));
    return {
      htmlResponseStartMs: navigation?.responseStart ?? null,
      reactFirstCommitMs: commit?.startTime ?? null,
      bookmarkListMs: window.__aarreListAt || null,
      firstBackgroundResponseMs: messageMs,
      firstScreenJsBytes: scripts.reduce((sum, entry) => sum + (entry.transferSize || entry.encodedBodySize || 0), 0),
    };
  }, firstMessageMs);
  await context.close();
} catch (error) {
  runtimeNote = error instanceof Error ? error.message : String(error);
} finally {
  await rm(profile, { recursive: true, force: true });
}

const lines = [
  "# Aarre 启动性能基线",
  "",
  `测量时间：${staticMetrics.measuredAt}`,
  "",
  "## 构建产物",
  "",
  `- Service Worker 主包：${staticMetrics.backgroundBytes} bytes`,
  `- 侧边栏首屏 CSS：${staticMetrics.sidepanelCssBytes} bytes`,
  `- 侧边栏入口 JS：${staticMetrics.sidepanelEntryBytes} bytes`,
  "",
  "## 真实 Chrome 运行时",
  "",
];
if (runtime) {
  lines.push(
    `- HTML 首字节：${runtime.htmlResponseStartMs?.toFixed(2)} ms`,
    `- React 首次 commit：${runtime.reactFirstCommitMs?.toFixed(2)} ms`,
    `- 首次出现书签列表：${runtime.bookmarkListMs?.toFixed(2)} ms`,
    `- 首条后台消息响应：${runtime.firstBackgroundResponseMs?.toFixed(2)} ms`,
    `- 首屏 JS 总字节：${runtime.firstScreenJsBytes} bytes`,
    "",
    "测量使用临时 Chrome 配置和一条仅存在于临时配置中的性能夹具书签；临时配置在测量后删除。",
  );
} else {
  lines.push(
    "当前环境未能启动可加载 MV3 扩展的真实 Chrome；运行时数据待真机验收。",
    "",
    `失败原因：${runtimeNote.replaceAll("\n", " ")}`,
  );
}
lines.push("", "运行命令：`npm run measure:startup`");
await writeFile(output, `${lines.join("\n")}\n`, "utf8");
console.log(await readFile(output, "utf8"));

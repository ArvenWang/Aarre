// Visual sweep harness: drives the dev server's side panel and manager pages
// through the states that are hard to reach by hand (hover, open menus, edit
// dialogs) and writes a screenshot per state to .shots/.
//
//   npm run dev            # in another terminal
//   node scripts/shoot.mjs [state...]
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const BASE = process.env.SHOOT_BASE ?? "http://localhost:5173";
const OUT = new URL("../.shots/", import.meta.url).pathname;
const THEME = process.env.SHOOT_THEME ?? "light";
const CHANNEL = process.env.PLAYWRIGHT_CHANNEL;

const panel = { width: 420, height: 1000 };
const manager = { width: 1440, height: 1000 };

async function open(browser, path, viewport) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 2,
    colorScheme: THEME,
  });
  await context.addInitScript(
    (theme) => window.localStorage.setItem("aarre:theme", theme),
    THEME
  );
  const page = await context.newPage();
  await page.goto(`${BASE}/${path}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  return page;
}

async function shot(page, name, options = {}) {
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${OUT}${name}.png`, ...options });
  console.log(`  ✓ ${name}`);
}

const states = {
  async panel(browser) {
    const page = await open(browser, "sidepanel.html", panel);
    await shot(page, "panel-list");

    const row = page.locator(".bookmark-row").nth(3);
    await row.hover();
    await shot(page, "panel-row-hover");

    const folder = page.locator('.bookmark-row[data-folder="true"]').first();
    if (await folder.count()) {
      await folder.hover();
      await shot(page, "panel-folder-hover");
    }
    await page.close();
  },

  async focus(browser) {
    const page = await open(browser, "sidepanel.html", panel);
    for (let step = 0; step < 4; step += 1) await page.keyboard.press("Tab");
    await shot(page, "panel-keyboard-focus");
    await page.close();
  },

  async settings(browser) {
    const page = await open(browser, "sidepanel.html", panel);
    await page.locator('[aria-label*="设置"], .native-actions button').last().click();
    await shot(page, "settings-main");

    const more = page.locator(".settings-more-button");
    if (await more.count()) {
      await more.hover();
      await shot(page, "settings-more-hover");
      await more.click();
      await shot(page, "settings-more");
    }
    await page.close();
  },

  async edit(browser) {
    const page = await open(browser, "sidepanel.html", panel);
    const row = page.locator(".bookmark-row").nth(3);
    await row.hover();
    await row.locator(".row-menu").first().click();
    await page.waitForTimeout(400);
    await shot(page, "panel-edit");

    const del = page.getByRole("button", { name: "删除书签" });
    if (await del.count()) {
      await del.first().click();
      await page.waitForTimeout(300);
      await shot(page, "panel-edit-confirm");
    }
    await page.close();
  },

  async library(browser) {
    const page = await open(browser, "manager.html", manager);
    await shot(page, "manager-library");
    await page.locator(".library-tab-button").nth(1).hover();
    await shot(page, "manager-tab-hover");
    await page.close();
  },

  async editor(browser) {
    const page = await open(browser, "manager.html", manager);
    const trigger = page.locator(".library-card-editor-trigger").first();
    await page.locator(".library-card").first().hover();
    await trigger.click({ force: true });
    await page.waitForTimeout(500);
    await shot(page, "manager-editor");

    const titleStyle = await page.evaluate(() => {
      const input = document.querySelector(".library-card-editor-dialog input");
      if (!input) return null;
      const style = getComputedStyle(input);
      return {
        focused: document.activeElement === input,
        border: style.borderColor,
        shadow: style.boxShadow,
      };
    });
    console.log("    title input:", JSON.stringify(titleStyle));

    await page.locator(".library-card-editor-dialog").evaluate((node) => {
      node.scrollTop = node.scrollHeight;
    });
    await shot(page, "manager-editor-footer");

    const del = page.locator(
      '.library-card-editor-actions [data-variant="danger-quiet"]',
    );
    if (await del.count()) {
      await del.click();
      await page.waitForTimeout(300);
      await page.locator(".library-card-editor-dialog").evaluate((node) => {
        node.scrollTop = node.scrollHeight;
      });
      await shot(page, "manager-editor-confirm");
      await page.getByRole("button", { name: "取消" }).first().click();
      await page.waitForTimeout(200);
    }

    const select = page.locator(".library-card-editor-dialog select, .library-card-editor-dialog [role=combobox]").first();
    if (await select.count()) {
      const box = await select.boundingBox();
      if (box) console.log("    folder select:", JSON.stringify(box));
      await select.click();
      await page.waitForTimeout(400);
      await shot(page, "manager-editor-select");
    }
    await page.close();
  },

  async views(browser) {
    const page = await open(browser, "manager.html", manager);
    for (const tab of ["整理提案", "报告", "主题图谱", "重新发现"]) {
      const link = page
        .locator("nav button, header button", { hasText: tab })
        .first();
      if (!(await link.count())) {
        console.log(`    未找到 ${tab}`);
        continue;
      }
      await link.click();
      await page.waitForTimeout(800);
      await shot(page, `manager-${tab}`);
    }
    await page.close();
  },

  async agent(browser) {
    const page = await open(browser, "sidepanel.html", panel);
    const entry = page.locator(".agent-composer-setup, .native-actions button").first();
    await entry.click();
    await page.waitForTimeout(500);
    await shot(page, "panel-agent");
    await page.close();
  },

  async filters(browser) {
    const page = await open(browser, "manager.html", manager);
    const trigger = page.locator(".library-sort [role=combobox], .library-toolbar [role=combobox]").first();
    if (await trigger.count()) {
      await trigger.click();
      await page.waitForTimeout(400);
      await shot(page, "manager-filter-open");
    } else {
      console.log("    未找到筛选下拉");
    }
    await page.close();
  },
};

const wanted = process.argv.slice(2);
const list = wanted.length ? wanted : Object.keys(states);

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch(CHANNEL ? { channel: CHANNEL } : {});
for (const name of list) {
  if (!states[name]) {
    console.log(`跳过未知状态 ${name}`);
    continue;
  }
  console.log(`▶ ${name}`);
  try {
    await states[name](browser);
  } catch (error) {
    console.log(`  ✗ ${name}: ${error.message.split("\n")[0]}`);
  }
}
await browser.close();
console.log(`截图目录：${OUT}`);

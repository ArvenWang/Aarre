// Runtime sweep for the control regressions that only show up once the CSS is
// composed: buttons that end up too short to hit, labels clipped by their box,
// icons sitting off the text baseline, and hover states that repaint a row in
// the wrong colour.
//
//   npm run dev            # in another terminal
//   node scripts/audit-controls.mjs
import { chromium } from "playwright";

const BASE = process.env.SHOOT_BASE ?? "http://localhost:5173";
const THEME = process.env.SHOOT_THEME ?? "light";
const CHANNEL = process.env.PLAYWRIGHT_CHANNEL;

const audit = () => {
  const findings = [];
  const label = (element) => {
    const classes = [...element.classList]
      .filter((name) => !/^[a-z-]*[:[]/.test(name) && name.length < 32)
      .slice(0, 3)
      .join(".");
    const text = (element.textContent || "").trim().slice(0, 18);
    return `${element.tagName.toLowerCase()}${classes ? "." + classes : ""}${text ? ` 「${text}」` : ""}`;
  };

  const controls = document.querySelectorAll(
    'button, a[href], [role="button"], [role="combobox"], input, select, textarea',
  );
  for (const control of controls) {
    const box = control.getBoundingClientRect();
    if (!box.width || !box.height) continue;
    const style = getComputedStyle(control);

    // Checkboxes, links inside running text and the affordance tucked inside a
    // tag chip are all deliberately smaller than a standalone control.
    const inlineByDesign =
      style.display.startsWith("inline") && !style.display.includes("-") ;
    const exempt =
      /^(?:checkbox|radio)$/.test(control.type || "") ||
      control.classList.contains("tag-chip-remove") ||
      inlineByDesign;
    if (box.height < 24 && !exempt)
      findings.push(`高度不足 ${box.height.toFixed(1)}px：${label(control)}`);

    // A label wider than its box with no overflow handling is a clip, not a
    // truncation — the text just disappears at the edge.
    if (
      control.scrollWidth > control.clientWidth + 1 &&
      style.overflowX === "hidden" &&
      style.textOverflow !== "ellipsis"
    )
      findings.push(
        `文字被裁切 ${control.scrollWidth}>${control.clientWidth}：${label(control)}`,
      );

    // A button's auto width shrinks to its content even when it is a flex
    // container, so a row that asks for space-between silently keeps its
    // trailing chevron glued to the label instead of at the far edge.
    if (
      control.tagName === "BUTTON" &&
      style.display === "flex" &&
      style.justifyContent === "space-between" &&
      control.parentElement
    ) {
      const parent = control.parentElement.getBoundingClientRect();
      const parentStyle = getComputedStyle(control.parentElement);
      const available =
        parent.width -
        parseFloat(parentStyle.paddingLeft) -
        parseFloat(parentStyle.paddingRight);
      if (parentStyle.display.startsWith("block") && box.width < available - 8)
        findings.push(
          `整行按钮未撑满 ${box.width.toFixed(0)}/${available.toFixed(0)}px：${label(control)}`,
        );
    }

    const svg = control.querySelector("svg");
    if (svg && (control.textContent || "").trim()) {
      const iconBox = svg.getBoundingClientRect();
      const offset = Math.abs(
        iconBox.top + iconBox.height / 2 - (box.top + box.height / 2),
      );
      if (offset > 3)
        findings.push(
          `图标偏离中线 ${offset.toFixed(1)}px：${label(control)}`,
        );
    }
  }

  // Anything wider than the viewport means a row that cannot be reached.
  for (const element of document.querySelectorAll("body *")) {
    const box = element.getBoundingClientRect();
    if (box.width > document.documentElement.clientWidth + 2)
      findings.push(
        `超出视口 ${box.width.toFixed(0)}px：${label(element)}`,
      );
  }

  return [...new Set(findings)];
};

// Hover is the state a screenshot sweep never covers, and it is where a painted
// component variant beats the project's own rule: `hover:bg-*` compiles to a
// pseudo-class selector, which outranks the plain class sitting on the very same
// element. The symptom is a row that flips to near-black under the cursor while
// its text stays dark. Rather than enumerate the selectors that could collide,
// force :hover on every control at once and compare what actually paints.
const readHoverContrast = () => {
  // Computed colours come back in whichever syntax the author used, and the
  // channels of color(srgb …) run 0–1 while rgb() runs 0–255. Painting the
  // value and reading the pixel back is the only parser that covers all of them.
  const canvas = document.createElement("canvas");
  const ink = canvas.getContext("2d", { willReadFrequently: true });
  const parse = (value) => {
    ink.clearRect(0, 0, 1, 1);
    ink.fillStyle = "#000";
    ink.fillStyle = value;
    ink.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ink.getImageData(0, 0, 1, 1).data;
    return [r, g, b, a / 255];
  };

  const luminance = (rgb) => {
    const [r, g, b] = rgb.slice(0, 3).map((channel) => {
      const c = channel / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };

  // A transparent control shows whatever is behind it, so resolve upwards.
  const painted = (element) => {
    for (let node = element; node; node = node.parentElement) {
      const rgb = parse(getComputedStyle(node).backgroundColor);
      if (rgb[3] > 0.5) return rgb.slice(0, 3);
    }
    return parse(getComputedStyle(document.body).backgroundColor).slice(0, 3);
  };

  const contrast = (a, b) => {
    const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (high + 0.05) / (low + 0.05);
  };

  return [...document.querySelectorAll("[data-audit-id]")].map((element) => ({
    id: element.dataset.auditId,
    background: painted(element),
    ink: parse(getComputedStyle(element).color).slice(0, 3),
    contrast: contrast(painted(element), parse(getComputedStyle(element).color)),
    luminance: luminance(painted(element)),
  }));
};

async function auditHover(page, context) {
  const count = await page.evaluate(() => {
    const controls = document.querySelectorAll(
      'button, a[href], [role="button"]',
    );
    controls.forEach((control, index) => {
      const box = control.getBoundingClientRect();
      if (box.width && box.height) control.dataset.auditId = String(index);
    });
    return controls.length;
  });
  if (!count) return [];

  const rest = await page.evaluate(readHoverContrast);
  const client = await context.newCDPSession(page);
  await client.send("DOM.enable");
  await client.send("CSS.enable");
  const { root } = await client.send("DOM.getDocument", { depth: -1 });
  const { nodeIds } = await client.send("DOM.querySelectorAll", {
    nodeId: root.nodeId,
    selector: "[data-audit-id]",
  });
  for (const nodeId of nodeIds)
    await client.send("CSS.forcePseudoState", {
      nodeId,
      forcedPseudoClasses: ["hover"],
    });

  const hovered = await page.evaluate(readHoverContrast);
  const labels = await page.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll("[data-audit-id]")].map((element) => [
        element.dataset.auditId,
        `${element.tagName.toLowerCase()}${
          [...element.classList]
            .filter(
              (name) =>
                !/[:[]/.test(name) &&
                name.length < 32 &&
                !/^(?:group|relative|isolate|inline-flex)$/.test(name),
            )
            // The project's own class is appended after the variant classes, so
            // the tail of the list is what identifies the element to a reader.
            .slice(-3)
            .map((name) => "." + name)
            .join("") || ""
        }${
          (element.textContent || "").trim()
            ? ` 「${(element.textContent || "").trim().slice(0, 16)}」`
            : element.getAttribute("aria-label")
              ? ` 「${element.getAttribute("aria-label")}」`
              : ""
        }`,
      ]),
    ),
  );

  const findings = [];
  const byId = new Map(rest.map((entry) => [entry.id, entry]));
  for (const after of hovered) {
    const before = byId.get(after.id);
    if (!before) continue;
    const flipped =
      (before.luminance > 0.6 && after.luminance < 0.3) ||
      (before.luminance < 0.3 && after.luminance > 0.7);
    if (flipped)
      findings.push(`hover 反色 ${labels[after.id]}`);
    else if (after.contrast < 3 && before.contrast >= 3)
      findings.push(
        `hover 后对比度降到 ${after.contrast.toFixed(1)}:1 ${labels[after.id]}`,
      );
  }
  return [...new Set(findings)];
}

const panel = { width: 420, height: 1000 };
const manager = { width: 1440, height: 1000 };

const scenes = [
  ["侧边栏 · 列表", "sidepanel.html", panel, async () => {}],
  [
    "侧边栏 · 设置",
    "sidepanel.html",
    panel,
    async (page) => {
      await page.locator(".native-actions button").last().click();
      await page.waitForTimeout(500);
    },
  ],
  [
    "侧边栏 · 设置更多",
    "sidepanel.html",
    panel,
    async (page) => {
      await page.locator(".native-actions button").last().click();
      await page.waitForTimeout(400);
      await page.locator(".settings-more-button").click();
      await page.waitForTimeout(400);
    },
  ],
  [
    "侧边栏 · 编辑书签",
    "sidepanel.html",
    panel,
    async (page) => {
      const row = page.locator(".bookmark-row").nth(3);
      await row.hover();
      await row.locator(".row-menu").first().click();
      await page.waitForTimeout(500);
    },
  ],
  ["收藏库 · 宽屏", "manager.html", manager, async () => {}],
  ["收藏库 · 窄屏", "manager.html", { width: 480, height: 900 }, async () => {}],
  [
    "收藏库 · 编辑弹窗",
    "manager.html",
    manager,
    async (page) => {
      await page.locator(".library-card").first().hover();
      await page
        .locator(".library-card-editor-trigger")
        .first()
        .click({ force: true });
      await page.waitForTimeout(600);
    },
  ],
  [
    "收藏库 · 删除确认",
    "manager.html",
    manager,
    async (page) => {
      await page.locator(".library-card").first().hover();
      await page
        .locator(".library-card-editor-trigger")
        .first()
        .click({ force: true });
      await page.waitForTimeout(600);
      await page
        .locator('.library-card-editor-actions [data-variant="danger-quiet"]')
        .click();
      await page.waitForTimeout(300);
    },
  ],
  [
    "整理提案",
    "manager.html",
    manager,
    async (page) => {
      await page.locator("header button", { hasText: "整理提案" }).first().click();
      await page.waitForTimeout(800);
    },
  ],
  [
    "报告",
    "manager.html",
    manager,
    async (page) => {
      await page.locator("header button", { hasText: "报告" }).first().click();
      await page.waitForTimeout(800);
    },
  ],
];

const wanted = process.argv.slice(2);
const browser = await chromium.launch(CHANNEL ? { channel: CHANNEL } : {});
let total = 0;
for (const [name, path, viewport, drive] of scenes) {
  if (wanted.length && !wanted.some((term) => name.includes(term))) continue;
  const context = await browser.newContext({ viewport, colorScheme: THEME });
  await context.addInitScript(
    (theme) => window.localStorage.setItem("aarre:theme", theme),
    THEME,
  );
  const page = await context.newPage();
  await page.goto(`${BASE}/${path}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  console.log(`\n▶ ${name} (${THEME})`);
  try {
    await drive(page);
  } catch (error) {
    console.log(`  ✗ 无法进入该状态：${error.message.split("\n")[0]}`);
    await context.close();
    continue;
  }
  const findings = [
    ...(await page.evaluate(audit)),
    ...(await auditHover(page, context)),
  ];
  total += findings.length;
  if (!findings.length) console.log("  没有发现控件问题");
  for (const finding of findings) console.log(`  · ${finding}`);
  await context.close();
}
await browser.close();
console.log(`\n合计 ${total} 项`);

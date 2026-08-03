import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const UI_DIRECTORY = new URL("../src/ui/", import.meta.url);
const SOURCE_DIRECTORY = new URL("../src/", import.meta.url);
const TOKEN_FILE = "tokens.css";
const ALLOWED_TOKEN_COLORS = new Set([
  "#ffffff",
  "#fcfcfc",
  "#fafafa",
  "#f5f6f7",
  "#17191c",
  "#6c7278",
  "#a0a5aa",
  "#ebedef",
  "#dadde0",
  "#12a594",
  "#d2493a",
  "#5b7cd8",
  "#c2762e",
  "#7b6bc4",
  "#4d9c5a",
  "#0f1113",
  "#12161c",
  "#1c2430",
  "#0a0d12",
  "#c5ceda",
  "#16181b",
  "#1d2023",
  "#eef0f2",
  "#949a9f",
  "#676d72",
  "#24272a",
  "#34383c",
  "#2ec4b0",
  "#e0776a",
  "#7d9ce8",
  "#dba05a",
  "#a394e0",
  "#6fbf7c"
]);

const errors: string[] = [];
const entries = (await readdir(UI_DIRECTORY))
  .filter((file) => file.endsWith(".css"))
  .sort();

for (const file of entries) {
  const source = await readFile(join(UI_DIRECTORY.pathname, file), "utf8");
  const lines = source.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    const lineNumber = index + 1;
    const colorMatches =
      line.match(/#[\da-f]{3,8}\b|(?:rgb|hsl)a?\(/gi) || [];
    if (file === TOKEN_FILE) {
      for (const color of colorMatches) {
        if (
          color.startsWith("#") &&
          !ALLOWED_TOKEN_COLORS.has(color.toLocaleLowerCase())
        ) {
          errors.push(
            `${file}:${lineNumber} 未登记的 token 色值 ${color}`
          );
        }
      }
    } else if (colorMatches.length) {
      errors.push(
        `${file}:${lineNumber} 必须使用颜色 token：${colorMatches.join(", ")}`
      );
    }

    if (file !== TOKEN_FILE) {
      const radius = line.match(/border-radius:\s*([^;]+)/);
      if (
        radius &&
        !radius[1].includes("var(") &&
        !/^(?:0|50%|inherit)$/.test(radius[1].trim())
      ) {
        errors.push(
          `${file}:${lineNumber} 圆角必须使用 token：${radius[1].trim()}`
        );
      }

      const fontSize = line.match(/font-size:\s*([^;]+)/);
      if (
        fontSize &&
        !fontSize[1].includes("var(") &&
        !/^(?:inherit|initial|unset)$/.test(fontSize[1].trim())
      ) {
        errors.push(
          `${file}:${lineNumber} 字号必须使用 token：${fontSize[1].trim()}`
        );
      }

      const fontWeight = line.match(/font-weight:\s*([^;]+)/);
      if (
        fontWeight &&
        !fontWeight[1].includes("var(") &&
        !/^(?:inherit|initial|unset)$/.test(fontWeight[1].trim())
      ) {
        errors.push(
          `${file}:${lineNumber} 字重必须使用 token：${fontWeight[1].trim()}`
        );
      }

      if (
        /--(?:paper|card|lime|component|muted|danger|success)\s*:/.test(
          line
        )
      ) {
        errors.push(
          `${file}:${lineNumber} 不得恢复旧设计变量：${line.trim()}`
        );
      }
    }

    if (line.includes("!important")) {
      errors.push(`${file}:${lineNumber} 不允许使用 !important`);
    }


    if (
      />\s*span\.relative\b|span\[aria-hidden=(?:"true"|'true')\]/.test(
        line
      )
    ) {
      errors.push(
        `${file}:${lineNumber} 不得依赖共享 Button 的匿名内部标签，请使用 data-slot`
      );
    }
  }
}

/**
 * 共享按钮类必须靠 min-height token 撑开。写死 height 正是「按钮塌成一条」
 * 和「两套按钮系统高度对不上」的来源，所以这里只盯 .button* / .icon-button
 * / .text-button* 这一组共享类，组件内部自己的 button 元素不在管辖范围。
 */
function checkControlHeights(file: string, source: string) {
  const sharedButtonClass =
    /\.(?:button(?:-[\w-]+)?|icon-button|text-button(?:-[\w-]+)?)$/;
  for (const block of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = block[1].trim();
    const body = block[2];
    if (selector.startsWith("@")) continue;
    const targetsSharedButton = selector
      .split(",")
      .map((part) => part.trim().split(/[\s>]+/).pop() || "")
      .some((last) => sharedButtonClass.test(last.replace(/:[\w-]+.*$/, "")));
    if (!targetsSharedButton) continue;

    const lineNumber = source.slice(0, block.index).split(/\r?\n/).length;
    const height = body.match(/(?:^|[\s;])height:\s*([^;]+)/);
    if (height && /\d/.test(height[1])) {
      errors.push(
        `${file}:${lineNumber} 共享按钮类不得写死 height，请改用 min-height token：${selector}`
      );
    }
    const minHeight = body.match(/min-height:\s*([^;]+)/);
    if (minHeight && !minHeight[1].includes("var(--control-h-")) {
      errors.push(
        `${file}:${lineNumber} 按钮最小高度必须使用 --control-h-* token：${minHeight[1].trim()}`
      );
    }
  }
}

/**
 * 同心圆角必须成对：外层用 --radius-lg，嵌在它里面的元素就得用
 * --radius-nested-lg。设置页那个「外 14px、内 8px、滑块 20px」的分段控件
 * 就是因为三层各写各的。
 */
function checkNestedRadiusPairs(file: string, source: string) {
  const radiusBySelector = new Map<string, { token: string; line: number }>();
  for (const block of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = block[1].trim();
    if (selector.startsWith("@")) continue;
    const radius = block[2].match(/border-radius:\s*var\((--radius-[\w-]+)\)/);
    // 胶囊嵌胶囊是对的：--radius-pill 的视觉半径跟着高度走，本来就该内外一致。
    if (!radius || radius[1] === "--radius-pill") continue;
    const lineNumber = source.slice(0, block.index).split(/\r?\n/).length;
    for (const part of selector.split(",")) {
      radiusBySelector.set(part.trim(), {
        token: radius[1],
        line: lineNumber
      });
    }
  }

  for (const [selector, radius] of radiusBySelector) {
    const segments = selector.split(/\s+/).filter(Boolean);
    if (segments.length < 2) continue;
    for (let end = 1; end < segments.length; end += 1) {
      const ancestor = radiusBySelector.get(
        segments.slice(0, end).join(" ")
      );
      if (ancestor?.token === radius.token) {
        errors.push(
          `${file}:${radius.line} 嵌套元素与外层共用 ${radius.token}，应改用配对的 nested 圆角：${selector}`
        );
        break;
      }
    }
  }
}

for (const file of entries) {
  const source = await readFile(join(UI_DIRECTORY.pathname, file), "utf8");
  if (file === TOKEN_FILE) continue;
  checkControlHeights(file, source);
  checkNestedRadiusPairs(file, source);
}

async function collectTsxFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectTsxFiles(path)));
    } else if (entry.name.endsWith(".tsx")) {
      files.push(path);
    }
  }
  return files;
}

for (const file of await collectTsxFiles(SOURCE_DIRECTORY.pathname)) {
  const source = await readFile(file, "utf8");
  const isUiPrimitive = file.includes("/ui/components/ui/");
  const buttonPattern = /<Button\b([\s\S]*?)>([\s\S]*?)<\/Button>/g;
  for (const match of source.matchAll(buttonPattern)) {
    const attributes = match[1];
    const children = match[2].trim();
    if (
      /^<[A-Z][A-Za-z0-9]*Icon\b[^>]*\/>$/.test(children) &&
      !/\bsize=(?:"icon(?:-sm|-lg)?"|\{"icon(?:-sm|-lg)?"\})/.test(
        attributes
      )
    ) {
      const lineNumber = source.slice(0, match.index).split(/\r?\n/).length;
      errors.push(
        `${file}:${lineNumber} 纯图标 Button 必须显式使用 icon 尺寸`
      );
    }

    if (/\bvariant="unstyled"/.test(attributes)) {
      const lineNumber = source.slice(0, match.index).split(/\r?\n/).length;
      errors.push(
        `${file}:${lineNumber} 禁止双轨按钮：使用 shadcn variant，不要使用 unstyled`
      );
    }
  }

  // tsx 里的硬编码尺寸和色值绕过了 token，是「收敛成 token」做了却没做到的主因。
  for (const [index, line] of source.split(/\r?\n/).entries()) {
    if (
      !isUiPrimitive &&
      /<(?:button|input|textarea|select)\b/.test(line) &&
      !/^\s*\/\//.test(line)
    ) {
      errors.push(
        `${file}:${index + 1} 禁止手写原生控件，请使用 @/ui/components/ui/ 下的组件`
      );
    }
    if (/from ["']\.\.\/.*components\/ui\//.test(line)) {
      errors.push(
        `${file}:${index + 1} 使用 @/ui/components/ui/ 别名，不要用相对路径`
      );
    }
    // 圆角、高度和色值是这个项目真正建立了 token 体系的三类，也正是硬编码
    // 造成过实际 bug 的三类。允许 calc()/min() 里引用 var() 的派生值。
    const arbitrary = (
      line.match(/\b[\w-]+-\[[^\]]*\]/g) || []
    ).filter((value) => {
      if (value.includes("var(")) return false;
      if (/#[\da-f]{3,8}\b/i.test(value)) return true;
      return /^(?:min-h|h|rounded[\w-]*)-\[/.test(value) && /\dpx/.test(value);
    });
    if (arbitrary.length) {
      errors.push(
        `${file}:${index + 1} Tailwind 任意值绕过了 token：${arbitrary.join(", ")}`
      );
    }

    const inlineStyle = line.match(/style=\{\{([^}]*)\}\}/);
    if (
      inlineStyle &&
      /(?<!var\([^)]*)\b\d+px\b|#[\da-f]{3,8}\b/i.test(inlineStyle[1])
    ) {
      errors.push(
        `${file}:${index + 1} 内联样式必须使用 token：${inlineStyle[1].trim()}`
      );
    }
  }
}

if (errors.length) {
  console.error("设计 token 检查失败：");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(
  `设计 token 检查通过：${entries.length} 个 CSS 文件与全部 tsx 无硬编码回归。`
);

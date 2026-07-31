import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const UI_DIRECTORY = new URL("../src/ui/", import.meta.url);
const SOURCE_DIRECTORY = new URL("../src/", import.meta.url);
const TOKEN_FILE = "tokens.css";
const ALLOWED_TOKEN_COLORS = new Set([
  "#ffffff",
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
  }
}

if (errors.length) {
  console.error("设计 token 检查失败：");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(
  `设计 token 检查通过：${entries.length} 个 CSS 文件无硬编码回归。`
);

import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";

const distRoot = join(process.cwd(), "dist");

async function javascriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await javascriptFiles(path)));
    } else if (entry.isFile() && path.endsWith(".js")) {
      files.push(path);
    }
  }
  return files;
}

const files = (await javascriptFiles(distRoot)).sort();
if (!files.length) {
  throw new Error("dist 中没有可检查的 JavaScript 产物。");
}

for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], {
    stdio: "inherit",
    shell: false
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log(
  `JavaScript 产物语法检查通过：${files
    .map((file) => relative(process.cwd(), file))
    .join(", ")}`
);

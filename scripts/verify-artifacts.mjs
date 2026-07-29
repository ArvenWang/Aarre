import { spawnSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const outputsDirectory = resolve(root, "outputs");
const entries = await readdir(outputsDirectory, {
  withFileTypes: true
});
const errors = [];

for (const entry of entries) {
  const unpackedMatch = entry.name.match(
    /^Bookmark-Layer-(\d+\.\d+\.\d+)-unpacked$/
  );
  if (entry.isDirectory() && unpackedMatch) {
    const manifest = JSON.parse(
      await readFile(
        resolve(outputsDirectory, entry.name, "manifest.json"),
        "utf8"
      )
    );
    if (manifest.version !== unpackedMatch[1]) {
      errors.push(
        `${entry.name} 实际包含版本 ${manifest.version}`
      );
    }
  }

  const zipMatch = entry.name.match(
    /^Bookmark-Layer-(\d+\.\d+\.\d+)\.zip$/
  );
  if (entry.isFile() && zipMatch) {
    const result = spawnSync(
      "unzip",
      ["-p", resolve(outputsDirectory, entry.name), "manifest.json"],
      { encoding: "utf8", shell: false }
    );
    if (result.status !== 0) {
      errors.push(`${entry.name} 无法读取 manifest.json`);
      continue;
    }
    const manifest = JSON.parse(result.stdout);
    if (manifest.version !== zipMatch[1]) {
      errors.push(`${entry.name} 实际包含版本 ${manifest.version}`);
    }
  }
}

if (errors.length) {
  console.error(`交付物版本校验失败：\n${errors.join("\n")}`);
  process.exit(1);
}

console.log("现有交付物文件名、Manifest 版本和压缩包结构一致。");

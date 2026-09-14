import { spawnSync } from "node:child_process";
import { cp, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDirectory = resolve(root, "dist");
const outputsDirectory = resolve(root, "outputs");
const packageJson = JSON.parse(
  await readFile(resolve(root, "package.json"), "utf8")
);
const manifest = JSON.parse(
  await readFile(resolve(distDirectory, "manifest.json"), "utf8")
);
const version = packageJson.version;

if (manifest.version !== version) {
  throw new Error(
    `版本不一致：package.json=${version}，dist/manifest.json=${manifest.version}`
  );
}

const baseName = `Bookmark-Layer-${version}`;
const unpackedDirectory = resolve(outputsDirectory, `${baseName}-unpacked`);
const extensionZip = resolve(outputsDirectory, `${baseName}.zip`);
const sourceZip = resolve(outputsDirectory, `${baseName}-source.zip`);
const buildManifest = resolve(outputsDirectory, `${baseName}-build.json`);
const targets = [unpackedDirectory, extensionZip, sourceZip, buildManifest];
const existingTargets = targets.filter(existsSync);

if (existingTargets.length) {
  console.error(
    `拒绝覆盖已有交付物：\n${existingTargets.join("\n")}\n请先提升版本号。`
  );
  process.exit(1);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: "pipe",
    shell: false,
    ...options
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} 执行失败：${result.stderr || result.stdout || "未知错误"}`
    );
  }
  return result.stdout;
}

const status = run("git", ["status", "--porcelain"]).trim();
if (status) {
  console.error("工作区存在未提交改动，拒绝生成不可追溯的交付包。");
  process.exit(1);
}

await mkdir(outputsDirectory, { recursive: true });
await cp(distDirectory, unpackedDirectory, {
  recursive: true,
  force: false,
  errorOnExist: true
});
run("zip", ["-q", "-r", extensionZip, "."], {
  cwd: distDirectory
});
run("git", [
  "archive",
  "--format=zip",
  `--output=${sourceZip}`,
  "HEAD"
]);

const packagedManifest = JSON.parse(
  await readFile(resolve(unpackedDirectory, "manifest.json"), "utf8")
);
if (packagedManifest.version !== version) {
  throw new Error("解压交付目录的版本校验失败。");
}
run("unzip", ["-t", extensionZip]);
run("unzip", ["-t", sourceZip]);

async function fileRecord(path, base = outputsDirectory) {
  const data = await readFile(path);
  return {
    path: path.slice(base.length + 1),
    bytes: data.byteLength,
    sha256: createHash("sha256").update(data).digest("hex")
  };
}
async function directoryRecords(directory) {
  const records = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) records.push(...await directoryRecords(path));
    else records.push(await fileRecord(path));
  }
  return records.sort((left, right) => left.path.localeCompare(right.path));
}
await writeFile(buildManifest, JSON.stringify({
  product: "Aarre",
  version,
  sourceCommit: run("git", ["rev-parse", "HEAD"]).trim(),
  sourceTree: run("git", ["rev-parse", "HEAD^{tree}"]).trim(),
  cleanSource: true,
  builtAt: (await stat(resolve(distDirectory, "manifest.json"))).mtime.toISOString(),
  packagedAt: new Date().toISOString(),
  minimumChromeVersion: manifest.minimum_chrome_version,
  files: [
    ...await directoryRecords(unpackedDirectory),
    await fileRecord(extensionZip),
    await fileRecord(sourceZip)
  ]
}, null, 2) + "\n");

console.log(`已生成并校验 ${baseName} 的扩展包、解压目录、源码包与 SHA-256 构建清单。`);

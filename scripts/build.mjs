import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { loadEnv } from "vite";

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: false
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run("vite", ["build"]);

const env = loadEnv("production", process.cwd(), "");
const configuredSupabaseUrl = env.VITE_SUPABASE_URL?.trim();
if (
  configuredSupabaseUrl &&
  !configuredSupabaseUrl.includes("YOUR_PROJECT")
) {
  const manifestPath = new URL("../dist/manifest.json", import.meta.url);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.host_permissions = [
    ...new Set([
      ...(manifest.host_permissions || []),
      `${new URL(configuredSupabaseUrl).origin}/*`
    ])
  ];
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

run("esbuild", [
  "src/content/capture.ts",
  "--bundle",
  "--format=iife",
  "--target=chrome116",
  "--outfile=dist/content-capture.js"
]);

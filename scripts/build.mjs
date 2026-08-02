import { spawnSync } from "node:child_process";
import { loadEnv } from "vite";

const buildEnvironment = {
  ...loadEnv("production", process.cwd(), ""),
  ...process.env
};
const cloudRelease = buildEnvironment.AARRE_CLOUD_RELEASE === "1";
const configuredApiUrl = buildEnvironment.VITE_AARRE_API_BASE_URL || "";

if (configuredApiUrl && !cloudRelease) {
  throw new Error(
    "VITE_AARRE_API_BASE_URL is only accepted when AARRE_CLOUD_RELEASE=1."
  );
}

if (cloudRelease) {
  const apiUrl = configuredApiUrl;
  let parsed;
  try {
    parsed = new URL(apiUrl);
  } catch {
    throw new Error("A cloud release requires a valid VITE_AARRE_API_BASE_URL.");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash ||
    ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)
  ) {
    throw new Error(
      "A cloud release requires a root HTTPS API origin and refuses localhost or URL paths."
    );
  }
}

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

run("esbuild", [
  "src/content/capture.ts",
  "--bundle",
  "--format=iife",
  "--target=chrome116",
  "--outfile=dist/content-capture.js"
]);

run("node", ["scripts/check-built-javascript.mjs"]);

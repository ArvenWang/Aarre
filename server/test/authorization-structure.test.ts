import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const userScopedTables = /\b(resources|bookmark_items|protection_rules|protection_rule_resources|user_settings|conversations|reports|usage_periods|operation_history|assets|conflict_versions|devices|account_usage|user_keys)\b/i;
const queryLiteral = /\.query(?:<[^;]*?>)?\(\s*([`"'])([\s\S]*?)\1/g;

test("every online user-data SQL statement carries an explicit user_id scope", async () => {
  const sourceDirectory = resolve(process.cwd(), "src");
  const files = (await readdir(sourceDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .map((entry) => entry.name)
    // The maintenance worker is intentionally global and has no request identity.
    .filter((name) => name !== "maintenance.ts");

  const violations: string[] = [];
  for (const file of files) {
    const source = await readFile(resolve(sourceDirectory, file), "utf8");
    for (const match of source.matchAll(queryLiteral)) {
      const sql = match[2];
      if (userScopedTables.test(sql) && !/\buser_id\b/i.test(sql)) {
        violations.push(`${file}: ${sql.replace(/\s+/g, " ").trim().slice(0, 180)}`);
      }
    }
  }

  assert.deepEqual(
    violations,
    [],
    `User-scoped SQL without an explicit user_id boundary:\n${violations.join("\n")}`
  );
});

test("HTTP user-data routes authenticate before invoking services", async () => {
  const source = await readFile(resolve(process.cwd(), "src/app.ts"), "utf8");
  for (const path of [
    "/v1/account",
    "/v1/sync/resources/:resourceKey",
    "/v1/sync/entities",
    "/v1/sync/conflicts",
    "/v1/assets/upload",
    "/v1/assets/:assetId/download"
  ]) {
    const routeStart = source.indexOf(`\"${path}\"`);
    assert.ok(routeStart >= 0, `Expected route ${path}.`);
    const routeWindow = source.slice(routeStart, routeStart + 900);
    assert.match(routeWindow, /requireAccount\(request\)/, `${path} must require an account.`);
  }
});

test("quota checks lock only the account usage row", async () => {
  const sources = await Promise.all([
    readFile(resolve(process.cwd(), "src/sync.ts"), "utf8"),
    readFile(resolve(process.cwd(), "src/assets.ts"), "utf8")
  ]);
  const combined = sources.join("\n");
  const quotaQueries = combined.match(
    /SELECT u\.quota_bytes, a\.metadata_bytes, a\.asset_bytes[\s\S]*?WHERE u\.id = \$1 FOR UPDATE(?: OF a)?/g
  ) || [];

  assert.equal(quotaQueries.length, 4);
  assert.ok(
    quotaQueries.every((query) => query.endsWith("FOR UPDATE OF a")),
    "Quota checks must not strongly lock users rows needed by child-table foreign keys."
  );
});

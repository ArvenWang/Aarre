import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../config.js";
import { createDatabase } from "../db.js";
import { applyMigrations } from "../migrations.js";

const config = loadConfig();
const database = createDatabase(config.DATABASE_URL);
const currentDirectory = dirname(fileURLToPath(import.meta.url));
const migrationDirectory = resolve(currentDirectory, "../../migrations");
const client = await database.connect();
try {
  const applied = await applyMigrations(client, migrationDirectory);
  process.stdout.write(`${applied.length ? applied.join("\n") : "No pending migrations."}\n`);
} finally {
  client.release();
  await database.end();
}

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createDatabase } from "./db.js";
import { applyMigrations } from "./migrations.js";
import { createRuntime } from "./runtime.js";
import { MaintenanceService } from "./maintenance.js";
import {
  captureOperationalError,
  flushErrorReporting,
  initializeErrorReporting
} from "./observability.js";

const config = loadConfig();
initializeErrorReporting(config);

async function main(): Promise<void> {
  const database = createDatabase(config.DATABASE_URL);
  const currentDirectory = dirname(fileURLToPath(import.meta.url));
  const migrationDirectory = resolve(currentDirectory, "../migrations");
  const client = await database.connect();
  try {
    await applyMigrations(client, migrationDirectory);
  } finally {
    client.release();
  }

  const runtime = createRuntime(config, database);
  const { app, services } = await buildApp({ config, database, ...runtime });
  const maintenanceService = new MaintenanceService(database);

  const maintenance = setInterval(() => {
    const deleteJobs = runtime.objectStore.backupDeletionConfigured
      ? services.assets.processDeleteJobs()
      : Promise.resolve({ processed: 0, failed: 0 });
    void deleteJobs
      .then(() => services.account.finalizeDeletions())
      .catch((error) => {
        app.log.error({ err: error }, "maintenance job failed");
        captureOperationalError(error, "maintenance");
      });
  }, 30_000);
  maintenance.unref();

  const retentionMaintenance = setInterval(() => {
    void maintenanceService.cleanup()
      .catch((error) => {
        app.log.error({ err: error }, "retention maintenance failed");
        captureOperationalError(error, "retention");
      });
  }, 60 * 60_000);
  retentionMaintenance.unref();

  async function shutdown(signal: string) {
    app.log.info({ signal }, "shutting down");
    clearInterval(maintenance);
    clearInterval(retentionMaintenance);
    await app.close();
    await database.end();
    await flushErrorReporting();
  }

  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));

  await app.listen({ host: config.HOST, port: config.PORT });
}

try {
  await main();
} catch (error) {
  captureOperationalError(error, "startup");
  await flushErrorReporting();
  throw error;
}

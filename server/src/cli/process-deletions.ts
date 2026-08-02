import { AssetService } from "../assets.js";
import { AccountService } from "../account.js";
import { loadConfig } from "../config.js";
import { createDatabase } from "../db.js";
import { createRuntime } from "../runtime.js";

const config = loadConfig();
const database = createDatabase(config.DATABASE_URL);
try {
  const runtime = createRuntime(config, database);
  if (!runtime.objectStore.backupDeletionConfigured) {
    throw new Error("The deletion worker requires the dedicated backup CAM identity.");
  }
  const assets = new AssetService(database, runtime.objectStore, config, runtime.encryption);
  const accounts = new AccountService(database, runtime.encryption);
  const result = await assets.processDeleteJobs(250);
  const finalizedAccounts = await accounts.finalizeDeletions();
  process.stdout.write(JSON.stringify({ ...result, finalizedAccounts }) + "\n");
} finally {
  await database.end();
}

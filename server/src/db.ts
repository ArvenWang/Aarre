import pg from "pg";

const { Pool } = pg;

export type Database = InstanceType<typeof Pool>;

export function createDatabase(connectionString: string): Database {
  return new Pool({
    connectionString,
    max: 8,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: "aarre-sync-api"
  });
}

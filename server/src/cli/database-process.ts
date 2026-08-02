import { spawn } from "node:child_process";

export function postgresEnvironment(connectionString: string): NodeJS.ProcessEnv {
  const parsed = new URL(connectionString);
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error("Database URL must use the postgres protocol.");
  }
  return {
    ...process.env,
    PGHOST: parsed.hostname,
    PGPORT: parsed.port || "5432",
    PGUSER: decodeURIComponent(parsed.username),
    PGPASSWORD: decodeURIComponent(parsed.password),
    PGDATABASE: decodeURIComponent(parsed.pathname.replace(/^\//, "")),
    PGSSLMODE: parsed.searchParams.get("sslmode") || process.env.PGSSLMODE || "prefer"
  };
}

export async function runDatabaseTool(
  command: string,
  args: string[],
  connectionString: string
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      env: postgresEnvironment(connectionString),
      stdio: ["ignore", "inherit", "inherit"]
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} failed (${signal || `exit ${code ?? "unknown"}`}).`));
    });
  });
}

export async function databaseToolOutput(
  command: string,
  args: string[],
  connectionString: string
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, {
      env: postgresEnvironment(connectionString),
      stdio: ["ignore", "pipe", "pipe"]
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve(Buffer.concat(stdout).toString("utf8").trim());
      else reject(new Error(
        `${command} failed (${signal || `exit ${code ?? "unknown"}`}): ${Buffer.concat(stderr).toString("utf8").trim().slice(0, 500)}`
      ));
    });
  });
}

export async function databaseToolMajor(command: string, connectionString: string): Promise<number> {
  const output = await databaseToolOutput(command, ["--version"], connectionString);
  const match = /PostgreSQL\)\s+(\d+)\./.exec(output);
  const major = Number(match?.[1] || 0);
  if (!Number.isInteger(major) || major < 10) {
    throw new Error(`Unable to determine ${command} major version.`);
  }
  return major;
}

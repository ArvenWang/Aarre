import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { PoolClient } from "pg";

/**
 * PostgreSQL's simple protocol accepts a whole file, but some production
 * connection paths reject a multi-command message with 08P01. Execute one
 * statement at a time while preserving semicolons inside strings, comments,
 * quoted identifiers, and dollar-quoted function bodies.
 */
export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let state: "normal" | "single" | "double" | "line-comment" | "block-comment" | "dollar" = "normal";
  let dollarTag = "";

  const push = () => {
    const statement = current.trim();
    if (statement) statements.push(statement);
    current = "";
  };

  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index];
    const next = sql[index + 1] || "";

    if (state === "normal") {
      if (character === "-" && next === "-") {
        current += character + next;
        index += 1;
        state = "line-comment";
      } else if (character === "/" && next === "*") {
        current += character + next;
        index += 1;
        state = "block-comment";
      } else if (character === "'") {
        current += character;
        state = "single";
      } else if (character === '"') {
        current += character;
        state = "double";
      } else if (character === "$") {
        const match = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(sql.slice(index));
        if (match) {
          dollarTag = match[0];
          current += dollarTag;
          index += dollarTag.length - 1;
          state = "dollar";
        } else {
          current += character;
        }
      } else if (character === ";") {
        push();
      } else {
        current += character;
      }
      continue;
    }

    current += character;
    if (state === "single" && character === "'") {
      if (next === "'") {
        current += next;
        index += 1;
      } else {
        state = "normal";
      }
    } else if (state === "double" && character === '"') {
      if (next === '"') {
        current += next;
        index += 1;
      } else {
        state = "normal";
      }
    } else if (state === "line-comment" && character === "\n") {
      state = "normal";
    } else if (state === "block-comment" && character === "*" && next === "/") {
      current += next;
      index += 1;
      state = "normal";
    } else if (state === "dollar" && sql.startsWith(dollarTag, index)) {
      current += dollarTag.slice(1);
      index += dollarTag.length - 1;
      state = "normal";
      dollarTag = "";
    }
  }

  if (state !== "normal" && state !== "line-comment") {
    throw new Error(`Migration SQL ended inside ${state}.`);
  }
  push();
  return statements;
}

export function isMigrationFilename(name: string): boolean {
  return name.endsWith(".sql") && !name.startsWith("._");
}

export async function applyMigrations(
  client: PoolClient,
  migrationDirectory: string
): Promise<string[]> {
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    filename text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  await client.query("SELECT pg_advisory_lock(hashtext('aarre-schema-migrations'))");
  const appliedNow: string[] = [];
  try {
    const appliedResult = await client.query("SELECT filename FROM schema_migrations");
    const applied = new Set<string>(
      appliedResult.rows.map((row: { filename: string }) => row.filename)
    );
    const files = (await readdir(migrationDirectory))
      .filter(isMigrationFilename)
      .sort();
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = await readFile(resolve(migrationDirectory, file), "utf8");
      const statements = splitSqlStatements(sql);
      if (!statements.length) {
        throw new Error(`Migration ${file} does not contain an SQL statement.`);
      }
      await client.query("BEGIN");
      try {
        for (const statement of statements) await client.query(statement);
        await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [file]);
        await client.query("COMMIT");
        appliedNow.push(file);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
    return appliedNow;
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext('aarre-schema-migrations'))");
  }
}

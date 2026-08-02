import assert from "node:assert/strict";
import test from "node:test";
import {
  isMigrationFilename,
  splitSqlStatements
} from "../src/migrations.js";

test("migration discovery rejects macOS AppleDouble sidecar files", () => {
  assert.equal(isMigrationFilename("007_folder_protection.sql"), true);
  assert.equal(isMigrationFilename("._007_folder_protection.sql"), false);
  assert.equal(isMigrationFilename("007_folder_protection.sql.bak"), false);
});

test("migration SQL is split only at top-level semicolons", () => {
  const statements = splitSqlStatements(`
    -- a semicolon in a comment; stays here
    CREATE TABLE "semi;colon" (value text DEFAULT 'a;''b');
    /* block; comment */
    CREATE FUNCTION sample() RETURNS void AS $body$
    BEGIN
      PERFORM 'inside;function';
    END;
    $body$ LANGUAGE plpgsql;
    INSERT INTO "semi;colon" VALUES ('done');
  `);

  assert.equal(statements.length, 3);
  assert.match(statements[0], /CREATE TABLE/);
  assert.match(statements[1], /inside;function/);
  assert.match(statements[2], /INSERT INTO/);
});

test("migration SQL rejects unfinished quoted input", () => {
  assert.throws(
    () => splitSqlStatements("SELECT 'unfinished;"),
    /ended inside single/
  );
});

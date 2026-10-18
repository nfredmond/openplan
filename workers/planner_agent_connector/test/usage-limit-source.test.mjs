import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
const migrations = new URL("../../../openplan/supabase/migrations/", import.meta.url);
const candidateName = "20261017000018_assistant_usage_limit_receipts.sql";
const withoutComments = text => text.replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, "");
const searchPath = header => /SET\s+search_path\s*=\s*([a-z_,\s]+?)(?:\s+AS\s+\$\$|;)/i.exec(header)?.[1].replace(/\s/g, "");

// Read CREATE headers and subsequent ALTER configuration, not just function bodies.
test("SQL18 preserves the effective hardened finish path across every intervening migration", async () => {
  const amendments = [];
  for (const name of (await readdir(migrations)).filter(name => name.endsWith(".sql") && name < candidateName).sort()) {
    const sql = withoutComments(await readFile(new URL(name, migrations), "utf8"));
    for (const match of sql.matchAll(/(?:CREATE(?: OR REPLACE)? FUNCTION\s+public\.finish_assistant_provider_turn\b[\s\S]*?\bAS\s+\$\$|ALTER FUNCTION\s+public\.finish_assistant_provider_turn\([^;]*?\)\s+SET\s+search_path[^;]*;)/gi)) {
      const path = searchPath(match[0]);
      if (path) amendments.push({ migration: name, path });
    }
  }
  assert.equal(amendments.at(-1)?.migration, "20261014000032_application_temporary_schema_order.sql", "Effective baseline configuration amendment was missed");
  assert.equal(amendments.at(-1)?.path, "pg_catalog,public,pg_temp");
  const sql = withoutComments(await readFile(new URL(candidateName, migrations), "utf8"));
  const header = /CREATE OR REPLACE FUNCTION public\.finish_assistant_provider_turn\b[\s\S]*?\bAS\s+\$\$/i.exec(sql)?.[0];
  assert.ok(header, "Finish function header missing");
  assert.equal(searchPath(header), amendments.at(-1).path, "Finish must preserve explicit pg_temp last");
  assert.match(header, /SECURITY DEFINER/i);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.finish_assistant_provider_turn\([^;]+\) FROM PUBLIC,anon,authenticated;/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.finish_assistant_provider_turn\([^;]+\) TO service_role;/);
});

test("SQL18 new validator uses trusted schemas before explicit pg_temp and stays service-only", async () => {
  const sql = withoutComments(await readFile(new URL(candidateName, migrations), "utf8"));
  const header = /CREATE FUNCTION public\.valid_assistant_native_limit_receipt\b[\s\S]*?\bAS\s+\$\$/i.exec(sql)?.[0];
  assert.ok(header, "Validator function header missing");
  assert.equal(searchPath(header), "pg_catalog,public,pg_temp", "Validator must keep explicit pg_temp last");
  assert.match(header, /IMMUTABLE/i);
  assert.doesNotMatch(header, /SECURITY DEFINER/i);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.valid_assistant_native_limit_receipt\([^;]+\) FROM PUBLIC,anon,authenticated;/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.valid_assistant_native_limit_receipt\([^;]+\) TO service_role;/);
});

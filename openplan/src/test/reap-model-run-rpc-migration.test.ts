import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATIONS_DIR = join(process.cwd(), "supabase/migrations");

// The October 16 migration that made the reaper refuse running, started and
// attempt-managed work (PR 177). The live definition may be newer, never older.
const RECOVERY_BOUNDARY_MIGRATION = "20261016000022_model_reaper_recovery_boundary.sql";

/**
 * SQL text with `--` comments removed, lowercased, whitespace collapsed and no
 * spaces beside commas, comparison operators or inside parentheses, so formatting changes do not move the assertions
 * and a comment describing the refusal cannot stand in for the refusal.
 * Limit: a `--` inside a string literal would also be cut; the reaper body has none.
 */
function normalizeSql(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\s*([,=<>])\s*/g, "$1")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .trim();
}

/** Split on `or` at parenthesis depth zero. */
function topLevelDisjuncts(condition: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < condition.length; index += 1) {
    const char = condition[index];
    if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
    else if (depth === 0 && condition.startsWith(" or ", index)) {
      parts.push(condition.slice(start, index).trim());
      start = index + " or ".length;
      index += " or ".length - 1;
    }
  }
  parts.push(condition.slice(start).trim());
  return parts;
}

const CREATE_REAPER = /create (?:or replace )?function public\.reap_model_run_if_stale\(/;

/**
 * Every migration whose code (not its comments) creates the reaper, in apply
 * order. The last one is the definition a fresh database ends up with, so a
 * future redefinition is checked by the same assertions without editing this file.
 */
function reaperDefinitions(): Array<{ file: string; sql: string }> {
  return readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => ({ file, sql: normalizeSql(readFileSync(join(MIGRATIONS_DIR, file), "utf8")) }))
    .filter(({ sql }) => CREATE_REAPER.test(sql));
}

/** The function body from its CREATE statement to the closing `$$;`. */
function reaperBody(sql: string): string {
  const start = sql.search(CREATE_REAPER);
  const end = sql.indexOf("$$;", start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return sql.slice(start, end);
}

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260722000004_reap_model_run_rpc.sql"),
  "utf8"
);

const lockdown = readFileSync(
  join(process.cwd(), "supabase/migrations/20260722000005_reap_rpc_lock_down.sql"),
  "utf8"
);

describe("reap_model_run_if_stale migration", () => {
  it("defines the reaper function with the documented signature", () => {
    expect(migration).toMatch(/create or replace function public\.reap_model_run_if_stale\(/);
    expect(migration).toMatch(/p_run_id uuid/);
    expect(migration).toMatch(/p_stale_before timestamptz/);
    expect(migration).toMatch(/p_message text/);
    expect(migration).toMatch(/returns boolean/);
  });

  it("re-validates progress across BOTH tables before flipping status (race-free guard)", () => {
    // Run row untouched since snapshot...
    expect(migration).toMatch(/r\.updated_at <= p_stale_before/);
    // ...and no stage has progressed since snapshot.
    expect(migration).toMatch(/not exists/i);
    expect(migration).toMatch(/s\.updated_at > p_stale_before/);
    // Only ever transitions non-terminal rows.
    expect(migration).toMatch(/status in \('queued', 'running'\)/);
  });

  it("locks execute down to the service role only", () => {
    expect(migration).toMatch(
      /revoke all on function public\.reap_model_run_if_stale\(uuid, timestamptz, text\) from public/
    );
    expect(migration).toMatch(
      /grant execute on function public\.reap_model_run_if_stale\(uuid, timestamptz, text\) to service_role/
    );
  });
});

describe("reap_model_run_if_stale lockdown migration", () => {
  it("explicitly revokes execute from anon and authenticated (Supabase default-privilege grants)", () => {
    // REVOKE ... FROM PUBLIC does NOT remove the direct anon/authenticated
    // grants Supabase default privileges add to new public functions — without
    // this an unauthenticated caller could force-fail any run via /rpc.
    expect(lockdown).toMatch(
      /revoke all on function public\.reap_model_run_if_stale\(uuid, timestamptz, text\) from anon, authenticated/
    );
    expect(lockdown).toMatch(
      /grant execute on function public\.reap_model_run_if_stale\(uuid, timestamptz, text\) to service_role/
    );
  });
});

describe("reap_model_run_if_stale latest definition (recovery boundary)", () => {
  const definitions = reaperDefinitions();
  const latest = definitions[definitions.length - 1];

  it("finds every redefinition and treats the newest as the live one", () => {
    const files = definitions.map(({ file }) => file);
    // Proves the scan sees more than one definition, so "latest" is a real choice.
    expect(files).toContain("20260722000004_reap_model_run_rpc.sql");
    expect(files).toContain(RECOVERY_BOUNDARY_MIGRATION);
    // The live definition is the October boundary or a later redefinition.
    expect(latest.file >= RECOVERY_BOUNDARY_MIGRATION).toBe(true);
  });

  it("refuses running, attempt-managed and started work before any write", () => {
    const body = reaperBody(latest.sql);
    const refusals = [...body.matchAll(/\bif ([^;]*?) then return false;/g)];
    const boundary = refusals.find((match) => match[1].includes("model_stage_execution_starts"));
    expect(boundary, `${latest.file} has no refusal that reads model_stage_execution_starts`).toBeDefined();

    // Each condition alone must refuse, so they are separate top-level ORs.
    expect(topLevelDisjuncts(boundary![1])).toEqual(
      expect.arrayContaining([
        // A running run is started work.
        "v_run.status<>'queued'",
        // Attempt-managed work recovers through its attempt, not through age.
        "v_run.attempt_managed",
        // A retained start row is proof the stage began computing.
        "exists (select 1 from public.model_stage_execution_starts where run_id=p_run_id)",
        // Historical work without start rows: any stage past queued has started.
        "exists (select 1 from public.model_run_stages where run_id=p_run_id and status<>'queued')",
      ])
    );

    const firstWrite = Math.min(
      ...["insert into public.", "update public.", "delete from public."]
        .map((verb) => body.indexOf(verb))
        .filter((index) => index >= 0)
    );
    expect(Number.isFinite(firstWrite)).toBe(true);
    expect(boundary!.index).toBeLessThan(firstWrite);
  });

  it("runs as a definer with an empty search path, and execute is never granted to callers", () => {
    expect(reaperBody(latest.sql)).toContain("security definer set search_path=''");
    const grants = readdirSync(MIGRATIONS_DIR)
      .filter((file) => file.endsWith(".sql"))
      .flatMap((file) => normalizeSql(readFileSync(join(MIGRATIONS_DIR, file), "utf8")).split(";"))
      .filter((statement) => /grant [^;]*on function public\.reap_model_run_if_stale\(/.test(statement));
    // The service-role grant is found, so the empty result below is not vacuous.
    expect(grants.some((statement) => /\bto service_role\b/.test(statement))).toBe(true);
    const grantsToCallers = grants.filter((statement) =>
      /\bto [^;]*\b(public|anon|authenticated)\b/.test(statement)
    );
    expect(grantsToCallers).toEqual([]);
  });
});

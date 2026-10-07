import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { LIVE_RLS } from "./local-supabase-env";
import { resolveLocalDbContainer } from "./helpers/live-catalog";
import { requireContractVerificationStack } from "./helpers/contract-verification-stack";

it.skipIf(!LIVE_RLS)("retains exact context commands with database attribution, fresh permission, stale-write and freeze checks", () => {
  const container = resolveLocalDbContainer();
  requireContractVerificationStack(container);
  // This opt-in probes unapplied candidate DDL inside the same rollback-only transaction.
  const migration = process.env.OPENPLAN_CONTEXT_MIGRATION_PROBE === "1"
    ? readFileSync("supabase/migrations/20261016000002_land_use_plan_context.sql", "utf8") : "";
  const retainedMigration = process.env.OPENPLAN_CONTEXT_RETAINED_MIGRATION_PROBE === "1"
    ? readFileSync("supabase/migrations/20261016000006_land_use_plan_retained_study_area.sql", "utf8") : "";
  const fixture = readFileSync("src/test/fixtures/land-use-plans/context-persistence.sql", "utf8");
  const result = spawnSync("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-qAt", "-v", "ON_ERROR_STOP=1"], {
    input: `BEGIN; SET LOCAL statement_timeout = '15s'; ${migration}\n${retainedMigration}\n${fixture}\nROLLBACK;`, encoding: "utf8", timeout: 25_000,
  });
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain("context persistence verified");
}, 30_000);

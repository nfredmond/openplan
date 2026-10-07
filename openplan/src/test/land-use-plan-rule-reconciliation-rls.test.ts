import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { LIVE_RLS } from "./local-supabase-env";
import { resolveLocalDbContainer } from "./helpers/live-catalog";
import { requireContractVerificationStack } from "./helpers/contract-verification-stack";

it.skipIf(!LIVE_RLS)("reconciles current plan rules atomically while preserving authored and frozen records", () => {
  const container = resolveLocalDbContainer(); requireContractVerificationStack(container);
  const migration = process.env.OPENPLAN_RECONCILIATION_MIGRATION_PROBE === "1"
    ? readFileSync("supabase/migrations/20261016000010_land_use_plan_rule_reconciliation.sql", "utf8") : "";
  const fixture = readFileSync("src/test/fixtures/land-use-plans/rule-reconciliation.sql", "utf8");
  const result = spawnSync("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-qAt", "-v", "ON_ERROR_STOP=1"], {
    input: `BEGIN; SET LOCAL statement_timeout='15s'; ${migration}\n${fixture}\nROLLBACK;`, encoding: "utf8", timeout: 25_000,
  });
  expect(result.error).toBeUndefined(); expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain("atomic plan rule reconciliation verified");
}, 30_000);

it.skipIf(!LIVE_RLS)("holds plan, permission and version locks across two native sessions", () => {
  const container = resolveLocalDbContainer(); requireContractVerificationStack(container);
  const ids = Object.fromEntries(["ACTOR", "OTHER_OWNER", "WORKSPACE", "PLAN", "VERSION", "COMMAND"].map(key => [key, randomUUID()]));
  const migration = process.env.OPENPLAN_RECONCILIATION_MIGRATION_PROBE === "1"
    ? readFileSync("supabase/migrations/20261016000010_land_use_plan_rule_reconciliation.sql", "utf8") : "";
  const fixture = readFileSync("src/test/fixtures/land-use-plans/rule-reconciliation-locks.sql", "utf8")
    .replace(/__(ACTOR|OTHER_OWNER|WORKSPACE|PLAN|VERSION|COMMAND)__/g, (_match, key: string) => ids[key]);
  const exercise = fixture.indexOf("DO $test$");
  if (exercise < 0) throw new Error("The native locking exercise is missing");
  const run = (input: string) => spawnSync("docker", ["exec", "-i", container, "psql", "-U", "supabase_admin", "-d", "postgres", "-qAt", "-v", "ON_ERROR_STOP=1"], {
    input, encoding: "utf8", timeout: 25_000,
  });
  let result: ReturnType<typeof run> | undefined;
  let cleanup: ReturnType<typeof run> | undefined;
  try {
    // Seed before the migration probe takes foreign-key DDL locks on parents.
    result = run(`BEGIN; SET LOCAL statement_timeout='5s'; ${fixture.slice(0, exercise)}\n${migration}\n${fixture.slice(exercise)}\nROLLBACK;`);
  } finally {
    // The peer committed only this test's randomly named synthetic fixtures.
    cleanup = run(`BEGIN; SET LOCAL statement_timeout='5s';
      DELETE FROM public.workspaces WHERE id='${ids.WORKSPACE}' AND name='SYNTHETIC reconciliation lock fixture';
      DELETE FROM public.workspaces w WHERE w.name IN ('${ids.ACTOR}','${ids.OTHER_OWNER}')
        AND EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.workspace_id=w.id AND m.user_id IN ('${ids.ACTOR}','${ids.OTHER_OWNER}') AND m.role='owner')
        AND NOT EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.workspace_id=w.id AND m.user_id NOT IN ('${ids.ACTOR}','${ids.OTHER_OWNER}'));
      DELETE FROM auth.users WHERE id IN ('${ids.ACTOR}','${ids.OTHER_OWNER}') AND email LIKE '%@synthetic.invalid';
      COMMIT;
      SELECT count(*) FROM public.workspaces WHERE id='${ids.WORKSPACE}';
      SELECT count(*) FROM auth.users WHERE id IN ('${ids.ACTOR}','${ids.OTHER_OWNER}');`);
    if (result?.status !== 0 || cleanup.status !== 0) console.error({ syntheticFixtureIds: ids, nativeError: result?.stderr, cleanupError: cleanup.stderr });
  }
  expect(result?.error).toBeUndefined(); expect(result?.status, result?.stderr).toBe(0);
  expect(result?.stdout).toContain("plan rule reconciliation locks verified");
  expect(cleanup?.error).toBeUndefined(); expect(cleanup?.status, cleanup?.stderr).toBe(0);
  expect(cleanup?.stdout.trim()).toBe("0\n0");
}, 30_000);

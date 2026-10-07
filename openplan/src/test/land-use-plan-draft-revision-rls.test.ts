import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { LIVE_RLS } from "./local-supabase-env";
import { resolveLocalDbContainer } from "./helpers/live-catalog";
import { requireContractVerificationStack } from "./helpers/contract-verification-stack";

it.skipIf(!LIVE_RLS)("advances exact draft revisions for mutable freeze inputs while protecting frozen ownership and counters", () => {
  const container = resolveLocalDbContainer();
  requireContractVerificationStack(container);
  const migration = process.env.OPENPLAN_DRAFT_REVISION_MIGRATION_PROBE === "1"
    ? readFileSync("supabase/migrations/20261016000003_land_use_plan_draft_revision.sql", "utf8") : "";
  const fixture = readFileSync("src/test/fixtures/land-use-plans/draft-revision.sql", "utf8");
  const result = spawnSync("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-qAt", "-v", "ON_ERROR_STOP=1"], {
    input: `BEGIN; SET LOCAL statement_timeout = '15s'; ${migration}\n${fixture}\nROLLBACK;`, encoding: "utf8", timeout: 25_000,
  });
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain("draft revision verified");
}, 30_000);

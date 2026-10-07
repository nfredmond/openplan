import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { LIVE_RLS } from "./local-supabase-env";
import { resolveLocalDbContainer } from "./helpers/live-catalog";
import { requireContractVerificationStack } from "./helpers/contract-verification-stack";

it.skipIf(!LIVE_RLS)("stops an exact creation request or returns its existing plan under current native permissions", () => {
  const container = resolveLocalDbContainer(); requireContractVerificationStack(container);
  const migration = process.env.OPENPLAN_CREATION_CANCELLATION_PROBE === "1"
    ? readFileSync("supabase/migrations/20261016000008_land_use_plan_creation_cancellation.sql", "utf8") : "";
  const fixture = readFileSync("src/test/fixtures/land-use-plans/creation-cancellation.sql", "utf8");
  const result = spawnSync("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-qAt", "-v", "ON_ERROR_STOP=1"], {
    input: `BEGIN; SET LOCAL statement_timeout='15s'; ${migration}\n${fixture}\nROLLBACK;`, encoding: "utf8", timeout: 25_000,
  });
  expect(result.error).toBeUndefined(); expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain("creation cancellation verified");
}, 30_000);

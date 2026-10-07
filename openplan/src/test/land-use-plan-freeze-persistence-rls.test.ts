import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { LIVE_RLS } from "./local-supabase-env";
import { resolveLocalDbContainer } from "./helpers/live-catalog";
import { requireContractVerificationStack } from "./helpers/contract-verification-stack";

it.skipIf(!LIVE_RLS)("freezes exact current content with one event and permission-checked replay in one transaction", () => {
  const container = resolveLocalDbContainer();
  requireContractVerificationStack(container);
  const migration = process.env.OPENPLAN_FREEZE_MIGRATION_PROBE === "1"
    ? ["20261016000004_land_use_plan_freeze_commands.sql", "20261016000005_land_use_plan_freeze_server_path.sql"]
      .map(name => readFileSync(`supabase/migrations/${name}`, "utf8")).join("\n") : "";
  const fixture = readFileSync("src/test/fixtures/land-use-plans/freeze-persistence.sql", "utf8");
  const result = spawnSync("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-qAt", "-v", "ON_ERROR_STOP=1"], {
    input: `BEGIN; SET LOCAL statement_timeout = '15s'; ${migration}\n${fixture}\nROLLBACK;`, encoding: "utf8", timeout: 25_000,
  });
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain("freeze persistence verified");
}, 30_000);

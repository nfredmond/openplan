import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { LIVE_RLS } from "./local-supabase-env";
import { resolveLocalDbContainer } from "./helpers/live-catalog";
import { requireContractVerificationStack } from "./helpers/contract-verification-stack";

it.skipIf(!LIVE_RLS).each([
  ["creation", false], ["freeze-persistence", false], ["freeze-persistence", true],
  ["context-persistence", false], ["context-persistence", true], ["draft-revision", false],
  ["gis-cascade", false], ["gis-cascade", true],
] as const)("preserves direct-write guards with reordered cascades: %s workspace=%s", (name, workspace) => {
  const container = resolveLocalDbContainer();
  requireContractVerificationStack(container);
  const migration = process.env.OPENPLAN_CASCADE_MIGRATION_PROBE === "1"
    ? readFileSync("supabase/migrations/20261016000009_land_use_plan_cascade_guards.sql", "utf8") : "";
  const gisMigration = process.env.OPENPLAN_GIS_CASCADE_MIGRATION_PROBE === "1"
    ? readFileSync("supabase/migrations/20261016000011_workspace_gis_cascade_guards.sql", "utf8") : "";
  const order = readFileSync("src/test/fixtures/land-use-plans/cascade-order.sql", "utf8");
  const fixture = readFileSync(`src/test/fixtures/land-use-plans/${name}.sql`, "utf8");
  const result = spawnSync("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-qAt", "-v", "ON_ERROR_STOP=1"], {
    input: `BEGIN; SET LOCAL statement_timeout='15s'; SET LOCAL lock_timeout='3s';
      SET LOCAL openplan.test_cascade_workspace='${workspace ? "1" : "0"}';
      ${migration}\n${gisMigration}\n${order}\n${fixture}\nROLLBACK;`, encoding: "utf8", timeout: 25_000,
  });
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain(name === "creation" ? "atomic plan creation verified" : `${name.replace("-", " ")} verified`);
}, 30_000);

it.skipIf(!LIVE_RLS).each(["plan-first", "release-first"] as const)("preserves review-release guards through plan and workspace cascades: %s", (order) => {
  const container = resolveLocalDbContainer();
  requireContractVerificationStack(container);
  const migration = process.env.OPENPLAN_REVIEW_RELEASE_CASCADE_MIGRATION_PROBE === "1"
    ? readFileSync("supabase/migrations/20261023190400_land_use_review_release_cascade_guards.sql", "utf8") : "";
  const fixture = readFileSync("src/test/fixtures/land-use-plans/review-release-cascade.sql", "utf8");
  const result = spawnSync("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-qAt", "-v", "ON_ERROR_STOP=1"], {
    input: `BEGIN; SET LOCAL statement_timeout='15s'; SET LOCAL lock_timeout='3s';
      SET LOCAL openplan.test_review_release_cascade_order='${order}';
      ${migration}\n${fixture}\nROLLBACK;`, encoding: "utf8", timeout: 25_000,
  });
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain(`review release plan cascade verified: ${order}`);
  expect(result.stdout).toContain(`review release workspace cascade verified: ${order}`);
}, 30_000);

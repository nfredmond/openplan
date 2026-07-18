import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const bucketMigrationSql = readFileSync(
  join(process.cwd(), "supabase/migrations/20260718000086_run_artifacts_bucket.sql"),
  "utf8",
);
const engineKeyMigrationSql = readFileSync(
  join(process.cwd(), "supabase/migrations/20260718000087_model_runs_engine_key_behavioral.sql"),
  "utf8",
);

describe("run-artifacts bucket migration", () => {
  it("provisions the bucket as private and idempotent", () => {
    expect(bucketMigrationSql).toMatch(/INSERT INTO storage\.buckets/i);
    expect(bucketMigrationSql).toMatch(/'run-artifacts',\s*\n?\s*'run-artifacts',\s*\n?\s*false/i);
    expect(bucketMigrationSql).toMatch(/ON CONFLICT \(id\) DO NOTHING/i);
  });

  it("forces out-of-band-provisioned buckets private", () => {
    expect(bucketMigrationSql).toMatch(
      /UPDATE storage\.buckets SET public = false WHERE id = 'run-artifacts' AND public/i,
    );
  });

  it("repairs legacy public artifact URLs into storage:// references", () => {
    expect(bucketMigrationSql).toMatch(/UPDATE model_run_artifacts/i);
    expect(bucketMigrationSql).toMatch(/storage:\/\/run-artifacts\//);
    expect(bucketMigrationSql).toMatch(/\/object\/public\/run-artifacts\//);
  });

  it("stays service-role-only — no storage.objects policies", () => {
    // Object paths carry no workspace prefix; reads are proxied through authed
    // API routes, so a storage-level policy would be a false grant surface.
    expect(bucketMigrationSql).not.toMatch(/CREATE POLICY/i);
  });
});

describe("model_runs engine_key migration", () => {
  it("swaps the CHECK constraint behind an existence guard", () => {
    expect(engineKeyMigrationSql).toMatch(/IF EXISTS \(\s*SELECT 1 FROM pg_constraint/i);
    expect(engineKeyMigrationSql).toMatch(/conname = 'model_runs_engine_key_check'/i);
    expect(engineKeyMigrationSql).toMatch(/DROP CONSTRAINT model_runs_engine_key_check/i);
    expect(engineKeyMigrationSql).toMatch(/ADD CONSTRAINT model_runs_engine_key_check/i);
  });

  it("permits every registry engine key including behavioral_demand", () => {
    for (const engineKey of [
      "deterministic_corridor_v1",
      "aequilibrae",
      "activitysim",
      "behavioral_demand",
    ]) {
      expect(engineKeyMigrationSql).toContain(`'${engineKey}'`);
    }
  });
});

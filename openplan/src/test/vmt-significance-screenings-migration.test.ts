import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { loadPolicyInventory } from "./migrations/policy-inventory";
import { loadSchemaInventory } from "./migrations/schema-inventory";
import { VMT_SIGNIFICANCE_SCREENING_COLUMNS } from "@/lib/planner-pack/vmt-screening-records";

/**
 * A stored VMT significance determination cannot lose the facts that make it
 * interpretable, and cannot be rewritten after the fact.
 *
 * Structural assertions run against the parsed migrations, so they hold with no
 * live database — the same arrangement `project_bca_screenings-migration` uses.
 */

const migrationSql = readFileSync(
  join(process.cwd(), "supabase/migrations/20260728000012_vmt_significance_screenings.sql"),
  "utf8"
);

const schema = loadSchemaInventory();
const policies = loadPolicyInventory();

describe("vmt_significance_screenings migration", () => {
  it("records the determination, its inputs, its run, and when — append-only", () => {
    expect(schema.tables()).toContain("vmt_significance_screenings");
    expect(migrationSql).toMatch(
      /workspace_id UUID NOT NULL REFERENCES public\.workspaces\(id\) ON DELETE CASCADE/i
    );

    for (const column of [
      "determination",
      "mitigation_required",
      "vmt_per_capita",
      "threshold_vmt_per_capita",
      "reference_vmt_per_capita",
      "threshold_pct",
      "reference_label",
      "project_type",
      "vmt_kpi_name",
      "scenario_id",
      "inputs_json",
      "result_json",
      "engine_version",
      "created_at",
      "created_by",
    ]) {
      expect(schema.hasColumn("vmt_significance_screenings", column), `missing ${column}`).toBe(true);
    }

    // Append-only. A determination is a historical fact: it was issued, that
    // day, from those inputs. No UPDATE or DELETE policy, and no such grant.
    expect(policies.permissiveGrants("vmt_significance_screenings", "UPDATE")).toEqual([]);
    expect(policies.permissiveGrants("vmt_significance_screenings", "DELETE")).toEqual([]);
    expect(migrationSql).not.toMatch(
      /GRANT[^;]*\b(UPDATE|DELETE)\b[^;]*ON TABLE public\.vmt_significance_screenings TO authenticated/i
    );
  });

  it("binds every row to exactly one run, model or county", () => {
    expect(schema.hasColumn("vmt_significance_screenings", "model_run_id")).toBe(true);
    expect(schema.hasColumn("vmt_significance_screenings", "county_run_id")).toBe(true);
    expect(schema.childrenOf("model_runs")).toContain("vmt_significance_screenings");
    expect(schema.childrenOf("county_runs")).toContain("vmt_significance_screenings");
    expect(migrationSql).toMatch(/vmt_significance_screenings_one_subject CHECK/i);
  });

  it("carries the jurisdiction basis, so a determination can never travel without whose law it is under", () => {
    for (const column of [
      "framework_id",
      "framework_name",
      "framework_version",
      "jurisdiction_country",
      "jurisdiction_subdivision",
      "jurisdiction_label",
      "jurisdiction_basis",
    ]) {
      expect(schema.hasColumn("vmt_significance_screenings", column), `missing ${column}`).toBe(true);
    }

    // NOT NULL on the country and the label: a row that cannot say which
    // jurisdiction it applies to is exactly the overclaim this column exists to
    // prevent. The subdivision stays nullable because a nationwide framework is
    // a legitimate shape.
    expect(migrationSql).toMatch(/jurisdiction_country TEXT NOT NULL/i);
    expect(migrationSql).toMatch(/jurisdiction_label TEXT NOT NULL/i);
    expect(migrationSql).toMatch(/jurisdiction_subdivision TEXT,/i);

    // The schema names no jurisdiction. California lives in a descriptor file,
    // never in a column default or a CHECK — that is what lets another
    // jurisdiction be added without a migration.
    expect(migrationSql).not.toMatch(/DEFAULT\s+'US'/i);
    expect(migrationSql).not.toMatch(/jurisdiction_country[^;]*CHECK/i);
    expect(migrationSql).not.toMatch(/jurisdiction_subdivision[^;]*CHECK/i);
    expect(migrationSql).not.toMatch(/framework_id[^;]*CHECK/i);
  });

  it("carries the claim tier and its provenance, and will not let them disagree", () => {
    expect(schema.hasColumn("vmt_significance_screenings", "claim_status")).toBe(true);
    expect(schema.hasColumn("vmt_significance_screenings", "claim_status_source")).toBe(true);

    // The same four tiers modeling_claim_decisions uses (20260721000002), so the
    // two rank against each other without translation.
    for (const tier of [
      "claim_grade_passed",
      "calibrated_to_counts",
      "screening_grade",
      "prototype_only",
    ]) {
      expect(migrationSql).toContain(`'${tier}'`);
    }

    // NULLABLE tier + a source that says so. "No claim decision exists" is an
    // answer; substituting a plausible default tier would be inventing evidence.
    expect(migrationSql).not.toMatch(/claim_status TEXT NOT NULL/i);
    expect(migrationSql).toMatch(/claim_status_source TEXT NOT NULL/i);
    expect(migrationSql).toMatch(/vmt_significance_screenings_claim_status_coherent CHECK/i);
  });

  it("records which VMT drove it, so a calibrated basis cannot pass as the screening default", () => {
    expect(schema.hasColumn("vmt_significance_screenings", "input_basis")).toBe(true);
    expect(migrationSql).toMatch(/input_basis TEXT NOT NULL CHECK \(input_basis IN \('screening', 'calibrated'\)\)/i);
  });

  it("denies a viewer through a role-aware write policy rather than a role-blind one", () => {
    expect(schema.rlsEnabled("vmt_significance_screenings")).toBe(true);

    const inserts = policies.permissiveGrants("vmt_significance_screenings", "INSERT");
    expect(inserts.map((policy) => policy.policy)).toEqual([
      "vmt_significance_screenings_writer_insert",
    ]);
    // Role-aware by construction: `workspace_member_can_write` is the shared
    // fail-closed predicate, so this table needs no restrictive writer gate and
    // a viewer cannot write it straight through PostgREST.
    expect(inserts[0].body).toMatch(/public\.workspace_member_can_write\s*\(\s*workspace_id\s*\)/i);
    expect(inserts[0].body).toMatch(/created_by = auth\.uid\(\)/);

    expect(
      policies.permissiveGrants("vmt_significance_screenings", "SELECT").map((policy) => policy.policy)
    ).toEqual(["vmt_significance_screenings_member_read"]);

    expect(migrationSql).toMatch(
      /REVOKE ALL ON TABLE public\.vmt_significance_screenings FROM PUBLIC, anon/i
    );
    expect(migrationSql).toMatch(
      /GRANT SELECT, INSERT ON TABLE public\.vmt_significance_screenings TO authenticated/i
    );
  });

  it("exposes a security_invoker latest-per-run view so a citation needs no row cap", () => {
    expect(schema.isView("vmt_significance_screenings_latest")).toBe(true);
    expect(migrationSql).toMatch(/WITH \(security_invoker = true\)/i);
    expect(migrationSql).toMatch(/SELECT DISTINCT ON \(coalesce\(model_run_id, county_run_id\)\)/i);
    expect(migrationSql).toMatch(/ORDER BY coalesce\(model_run_id, county_run_id\), created_at DESC/i);
    expect(migrationSql).toMatch(
      /GRANT SELECT ON public\.vmt_significance_screenings_latest TO authenticated/i
    );
    expect(migrationSql).toMatch(
      /REVOKE ALL ON public\.vmt_significance_screenings_latest FROM PUBLIC, anon/i
    );
  });

  it("selects only columns the table actually has", () => {
    // `reference-count-projection-guard` cannot check this one: the projection is
    // an imported CONSTANT, which the call-site scanner records as unresolvable
    // and skips. Supabase clients here are untyped, so a typo in that list would
    // surface only at runtime — as PostgREST 42703, which this route reports as
    // "could not read the saved determinations" and, on POST, as the
    // saved-but-unreadable arm. So the list is checked against the parsed schema
    // directly, where the guard cannot reach.
    const missing = VMT_SIGNIFICANCE_SCREENING_COLUMNS.split(",")
      .map((column) => column.trim())
      .filter((column) => !schema.hasColumn("vmt_significance_screenings", column));

    expect(missing).toEqual([]);
  });

  it("indexes the per-run and per-workspace read paths", () => {
    expect(migrationSql).toMatch(
      /vmt_significance_screenings_model_run_idx[\s\S]*model_run_id, created_at DESC/i
    );
    expect(migrationSql).toMatch(
      /vmt_significance_screenings_county_run_idx[\s\S]*county_run_id, created_at DESC/i
    );
    expect(migrationSql).toMatch(
      /vmt_significance_screenings_workspace_idx[\s\S]*workspace_id, created_at DESC/i
    );
  });
});

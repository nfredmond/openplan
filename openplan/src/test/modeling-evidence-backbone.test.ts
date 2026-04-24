import { readFileSync } from "fs";
import { describe, expect, it, vi } from "vitest";

import {
  buildCountyRunModelingEvidenceBundle,
  modelingClaimAllowsOutwardPlanningLanguage,
  modelingClaimReportLanguage,
  refreshCountyRunModelingEvidence,
  resolveModelingClaimDecision,
  type ModelingValidationResultLike,
} from "@/lib/models/evidence-backbone";
import type { CountyOnrampManifest } from "@/lib/models/county-onramp";

const migration = readFileSync("supabase/migrations/20260424000069_modeling_evidence_backbone.sql", "utf8");

function validation(overrides: Partial<ModelingValidationResultLike> = {}): ModelingValidationResultLike {
  return {
    metricKey: "assignment_final_gap",
    metricLabel: "Assignment final gap",
    status: "pass",
    detail: "Assignment converged.",
    observedValue: 0.008,
    thresholdValue: 0.01,
    thresholdComparator: "lte",
    blocksClaimGrade: true,
    ...overrides,
  };
}

const manifest = {
  schema_version: "openplan.county_onramp_manifest.v1",
  generated_at: "2026-03-24T23:00:00Z",
  name: "nevada-county-runtime",
  county_fips: "06057",
  county_prefix: "NEVADA",
  run_dir: "/tmp/nevada",
  mode: "existing-run",
  stage: "validated-screening",
  artifacts: {
    scaffold_csv: "/tmp/scaffold.csv",
    review_packet_md: "/tmp/review.md",
    run_summary_json: "/tmp/run_summary.json",
    bundle_manifest_json: "/tmp/bundle_manifest.json",
    validation_summary_json: "/tmp/validation_summary.json",
  },
  runtime: {
    keep_project: true,
    force: false,
    overall_demand_scalar: 0.369,
    external_demand_scalar: null,
    hbw_scalar: null,
    hbo_scalar: null,
    nhb_scalar: null,
  },
  summary: {
    run: {
      zone_count: 26,
      population_total: 102322,
      jobs_total: 48252,
      loaded_links: 54944,
      final_gap: 0.00955,
      total_trips: 628262.2,
    },
    validation: {
      counts_source_csv: "/data/pilot-nevada-county/validation/caltrans_2023_priority_counts.csv",
      stations_total: 5,
      stations_matched: 5,
      screening_gate: {
        status_label: "internal prototype only",
        required_matches: 3,
        ready_median_ape_threshold: 30,
        ready_critical_ape_threshold: 50,
        reasons: [
          "At least one core facility has 237.62% absolute percent error, above the 50.00% critical-facility threshold.",
        ],
      },
      metrics: {
        median_absolute_percent_error: 27.4,
        mean_absolute_percent_error: 68.75,
        max_absolute_percent_error: 237.62,
        spearman_rho_facility_ranking: 0.4,
      },
    },
    bundle_validation: null,
  },
} as unknown as CountyOnrampManifest;

describe("modeling evidence backbone migration", () => {
  it("creates source manifest, validation result, and claim decision tables with RLS", () => {
    for (const table of ["modeling_source_manifests", "modeling_validation_results", "modeling_claim_decisions"]) {
      expect(migration).toContain(`CREATE TABLE IF NOT EXISTS public.${table}`);
      expect(migration).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
    }
  });

  it("pins trigger function search paths and stores canonical claim statuses", () => {
    expect(migration).toContain("SET search_path = public, pg_catalog");
    expect(migration).toContain("modeling_evidence_target_matches_workspace");
    expect(migration).toContain("CHECK (model_run_id IS NOT NULL OR county_run_id IS NOT NULL)");
    expect(migration).toContain("claim_grade_passed");
    expect(migration).toContain("screening_grade");
    expect(migration).toContain("prototype_only");
  });
});

describe("resolveModelingClaimDecision", () => {
  it("allows claim-grade language when every required metric passes", () => {
    const decision = resolveModelingClaimDecision({
      track: "assignment",
      validationResults: [
        validation({ metricKey: "assignment_final_gap" }),
        validation({ metricKey: "count_station_matches" }),
      ],
      requiredMetricKeys: ["assignment_final_gap", "count_station_matches"],
    });

    expect(decision.claimStatus).toBe("claim_grade_passed");
    expect(modelingClaimAllowsOutwardPlanningLanguage(decision)).toBe(true);
    expect(modelingClaimReportLanguage(decision)).toContain("Claim-grade public-data modeling result");
  });

  it("downgrades to screening grade on warnings or failures", () => {
    const decision = resolveModelingClaimDecision({
      track: "assignment",
      validationResults: [
        validation({ metricKey: "assignment_final_gap" }),
        validation({
          metricKey: "critical_absolute_percent_error",
          status: "fail",
          detail: "Worst matched facility APE 237.62% exceeds the 50% threshold.",
        }),
      ],
      requiredMetricKeys: ["assignment_final_gap", "critical_absolute_percent_error"],
    });

    expect(decision.claimStatus).toBe("screening_grade");
    expect(modelingClaimAllowsOutwardPlanningLanguage(decision)).toBe(false);
    expect(decision.reasons).toContain("Worst matched facility APE 237.62% exceeds the 50% threshold.");
  });

  it("keeps outputs prototype-only when required validation evidence is missing", () => {
    const decision = resolveModelingClaimDecision({
      track: "behavioral_demand",
      validationResults: [validation({ metricKey: "assignment_final_gap" })],
      requiredMetricKeys: ["activitysim_runtime_success"],
      prototypeReasons: ["ActivitySim runtime has not produced a successful executable run."],
    });

    expect(decision.claimStatus).toBe("prototype_only");
    expect(decision.validationSummary.missingRequiredMetricKeys).toEqual(["activitysim_runtime_success"]);
  });
});

describe("buildCountyRunModelingEvidenceBundle", () => {
  it("builds public source manifests, validation rows, and a screening-grade decision for the NCTC-style failure", () => {
    const bundle = buildCountyRunModelingEvidenceBundle({
      workspaceId: "11111111-1111-4111-8111-111111111111",
      countyRunId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      geographyLabel: "Nevada County, CA",
      manifest,
    });

    expect(bundle.sourceManifests.map((source) => source.sourceKey)).toEqual([
      "census_tiger_boundary",
      "census_acs_zone_attributes",
      "osm_road_network",
      "observed_count_validation",
    ]);
    expect(bundle.validationResults.map((result) => result.metricKey)).toEqual([
      "assignment_final_gap",
      "count_station_matches",
      "median_absolute_percent_error",
      "critical_absolute_percent_error",
      "facility_ranking_spearman_rho",
    ]);
    expect(bundle.claimDecision.claimStatus).toBe("screening_grade");
    expect(bundle.claimDecision.statusReason).toContain("237.62%");
  });
});

describe("refreshCountyRunModelingEvidence", () => {
  it("refreshes assignment source manifests, validation results, and the claim decision in order", async () => {
    const calls: string[] = [];
    const sourceSelect = vi.fn(async () => ({
      data: [
        { id: "source-1", source_key: "census_tiger_boundary" },
        { id: "source-2", source_key: "census_acs_zone_attributes" },
        { id: "source-3", source_key: "osm_road_network" },
        { id: "source-4", source_key: "observed_count_validation" },
      ],
      error: null,
    }));
    const validationInsert = vi.fn(async (rows: unknown[]) => {
      calls.push(`insert-validation:${rows.length}`);
      return { error: null };
    });
    const claimInsert = vi.fn(async (row: { claim_status: string }) => {
      calls.push(`insert-claim:${row.claim_status}`);
      return { error: null };
    });
    const sourceUpsert = vi.fn((rows: unknown[]) => {
      calls.push(`upsert-source:${rows.length}`);
      return { select: sourceSelect };
    });
    const deleteTrackRows = (label: string) =>
      vi.fn(() => ({
        eq: vi.fn((column: string, value: string) => ({
          eq: vi.fn(async (trackColumn: string, trackValue: string) => {
            calls.push(`delete-${label}:${column}:${value}:${trackColumn}:${trackValue}`);
            return { error: null };
          }),
        })),
      }));
    const from = vi.fn((table: string) => {
      if (table === "modeling_source_manifests") {
        return {
          upsert: sourceUpsert,
        };
      }
      if (table === "modeling_validation_results") {
        return {
          delete: deleteTrackRows("validation"),
          insert: validationInsert,
        };
      }
      if (table === "modeling_claim_decisions") {
        return {
          delete: deleteTrackRows("claim"),
          insert: claimInsert,
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    });

    const result = await refreshCountyRunModelingEvidence({
      supabase: { from } as unknown as Parameters<typeof refreshCountyRunModelingEvidence>[0]["supabase"],
      workspaceId: "11111111-1111-4111-8111-111111111111",
      countyRunId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      geographyLabel: "Nevada County, CA",
      manifest,
    });

    expect(result.error).toBeNull();
    expect(result.insertedSourceManifestCount).toBe(4);
    expect(result.insertedValidationResultCount).toBe(5);
    expect(calls).toEqual([
      "delete-validation:county_run_id:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:track:assignment",
      "delete-claim:county_run_id:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:track:assignment",
      "upsert-source:4",
      "insert-validation:5",
      "insert-claim:screening_grade",
    ]);
  });
});

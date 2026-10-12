import { readFileSync } from "fs";
import { describe, expect, it, vi } from "vitest";

import {
  MODELING_CLAIM_STATUSES,
  buildCountyRunModelingEvidenceBundle,
  countyRunDisplayableClaim,
  loadCountyRunModelingEvidence,
  modelingClaimAllowsOutwardPlanningLanguage,
  modelingClaimReportLanguage,
  modelingClaimStatusLabel,
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

  /**
   * NO EVIDENCE AT ALL IS PROTOTYPE-ONLY, AND NOTHING WAS CHECKING IT.
   *
   * The prototype test below supplies BOTH a `prototypeReasons` entry and a
   * missing required metric, so two other conditions in the same `||` already
   * hold and `validationResults.length === 0` is never the deciding one.
   * Deleting that clause let a run with no validation evidence whatsoever come
   * back `claim_grade_passed` — "All required public-data validation checks
   * passed" — and clear `modelingClaimAllowsOutwardPlanningLanguage`, which is
   * the sentence that goes into a grant application or an RTP. All seven tests
   * stayed green. This is the honesty firewall failing OPEN, so it is asserted
   * on its own, with nothing else true.
   */
  it("refuses claim-grade for a run with no validation evidence at all", () => {
    const decision = resolveModelingClaimDecision({
      track: "assignment",
      validationResults: [],
      requiredMetricKeys: [],
    });

    expect(decision.claimStatus).toBe("prototype_only");
    expect(modelingClaimAllowsOutwardPlanningLanguage(decision)).toBe(false);
    expect(decision.statusReason).not.toContain("passed");
  });

  /**
   * A WARNING ALONE DOWNGRADES. The existing downgrade test uses a `fail`, so
   * `failures.length > 0` carried it and `|| warnings.length > 0` could be
   * deleted with every test still green — promoting a warned metric straight to
   * claim-grade.
   */
  it("downgrades to screening grade on a warning with no failure", () => {
    const decision = resolveModelingClaimDecision({
      track: "assignment",
      validationResults: [
        validation({ metricKey: "assignment_final_gap" }),
        validation({
          metricKey: "median_absolute_percent_error",
          status: "warn",
          detail: "Median APE 27.4% is above the 20% target.",
        }),
      ],
      requiredMetricKeys: ["assignment_final_gap", "median_absolute_percent_error"],
    });

    expect(decision.claimStatus).toBe("screening_grade");
    expect(modelingClaimAllowsOutwardPlanningLanguage(decision)).toBe(false);
    expect(decision.reasons).toContain("Median APE 27.4% is above the 20% target.");
  });

  /**
   * `blocksClaimGrade` IS OPTIONAL, AND ITS DEFAULT IS TO BLOCK.
   *
   * `blocksClaimGrade !== false` means a result that never states whether it
   * blocks still does — the safe reading of an absent flag. Changing it to
   * `=== true` makes silence permissive, and every fixture in this file sets the
   * flag explicitly, so nothing saw it. Both directions are asserted: an omitted
   * flag blocks, an explicit `false` does not.
   */
  it("treats a failing result that omits blocksClaimGrade as blocking", () => {
    const omitted = validation({
      metricKey: "critical_absolute_percent_error",
      status: "fail",
      detail: "Worst matched facility APE 237.62% exceeds the 50% threshold.",
    });
    delete (omitted as { blocksClaimGrade?: boolean }).blocksClaimGrade;

    const decision = resolveModelingClaimDecision({
      track: "assignment",
      validationResults: [validation({ metricKey: "assignment_final_gap" }), omitted],
      requiredMetricKeys: ["assignment_final_gap", "critical_absolute_percent_error"],
    });

    expect(decision.claimStatus).toBe("screening_grade");
    expect(modelingClaimAllowsOutwardPlanningLanguage(decision)).toBe(false);
  });

  it("lets a result that explicitly declares itself non-blocking pass through", () => {
    const decision = resolveModelingClaimDecision({
      track: "assignment",
      validationResults: [
        validation({ metricKey: "assignment_final_gap" }),
        validation({
          metricKey: "facility_ranking_spearman_rho",
          status: "warn",
          blocksClaimGrade: false,
          detail: "Facility ranking correlation is informational.",
        }),
      ],
      requiredMetricKeys: ["assignment_final_gap", "facility_ranking_spearman_rho"],
    });

    expect(decision.claimStatus).toBe("claim_grade_passed");
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

/**
 * THE FIVE SURVIVORS OF THE 2026-08-07 CLAIM-TIER AUDIT.
 *
 * 14 mutations over `resolveModelingClaimDecision` and the vocabulary around
 * it; 9 died. The five below lived, and they are not edge cases — two of them
 * PROMOTE a run's tier, which is the exact thing the honesty firewall exists to
 * make impossible. This module is the firewall's own decision procedure, so a
 * hole here is not one wrong number; it is every downstream surface repeating a
 * claim the evidence does not support.
 */
describe("a tier is not awarded for evidence that was never produced", () => {
  it("holds a run at prototype_only when a REQUIRED metric was never validated", () => {
    // MUTATION T2 SURVIVED: dropping `missingRequiredMetricKeys.length > 0` from
    // the prototype condition changed no test. And the run does not merely slip
    // to screening-grade — with no failures and no warnings among the checks
    // that DID run, it falls through to `claim_grade_passed`. A run that skipped
    // the check entirely would then claim the strongest tier in the product, on
    // the strength of the checks it happened to run.
    const decision = resolveModelingClaimDecision({
      track: "assignment",
      validationResults: [validation({ metricKey: "assignment_final_gap" })],
      requiredMetricKeys: ["assignment_final_gap", "count_station_matches"],
    });

    expect(decision.claimStatus).toBe("prototype_only");
    expect(modelingClaimAllowsOutwardPlanningLanguage(decision)).toBe(false);
    expect(decision.reasons).toContain("Missing required validation metric: count_station_matches");
    expect(decision.validationSummary.missingRequiredMetricKeys).toEqual(["count_station_matches"]);
  });

  it("honours a caller's explicit screening reason even when every check passed", () => {
    // MUTATION T4 SURVIVED: dropping `screeningReasons.length > 0` from the
    // screening condition changed no test. `screeningReasons` is how a caller
    // states a limit the validation table cannot see — a coarse zone system, a
    // frozen input, a proxy input — and ignoring it promotes a run to
    // claim-grade on checks that were never about the limit in question.
    const decision = resolveModelingClaimDecision({
      track: "assignment",
      validationResults: [validation({ metricKey: "assignment_final_gap" })],
      requiredMetricKeys: ["assignment_final_gap"],
      screeningReasons: ["Zone system is too coarse for link-level claims."],
    });

    expect(decision.claimStatus).toBe("screening_grade");
    expect(modelingClaimAllowsOutwardPlanningLanguage(decision)).toBe(false);
    expect(decision.statusReason).toBe("Zone system is too coarse for link-level claims.");
    expect(decision.reasons).toContain("Zone system is too coarse for link-level claims.");
  });
});

describe("every tier states its own basis", () => {
  /**
   * MUTATIONS T11, T12 and T13 SURVIVED — all three status sentences could be
   * emptied with the suite green.
   *
   * A tier with no stated reason is worse than a missing tier: the badge still
   * renders, still carries authority, and the one thing that would let a
   * reviewer weigh it is gone. `statusReason` is what the evidence panel shows
   * beside the badge, and `modelingClaimReportLanguage` is what a report prints.
   */
  it("says why a run is prototype-only, and what not to do with it", () => {
    const decision = resolveModelingClaimDecision({
      track: "assignment",
      validationResults: [],
      requiredMetricKeys: ["assignment_final_gap"],
    });

    expect(decision.claimStatus).toBe("prototype_only");
    expect(decision.statusReason).not.toBe("");
    expect(decision.statusReason).toMatch(/cannot make outward planning claims/i);
    expect(modelingClaimReportLanguage(decision)).toMatch(/Prototype-only modeling result/i);
    // The instruction, not just the label — this is the sentence that stops a
    // number reaching a public document.
    expect(modelingClaimReportLanguage(decision)).toMatch(
      /Do not use for outward planning claims/i
    );
  });

  it("says what a claim-grade pass rests on", () => {
    const decision = resolveModelingClaimDecision({
      track: "assignment",
      validationResults: [validation({ metricKey: "assignment_final_gap" })],
      requiredMetricKeys: ["assignment_final_gap"],
    });

    expect(decision.claimStatus).toBe("claim_grade_passed");
    expect(decision.statusReason).not.toBe("");
    expect(decision.statusReason).toMatch(/validation checks passed/i);
  });

  it("gives every tier a non-empty report sentence", () => {
    // The vocabulary and the sentences are two lists that must stay the same
    // length. A tier added without its sentence would render as a badge with
    // nothing under it.
    for (const claimStatus of MODELING_CLAIM_STATUSES) {
      const language = modelingClaimReportLanguage({
        track: "assignment",
        claimStatus,
        statusReason: "",
        reasons: [],
        validationSummary: {
          passed: 0,
          warned: 0,
          failed: 0,
          missingRequiredMetricKeys: [],
          requiredMetricKeys: [],
        },
      });
      expect(language.length, claimStatus).toBeGreaterThan(40);
    }
  });
});

describe("buildCountyRunModelingEvidenceBundle", () => {
  it("builds public source manifests, validation rows, and a prototype-only decision for the NCTC-style failure", () => {
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
    expect(bundle.claimDecision.claimStatus).toBe("prototype_only");
    // The diagnostic failure still travels with the decision.
    expect(bundle.claimDecision.reasons).toContain(
      "Worst matched facility APE 237.62% exceeds the 50% diagnostic threshold."
    );
  });
});

/**
 * THE COUNTY TIER ANSWERS TO THE RULES-V4 SCIENTIFIC OUTCOME (KI-2026-10-12-001).
 *
 * The county lane used to take its tier from the retired 30 percent median-APE
 * gate with a three-station minimum. A run whose rules-v4 outcome was fail or
 * inconclusive could still read "Screening-grade". The worker lane already
 * refuses that (build_model_run_modeling_evidence in
 * workers/aequilibrae_worker/main.py); these pin the county lane to the same
 * answer. The fixture's old-gate numbers all pass, so only the scientific
 * outcome can hold the tier down.
 */
describe("a county run's claim tier comes from its rules-v4 scientific outcome", () => {
  function countyManifest(validationExtras: Record<string, unknown>, gateReasons: string[] = []) {
    return {
      ...manifest,
      summary: {
        ...manifest.summary,
        validation: {
          counts_source_csv: "/data/counts.csv",
          stations_total: 5,
          stations_matched: 5,
          screening_gate: {
            status_label: "bounded screening-ready",
            required_matches: 3,
            ready_median_ape_threshold: 30,
            ready_critical_ape_threshold: 50,
            reasons: gateReasons,
          },
          metrics: {
            median_absolute_percent_error: 16.01,
            max_absolute_percent_error: 41.2,
            spearman_rho_facility_ranking: 0.9,
          },
          ...validationExtras,
        },
      },
    } as unknown as CountyOnrampManifest;
  }

  function decide(validationExtras: Record<string, unknown>, gateReasons: string[] = []) {
    return buildCountyRunModelingEvidenceBundle({
      workspaceId: "11111111-1111-4111-8111-111111111111",
      countyRunId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      geographyLabel: "Any County",
      manifest: countyManifest(validationExtras, gateReasons),
    }).claimDecision;
  }

  const oldGatePassReason =
    "Matched stations >= 3, median absolute percent error <= 30.00%, and no matched facility exceeds 50.00% absolute percent error.";

  it("holds a failing rules-v4 outcome at prototype-only", () => {
    const decision = decide({
      validation_rules_version: 4,
      scientific_outcome: "fail",
      model_validation_assessment: {
        scientific_outcome: "fail",
        validation_evidence_write: "recorded",
        reasons: ["Decisive median raw APE 41.00% exceeds the frozen 25.00% limit."],
      },
    }, [oldGatePassReason]);

    expect(decision.claimStatus).toBe("prototype_only");
    expect(modelingClaimStatusLabel(decision.claimStatus)).toBe("Prototype-only");
    expect(decision.statusReason).toBe(
      "The rules-v4 scientific outcome is fail. Decisive median raw APE 41.00% exceeds the frozen 25.00% limit."
    );
  });

  it("holds an inconclusive rules-v4 outcome at prototype-only even when the old 30% gate passed", () => {
    const decision = decide({
      validation_rules_version: 4,
      scientific_outcome: "inconclusive",
      model_validation_assessment: {
        scientific_outcome: "inconclusive",
        // Recorded on purpose: the outcome alone must hold the tier down.
        validation_evidence_write: "recorded",
        reasons: ["The available point-count rows do not satisfy the observed-traffic-observation.v1 contract."],
      },
    }, [oldGatePassReason]);

    expect(decision.claimStatus).toBe("prototype_only");
    expect(modelingClaimAllowsOutwardPlanningLanguage(decision)).toBe(false);
    expect(decision.statusReason).toMatch(/^The rules-v4 scientific outcome is inconclusive\./);
  });

  it("reads a stored manifest without a rules-v4 outcome as prototype-only and not assessed", () => {
    const decision = decide({}, [oldGatePassReason]);

    expect(decision.claimStatus).toBe("prototype_only");
    expect(decision.statusReason).toMatch(/^Not assessed: this run has no rules-v4 scientific outcome\./);
  });

  it("does not let a pass whose evidence write is unconfirmed rise above prototype-only", () => {
    const decision = decide({
      validation_rules_version: 4,
      model_validation_assessment: { scientific_outcome: "pass", validation_evidence_write: "pending" },
    });

    expect(decision.claimStatus).toBe("prototype_only");
    expect(decision.statusReason).toMatch(/^Validation evidence storage is not confirmed\./);
  });

  it("caps an explicit rules-v4 pass at screening grade, as the worker lane does", () => {
    const decision = decide({
      validation_rules_version: 4,
      model_validation_assessment: { scientific_outcome: "pass", validation_evidence_write: "recorded" },
    });

    expect(decision.claimStatus).toBe("screening_grade");
    expect(decision.statusReason).toMatch(/^The rules-v4 assessment passed its exact frozen, use-specific acceptance rule\./);
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
      "insert-claim:prototype_only",
    ]);
  });
});

/**
 * STORED COUNTY TIERS ARE SHOWN ONLY AS FAR AS THE RULES-V4 BASIS SUPPORTS.
 *
 * Claim rows written before KI-2026-10-12-001 was fixed carry tiers the retired
 * 30 percent gate awarded. Stored data is not rewritten; every reader lowers
 * at read time, and nothing is ever raised.
 */
describe("countyRunDisplayableClaim", () => {
  const stored = (claimStatus: "prototype_only" | "screening_grade" | "claim_grade_passed") => ({
    claimStatus,
    statusReason: "Stored reason.",
    reasons: ["Stored reason."],
  });
  const confirmedPass = {
    validation_rules_version: 4,
    model_validation_assessment: { scientific_outcome: "pass", validation_evidence_write: "recorded" },
  };

  it("lowers a stored screening tier with no rules-v4 outcome to prototype-only, not assessed", () => {
    const shown = countyRunDisplayableClaim(stored("screening_grade"), null);
    expect(shown.claimStatus).toBe("prototype_only");
    expect(shown.statusReason).toMatch(/^Not assessed: this run has no rules-v4 scientific outcome\./);
    expect(shown.reasons).toContain("Stored reason.");
  });

  it("caps a stored claim-grade tier at screening grade on a confirmed pass", () => {
    expect(countyRunDisplayableClaim(stored("claim_grade_passed"), confirmedPass).claimStatus).toBe("screening_grade");
  });

  it("leaves a supported stored tier exactly as stored", () => {
    expect(countyRunDisplayableClaim(stored("screening_grade"), confirmedPass)).toEqual(stored("screening_grade"));
  });

  it("never raises a stored tier, even on a confirmed pass", () => {
    expect(countyRunDisplayableClaim(stored("prototype_only"), confirmedPass).claimStatus).toBe("prototype_only");
  });
});

describe("loadCountyRunModelingEvidence lowers stored county tiers", () => {
  const BASIS_PROJECTION =
    "basis_rules_version:validation_summary_json->validation_rules_version, basis_outcome:validation_summary_json->model_validation_assessment->>scientific_outcome, basis_evidence_write:validation_summary_json->model_validation_assessment->>validation_evidence_write, basis_reasons:validation_summary_json->model_validation_assessment->reasons";
  const COUNTY_RUN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

  function client(storedStatus: string, basis: { data: unknown; error: unknown }) {
    const countyRunSelect = vi.fn((_projection: string) => ({
      eq: vi.fn((_column: string, _value: string) => ({ maybeSingle: vi.fn(async () => basis) })),
    }));
    const claimRow = {
      track: "assignment",
      claim_status: storedStatus,
      status_reason: "Worst matched facility APE 237.62% exceeds the 50% claim-grade threshold.",
      reasons_json: ["Worst matched facility APE 237.62% exceeds the 50% claim-grade threshold."],
      validation_summary_json: { passed: 3, warned: 0, failed: 1, missingRequiredMetricKeys: [], requiredMetricKeys: [] },
      decided_at: "2026-03-24T23:00:00Z",
    };
    const ordered = { order: vi.fn(async () => ({ data: [], error: null })) };
    const from = vi.fn((table: string) => {
      if (table === "modeling_claim_decisions") {
        return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: claimRow, error: null }) }) }) }) };
      }
      if (table === "county_runs") return { select: countyRunSelect };
      if (table === "modeling_source_manifests") return { select: () => ({ eq: () => ordered }) };
      if (table === "modeling_validation_results") return { select: () => ({ eq: () => ({ eq: () => ordered }) }) };
      throw new Error(`Unexpected table: ${table}`);
    });
    return { supabase: { from } as unknown as Parameters<typeof loadCountyRunModelingEvidence>[0]["supabase"], countyRunSelect };
  }

  it("shows a stored screening tier with an inconclusive outcome as prototype-only, in one bounded read", async () => {
    const { supabase, countyRunSelect } = client("screening_grade", {
      data: {
        basis_rules_version: 4,
        basis_outcome: "inconclusive",
        basis_evidence_write: "pending",
        basis_reasons: ["The available point-count rows do not satisfy the observed-traffic-observation.v1 contract."],
      },
      error: null,
    });

    const { evidence, error } = await loadCountyRunModelingEvidence({ supabase, countyRunId: COUNTY_RUN_ID });

    expect(error).toBeNull();
    expect(evidence?.claimDecision?.claimStatus).toBe("prototype_only");
    expect(evidence?.claimDecision?.statusReason).toMatch(/^The rules-v4 scientific outcome is inconclusive\./);
    expect(evidence?.reportLanguage).toMatch(/^Prototype-only modeling result/);
    expect(countyRunSelect).toHaveBeenCalledTimes(1);
    expect(countyRunSelect).toHaveBeenCalledWith(BASIS_PROJECTION);
    expect(countyRunSelect.mock.results[0]?.value.eq).toHaveBeenCalledWith("id", COUNTY_RUN_ID);
  });

  it("keeps a stored screening tier when the run recorded a confirmed pass", async () => {
    const { supabase } = client("screening_grade", {
      data: { basis_rules_version: 4, basis_outcome: "pass", basis_evidence_write: "recorded", basis_reasons: [] },
      error: null,
    });

    const { evidence } = await loadCountyRunModelingEvidence({ supabase, countyRunId: COUNTY_RUN_ID });
    expect(evidence?.claimDecision?.claimStatus).toBe("screening_grade");
  });

  it("makes no extra read for a stored prototype-only tier", async () => {
    const { supabase, countyRunSelect } = client("prototype_only", { data: null, error: null });

    const { evidence } = await loadCountyRunModelingEvidence({ supabase, countyRunId: COUNTY_RUN_ID });
    expect(evidence?.claimDecision?.claimStatus).toBe("prototype_only");
    expect(countyRunSelect).not.toHaveBeenCalled();
  });

  it("reports a failed basis read instead of showing the stored tier", async () => {
    const { supabase } = client("screening_grade", { data: null, error: { message: "permission denied for table county_runs" } });

    const { evidence, error } = await loadCountyRunModelingEvidence({ supabase, countyRunId: COUNTY_RUN_ID });
    expect(evidence).toBeNull();
    expect(error?.message).toBe("permission denied for table county_runs");
  });
});

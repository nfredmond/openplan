import { describe, expect, it } from "vitest";
import {
  buildBehavioralDemandComparison,
  normalizeBehavioralComparisonSource,
} from "@/lib/models/behavioral-kpi-comparison";

describe("behavioral KPI comparison helpers", () => {
  it("compares shared behavioral KPI rows and reports mismatched coverage", () => {
    const current = normalizeBehavioralComparisonSource({
      summary_type: "activitysim_behavioral_kpi_summary",
      source: { runtime_mode: "activitysim_cli", runtime_status: "succeeded" },
      availability: { status: "behavioral_kpis_available", reasons: [] },
      coverage: {
        totals: ["trips"],
        trip_volumes_by_purpose: true,
        mode_shares: false,
        segment_summaries: [],
      },
      totals: { trips: 120 },
      trip_volumes_by_purpose: {
        values: [
          { label: "work", count: 90, share: 0.75 },
          { label: "school", count: 30, share: 0.25 },
        ],
      },
      mode_shares: { values: [] },
      segment_summaries: [],
      caveats: ["Current prototype-only."],
    });
    const baseline = normalizeBehavioralComparisonSource({
      summary_type: "activitysim_behavioral_kpi_summary",
      source: { runtime_mode: "activitysim_cli", runtime_status: "succeeded" },
      availability: { status: "behavioral_kpis_available", reasons: [] },
      coverage: {
        totals: ["trips"],
        trip_volumes_by_purpose: true,
        mode_shares: false,
        segment_summaries: [],
      },
      totals: { trips: 100 },
      trip_volumes_by_purpose: {
        values: [{ label: "work", count: 100, share: 1.0 }],
      },
      mode_shares: { values: [] },
      segment_summaries: [],
      caveats: [],
    });

    const comparison = buildBehavioralDemandComparison(current, baseline);

    expect(comparison.support.status).toBe("behavioral_comparison_available");
    expect(comparison.coverage.comparable_kpi_count).toBe(3);
    expect(comparison.coverage.current_only_count).toBe(2);
    expect(comparison.exclusions[0]).toContain("Current run has 2 behavioral KPI rows");
    expect(comparison.comparison.rows.find((row) => row.kpi_name === "total_trips")).toMatchObject({
      value: 120,
      baseline_value: 100,
      absolute_delta: 20,
      percent_delta: 20,
    });
  });

  it("blocks comparison when both sides are preflight-only or not-enough-output", () => {
    const current = normalizeBehavioralComparisonSource({
      summary_type: "activitysim_behavioral_kpi_summary",
      source: { runtime_mode: "preflight_only", runtime_status: "blocked" },
      availability: { status: "not_enough_behavioral_outputs", reasons: ["preflight"] },
      coverage: { totals: [], trip_volumes_by_purpose: false, mode_shares: false, segment_summaries: [] },
      totals: {},
      trip_volumes_by_purpose: { values: [] },
      mode_shares: { values: [] },
      segment_summaries: [],
      caveats: ["Preflight only."],
    });
    const baseline = normalizeBehavioralComparisonSource({
      summary_type: "activitysim_behavioral_kpi_summary",
      source: { runtime_mode: "preflight_only", runtime_status: "blocked" },
      availability: { status: "not_enough_behavioral_outputs", reasons: ["preflight"] },
      coverage: { totals: [], trip_volumes_by_purpose: false, mode_shares: false, segment_summaries: [] },
      totals: {},
      trip_volumes_by_purpose: { values: [] },
      mode_shares: { values: [] },
      segment_summaries: [],
      caveats: [],
    });

    const comparison = buildBehavioralDemandComparison(current, baseline);

    expect(comparison.support.supportable).toBe(false);
    expect(comparison.support.status).toBe("behavioral_comparison_blocked");
    expect(comparison.support.message).toContain("not supportable yet");
    expect(comparison.comparison.rows).toEqual([]);
  });

  it("keeps partial-output comparisons caveated and supportable only on shared rows", () => {
    const current = normalizeBehavioralComparisonSource({
      packet_type: "behavioral_demand_evidence_packet",
      source: { behavioral_manifest_path: "/tmp/current/behavioral_demand_prototype_manifest.json" },
      prototype_chain: {
        runtime: { mode: "activitysim_cli", status: "failed" },
        behavioral_kpis: {
          availability_status: "partial_behavioral_outputs",
          availability_reasons: ["partial only"],
          coverage: {
            totals: ["trips"],
            trip_volumes_by_purpose: true,
            mode_shares: false,
            segment_summaries: [],
          },
          totals: { trips: 40 },
          trip_volumes_by_purpose: { values: [{ label: "work", count: 40, share: 1 }] },
          mode_shares: { values: [] },
          segment_summaries: [],
        },
      },
      caveats: ["Partial output only."],
    });
    const baseline = normalizeBehavioralComparisonSource({
      summary_type: "activitysim_behavioral_kpi_summary",
      source: { runtime_mode: "activitysim_cli", runtime_status: "succeeded" },
      availability: { status: "behavioral_kpis_available", reasons: [] },
      coverage: {
        totals: ["trips"],
        trip_volumes_by_purpose: true,
        mode_shares: false,
        segment_summaries: [],
      },
      totals: { trips: 20 },
      trip_volumes_by_purpose: { values: [{ label: "work", count: 20, share: 1 }] },
      mode_shares: { values: [] },
      segment_summaries: [],
      caveats: [],
    });

    const comparison = buildBehavioralDemandComparison(current, baseline);

    expect(comparison.support.status).toBe("behavioral_comparison_partial_only");
    expect(comparison.support.supportable).toBe(true);
    expect(comparison.support.partial).toBe(true);
    expect(comparison.caveats.join(" ")).toContain("partial-output only");
    expect(comparison.comparison.rows).toHaveLength(3);
  });
});

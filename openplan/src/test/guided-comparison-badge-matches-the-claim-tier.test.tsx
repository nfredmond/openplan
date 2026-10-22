import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { GuidedComparisonResultsPanel } from "@/components/scenarios/guided-comparison-results-panel";
import {
  buildGuidedComparisonResults,
  guidedComparisonClaimStatus,
  type GuidedComparisonDecision,
} from "@/lib/models/guided-comparison-results";

/**
 * Independent review L-14 (2026-10-11): every method header in a guided
 * comparison read "Screening evidence", even when both runs were recorded as
 * prototype-only. The header now states the weaker of the two runs' recorded
 * tiers, and never a tier no run was given.
 */

const links = [
  { comparison_snapshot_id: "snapshot", model_run_id: "aeq-base", method: "aequilibrae", scenario_role: "baseline" },
  { comparison_snapshot_id: "snapshot", model_run_id: "aeq-build", method: "aequilibrae", scenario_role: "build" },
  { comparison_snapshot_id: "snapshot", model_run_id: "as-base", method: "activitysim", scenario_role: "baseline" },
  { comparison_snapshot_id: "snapshot", model_run_id: "as-build", method: "activitysim", scenario_role: "build" },
];

const kpis = links.flatMap((link) => {
  const activitySim = link.method === "activitysim";
  return [
    { run_id: link.model_run_id, kpi_name: activitySim ? "activitysim_trips" : "total_trips", value: 100, unit: "trips/day" },
    { run_id: link.model_run_id, kpi_name: activitySim ? "activitysim_daily_vmt" : "daily_vmt", value: 1_000, unit: "vehicle-miles/day" },
  ];
});

function decisions(tiers: Record<string, string | null>): GuidedComparisonDecision[] {
  return Object.entries(tiers).flatMap(([runId, tier]) =>
    tier === null
      ? []
      : [{ model_run_id: runId, track: runId.startsWith("aeq") ? "assignment" : "behavioral_demand", claim_status: tier, status_reason: null }]
  );
}

function headerBadges(tiers: Record<string, string | null>): string[] {
  const results = buildGuidedComparisonResults({ snapshotId: "snapshot", links, kpis, decisions: decisions(tiers) });
  render(<GuidedComparisonResultsPanel snapshotId="snapshot" results={results} unreadable={false} />);
  return screen.getAllByText(/no cross-method average/).map((node) => node.textContent ?? "");
}

describe("guided comparison method badge", () => {
  it("says prototype-only for prototype-only runs, not screening evidence", () => {
    const badges = headerBadges({ "aeq-base": "prototype_only", "aeq-build": "prototype_only", "as-base": "prototype_only", "as-build": "prototype_only" });
    expect(badges).toEqual(["Prototype-only · no cross-method average", "Prototype-only · no cross-method average"]);
  });

  it("takes the weaker of the two runs, per method", () => {
    const badges = headerBadges({
      "aeq-base": "screening_grade",
      "aeq-build": "screening_grade",
      "as-base": "calibrated_to_counts",
      "as-build": "prototype_only",
    });
    expect(badges).toEqual(["Screening-grade · no cross-method average", "Prototype-only · no cross-method average"]);
  });

  it("does not show a tier when a run has none recorded", () => {
    const badges = headerBadges({ "aeq-base": "claim_grade_passed", "aeq-build": null, "as-base": "screening_grade", "as-build": "unknown_tier" });
    expect(badges).toEqual(["Claim tier not recorded · no cross-method average", "Claim tier not recorded · no cross-method average"]);
  });

  it("orders tiers by the shared rank, whichever run is weaker", () => {
    const [aequilibrae] = buildGuidedComparisonResults({
      snapshotId: "snapshot",
      links,
      kpis,
      decisions: decisions({ "aeq-base": "claim_grade_passed", "aeq-build": "calibrated_to_counts" }),
    });
    expect(guidedComparisonClaimStatus(aequilibrae!)).toBe("calibrated_to_counts");
  });
});

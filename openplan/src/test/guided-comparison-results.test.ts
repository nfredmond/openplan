import { describe, expect, it } from "vitest";

import { buildGuidedComparisonResults } from "@/lib/models/guided-comparison-results";

const links = [
  { comparison_snapshot_id: "snapshot", model_run_id: "aeq-base", method: "aequilibrae", scenario_role: "baseline" },
  { comparison_snapshot_id: "snapshot", model_run_id: "aeq-build", method: "aequilibrae", scenario_role: "build" },
  { comparison_snapshot_id: "snapshot", model_run_id: "as-base", method: "activitysim", scenario_role: "baseline" },
  { comparison_snapshot_id: "snapshot", model_run_id: "as-build", method: "activitysim", scenario_role: "build" },
];

const kpis = links.flatMap((link, index) => [
  { run_id: link.model_run_id, kpi_name: "total_trips", value: 100 + (index % 2) * 10, unit: "trips/day" },
  { run_id: link.model_run_id, kpi_name: "daily_vmt", value: 1_000 - (index % 2) * 100, unit: "vehicle-miles/day" },
]);

const decisions = [
  { model_run_id: "aeq-base", track: "assignment", claim_status: "prototype_only", status_reason: "Local counts were unavailable." },
  { model_run_id: "aeq-build", track: "assignment", claim_status: "prototype_only", status_reason: "Local counts were unavailable." },
  { model_run_id: "as-base", track: "behavioral_demand", claim_status: "prototype_only", status_reason: "The behavioral result is uncalibrated." },
  { model_run_id: "as-build", track: "behavioral_demand", claim_status: "prototype_only", status_reason: "The behavioral result is uncalibrated." },
];

describe("guided comparison results", () => {
  it("keeps both methods separate and reports baseline, build, raw change, and validation", () => {
    const results = buildGuidedComparisonResults({ snapshotId: "snapshot", links, kpis, decisions });

    expect(results.map((result) => result.method)).toEqual(["aequilibrae", "activitysim"]);
    expect(results[0]?.metrics).toEqual([
      expect.objectContaining({ key: "total_trips", baseline: 100, build: 110, delta: 10, percentDelta: 10 }),
      expect.objectContaining({ key: "daily_vmt", baseline: 1_000, build: 900, delta: -100, percentDelta: -10 }),
    ]);
    expect(results[0]?.build).toMatchObject({ claimStatus: "prototype_only", statusReason: "Local counts were unavailable." });
    expect(results[1]?.build).toMatchObject({ claimStatus: "prototype_only", statusReason: "The behavioral result is uncalibrated." });
  });

  it("does not substitute a run when one exact method-scenario link is missing", () => {
    const results = buildGuidedComparisonResults({ snapshotId: "snapshot", links: links.slice(0, 3), kpis, decisions });
    expect(results.map((result) => result.method)).toEqual(["aequilibrae"]);
  });

  it("does not calculate a change from mismatched units or missing values", () => {
    const broken = kpis.map((row) => row.run_id === "aeq-build" && row.kpi_name === "daily_vmt"
      ? { ...row, unit: "vehicle-km/day" }
      : row);
    const results = buildGuidedComparisonResults({ snapshotId: "snapshot", links, kpis: broken, decisions });
    expect(results[0]?.metrics.map((metric) => metric.key)).toEqual(["total_trips"]);
  });
});


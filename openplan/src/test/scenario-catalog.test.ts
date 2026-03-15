import { describe, expect, it } from "vitest";
import {
  buildScenarioComparisonSummary,
  getScenarioComparisonReadiness,
  scenarioComparisonStatus,
} from "@/lib/scenarios/catalog";

describe("scenario comparison helpers", () => {
  it("marks a comparison ready only when baseline and alternative have distinct runs", () => {
    expect(
      getScenarioComparisonReadiness({
        baselineEntryId: "baseline-entry",
        baselineRunId: "baseline-run",
        candidateRunId: "alternative-run",
      })
    ).toMatchObject({
      status: "ready",
      ready: true,
      evidenceReady: true,
    });
  });

  it("explains when the baseline is missing", () => {
    expect(
      getScenarioComparisonReadiness({
        baselineEntryId: null,
        baselineRunId: null,
        candidateRunId: "alternative-run",
      })
    ).toMatchObject({
      status: "missing-baseline",
      ready: false,
      reason: "Register a baseline entry before comparing alternatives.",
    });
  });

  it("blocks comparisons when both entries point at the same run", () => {
    expect(scenarioComparisonStatus("shared-run", "shared-run", "baseline-entry")).toBe("same-run");
  });

  it("summarizes ready and blocked alternatives", () => {
    expect(
      buildScenarioComparisonSummary({
        baselineEntryId: "baseline-entry",
        baselineRunId: "baseline-run",
        candidateRunIds: ["alternative-run", null, "baseline-run"],
      })
    ).toEqual({
      totalAlternatives: 3,
      readyAlternatives: 1,
      blockedAlternatives: 2,
      baselineEntryPresent: true,
      baselineRunPresent: true,
    });
  });
});

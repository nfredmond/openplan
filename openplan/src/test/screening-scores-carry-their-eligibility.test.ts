import { describe, expect, it } from "vitest";

import { scoreValueForPresentation } from "@/lib/analysis/score-presentation";
import { buildModelRunResultSummary } from "@/lib/models/run-launch";
import { modelRunComparisonMetrics } from "@/lib/scenarios/comparison-board";

/**
 * A managed run's stored summary keeps whether each score may be shown.
 *
 * The summary is what the model run list and the scenario comparison board
 * read. It copies the four raw scores but not the evidence flags the
 * presentation rule needs, so before October 2026 a composite whose crash and
 * transit inputs were missing was shown and compared as if it were supported.
 *
 * Blind category: summaries written before this change carry no record and
 * still read as their raw numbers.
 */
const metricsWithoutCrashOrTransit = {
  overallScore: 32,
  accessibilityScore: 45,
  safetyScore: 40,
  equityScore: 17,
  dataQuality: { censusAvailable: true, crashDataAvailable: false, transitDataAvailable: false },
};

describe("screening scores carry their eligibility", () => {
  it("records in the run summary which scores the rule withholds", () => {
    const summary = buildModelRunResultSummary({ runId: "run-1", metrics: metricsWithoutCrashOrTransit });
    // The raw numbers stay, for reproducibility.
    expect(summary.overallScore).toBe(32);
    expect(summary.scorePresentation.overall).toEqual({ value: null, eligible: false });
    expect(summary.scorePresentation.equity).toEqual({ value: 17, eligible: true });
    // A reader of the summary alone now withholds the composite.
    expect(scoreValueForPresentation(summary as unknown as Record<string, unknown>, "overallScore")).toBeNull();
  });

  it("carries the record into the scenario comparison", () => {
    const summary = buildModelRunResultSummary({ runId: "run-1", metrics: metricsWithoutCrashOrTransit });
    const compared = modelRunComparisonMetrics(summary as unknown as Record<string, unknown>);
    expect(compared?.scorePresentation).toEqual(summary.scorePresentation);
    expect(scoreValueForPresentation(compared ?? {}, "overallScore")).toBeNull();
    expect(scoreValueForPresentation(compared ?? {}, "equityScore")).toBe(17);
  });

  it("keeps every score when the run had all its evidence", () => {
    const summary = buildModelRunResultSummary({
      runId: "run-2",
      metrics: {
        ...metricsWithoutCrashOrTransit,
        dataQuality: { censusAvailable: true, crashDataAvailable: true, transitDataAvailable: true },
      },
    });
    expect(scoreValueForPresentation(summary as unknown as Record<string, unknown>, "overallScore")).toBe(32);
  });
});

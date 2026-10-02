import { describe, expect, it } from "vitest";

import { withPresentedHeadlineScores } from "@/lib/analysis/score-presentation";

/**
 * A page shows a headline score only when the presentation rule allows it.
 *
 * Built from the real shape of a run saved on 2026-08-20 in the local test
 * workspace: an overall of 32 stored with no presentation record, Census
 * available, crash and transit unavailable. Corridor Analysis displayed
 * "Overall 32" for it.
 *
 * Blind category: this checks the helper. That the page applies it is checked
 * in the browser; see the implementation log.
 */
const legacyRun = {
  overallScore: 32,
  accessibilityScore: 45,
  safetyScore: 40,
  equityScore: 17,
  dataQuality: {
    censusAvailable: true,
    crashDataAvailable: false,
    transitDataAvailable: false,
  },
};

describe("withPresentedHeadlineScores", () => {
  it("withholds what the rule withholds on a run saved before the rule existed", () => {
    const presented = withPresentedHeadlineScores(legacyRun);
    expect(presented.overallScore).toBeNull();
    expect(presented.accessibilityScore).toBeNull();
    expect(presented.safetyScore).toBeNull();
    // Equity needs only Census, which this run had.
    expect(presented.equityScore).toBe(17);
  });

  it("keeps every score when all evidence was present", () => {
    const complete = {
      ...legacyRun,
      dataQuality: { censusAvailable: true, crashDataAvailable: true, transitDataAvailable: true },
    };
    expect(withPresentedHeadlineScores(complete)).toMatchObject({
      overallScore: 32,
      accessibilityScore: 45,
      safetyScore: 40,
      equityScore: 17,
    });
  });

  it("follows a recorded presentation over the raw numbers", () => {
    const recorded = {
      ...legacyRun,
      scorePresentation: { overall: { value: null, eligible: false }, equity: { value: 17, eligible: true } },
    };
    expect(withPresentedHeadlineScores(recorded).overallScore).toBeNull();
    expect(withPresentedHeadlineScores(recorded).equityScore).toBe(17);
  });

  it("leaves the input untouched, because it is for display only", () => {
    withPresentedHeadlineScores(legacyRun);
    expect(legacyRun.overallScore).toBe(32);
  });
});

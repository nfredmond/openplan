import { describe, expect, it } from "vitest";
import {
  presentableScoreMetrics,
  resolveScorePresentation,
  scoreValueForPresentation,
} from "@/lib/analysis/score-presentation";
import type { CorridorScores } from "@/lib/data-sources/scoring";

function scores(overrides: Partial<CorridorScores["dataQuality"]> = {}): CorridorScores {
  return {
    accessibilityScore: 72,
    safetyScore: 61,
    equityScore: 48,
    overallScore: 62,
    confidence: "high",
    dataQuality: {
      censusAvailable: true,
      crashDataAvailable: true,
      crashDataComplete: true,
      transitDataAvailable: true,
      lodesSource: "test",
      equitySource: "test",
      ...overrides,
    },
  };
}

describe("corridor score presentation eligibility", () => {
  it("shows every score only when all required inputs exist", () => {
    const presentation = resolveScorePresentation(scores());
    expect(presentableScoreMetrics(presentation)).toMatchObject({
      accessibilityScore: 72,
      safetyScore: 61,
      equityScore: 48,
      overallScore: 62,
    });
    expect(presentation.banding).toBe("not_validated");
  });

  it("withholds accessibility and the composite without transit", () => {
    const presentation = resolveScorePresentation(scores({ transitDataAvailable: false }));
    expect(presentation.accessibility.value).toBeNull();
    expect(presentation.safety.value).toBe(61);
    expect(presentation.equity.value).toBe(48);
    expect(presentation.overall.value).toBeNull();
  });

  it("withholds safety and the composite without crash evidence", () => {
    const presentation = resolveScorePresentation(scores({ crashDataAvailable: false }));
    expect(presentation.safety.value).toBeNull();
    expect(presentation.overall.value).toBeNull();
  });

  it("withholds safety and the composite when the crash extract is incomplete", () => {
    const presentation = resolveScorePresentation(scores({ crashDataComplete: false }));
    expect(presentation.safety.value).toBeNull();
    expect(presentation.safety.withheldReason).toMatch(/extract is incomplete/i);
    expect(presentation.overall.value).toBeNull();
  });

  it("withholds accessibility, equity, and the composite without Census", () => {
    const presentation = resolveScorePresentation(scores({ censusAvailable: false }));
    expect(presentation.accessibility.value).toBeNull();
    expect(presentation.equity.value).toBeNull();
    expect(presentation.safety.value).toBe(61);
    expect(presentation.overall.value).toBeNull();
  });

  it("does not let an old raw score escape when eligibility was not recorded", () => {
    expect(scoreValueForPresentation({ overallScore: 99 }, "overallScore")).toBe(99);
    expect(scoreValueForPresentation({
      overallScore: 99,
      dataQuality: { censusAvailable: true, transitDataAvailable: true, crashDataAvailable: false },
    }, "overallScore")).toBeNull();
    expect(scoreValueForPresentation({
      overallScore: 62,
      dataQuality: { censusAvailable: true, transitDataAvailable: true, crashDataAvailable: true },
    }, "overallScore")).toBe(62);
  });
});

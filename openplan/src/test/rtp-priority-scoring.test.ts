import { describe, expect, it } from "vitest";
import {
  buildRtpPriorityRationale,
  computeRtpPriorityScore,
  parsePriorityScores,
  tierForComposite,
} from "@/lib/rtp/priority-scoring";
import { RTP_PRIORITY_CRITERIA } from "@/lib/rtp/priority-criteria";

describe("parsePriorityScores", () => {
  it("keeps known criteria with integer ratings 1..3, drops the rest", () => {
    expect(
      parsePriorityScores({ vmt_reduction: 3, ghg_reduction: 2, safety: 0, bogus: 3, equity: 5, multimodal: 1.4 }),
    ).toEqual({ vmt_reduction: 3, ghg_reduction: 2, equity: 3, multimodal: 1 });
  });

  it("returns {} for non-object input", () => {
    expect(parsePriorityScores(null)).toEqual({});
    expect(parsePriorityScores([1, 2, 3])).toEqual({});
    expect(parsePriorityScores("nope")).toEqual({});
  });
});

describe("computeRtpPriorityScore", () => {
  it("is 0 / unscored when nothing is scored", () => {
    const summary = computeRtpPriorityScore({});
    expect(summary.composite).toBe(0);
    expect(summary.tier).toBe("unscored");
    expect(summary.scoredCriteria).toBe(0);
  });

  it("is 100 / high when every criterion is maxed", () => {
    const maxed = Object.fromEntries(RTP_PRIORITY_CRITERIA.map((c) => [c.key, 3]));
    const summary = computeRtpPriorityScore(maxed);
    expect(summary.composite).toBe(100);
    expect(summary.tier).toBe("high");
    expect(summary.scoredCriteria).toBe(RTP_PRIORITY_CRITERIA.length);
    expect(summary.byLevel.state).toBe(100);
    expect(summary.byLevel.federal).toBe(100);
  });

  it("weights by criterion — VMT+GHG+safety (all weight 3) = 50/100, medium", () => {
    const summary = computeRtpPriorityScore({ vmt_reduction: 3, ghg_reduction: 3, safety: 3 });
    // (3+3+3) weighted / 18 total weight = 50
    expect(summary.composite).toBe(50);
    expect(summary.tier).toBe("medium");
    expect(summary.scoredCriteria).toBe(3);
  });

  it("rolls up per priority level", () => {
    // Only VMT (state, weight 3). State weight total = vmt3 + ghg3 + multimodal2 = 8 → 3/8 = 38.
    const summary = computeRtpPriorityScore({ vmt_reduction: 3 });
    expect(summary.byLevel.state).toBe(38);
    expect(summary.byLevel.federal).toBe(0);
    expect(summary.tier).toBe("low");
  });
});

describe("tierForComposite", () => {
  it("maps composite + scored-count to a tier", () => {
    expect(tierForComposite(0, 0)).toBe("unscored");
    expect(tierForComposite(20, 2)).toBe("low");
    expect(tierForComposite(30, 2)).toBe("medium");
    expect(tierForComposite(60, 4)).toBe("high");
  });
});

describe("buildRtpPriorityRationale", () => {
  it("ranks drivers by weighted contribution and writes a narrative citing the top criteria", () => {
    const rationale = buildRtpPriorityRationale({ community_support: 3, vmt_reduction: 3, ghg_reduction: 2 });
    // vmt (3/3*3=3) > ghg (2/3*3=2) > community_support (3/3*2=2, tiebreak alpha)
    expect(rationale.drivers[0].key).toBe("vmt_reduction");
    expect(rationale.narrative).toMatch(/Scores \d+\/100/);
    expect(rationale.narrative.toLowerCase()).toContain("reduces vmt");
    expect(rationale.summary.scoredCriteria).toBe(3);
  });

  it("says unscored when empty", () => {
    expect(buildRtpPriorityRationale({}).narrative).toMatch(/not yet been scored/i);
  });
});

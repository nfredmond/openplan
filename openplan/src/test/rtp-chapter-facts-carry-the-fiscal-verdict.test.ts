import { describe, expect, it } from "vitest";

import { buildRtpChapterFacts } from "@/lib/rtp/narrative-facts";
import { buildRtpFiscalConstraint } from "@/lib/rtp/fiscal-constraint";
import { buildRtpCycleReadiness, buildRtpCycleWorkflowSummary } from "@/lib/rtp/catalog";

/**
 * THE CHAPTER ABOUT FISCAL CONSTRAINT WAS DRAFTED WITH NO FISCAL FACT.
 *
 * Found by driving the RTP module as a planner on 2026-08-08. A cycle with no
 * revenue rows, no horizon bands and no linked projects has the verdict
 * `not_determined`, and the export says so plainly — "Zero revenue is an empty
 * financial element, not an over-committed plan." The AI draft for the
 * "Financial element and fiscal constraint" chapter nonetheless asserted that
 *
 *     "the revenues anticipated over the twenty-four-year planning period are
 *      sufficient to cover the costs of projects and programs included in the
 *      constrained network"
 *
 * — a fiscal constraint certification, on the one chapter where that sentence
 * carries federal weight, for a plan with no revenue on record.
 *
 * The grounding checker DID flag it, but only as "no citation", because the
 * fact list contained nothing about fiscal constraint for it to contradict. A
 * procedural flag reads as "add a source"; a planner can reasonably keep a
 * sentence that looks like standard RTP language. The fix is not a better
 * warning, it is giving the model — and the checker — the finding the system
 * has already computed.
 */

const CYCLE = {
  title: "2050 Metropolitan Transportation Plan",
  status: "draft",
  geography_label: "Columbus, OH metropolitan planning area",
  horizon_start_year: 2026,
  horizon_end_year: 2050,
  adoption_target_date: null,
  public_review_open_at: null,
  public_review_close_at: null,
};

const CHAPTER = {
  title: "Financial element and fiscal constraint",
  section_type: "financial",
  status: "not_started",
  summary: null,
  guidance: null,
};

function factsWith(fiscalConstraint: Parameters<typeof buildRtpChapterFacts>[0]["fiscalConstraint"]) {
  const readiness = buildRtpCycleReadiness({
    geographyLabel: CYCLE.geography_label,
    horizonStartYear: CYCLE.horizon_start_year,
    horizonEndYear: CYCLE.horizon_end_year,
    adoptionTargetDate: CYCLE.adoption_target_date,
    publicReviewOpenAt: CYCLE.public_review_open_at,
    publicReviewCloseAt: CYCLE.public_review_close_at,
  });

  return buildRtpChapterFacts({
    chapter: CHAPTER,
    cycle: CYCLE,
    readiness,
    workflow: buildRtpCycleWorkflowSummary({ status: CYCLE.status, readiness }),
    linkedProjects: [],
    portfolioFunding: null,
    engagement: null,
    modelingEvidence: [],
    fiscalConstraint,
    kbClaims: [],
  }).map((fact) => fact.claim_text);
}

/** The real verdict for an empty plan: no revenue, no bands, no projects. */
const EMPTY_PLAN_VERDICT = buildRtpFiscalConstraint({
  cycleHorizonStartYear: 2026,
  cycleHorizonEndYear: 2050,
  cycleFinancialBasisYear: null,
  annualInflationRate: null,
  bands: [],
  lines: [],
  projects: [],
});

describe("RTP chapter facts carry the cycle's fiscal verdict", () => {
  it("computes not_determined for a plan with no revenue at all", () => {
    // Guards the fixture itself: if this ever came back "constrained", every
    // assertion below would be testing the wrong world.
    expect(EMPTY_PLAN_VERDICT.verdict).toBe("not_determined");
  });

  it("states the verdict as a citable fact", () => {
    const claims = factsWith(EMPTY_PLAN_VERDICT);

    const fiscal = claims.find((claim) => claim.startsWith("Fiscal constraint finding"));
    expect(fiscal).toBeDefined();
    expect(fiscal).toMatch(/not determined/i);
  });

  it("tells the model not to claim constraint while the finding is undetermined", () => {
    const fiscal = factsWith(EMPTY_PLAN_VERDICT).find((claim) =>
      claim.startsWith("Fiscal constraint finding")
    );

    // The exact sentence the draft produced is what this prohibition exists to
    // stop, so the prohibition has to name that claim, not gesture at it.
    expect(fiscal).toMatch(/Do not state or imply that this plan is fiscally constrained/);
    expect(fiscal).toMatch(/revenues cover programmed costs/);
  });

  /**
   * A ledger that could not be READ is not an empty ledger. The route passes
   * null in that case, and a fabricated "not determined" would be the same
   * false certainty this fact exists to prevent.
   */
  it("says nothing about fiscal constraint when the finding is unavailable", () => {
    const claims = factsWith(null);

    expect(claims.some((claim) => claim.startsWith("Fiscal constraint finding"))).toBe(false);
    expect(claims.join(" ")).not.toMatch(/fiscally constrained/i);
  });

  it("does not attach the prohibition to a determined verdict", () => {
    const determined = { ...EMPTY_PLAN_VERDICT, verdict: "constrained" as const };

    const fiscal = factsWith(determined).find((claim) =>
      claim.startsWith("Fiscal constraint finding")
    );

    expect(fiscal).toBeDefined();
    expect(fiscal).not.toMatch(/Do not state or imply/);
  });
});

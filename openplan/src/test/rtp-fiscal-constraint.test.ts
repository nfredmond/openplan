/**
 * The fiscal-constraint check must refuse to compute through a hole.
 *
 * This is the number a funder verifies and a board votes on. The failure mode
 * that matters is not an arithmetic slip — it is a plan with missing data
 * summing to a total that LOOKS complete and reporting itself affordable. Most
 * of these tests are about that: what the check says when it does not know.
 */
import { describe, expect, it } from "vitest";
import {
  buildRtpFiscalConstraint,
  describeRtpFiscalConstraint,
  escalateToYearOfExpenditure,
  type RtpFinancialLineInput,
  type RtpHorizonBandInput,
  type RtpProgrammedProjectInput,
} from "@/lib/rtp/fiscal-constraint";

const BAND: RtpHorizonBandInput = {
  id: "band-1",
  label: "First ten years",
  startYear: 2026,
  endYear: 2035,
  escalationTargetYear: 2030,
  costEstimateBasis: "itemized",
  sortOrder: 0,
};

function revenue(amount: number | string | null, overrides: Partial<RtpFinancialLineInput> = {}): RtpFinancialLineInput {
  return {
    id: `rev-${Math.abs(Number(amount) || 0)}-${overrides.id ?? ""}`,
    horizonBandId: BAND.id,
    entryKind: "revenue",
    sourceName: "Programme revenue",
    amount,
    amountBasisYear: 2026,
    ...overrides,
  };
}

function project(
  cost: number | string | null,
  overrides: Partial<RtpProgrammedProjectInput> = {}
): RtpProgrammedProjectInput {
  return {
    linkId: `link-${overrides.projectId ?? cost}`,
    projectId: `project-${overrides.projectId ?? cost}`,
    projectName: "Corridor upgrade",
    portfolioRole: "constrained",
    horizonBandId: BAND.id,
    estimatedCost: cost,
    costBasisYear: 2026,
    ...overrides,
  };
}

const BASE = {
  cycleFinancialBasisYear: 2026,
  annualInflationRate: null,
  bands: [BAND],
};

describe("a plan that can be paid for", () => {
  it("is fiscally constrained when revenue covers the whole programme", () => {
    const summary = buildRtpFiscalConstraint({
      ...BASE,
      lines: [revenue(100_000_000)],
      projects: [project(40_000_000, { projectId: "a" }), project(30_000_000, { projectId: "b" })],
    });

    expect(summary.verdict).toBe("constrained");
    expect(summary.capitalCost).toBe(70_000_000);
    expect(summary.revenue).toBe(100_000_000);
    expect(summary.balance).toBe(30_000_000);
    expect(summary.blockers).toEqual([]);
  });

  it("is over-committed when the programme costs more than the revenue", () => {
    const summary = buildRtpFiscalConstraint({
      ...BASE,
      lines: [revenue(50_000_000)],
      projects: [project(80_000_000, { projectId: "a" })],
    });

    expect(summary.verdict).toBe("over_committed");
    expect(summary.balance).toBe(-30_000_000);
  });
});

describe("operations and maintenance is part of what the plan must pay for", () => {
  /**
   * 23 CFR 450.324(f)(11)(i). The approved spec for this feature summed only
   * project capital, which would have declared this exact plan affordable —
   * the defect this test exists to prevent.
   */
  it("turns an otherwise-affordable plan over-committed once O&M is counted", () => {
    const withoutOm = buildRtpFiscalConstraint({
      ...BASE,
      lines: [revenue(100_000_000)],
      projects: [project(90_000_000, { projectId: "a" })],
    });
    expect(withoutOm.verdict).toBe("constrained");

    const withOm = buildRtpFiscalConstraint({
      ...BASE,
      lines: [
        revenue(100_000_000),
        {
          id: "om-1",
          horizonBandId: BAND.id,
          entryKind: "operations_maintenance",
          sourceName: "Operate and maintain the system",
          amount: 40_000_000,
          amountBasisYear: 2026,
        },
      ],
      projects: [project(90_000_000, { projectId: "a" })],
    });

    expect(withOm.verdict).toBe("over_committed");
    expect(withOm.operationsMaintenanceCost).toBe(40_000_000);
    expect(withOm.totalCost).toBe(130_000_000);
    expect(withOm.balance).toBe(-30_000_000);

    // The PER-BAND totals must include O&M too. Asserted separately because
    // the summary re-sums the bands' individually-reported cost fields, so a
    // band whose own totalCost omitted O&M still produced a correct summary —
    // found by mutation, which passed all eighteen tests until these four
    // lines existed.
    expect(withOm.bands[0].operationsMaintenanceCost).toBe(40_000_000);
    expect(withOm.bands[0].totalCost).toBe(130_000_000);
    expect(withOm.bands[0].balance).toBe(-30_000_000);
    expect(withOm.bands[0].verdict).toBe("over_committed");
  });

  it("keeps capital, O&M and other costs separately visible so a planner sees which binds", () => {
    const summary = buildRtpFiscalConstraint({
      ...BASE,
      lines: [
        revenue(100_000_000),
        { id: "om", horizonBandId: BAND.id, entryKind: "operations_maintenance", sourceName: "O&M", amount: 20_000_000, amountBasisYear: 2026 },
        { id: "dbt", horizonBandId: BAND.id, entryKind: "other_cost", sourceName: "Debt service", amount: 5_000_000, amountBasisYear: 2026 },
      ],
      projects: [project(10_000_000, { projectId: "a" })],
    });

    expect(summary.capitalCost).toBe(10_000_000);
    expect(summary.operationsMaintenanceCost).toBe(20_000_000);
    expect(summary.otherCost).toBe(5_000_000);
    expect(summary.totalCost).toBe(35_000_000);
  });
});

describe("the check refuses to compute through missing data", () => {
  it("does NOT report a plan constrained while a constrained project is unpriced", () => {
    const summary = buildRtpFiscalConstraint({
      ...BASE,
      lines: [revenue(100_000_000)],
      projects: [
        project(40_000_000, { projectId: "a" }),
        project(null, { projectId: "b", projectName: "Unpriced bridge" }),
      ],
    });

    // The arithmetic alone would have said "constrained" — 40M against 100M.
    expect(summary.balance).toBeGreaterThan(0);
    expect(summary.verdict).toBe("not_determined");
    expect(summary.blockers.map((blocker) => blocker.code)).toContain("unpriced_constrained_project");
    // And it names the project, so the planner knows what to go and enter.
    expect(summary.unresolvedProjects).toEqual([
      expect.objectContaining({ projectId: "b", projectName: "Unpriced bridge", reason: "unpriced" }),
    ]);
  });

  it("treats an unparseable or negative cost as unpriced, never as zero", () => {
    for (const bad of ["", "not a number", -5] as Array<string | number>) {
      const summary = buildRtpFiscalConstraint({
        ...BASE,
        lines: [revenue(100_000_000)],
        projects: [project(bad, { projectId: "a" })],
      });
      expect(summary.verdict).toBe("not_determined");
      expect(summary.capitalCost).toBe(0);
      expect(summary.unresolvedProjects[0]?.reason).toBe("unpriced");
    }
  });

  it("does not determine a plan whose constrained project belongs to no period", () => {
    const summary = buildRtpFiscalConstraint({
      ...BASE,
      lines: [revenue(100_000_000)],
      projects: [project(10_000_000, { projectId: "a", horizonBandId: null })],
    });

    expect(summary.verdict).toBe("not_determined");
    expect(summary.blockers.map((blocker) => blocker.code)).toContain("unbanded_constrained_project");
  });

  it("calls an empty financial element undetermined rather than over-committed", () => {
    const summary = buildRtpFiscalConstraint({
      ...BASE,
      lines: [],
      projects: [project(10_000_000, { projectId: "a" })],
    });

    // Zero revenue against real cost is not a finding about affordability.
    expect(summary.verdict).toBe("not_determined");
    expect(summary.blockers.map((blocker) => blocker.code)).toContain("no_revenue_recorded");
  });

  it("refuses to add different base years together with no inflation rate", () => {
    const summary = buildRtpFiscalConstraint({
      ...BASE,
      lines: [revenue(100_000_000, { amountBasisYear: 2026 })],
      projects: [project(10_000_000, { projectId: "a", costBasisYear: 2040 })],
    });

    expect(summary.verdict).toBe("not_determined");
    expect(summary.blockers.map((blocker) => blocker.code)).toContain("irreconcilable_base_years");
  });

  it("has no bands to compare against when none are declared", () => {
    const summary = buildRtpFiscalConstraint({
      cycleFinancialBasisYear: 2026,
      annualInflationRate: null,
      bands: [],
      lines: [],
      projects: [],
    });

    expect(summary.verdict).toBe("not_determined");
    expect(summary.blockers.map((blocker) => blocker.code)).toContain("no_horizon_bands");
  });
});

describe("only the constrained programme counts as cost", () => {
  it("excludes illustrative and candidate projects from the total", () => {
    const summary = buildRtpFiscalConstraint({
      ...BASE,
      lines: [revenue(100_000_000)],
      projects: [
        project(50_000_000, { projectId: "a" }),
        project(400_000_000, { projectId: "b", portfolioRole: "illustrative" }),
        project(300_000_000, { projectId: "c", portfolioRole: "candidate" }),
      ],
    });

    // 23 CFR 450.324(f)(11)(vii) and (l): the illustrative list is what the
    // agency would build if more money appeared. Counting it would make every
    // plan look over-committed and punish an agency for documenting ambition.
    expect(summary.capitalCost).toBe(50_000_000);
    expect(summary.verdict).toBe("constrained");
    expect(summary.illustrativeProjectCount).toBe(1);
    expect(summary.constrainedProjectCount).toBe(1);
  });

  it("does not treat an UNPRICED illustrative project as a blocker", () => {
    const summary = buildRtpFiscalConstraint({
      ...BASE,
      lines: [revenue(100_000_000)],
      projects: [
        project(50_000_000, { projectId: "a" }),
        project(null, { projectId: "b", portfolioRole: "illustrative" }),
      ],
    });

    // An illustrative project is outside the constrained programme, so its
    // missing cost cannot make the constrained total incomplete.
    expect(summary.verdict).toBe("constrained");
    expect(summary.unresolvedProjects).toEqual([]);
  });
});

describe("year-of-expenditure dollars", () => {
  it("escalates to the band's expenditure year when a rate is recorded", () => {
    const summary = buildRtpFiscalConstraint({
      ...BASE,
      annualInflationRate: 0.03,
      lines: [revenue(100_000_000)],
      projects: [project(10_000_000, { projectId: "a" })],
    });

    // 2026 dollars spent in 2030: four years at 3%.
    const expected = 10_000_000 * Math.pow(1.03, 4);
    expect(summary.dollarBasis).toBe("year_of_expenditure");
    expect(summary.capitalCost).toBeCloseTo(expected, 0);
    expect(summary.capitalCost).toBeGreaterThan(10_000_000);
  });

  it("reports CONSTANT dollars, and says so, when no rate is recorded", () => {
    const summary = buildRtpFiscalConstraint({
      ...BASE,
      lines: [revenue(100_000_000)],
      projects: [project(10_000_000, { projectId: "a" })],
    });

    expect(summary.dollarBasis).toBe("constant");
    expect(summary.capitalCost).toBe(10_000_000);
    // The sentence a board reads must not present constant dollars as YOE.
    const sentence = describeRtpFiscalConstraint(summary);
    expect(sentence).toContain("constant 2026 dollars");
    expect(sentence).toContain("not year-of-expenditure");
  });

  it("uses the band midpoint when the agency has not named an expenditure year, and flags the assumption", () => {
    const summary = buildRtpFiscalConstraint({
      ...BASE,
      annualInflationRate: 0.03,
      bands: [{ ...BAND, escalationTargetYear: null }],
      lines: [revenue(100_000_000)],
      projects: [project(10_000_000, { projectId: "a" })],
    });

    expect(summary.bands[0].expenditureYear).toBe(2030); // midpoint of 2026–2035
    expect(summary.bands[0].expenditureYearAssumed).toBe(true);
  });

  it("never discounts backwards for an expenditure year before the basis year", () => {
    expect(escalateToYearOfExpenditure(1000, 2030, 2026, 0.03)).toBe(1000);
    expect(escalateToYearOfExpenditure(1000, null, 2030, 0.03)).toBe(1000);
    expect(escalateToYearOfExpenditure(1000, 2026, 2030, null)).toBe(1000);
  });
});

describe("per-period results", () => {
  it("reports each band separately so a planner sees which period is short", () => {
    const later: RtpHorizonBandInput = {
      id: "band-2",
      label: "2036–2050",
      startYear: 2036,
      endYear: 2050,
      escalationTargetYear: 2043,
      costEstimateBasis: "banded",
      sortOrder: 1,
    };

    const summary = buildRtpFiscalConstraint({
      cycleFinancialBasisYear: 2026,
      annualInflationRate: null,
      bands: [BAND, later],
      lines: [revenue(100_000_000), revenue(20_000_000, { id: "later", horizonBandId: later.id })],
      projects: [
        project(50_000_000, { projectId: "a" }),
        project(80_000_000, { projectId: "b", horizonBandId: later.id }),
      ],
    });

    expect(summary.bands.map((band) => band.verdict)).toEqual(["constrained", "over_committed"]);
    expect(summary.bands[1].balance).toBe(-60_000_000);
    // The plan as a whole is over-committed even though its first period is not.
    expect(summary.verdict).toBe("over_committed");
  });
});

describe("the sentence a board reads", () => {
  it("states what is missing rather than a number, when nothing was determined", () => {
    const summary = buildRtpFiscalConstraint({
      ...BASE,
      lines: [revenue(100_000_000)],
      projects: [project(null, { projectId: "a" })],
    });

    const sentence = describeRtpFiscalConstraint(summary);
    expect(sentence).toContain("has not been determined");
    expect(sentence).toContain("no cost recorded");
    // It must not quote a total it does not stand behind.
    expect(sentence).not.toContain("$");
  });
});

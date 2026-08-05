/**
 * Whether an RTP can be paid for — the fiscal-constraint check.
 *
 * 23 CFR 450.324(f)(11) requires an RTP's financial plan to "demonstrate how
 * the adopted transportation plan can be implemented". This module is that
 * demonstration, and everything unusual about its shape comes from one
 * conviction: **the honest answer to "is this plan fiscally constrained?" is
 * very often "we cannot tell yet", and saying so is worth more than a number.**
 *
 * A constraint check is the single figure a funder verifies and a board votes
 * on. A check that computes through missing data produces a plan that looks
 * affordable and is not — which is worse than no check at all, because nobody
 * looks again. So `not_determined` is a first-class verdict here, it outranks
 * both other verdicts, and every reason for it is named in `blockers` so a
 * planner is told what to go and enter.
 *
 * FOUR THINGS THAT BLOCK A DETERMINATION, each a real failure mode:
 *
 *   1. A constrained project with no cost. NULL means unpriced, never zero.
 *   2. A constrained project in no horizon band — its cost belongs to no
 *      period, so no period's balance can include it.
 *   3. No revenue recorded at all. Zero revenue against real costs is not
 *      "over-committed", it is an empty financial element.
 *   4. Amounts in different base years with no inflation rate to reconcile
 *      them. Adding 2026 dollars to 2040 dollars produces a number that means
 *      nothing.
 *
 * ONLY `constrained` PROJECTS COUNT AS COST. 23 CFR 450.324(f)(11)(vii) and
 * paragraph (l) put illustrative projects explicitly outside the constrained
 * program — they are what the agency would build if more money appeared — and
 * a `candidate` is not yet in the plan at all. Counting either against revenue
 * would make every plan look over-committed and would punish an agency for
 * documenting its ambitions, which is the opposite of what the illustrative
 * list is for.
 */
import { parseOptionalAmount } from "@/lib/money/optional-amount";

export type RtpFiscalEntryKind = "revenue" | "operations_maintenance" | "other_cost";

/** Matches `project_rtp_cycle_links.portfolio_role`. */
export const RTP_CONSTRAINED_PORTFOLIO_ROLE = "constrained";

export interface RtpHorizonBandInput {
  id: string;
  label: string;
  startYear: number;
  endYear: number;
  /** Null means the midpoint is used AND the assumption is disclosed. */
  escalationTargetYear: number | null;
  costEstimateBasis: "itemized" | "banded";
  sortOrder: number;
}

export interface RtpFinancialLineInput {
  id: string;
  horizonBandId: string;
  entryKind: RtpFiscalEntryKind;
  sourceName: string;
  amount: number | string | null;
  amountBasisYear: number | null;
}

export interface RtpProgrammedProjectInput {
  linkId: string;
  projectId: string;
  projectName: string | null;
  portfolioRole: string | null;
  horizonBandId: string | null;
  estimatedCost: number | string | null;
  costBasisYear: number | null;
}

export interface RtpFiscalConstraintInput {
  cycleFinancialBasisYear: number | null;
  annualInflationRate: number | string | null;
  bands: readonly RtpHorizonBandInput[];
  lines: readonly RtpFinancialLineInput[];
  projects: readonly RtpProgrammedProjectInput[];
}

export type RtpFiscalVerdict = "constrained" | "over_committed" | "not_determined";

/** Machine-readable reasons a determination could not be made. */
export type RtpFiscalBlockerCode =
  | "unpriced_constrained_project"
  | "unbanded_constrained_project"
  | "no_revenue_recorded"
  | "irreconcilable_base_years"
  | "no_horizon_bands";

export interface RtpFiscalBlocker {
  code: RtpFiscalBlockerCode;
  /** A sentence a planner reads, naming what to do about it. */
  detail: string;
}

export interface RtpFiscalBandResult {
  bandId: string;
  label: string;
  startYear: number;
  endYear: number;
  costEstimateBasis: "itemized" | "banded";
  /** The year this band's money is treated as spent. */
  expenditureYear: number;
  /** True when `expenditureYear` came from the midpoint rather than the agency. */
  expenditureYearAssumed: boolean;
  revenue: number;
  capitalCost: number;
  operationsMaintenanceCost: number;
  otherCost: number;
  totalCost: number;
  /** revenue − totalCost. Negative means this period is over-committed. */
  balance: number;
  verdict: RtpFiscalVerdict;
  constrainedProjectCount: number;
  unpricedProjectCount: number;
  blockers: RtpFiscalBlocker[];
}

export interface RtpFiscalUnresolvedProject {
  linkId: string;
  projectId: string;
  projectName: string | null;
  reason: "unpriced" | "unbanded";
}

export interface RtpFiscalConstraintSummary {
  /**
   * Whether the figures below are year-of-expenditure dollars — which
   * 23 CFR 450.324(f)(11)(iv) requires — or constant dollars, which they fall
   * back to when the agency has recorded no inflation rate. Every surface must
   * render this; presenting constant dollars as YOE is the misstatement this
   * field exists to prevent.
   */
  dollarBasis: "year_of_expenditure" | "constant";
  basisYear: number | null;
  inflationRate: number | null;
  bands: RtpFiscalBandResult[];
  revenue: number;
  capitalCost: number;
  operationsMaintenanceCost: number;
  otherCost: number;
  totalCost: number;
  balance: number;
  verdict: RtpFiscalVerdict;
  blockers: RtpFiscalBlocker[];
  constrainedProjectCount: number;
  illustrativeProjectCount: number;
  /** Constrained projects that could not be counted, and why. */
  unresolvedProjects: RtpFiscalUnresolvedProject[];
}

function parseRate(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) return null;
  return parsed;
}

function midpoint(startYear: number, endYear: number): number {
  return Math.floor((startYear + endYear) / 2);
}

/**
 * Escalate a constant-dollar amount to the year it is expected to be spent.
 *
 * Returns the amount unchanged when there is no rate — the caller has already
 * decided, via `dollarBasis`, that it is reporting constant dollars and will
 * say so.
 */
export function escalateToYearOfExpenditure(
  amount: number,
  basisYear: number | null,
  expenditureYear: number,
  annualInflationRate: number | null
): number {
  if (annualInflationRate === null || basisYear === null) return amount;
  const years = expenditureYear - basisYear;
  if (years <= 0) return amount;
  return amount * Math.pow(1 + annualInflationRate, years);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * The heart of it. Pure — no I/O, no clock — so it can be exercised over the
 * awkward cases (unpriced, unbanded, no revenue, mixed base years) directly.
 */
export function buildRtpFiscalConstraint(
  input: RtpFiscalConstraintInput
): RtpFiscalConstraintSummary {
  const rate = parseRate(input.annualInflationRate);
  const cycleBasisYear = input.cycleFinancialBasisYear;
  const dollarBasis: RtpFiscalConstraintSummary["dollarBasis"] =
    rate === null ? "constant" : "year_of_expenditure";

  const bands = [...input.bands].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.startYear - b.startYear || a.label.localeCompare(b.label)
  );
  const bandById = new Map(bands.map((band) => [band.id, band]));

  const constrained = input.projects.filter(
    (project) => project.portfolioRole === RTP_CONSTRAINED_PORTFOLIO_ROLE
  );
  const illustrativeProjectCount = input.projects.filter(
    (project) => project.portfolioRole === "illustrative"
  ).length;

  const unresolvedProjects: RtpFiscalUnresolvedProject[] = [];
  const summaryBlockers: RtpFiscalBlocker[] = [];

  // Base years actually in play, so mixed constant dollars can be detected.
  const observedBasisYears = new Set<number>();
  const recordBasisYear = (year: number | null) => {
    const effective = year ?? cycleBasisYear;
    if (effective !== null && effective !== undefined) observedBasisYears.add(effective);
  };

  type Accumulator = {
    revenue: number;
    capitalCost: number;
    operationsMaintenanceCost: number;
    otherCost: number;
    constrainedProjectCount: number;
    unpricedProjectCount: number;
  };
  const zero = (): Accumulator => ({
    revenue: 0,
    capitalCost: 0,
    operationsMaintenanceCost: 0,
    otherCost: 0,
    constrainedProjectCount: 0,
    unpricedProjectCount: 0,
  });
  const perBand = new Map<string, Accumulator>(bands.map((band) => [band.id, zero()]));

  const expenditureYearFor = (band: RtpHorizonBandInput) =>
    band.escalationTargetYear ?? midpoint(band.startYear, band.endYear);

  // --- the ledger ---------------------------------------------------------
  let anyRevenueRecorded = false;
  for (const line of input.lines) {
    const band = bandById.get(line.horizonBandId);
    if (!band) continue; // a line whose band was removed contributes to nothing
    const accumulator = perBand.get(band.id);
    if (!accumulator) continue;

    const amount = parseOptionalAmount(line.amount);
    if (amount === null) continue; // unparseable is absent, never zero
    recordBasisYear(line.amountBasisYear);

    const escalated = escalateToYearOfExpenditure(
      amount,
      line.amountBasisYear ?? cycleBasisYear,
      expenditureYearFor(band),
      rate
    );

    if (line.entryKind === "revenue") {
      accumulator.revenue += escalated;
      anyRevenueRecorded = true;
    } else if (line.entryKind === "operations_maintenance") {
      accumulator.operationsMaintenanceCost += escalated;
    } else {
      accumulator.otherCost += escalated;
    }
  }

  // --- the constrained program -------------------------------------------
  for (const project of constrained) {
    const band = project.horizonBandId ? bandById.get(project.horizonBandId) : undefined;
    if (!band) {
      unresolvedProjects.push({
        linkId: project.linkId,
        projectId: project.projectId,
        projectName: project.projectName,
        reason: "unbanded",
      });
      continue;
    }

    const accumulator = perBand.get(band.id);
    if (!accumulator) continue;
    accumulator.constrainedProjectCount += 1;

    const cost = parseOptionalAmount(project.estimatedCost);
    if (cost === null) {
      accumulator.unpricedProjectCount += 1;
      unresolvedProjects.push({
        linkId: project.linkId,
        projectId: project.projectId,
        projectName: project.projectName,
        reason: "unpriced",
      });
      continue;
    }

    recordBasisYear(project.costBasisYear);
    accumulator.capitalCost += escalateToYearOfExpenditure(
      cost,
      project.costBasisYear ?? cycleBasisYear,
      expenditureYearFor(band),
      rate
    );
  }

  // --- blockers -----------------------------------------------------------
  if (bands.length === 0) {
    summaryBlockers.push({
      code: "no_horizon_bands",
      detail:
        "This plan has no horizon bands, so costs and revenues belong to no period and cannot be compared. Add the periods this plan programmes money across.",
    });
  }

  const unpricedCount = unresolvedProjects.filter((item) => item.reason === "unpriced").length;
  if (unpricedCount > 0) {
    summaryBlockers.push({
      code: "unpriced_constrained_project",
      detail: `${unpricedCount} constrained ${unpricedCount === 1 ? "project has" : "projects have"} no cost recorded, so the constrained total is incomplete and cannot be compared with revenue.`,
    });
  }

  const unbandedCount = unresolvedProjects.filter((item) => item.reason === "unbanded").length;
  if (unbandedCount > 0) {
    summaryBlockers.push({
      code: "unbanded_constrained_project",
      detail: `${unbandedCount} constrained ${unbandedCount === 1 ? "project is" : "projects are"} not assigned to a horizon band, so ${unbandedCount === 1 ? "its cost belongs" : "their costs belong"} to no period.`,
    });
  }

  if (!anyRevenueRecorded) {
    summaryBlockers.push({
      code: "no_revenue_recorded",
      detail:
        "No revenue assumptions have been recorded, so there is nothing to compare the programme against. Zero revenue is an empty financial element, not an over-committed plan.",
    });
  }

  // Mixed constant-dollar base years with no rate cannot be added together.
  if (rate === null && observedBasisYears.size > 1) {
    const years = [...observedBasisYears].sort((a, b) => a - b);
    summaryBlockers.push({
      code: "irreconcilable_base_years",
      detail: `Amounts are recorded in ${years.length} different base years (${years.join(", ")}) and no inflation rate is set, so they cannot be added together. Record an annual inflation rate, or restate the amounts in one base year.`,
    });
  }

  // --- roll up ------------------------------------------------------------
  const bandResults: RtpFiscalBandResult[] = bands.map((band) => {
    const accumulator = perBand.get(band.id) ?? zero();
    const totalCost =
      accumulator.capitalCost + accumulator.operationsMaintenanceCost + accumulator.otherCost;
    const balance = accumulator.revenue - totalCost;

    const bandBlockers: RtpFiscalBlocker[] = [];
    if (accumulator.unpricedProjectCount > 0) {
      bandBlockers.push({
        code: "unpriced_constrained_project",
        detail: `${accumulator.unpricedProjectCount} constrained ${accumulator.unpricedProjectCount === 1 ? "project in this period has" : "projects in this period have"} no cost recorded.`,
      });
    }
    if (accumulator.revenue === 0) {
      bandBlockers.push({
        code: "no_revenue_recorded",
        detail: "No revenue is assigned to this period.",
      });
    }

    return {
      bandId: band.id,
      label: band.label,
      startYear: band.startYear,
      endYear: band.endYear,
      costEstimateBasis: band.costEstimateBasis,
      expenditureYear: expenditureYearFor(band),
      expenditureYearAssumed: band.escalationTargetYear === null,
      revenue: round2(accumulator.revenue),
      capitalCost: round2(accumulator.capitalCost),
      operationsMaintenanceCost: round2(accumulator.operationsMaintenanceCost),
      otherCost: round2(accumulator.otherCost),
      totalCost: round2(totalCost),
      balance: round2(balance),
      // A period cannot be declared constrained while something in it is
      // unknown, for the same reason the plan cannot.
      verdict: bandBlockers.length > 0 ? "not_determined" : balance >= 0 ? "constrained" : "over_committed",
      constrainedProjectCount: accumulator.constrainedProjectCount,
      unpricedProjectCount: accumulator.unpricedProjectCount,
      blockers: bandBlockers,
    };
  });

  const revenue = bandResults.reduce((sum, band) => sum + band.revenue, 0);
  const capitalCost = bandResults.reduce((sum, band) => sum + band.capitalCost, 0);
  const operationsMaintenanceCost = bandResults.reduce(
    (sum, band) => sum + band.operationsMaintenanceCost,
    0
  );
  const otherCost = bandResults.reduce((sum, band) => sum + band.otherCost, 0);
  const totalCost = capitalCost + operationsMaintenanceCost + otherCost;
  const balance = revenue - totalCost;

  // `not_determined` OUTRANKS both other verdicts. This is the line that keeps
  // an incomplete plan from reporting itself affordable.
  const verdict: RtpFiscalVerdict =
    summaryBlockers.length > 0 ? "not_determined" : balance >= 0 ? "constrained" : "over_committed";

  return {
    dollarBasis,
    basisYear: cycleBasisYear,
    inflationRate: rate,
    bands: bandResults,
    revenue: round2(revenue),
    capitalCost: round2(capitalCost),
    operationsMaintenanceCost: round2(operationsMaintenanceCost),
    otherCost: round2(otherCost),
    totalCost: round2(totalCost),
    balance: round2(balance),
    verdict,
    blockers: summaryBlockers,
    constrainedProjectCount: constrained.length,
    illustrativeProjectCount,
    unresolvedProjects,
  };
}

export function rtpFiscalVerdictLabel(verdict: RtpFiscalVerdict): string {
  if (verdict === "constrained") return "Fiscally constrained";
  if (verdict === "over_committed") return "Costs exceed revenue";
  return "Not determined";
}

export function rtpFiscalVerdictTone(verdict: RtpFiscalVerdict): "success" | "warning" | "neutral" {
  if (verdict === "constrained") return "success";
  if (verdict === "over_committed") return "warning";
  return "neutral";
}

/**
 * One sentence a board can read, which never claims more than was computed.
 * The dollar basis travels with the number because a constant-dollar total
 * presented as year-of-expenditure is exactly the misstatement 23 CFR
 * 450.324(f)(11)(iv) is about.
 */
export function describeRtpFiscalConstraint(summary: RtpFiscalConstraintSummary): string {
  const basisPhrase =
    summary.dollarBasis === "year_of_expenditure"
      ? "in year-of-expenditure dollars"
      : summary.basisYear
        ? `in constant ${summary.basisYear} dollars (no inflation rate recorded, so these are not year-of-expenditure figures)`
        : "in constant dollars of an unstated base year (no inflation rate recorded, so these are not year-of-expenditure figures)";

  if (summary.verdict === "not_determined") {
    const reasons = summary.blockers.map((blocker) => blocker.detail).join(" ");
    return `Whether this plan is fiscally constrained has not been determined. ${reasons}`.trim();
  }

  const money = (value: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(value);

  if (summary.verdict === "constrained") {
    return `The constrained programme totals ${money(summary.totalCost)} against ${money(summary.revenue)} of reasonably available revenue ${basisPhrase}, leaving ${money(summary.balance)} unprogrammed.`;
  }

  return `The constrained programme totals ${money(summary.totalCost)} against ${money(summary.revenue)} of reasonably available revenue ${basisPhrase} — ${money(Math.abs(summary.balance))} more than the plan can pay for.`;
}

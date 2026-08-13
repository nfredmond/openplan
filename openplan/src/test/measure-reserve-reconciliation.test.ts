import { describe, expect, it } from "vitest";
import {
  allocateMeasureReceipt,
  parseMeasureAllocationRule,
  type MeasureAllocationResult,
  type MeasureReserveLine,
} from "@/lib/measures/allocation";
import { buildMeasureClaimLedger, buildMeasureMoeSummary } from "@/lib/measures/claims";
import { buildMeasureReceiptLedger, type MeasureReserveRecord } from "@/lib/measures/receipts";
import { buildMeasureOversightModel, type OversightDivision } from "@/lib/measures/oversight";

/**
 * THE WHOLE CHAIN, ON PAPER FIRST: allocator → the rows a period stores →
 * the four figures a citizens' oversight committee reads.
 *
 * ============================================================================
 * WHY THIS FILE EXISTS BESIDE THREE THAT ALREADY TEST ITS PARTS
 * ============================================================================
 *
 * `measure-allocation-arithmetic.test.ts` pins the allocator and knows nothing
 * about a database. `measure-allocate-route.test.ts` pins the rows the route
 * writes and knows nothing about the oversight page. `measure-oversight-public-
 * page.test.tsx` renders the page from hand-written rows and knows nothing
 * about where they came from.
 *
 * Each half can be right while the SEAM is wrong, and the seam is where this
 * lane's defect lived: the allocator computed reserves, nothing stored them,
 * and the page subtracted what it had. Every part passed. So this file walks
 * the whole way through in one pass and asserts, at the end, the property the
 * lane exists for:
 *
 *     received − taken out first − kept back in reserve
 *       = Σ what the ordinance's purposes were given, EXACTLY
 *
 * ============================================================================
 * THE WORKED EXAMPLE, DERIVED ON PAPER BEFORE ANY CODE WAS RUN
 * ============================================================================
 *
 * The ordinance: 1% off the top for administration, capped at 40,000 in any one
 * period; 2% of everything that came in kept as a rainy-day fund; 50/30/20 over
 * what is left; then 10% of the transit share kept for bus replacement. Half-up
 * at the cent throughout.
 *
 *   PERIOD ONE — received 4,812,340.17
 *     1% of the receipt              48,123.40   (4,812,340.1700 × 0.01)
 *     limited by the 40,000 cap to   40,000.00   <- the cap bites
 *     after that                  4,772,340.17
 *     rainy-day, 2% of GROSS         96,246.80   (96,246.8034 half-up)
 *     pool to divide              4,676,093.37
 *       streets  50%              2,338,046.69   (2,338,046.685 half-up)
 *       transit  30%              1,402,828.01   (1,402,828.011 half-down)
 *       active   20%                935,218.67   (935,218.674 half-down)
 *                              Σ  4,676,093.37   exact — no residual
 *     bus replacement, 10% of transit  140,282.80   (140,282.801 half-down)
 *     transit after that          1,262,545.21
 *     what the purposes got       4,535,810.57   (2,338,046.69 + 1,262,545.21
 *                                                 + 935,218.67)
 *
 *   PERIOD TWO — received 5,000,000.00
 *     1% of the receipt              50,000.00
 *     limited by the 40,000 cap to   40,000.00   <- the cap bites again
 *     after that                  4,960,000.00
 *     rainy-day, 2% of GROSS        100,000.00
 *     pool to divide              4,860,000.00
 *       streets  50%              2,430,000.00
 *       transit  30%              1,458,000.00
 *       active   20%                972,000.00
 *     bus replacement, 10% of transit  145,800.00
 *     transit after that          1,312,200.00
 *     what the purposes got       4,714,200.00
 *
 *   THE TWO PERIODS TOGETHER
 *     received                    9,812,340.17
 *     taken out first                80,000.00   (40,000.00 × 2)
 *     kept back in reserve          482,329.60   (rainy-day 196,246.80
 *                                                 + bus replacement 286,082.80)
 *     left for the purposes       9,250,010.57
 *     streets                     4,768,046.69   (2,338,046.69 + 2,430,000.00)
 *     transit                     2,574,745.21   (1,262,545.21 + 1,312,200.00)
 *     active                      1,907,218.67   (  935,218.67 +   972,000.00)
 *                              Σ  9,250,010.57   <- must close on this
 *
 * NOTE THE TWO BASES THAT ARE EASY TO GET WRONG, and that this fixture would
 * catch. The rainy-day reserve is 2% of the RECEIPT, not of what was left after
 * the take — 2% of 4,772,340.17 would be 95,446.80, a thousand dollars out. The
 * bus-replacement reserve is 10% of the transit share BEFORE the reserve, not
 * after — 10% of 1,262,545.21 would be 126,254.52.
 */

const ORDINANCE = parseMeasureAllocationRule({
  version: 1,
  offTheTop: [
    { id: "administration", label: "Running the programme", percent: 1, capAmount: 40000, capBasis: "per_period" },
  ],
  reserves: [
    { id: "rainy_day", label: "Rainy-day fund", basis: "gross", percent: 2 },
    { id: "bus_replacement", label: "Bus replacement fund", basis: "category:transit", percent: 10 },
  ],
  categories: [
    { id: "streets", label: "Local streets and roads", percentOfAllocable: 50, distribution: { kind: "pooled" } },
    { id: "transit", label: "Transit service", percentOfAllocable: 30, distribution: { kind: "pooled" } },
    { id: "active", label: "Walking and biking", percentOfAllocable: 20, distribution: { kind: "pooled" } },
  ],
  basisDefinitions: [],
});

const PERIODS = [
  {
    id: "p1",
    measure_fund_id: "fund-1",
    period_label: "FY26 Q1",
    fiscal_year_label: "FY 2026",
    period_start: "2025-07-01",
    period_end: "2025-09-30",
    received_amount: "4812340.17",
    received_on: "2025-10-20",
  },
  {
    id: "p2",
    measure_fund_id: "fund-1",
    period_label: "FY26 Q2",
    fiscal_year_label: "FY 2026",
    period_start: "2025-10-01",
    period_end: "2025-12-31",
    received_amount: "5000000.00",
    received_on: "2026-01-21",
  },
] as const;

function allocate(receiptAmount: string): MeasureAllocationResult {
  const outcome = allocateMeasureReceipt({ rule: ORDINANCE, receiptAmount });
  if (!outcome.ok) throw new Error(`the fixture ordinance refused a recorded receipt: ${outcome.reason}`);
  return outcome.allocation;
}

/**
 * The allocator's reserve lines as `measure_period_reserve` stores them.
 *
 * A SMALL, DELIBERATE ECHO of the allocate route's own mapping — kept small on
 * purpose, and NOT a second definition of it: the route's version is asserted
 * field by field in `measure-allocate-route.test.ts` against the real handler.
 * What this file needs it for is the seam, and the seam is only real if the
 * rows the page reads were derived from the figures the allocator produced
 * rather than typed in beside them.
 */
function reserveRows(allocation: MeasureAllocationResult, periodId: string) {
  const labels = new Map(allocation.categories.map((category) => [category.id, category.label]));
  const row = (line: MeasureReserveLine) => {
    const categoryId = line.basis.startsWith("category:") ? line.basis.slice("category:".length) : null;
    return {
      period_id: periodId,
      reserve_id: line.id,
      label: line.label,
      basis_kind: categoryId ? "category" : line.basis,
      basis_category_id: categoryId,
      basis_category_label: categoryId ? labels.get(categoryId) ?? line.label : null,
      basis_amount: line.basisAmount.toFixed(2),
      percent: line.percent.toFixed(4),
      amount: line.amount.toFixed(2),
      computed_amount: line.computedAmount.toFixed(2),
    };
  };
  return [...allocation.poolReserves.map(row), ...allocation.categoryReserves.map(row)];
}

function takeRows(allocation: MeasureAllocationResult, periodId: string) {
  return allocation.offTheTop.map((line) => ({
    period_id: periodId,
    off_the_top_id: line.id,
    label: line.label,
    amount: line.amount.toFixed(2),
    uncapped_amount: line.uncappedAmount.toFixed(2),
    cap_amount: line.capAmount === null ? null : line.capAmount.toFixed(2),
    cap_basis: line.capBasis,
    cap_status: line.capStatus,
  }));
}

/** Pooled categories: one allocation row each, holding the PROGRAMMABLE amount. */
function allocationRows(allocation: MeasureAllocationResult, periodId: string) {
  return allocation.categories.map((category) => ({
    period_id: periodId,
    category_id: category.id,
    recipient_id: null,
    amount: category.programmableAmount.toFixed(2),
    computation_basis: "descriptor",
  }));
}

const FIRST = allocate("4812340.17");
const SECOND = allocate("5000000.00");

const ALLOCATIONS = [...allocationRows(FIRST, "p1"), ...allocationRows(SECOND, "p2")];
const TAKES = [...takeRows(FIRST, "p1"), ...takeRows(SECOND, "p2")];
const RESERVES = [...reserveRows(FIRST, "p1"), ...reserveRows(SECOND, "p2")];

/**
 * An allocation recorded under a heading the ordinance in force does not list —
 * the other thing that can legitimately open a gap on this page. Kept out of
 * the main fixture so the ordinary case really does close on nothing.
 */
const UNLISTED_ALLOCATION = {
  period_id: "p1",
  category_id: "legacy_debt",
  recipient_id: null,
  amount: "100000.00",
  computation_basis: "descriptor",
};

function division(
  overrides: { reserves?: readonly MeasureReserveRecord[]; withUnlistedHeading?: boolean } = {}
): OversightDivision {
  const allocations = overrides.withUnlistedHeading ? [...ALLOCATIONS, UNLISTED_ALLOCATION] : ALLOCATIONS;
  const model = buildMeasureOversightModel({
    programTitle: "Example County Transportation Measure",
    currencyCode: "USD",
    rateLabel: "Half-cent sales tax",
    ordinanceReference: "Ordinance 2024-11",
    adoptedOn: null,
    sunsetOn: null,
    sunsetPosture: "not_recorded",
    receiptResult: buildMeasureReceiptLedger({ periodRead: { ok: true, periods: [...PERIODS] } }),
    claimResult: buildMeasureClaimLedger({
      claimRead: { ok: true, claims: [] },
      allocations,
      periods: [...PERIODS],
    }),
    moeSummary: buildMeasureMoeSummary({ records: [] }),
    rule: ORDINANCE,
    ruleUnavailableSentence: null,
    recipients: [],
    offTheTopRead: { ok: true, takes: TAKES },
    reserveRead: { ok: true, reserves: [...(overrides.reserves ?? RESERVES)] },
    allocations,
    fiscalYearLabel: null,
  });

  if (!model.division || !model.division.ok) throw new Error("the division section was not built");
  return model.division.value;
}

/** "USD 9,250,010.57" -> 9250010.57, from the text a reader actually gets. */
function money(text: string): number {
  const match = /-?[\d,]+\.\d{2}/.exec(text.replaceAll(String.fromCharCode(160), " "));
  if (!match) throw new Error(`no money figure in ${JSON.stringify(text)}`);
  return Number(match[0].replaceAll(",", ""));
}

describe("the allocator's own figures, cent by cent", () => {
  it("takes 1% off the top and stops at the period cap", () => {
    expect(FIRST.offTheTop).toHaveLength(1);
    expect(FIRST.offTheTop[0].uncappedAmount).toBe(48123.4);
    expect(FIRST.offTheTop[0].amount).toBe(40000);
    expect(FIRST.offTheTop[0].capStatus).toBe("capped");
    expect(SECOND.offTheTop[0].uncappedAmount).toBe(50000);
    expect(SECOND.offTheTop[0].amount).toBe(40000);
  });

  it("takes the pool reserve out of the RECEIPT, not out of what the take left", () => {
    expect(FIRST.poolReserves).toHaveLength(1);
    expect(FIRST.poolReserves[0]).toMatchObject({
      id: "rainy_day",
      basis: "gross",
      percent: 2,
      basisAmount: 4812340.17,
      amount: 96246.8,
      computedAmount: 96246.8,
    });
    // The wrong base, stated so the assertion above cannot pass by coincidence:
    // 2% of 4,772,340.17 is 95,446.80.
    expect(FIRST.poolReserves[0].amount).not.toBe(95446.8);
    expect(SECOND.poolReserves[0].amount).toBe(100000);
  });

  it("divides the pool 50/30/20 with no residual to place", () => {
    expect(FIRST.allocableAmount).toBe(4676093.37);
    expect(FIRST.categories.map((category) => category.amount)).toEqual([2338046.69, 1402828.01, 935218.67]);
    expect(FIRST.roundingResidual).toBe(0);
    expect(SECOND.allocableAmount).toBe(4860000);
    expect(SECOND.categories.map((category) => category.amount)).toEqual([2430000, 1458000, 972000]);
  });

  it("takes the purpose-level reserve out of that purpose's share BEFORE the reserve", () => {
    expect(FIRST.categoryReserves).toHaveLength(1);
    expect(FIRST.categoryReserves[0]).toMatchObject({
      id: "bus_replacement",
      basis: "category:transit",
      percent: 10,
      basisAmount: 1402828.01,
      amount: 140282.8,
      computedAmount: 140282.8,
    });
    // 10% of the share AFTER the reserve would be 126,254.52 — a base a reader
    // of the code could plausibly choose, and one this fixture rules out.
    expect(FIRST.categoryReserves[0].amount).not.toBe(126254.52);
    expect(SECOND.categoryReserves[0].amount).toBe(145800);
  });

  /**
   * TWO RESERVES ON ONE PURPOSE, and the base each of them uses.
   *
   * The descriptor does not say whether a second reserve on the same purpose is
   * a percentage of that purpose's whole share or of what the first one left,
   * and the two answers differ by real money. The rule this module actually
   * follows is the first — the same rule two POOL reserves follow, each a
   * percentage of the same base — and it is pinned here because it is a choice
   * nothing else in the suite can see: every other fixture has at most one
   * reserve per purpose, so both readings agree and a change would be silent.
   *
   * On period one's transit share of 1,402,828.01:
   *   10%  ->  140,282.80   (140,282.801 half-down)
   *    5%  ->   70,141.40   ( 70,141.4005 half-down)
   *          Σ 210,424.20   leaving 1,192,403.81
   *
   * Under the other reading the 5% would be taken of 1,262,545.21 and come to
   * 63,127.26 — seven thousand dollars of a public fund, decided by which base
   * a future edit happens to pick.
   */
  it("takes each reserve on one purpose as a percentage of that purpose's own share", () => {
    const twoOnOne = parseMeasureAllocationRule({
      version: 1,
      offTheTop: [
        { id: "administration", label: "Running the programme", percent: 1, capAmount: 40000, capBasis: "per_period" },
      ],
      reserves: [
        { id: "rainy_day", label: "Rainy-day fund", basis: "gross", percent: 2 },
        { id: "bus_replacement", label: "Bus replacement fund", basis: "category:transit", percent: 10 },
        { id: "depot_repair", label: "Depot repair fund", basis: "category:transit", percent: 5 },
      ],
      categories: [
        { id: "streets", label: "Local streets and roads", percentOfAllocable: 50, distribution: { kind: "pooled" } },
        { id: "transit", label: "Transit service", percentOfAllocable: 30, distribution: { kind: "pooled" } },
        { id: "active", label: "Walking and biking", percentOfAllocable: 20, distribution: { kind: "pooled" } },
      ],
      basisDefinitions: [],
    });

    const outcome = allocateMeasureReceipt({ rule: twoOnOne, receiptAmount: "4812340.17" });
    if (!outcome.ok) throw new Error("the fixture ordinance refused a recorded receipt");

    expect(outcome.allocation.categoryReserves.map((reserve) => reserve.basisAmount)).toEqual([
      1402828.01, 1402828.01,
    ]);
    expect(outcome.allocation.categoryReserves.map((reserve) => reserve.amount)).toEqual([140282.8, 70141.4]);
    // The other reading, named so the assertion above cannot pass by accident.
    expect(outcome.allocation.categoryReserves[1].amount).not.toBe(63127.26);

    const transit = outcome.allocation.categories.find((category) => category.id === "transit");
    expect(transit?.reserveAmount).toBe(210424.2);
    expect(transit?.programmableAmount).toBe(1192403.81);
  });

  /**
   * A RESERVE CANNOT KEEP BACK MORE THAN IS LEFT, and the pair of columns that
   * lets a surface say so.
   *
   * `amount` and `computedAmount` are equal in every ordinary period, which is
   * exactly why a fixture where they differ is needed: without one, a line that
   * reported the CLAMPED figure as the ordinance's own working would look
   * identical to a correct one everywhere the suite could see.
   *
   * A receipt of 1,000.00 with 90% taken off the top leaves 100.00, and a
   * rainy-day clause of 50% of GROSS calls for 500.00. The fund keeps 100.00,
   * the ordinance and the receipt disagree, and both numbers are recorded so a
   * committee can be told which.
   */
  it("limits a reserve to what is left, and keeps what the ordinance called for beside it", () => {
    const squeezed = parseMeasureAllocationRule({
      version: 1,
      offTheTop: [{ id: "administration", label: "Running the programme", percent: 90 }],
      reserves: [{ id: "rainy_day", label: "Rainy-day fund", basis: "gross", percent: 50 }],
      categories: [
        { id: "streets", label: "Local streets and roads", percentOfAllocable: 100, distribution: { kind: "pooled" } },
      ],
      basisDefinitions: [],
    });

    const outcome = allocateMeasureReceipt({ rule: squeezed, receiptAmount: "1000.00" });
    if (!outcome.ok) throw new Error("the fixture ordinance refused a recorded receipt");

    expect(outcome.allocation.offTheTop[0].amount).toBe(900);
    expect(outcome.allocation.poolReserves[0].computedAmount).toBe(500);
    expect(outcome.allocation.poolReserves[0].amount).toBe(100);
    expect(outcome.allocation.notes.map((note) => note.code)).toContain("reserve_exceeds_remaining");
    // Nothing is left to divide, and that is a real figure rather than a
    // failure — the ordinance and the receipt disagree, and the fund keeps what
    // it has rather than going negative.
    expect(outcome.allocation.allocableAmount).toBe(0);
  });

  it("leaves each purpose its share net of the reserve held out of it", () => {
    expect(FIRST.categories.map((category) => category.programmableAmount)).toEqual([
      2338046.69, 1262545.21, 935218.67,
    ]);
    expect(SECOND.categories.map((category) => category.programmableAmount)).toEqual([
      2430000, 1312200, 972000,
    ]);
  });
});

describe("the public chain, built from what those periods stored", () => {
  it("prints the four figures the arithmetic runs through", () => {
    const value = division();
    if (value.kind !== "divided") throw new Error("expected a divided period set");

    expect(money(value.received.amountText)).toBe(9812340.17);
    expect(money(value.takenOut.amountText)).toBe(80000);
    expect(money(value.heldBack.amountText)).toBe(482329.6);
    expect(money(value.leftToDivide.amountText)).toBe(9250010.57);
  });

  /**
   * THE PROPERTY THIS LANE EXISTS FOR.
   *
   * Asserted twice over: once as the subtraction a committee member performs on
   * the printed figures, and once against Σ of what the ordinance's purposes
   * were actually given. Either alone could pass while the other failed — the
   * first is internal to the chain, the second joins the chain to the rows.
   */
  it("closes exactly: received − taken out − kept back = Σ what the purposes were given", () => {
    const value = division();
    if (value.kind !== "divided") throw new Error("expected a divided period set");

    const received = money(value.received.amountText);
    const takenOut = money(value.takenOut.amountText);
    const heldBack = money(value.heldBack.amountText);
    const left = money(value.leftToDivide.amountText);

    expect(Number((received - takenOut - heldBack).toFixed(2))).toBe(left);

    const given = ALLOCATIONS.reduce((sum, row) => sum + Number(row.amount), 0);
    expect(Number(given.toFixed(2))).toBe(left);
    expect(Number(given.toFixed(2))).toBe(9250010.57);

    // And the page says so, rather than leaving the reader to add the column.
    expect(value.settlementSentence).toContain("the same as the amount left for them");
    expect(value.settlementSentence).not.toContain("less than");
  });

  it("names each reserve, what it was kept out of, and at what rate", () => {
    const value = division();
    if (value.kind !== "divided") throw new Error("expected a divided period set");

    expect(value.reserves.map((reserve) => reserve.reserveId)).toEqual(["rainy_day", "bus_replacement"]);
    expect(value.noReservesSentence).toBeNull();

    const [pool, purpose] = value.reserves;
    expect(money(pool.amountText)).toBe(196246.8);
    expect(pool.heldOutOfText).toBe("Everything that came in");
    expect(pool.noteSentence).toContain("The ordinance sets this at 2% of USD");
    expect(money(pool.noteSentence ?? "")).toBe(9812340.17);

    expect(money(purpose.amountText)).toBe(286082.8);
    // THE PURPOSE'S OWN NAME, never the category id a resident cannot use.
    expect(purpose.heldOutOfText).toBe("Transit service");
    expect(purpose.heldOutOfText).not.toContain("transit_hold");
    expect(purpose.noteSentence).toContain("The ordinance sets this at 10% of USD");
    // The two periods' transit shares BEFORE the reserve: 1,402,828.01 +
    // 1,458,000.00. Stating the base against which 10% was taken is what makes
    // the line checkable rather than merely disclosed.
    expect(money(purpose.noteSentence ?? "")).toBe(2860828.01);
  });

  /**
   * A RATE IS STATED ONLY WHEN EVERY PERIOD USED THE SAME ONE.
   *
   * An ordinance amended mid-year produces exactly this: two periods, two
   * recorded rates, each amount correct under its own. "The ordinance sets this
   * at 2% of X" over both of them would describe a period the figure does not
   * come from, and a committee member checking 2% against the total would find
   * it does not work and have no way to learn why. So the sentence goes and the
   * amount stays — the rate became unsayable, not the money.
   */
  it("states a rate only when every period recorded the same one", () => {
    const amended = RESERVES.map((row) =>
      row.reserve_id === "rainy_day" && row.period_id === "p2" ? { ...row, percent: "3.0000" } : row
    );
    const value = division({ reserves: amended });
    if (value.kind !== "divided") throw new Error("expected a divided period set");

    const [pool, purpose] = value.reserves;
    expect(pool.noteSentence).toBeNull();
    expect(money(pool.amountText)).toBe(196246.8);
    // The purpose-level reserve was not amended, so its rate is still sayable.
    // Without this half the assertion above would pass on a builder that had
    // simply stopped stating rates at all.
    expect(purpose.noteSentence).toContain("The ordinance sets this at 10% of USD");
  });

  /**
   * AND SAYS SO WHEN LESS WAS KEPT BACK THAN THE ORDINANCE CALLED FOR.
   *
   * The recorded pair is what makes this sentence possible without recomputing
   * an old rule version against an old receipt. A reader who saw only the
   * amount would have no way to know the clause had been squeezed at all.
   */
  it("names the ordinance's own working when it exceeded what was left", () => {
    const squeezed = RESERVES.map((row) =>
      row.reserve_id === "rainy_day" && row.period_id === "p1"
        ? { ...row, computed_amount: "150000.00" }
        : row
    );
    const value = division({ reserves: squeezed });
    if (value.kind !== "divided") throw new Error("expected a divided period set");

    // 150,000.00 called for in period one plus 100,000.00 in period two, against
    // 196,246.80 actually kept back over the two.
    expect(value.reserves[0].noteSentence).toContain(
      "The ordinance's own working came to USD"
    );
    expect(value.reserves[0].noteSentence).toContain("was kept back, because no more was left to keep back.");
    expect(money(value.reserves[0].noteSentence?.split("came to")[1] ?? "")).toBe(250000);
    // The amount in the chain is still what was KEPT, never what was called for.
    expect(money(value.reserves[0].amountText)).toBe(196246.8);
    expect(money(value.heldBack.amountText)).toBe(482329.6);
  });

  /**
   * AND ONLY WHEN THE FIGURE IT WAS TAKEN OF CAN BE READ.
   *
   * "2% of" with nothing after it is not a checkable sentence, and "2%" alone
   * invites a reader to apply it to the received total — which is right for a
   * pool reserve and wrong for every purpose-level one.
   */
  it("says nothing about the rate when the figure it was applied to is unreadable", () => {
    const missingBase = RESERVES.map((row) =>
      row.reserve_id === "rainy_day" && row.period_id === "p1" ? { ...row, basis_amount: null } : row
    );
    const value = division({ reserves: missingBase });
    if (value.kind !== "divided") throw new Error("expected a divided period set");

    expect(value.reserves[0].noteSentence).toBeNull();
    // The amount is unaffected: an unreadable BASE is not an unreadable AMOUNT,
    // and conflating them would drop 196,246.80 out of the chain.
    expect(money(value.reserves[0].amountText)).toBe(196246.8);
    expect(value.heldBack.isFloor).toBe(false);
  });

  /**
   * THE SAME FUND WITH THE RESERVES MISSING, which is what every period divided
   * up before 20260812000019 looks like.
   *
   * The chain must not pretend to close: the reserve line reads a true 0.00 and
   * the settlement states the difference as a figure and names the periods that
   * could be hiding one. This is the honest degradation the lane replaced an
   * unrecoverable cause with.
   */
  it("states the gap and names the periods when the reserves were never recorded", () => {
    const value = division({ reserves: [] });
    if (value.kind !== "divided") throw new Error("expected a divided period set");

    expect(money(value.heldBack.amountText)).toBe(0);
    expect(value.noReservesSentence).toBe(
      "The ordinance kept nothing back in reserve out of these periods."
    );
    // 9,812,340.17 − 80,000.00 = 9,732,340.17 left, against 9,250,010.57 given:
    // 482,329.60 short, which is exactly the reserve nobody wrote down.
    expect(money(value.leftToDivide.amountText)).toBe(9732340.17);
    expect(value.settlementSentence).toContain("482,329.60 less than the amount left for them");
    expect(value.settlementSentence).toContain("nothing recorded as kept back in reserve");
    expect(value.settlementSentence).toContain("FY26 Q1 and FY26 Q2");
    // And it still refuses to call the difference money gone astray — AFTER the
    // cause, not before it. "Treat this as unexplained" printed ahead of the
    // explanation tells a reader to stop reading one sentence too early.
    expect(value.settlementSentence).toContain("rather than as money that has gone astray");
    // The sentence the product could not do better than before this lane. It
    // named a cause it could neither show nor rule out; it can now do both.
    expect(value.settlementSentence).not.toContain("Some ordinances hold an amount back");
  });

  /**
   * EVERY CAUSE BEFORE THE INSTRUCTION THAT CLOSES THE SECTION.
   *
   * With both causes live at once — periods whose reserves were never recorded,
   * and money set aside under a heading the ordinance shown here does not list
   * — the reader has to reach both before being told to treat what is left as
   * unexplained. "Treat this as unexplained" printed ahead of the explanation
   * stops a reader one sentence too early, on the surface where they have no
   * second copy of the figures to go back to.
   */
  it("gives every cause before the sentence that tells a reader what to do with the difference", () => {
    const value = division({ reserves: [], withUnlistedHeading: true });
    if (value.kind !== "divided") throw new Error("expected a divided period set");

    const sentence = value.settlementSentence;
    const shortfall = sentence.indexOf("less than the amount left for them");
    const reserveCause = sentence.indexOf("nothing recorded as kept back in reserve");
    const unlistedCause = sentence.indexOf("the ordinance shown here does not list");
    const close = sentence.indexOf("Treat what is still unaccounted for");

    for (const [name, at] of [
      ["the shortfall", shortfall],
      ["the unrecorded-reserve cause", reserveCause],
      ["the unlisted-heading cause", unlistedCause],
      ["the closing instruction", close],
    ] as const) {
      expect(at, `${name} is missing from the settlement sentence`).toBeGreaterThan(-1);
    }
    expect(shortfall).toBeLessThan(reserveCause);
    expect(reserveCause).toBeLessThan(unlistedCause);
    expect(unlistedCause).toBeLessThan(close);
    // The unlisted heading is 100,000.00 of allocations under `legacy_debt`,
    // which the page cannot print in its table — so a reader adding the column
    // would be short by exactly that, and is told so.
    expect(sentence.replaceAll(String.fromCharCode(160), " ")).toContain(
      "USD 100,000.00 of what has been set aside is recorded under a purpose"
    );
  });

  /**
   * A HELD-BACK FIGURE OF ZERO IS NOT A DOUBTFUL FIGURE.
   *
   * Most ordinances keep nothing back, so a floor flag driven by "no reserve
   * row" would sit permanently on a correct 0.00 and propagate to the one
   * number the section exists to close. The floor is reserved for a recorded
   * amount that could not be READ.
   */
  it("does not flag a zero reserve as a lower bound, and does flag an unreadable one", () => {
    const clean = division({ reserves: [] });
    if (clean.kind !== "divided") throw new Error("expected a divided period set");
    expect(clean.heldBack.isFloor).toBe(false);
    expect(clean.leftToDivide.coverageSentence).not.toContain("could be lower");

    const unreadable = division({
      // A negative is what `parseOptionalAmount` refuses, and the column's own
      // CHECK refuses it too — so this is the shape of a row that arrived from
      // somewhere this product did not write.
      reserves: [{ ...RESERVES[0], amount: "-1.00" }],
    });
    if (unreadable.kind !== "divided") throw new Error("expected a divided period set");
    expect(unreadable.heldBack.isFloor).toBe(true);
    expect(unreadable.heldBack.coverageSentence).toContain("could not be read");
    expect(unreadable.leftToDivide.coverageSentence).toContain("could be lower");
  });
});

/*
 * ============================================================================
 * MUTATION RESULTS — 2026-08-12, the reserve lane
 * ============================================================================
 *
 * NEGATIVE CONTROL FIRST. A throwaway `expect(1).toBe(2)` in its own file
 * exited 1 and a real suite exited 0, so a green result below is
 * distinguishable from a runner that cannot report a red one. Every mutation
 * was applied to the SOURCE, run against all fourteen `measure-*` suites, and
 * reverted; the counts are of failing TESTS.
 *
 *   M1  `heldBack` never accumulates .............................. 7 failed
 *   M2  `leftToDivide` drops the reserve subtraction .............. 7 failed
 *   M3b a reserve's rows do not accumulate across periods ......... 1 failed
 *   M4  the basis figures do not accumulate across periods ........ 3 failed
 *   M5  the no-reserve-row floor flag restored .................... 1 failed
 *   M6  an unreadable amount is skipped without flagging .......... 1 failed
 *   M7  the settlement never names the periods with no reserve .... 3 failed
 *   M8  every reserve reads as coming out of the whole payment .... 2 failed
 *   M9b a disagreeing rate is stated anyway ....................... 1 failed
 *   M10 a failed reserve read is treated as no reserves ........... 1 failed
 *   M11 the rate is stated over an unreadable base ................ 1 failed
 *   M12 a 'gross' reserve is taken of what the take left ......... 11 failed
 *   M13b a purpose reserve is taken net of an earlier one ......... 1 failed
 *   M14 the line carries the wrong rate ........................... 4 failed
 *   M15b the clamped figure is reported as the ordinance's working  1 failed
 *   M16 the route builds no reserve rows .......................... 1 failed
 *   M17 the note never says a reserve was squeezed ................ 1 failed
 *   M18 the route omits `p_reserves` and rides the DB default ..... 2 failed
 *   M19 every row is written with `basis_kind` from the raw basis . 1 failed
 *   M20 the statement drops the kept-back figure .................. 5 failed
 *   M21 the statement drops the reserve table ..................... 5 failed
 *   M22 the page drops the kept-back figure ....................... 2 failed
 *   M23 the page drops the reserve table .......................... 3 failed
 *   M24 the page reads no reserves at all ......................... 5 failed
 *   M25 the statement route stops refusing a failed reserve read .. 2 failed
 *   M26 a reserve from an undivided period is folded in ........... 4 failed
 *   M27 a failed reserve read borrows the takes' sentence ......... 1 failed
 *   M29b the closing instruction is printed before its causes ..... 1 failed
 *
 * THREE SURVIVED THE FIRST TIME, and each one was a real hole rather than a
 * bad mutation. Saying so is the point of keeping this log:
 *
 *   M9  `percents.size === 1` ignored — every fixture used one rate per
 *       clause, so a builder that stated a rate over two different ones was
 *       indistinguishable. Fixed by "states a rate only when every period
 *       recorded the same one" (an ordinance amended mid-year).
 *   M13 a purpose reserve taken net of an earlier one — every fixture had at
 *       most ONE reserve per purpose, so both readings agreed. Fixed by "takes
 *       each reserve on one purpose as a percentage of that purpose's own
 *       share", which pins a choice the descriptor does not make for us.
 *   M15 `computedAmount` reported as `amount` — no fixture clamped a reserve,
 *       so the pair of columns was never observed differing. Fixed by "limits
 *       a reserve to what is left".
 *
 * ONE DECLARED NEUTRAL BEFORE IT WAS RUN, and survived as predicted:
 *
 *   M28 `if (input.offTheTopRead && input.reserveRead)` weakened to the takes
 *       read alone, with the reserves defaulting to none. Both callers always
 *       supply both, so no surface can observe it. It stays in the code as the
 *       thing that keeps the NEXT surface honest while it is being wired up,
 *       and inventing an assertion to kill it would be a test of nothing.
 *
 * M29 SURVIVED THE FIRST TIME TOO, and for the same class of reason: no
 * fixture had TWO causes live at once, so moving the closing instruction ahead
 * of the second one was unobservable. Fixed by "gives every cause before the
 * sentence that tells a reader what to do with the difference", which runs the
 * unrecorded-reserve cause and the unlisted-heading cause together. That is
 * four survivors in one lane from the same shape of gap — a fixture in which
 * only one thing is unusual at a time.
 *
 * 28 real mutations, 28 killed (4 only after the coverage above was added);
 * 1 declared-neutral, survived as predicted.
 *
 * ============================================================================
 * WHAT A FAKE CANNOT PROVE, AND HOW IT WAS PROVEN INSTEAD
 * ============================================================================
 *
 * That the reserve INSERT joins the SAME statement batch — that a failure of it
 * rolls back the DELETEs that ran before it — is a property of Postgres. It was
 * proven against the live local database rather than reasoned about, inside one
 * transaction that was rolled back at the end.
 *
 * The probe applied 20260812000019 to the real schema, seeded a period holding
 * one allocation, one off-the-top take and one reserve of 20.00, then called
 * `replace_measure_period_allocation` four times inside savepoints — emulating
 * PostgREST's per-request transaction — with (a) a negative reserve amount,
 * (b) two rows for one reserve clause, (c) a reserve naming another period, and
 * (d) a 'category' reserve naming no category. Each raised
 * (`measure_period_reserve_amount_check`, `measure_period_reserve_uniq`, the
 * function's own scope check, and `measure_period_reserve_basis_pair`), and
 * after all four rollbacks the period still held its 1 allocation, its 1 take
 * and its 1 reserve of 20.00.
 *
 * The happy path then replaced all three sets in one call, and a FOUR-argument
 * call — the previous build, mid-upgrade — resolved through the new default,
 * returned `replaced_reserve_count: 1` and left the period with no reserve
 * rows, which is the correct behaviour for a build that computes none.
 */

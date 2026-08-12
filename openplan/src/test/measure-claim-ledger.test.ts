import { describe, expect, it } from "vitest";
import {
  buildMeasureClaimLedger,
  buildMeasureMoeSummary,
  checkMeasureClaimEligibility,
  isAllowedMeasureClaimTransition,
  isClaimedMeasureClaimStatus,
  resolveMeasureClaimCategories,
  toMeasureClaimRead,
  CLAIMED_MEASURE_CLAIM_STATUSES,
  EXCLUDED_MEASURE_CLAIM_STATUSES,
  MEASURE_CLAIM_AWAITING_DECISION_STATUSES,
  MEASURE_CLAIM_COLUMNS,
  MEASURE_CLAIM_STATUSES,
  MEASURE_CLAIM_SWEEP_COLUMNS,
  MEASURE_CLAIM_TRANSITIONS,
} from "@/lib/measures/claims";
import { CLAIMED_INVOICE_STATUSES } from "@/lib/invoicing/invoice-records";
import { parseMeasureAllocationRule } from "@/lib/measures/allocation";

/**
 * THE CLAIM LEDGER, PINNED CENT BY CENT.
 *
 * ============================================================================
 * EVERY NUMBER BELOW WAS DERIVED BY HAND BEFORE THE CODE EXISTED
 * ============================================================================
 *
 * Money arithmetic is this repository's named hollow-code category, and the
 * v0.17.0 drawdown ledger found two live errors precisely because a worked
 * example was written out first. So the fixture is worked out here, in the
 * comment, and the assertions name the results as literals. A test that
 * recomputed the expected value the same way the code does would pass whatever
 * the code did.
 *
 * ---------------------------------------------------------------------------
 * THE ALLOCATION SIDE (the ceiling)
 * ---------------------------------------------------------------------------
 *
 * FY26 Q1, one period. Local streets returns to source over four jurisdictions;
 * transit is pooled. The four local-streets shares are taken from the allocator
 * lane's own worked example so the two lanes' fixtures describe one fund:
 *
 *   local_streets   Alder     583,043.28
 *                   Birch     272,825.59
 *                   Cedar     114,521.61
 *                   Delta     935,296.23   (carries the +0.01 residual)
 *                   -------------------------------
 *                   category  1,905,686.71
 *
 *     583,043.28 + 272,825.59 = 855,868.87
 *     855,868.87 + 114,521.61 = 970,390.48
 *     970,390.48 + 935,296.23 = 1,905,686.71   OK
 *
 *   transit         pooled      952,843.35   (no per-recipient row)
 *
 * ---------------------------------------------------------------------------
 * THE CLAIM SIDE
 * ---------------------------------------------------------------------------
 *
 * Alder / local_streets / FY26 — seven claims, one of every status:
 *
 *   1  120,000.00  retention 5%    paid          retention 6,000.00  net 114,000.00
 *   2   89,412.37  retention 0     submitted     retention     0.00  net  89,412.37
 *   3   40,000.00  retention 1,250.00 explicit
 *                                  under_review  retention 1,250.00  net  38,750.00
 *   4   15,000.00  retention 0     draft         net 15,000.00       EXCLUDED
 *   5   22,500.00  retention 0     denied        gross 22,500.00     EXCLUDED
 *   6    9,000.00  retention 0     withdrawn     gross  9,000.00     EXCLUDED
 *   7   60,000.00  retention 10%   approved      retention 6,000.00  net  54,000.00
 *
 *   claimedGross = 120,000.00 + 89,412.37 + 40,000.00 + 60,000.00 = 309,412.37
 *   claimedNet   = 114,000.00 + 89,412.37 + 38,750.00 + 54,000.00 = 296,162.37
 *   paidNet      = 114,000.00
 *   outstanding  =  89,412.37 + 38,750.00 + 54,000.00 = 182,162.37
 *   retentionHeld (paid only)        = 6,000.00
 *   retentionPending (claimed unpaid)= 0.00 + 1,250.00 + 6,000.00 = 7,250.00
 *   remaining    = 583,043.28 − 309,412.37 = 273,630.91
 *
 * Cedar / local_streets / FY26 — ONE approved claim of 130,000.00 against an
 * allocation of 114,521.61:
 *
 *   remaining = 114,521.61 − 130,000.00 = −15,478.39     UNCLAMPED, on purpose
 *
 * Birch / transit / FY26 — one paid claim of 5,000.00, and NO per-recipient
 * allocation (transit is pooled), so its bucket ceiling is null, NOT −5,000.00.
 *
 * Birch and Delta hold local-streets allocations and file nothing.
 *
 * ---------------------------------------------------------------------------
 * THE TOTALS
 * ---------------------------------------------------------------------------
 *
 *   claimedGrossTotal = 309,412.37 + 130,000.00 + 5,000.00 = 444,412.37
 *   claimedNetTotal   = 296,162.37 + 130,000.00 + 5,000.00 = 431,162.37
 *   paidNetTotal      = 114,000.00 + 5,000.00 = 119,000.00
 *   outstandingTotal  = 182,162.37 + 130,000.00 = 312,162.37
 *
 * The fund-level ceiling comes from CATEGORY totals, never from summing
 * recipient buckets — the pooled transit allocation has no recipient bucket to
 * be summed, and leaving it out would understate the ceiling by 952,843.35:
 *
 *   local_streets  allocated 1,905,686.71  claimed 439,412.37 -> 1,466,274.34
 *     (309,412.37 + 130,000.00 = 439,412.37;
 *      1,905,686.71 − 439,412.37 = 1,466,274.34)
 *   transit        allocated   952,843.35  claimed   5,000.00 ->   947,843.35
 *
 *   allocatedTotal          = 1,905,686.71 + 952,843.35 = 2,858,530.06
 *   remainingAllocatedTotal = 1,466,274.34 +   947,843.35 = 2,414,117.69
 */

const PERIOD_ID = "11111111-1111-4111-8111-111111111111";
const ALDER = "aaaaaaaa-0000-4000-8000-000000000001";
const BIRCH = "aaaaaaaa-0000-4000-8000-000000000002";
const CEDAR = "aaaaaaaa-0000-4000-8000-000000000003";
const DELTA = "aaaaaaaa-0000-4000-8000-000000000004";

const PERIODS = [{ id: PERIOD_ID, period_label: "FY26 Q1", fiscal_year_label: "FY26" }];

const ALLOCATIONS = [
  { period_id: PERIOD_ID, category_id: "local_streets", recipient_id: ALDER, amount: "583043.28", computation_basis: "descriptor" },
  { period_id: PERIOD_ID, category_id: "local_streets", recipient_id: BIRCH, amount: "272825.59", computation_basis: "descriptor" },
  { period_id: PERIOD_ID, category_id: "local_streets", recipient_id: CEDAR, amount: "114521.61", computation_basis: "descriptor" },
  { period_id: PERIOD_ID, category_id: "local_streets", recipient_id: DELTA, amount: "935296.23", computation_basis: "descriptor" },
  { period_id: PERIOD_ID, category_id: "transit", recipient_id: null, amount: "952843.35", computation_basis: "descriptor" },
];

const CLAIMS = [
  { id: "c1", recipient_id: ALDER, period_id: PERIOD_ID, fiscal_year_label: "FY26", category_id: "local_streets", amount: "120000.00", retention_percent: "5", retention_amount: "0", status: "paid", paid_on: "2026-03-15", submitted_on: "2026-02-01" },
  { id: "c2", recipient_id: ALDER, period_id: PERIOD_ID, fiscal_year_label: "FY26", category_id: "local_streets", amount: "89412.37", retention_percent: "0", retention_amount: "0", status: "submitted", submitted_on: "2026-02-10" },
  { id: "c3", recipient_id: ALDER, period_id: PERIOD_ID, fiscal_year_label: "FY26", category_id: "local_streets", amount: "40000.00", retention_percent: "0", retention_amount: "1250.00", status: "under_review", submitted_on: "2026-02-12" },
  { id: "c4", recipient_id: ALDER, period_id: PERIOD_ID, fiscal_year_label: "FY26", category_id: "local_streets", amount: "15000.00", retention_percent: "0", retention_amount: "0", status: "draft" },
  { id: "c5", recipient_id: ALDER, period_id: PERIOD_ID, fiscal_year_label: "FY26", category_id: "local_streets", amount: "22500.00", retention_percent: "0", retention_amount: "0", status: "denied", submitted_on: "2026-01-20", denial_reason: "Outside the eligible period." },
  { id: "c6", recipient_id: ALDER, period_id: PERIOD_ID, fiscal_year_label: "FY26", category_id: "local_streets", amount: "9000.00", retention_percent: "0", retention_amount: "0", status: "withdrawn", submitted_on: "2026-01-22" },
  { id: "c7", recipient_id: ALDER, period_id: PERIOD_ID, fiscal_year_label: "FY26", category_id: "local_streets", amount: "60000.00", retention_percent: "10", retention_amount: "0", status: "approved", submitted_on: "2026-02-14" },
  { id: "c8", recipient_id: CEDAR, period_id: PERIOD_ID, fiscal_year_label: "FY26", category_id: "local_streets", amount: "130000.00", retention_percent: "0", retention_amount: "0", status: "approved", submitted_on: "2026-02-15" },
  { id: "c9", recipient_id: BIRCH, period_id: PERIOD_ID, fiscal_year_label: "FY26", category_id: "transit", amount: "5000.00", retention_percent: "0", retention_amount: "0", status: "paid", paid_on: "2026-04-01", submitted_on: "2026-03-01" },
];

function buildFixtureLedger() {
  const result = buildMeasureClaimLedger({
    claimRead: { ok: true, claims: CLAIMS },
    allocations: ALLOCATIONS,
    periods: PERIODS,
  });
  if (!result.ok) throw new Error(`fixture ledger failed: ${result.message}`);
  return result.ledger;
}

function bucket(recipientId: string, categoryId: string) {
  return buildFixtureLedger().buckets.find(
    (entry) => entry.recipientId === recipientId && entry.categoryId === categoryId
  );
}

describe("the measure claim ledger", () => {
  it("totals the claim side to the cent", () => {
    const ledger = buildFixtureLedger();

    expect(ledger.claimedGrossTotal).toBe(444412.37);
    expect(ledger.claimedNetTotal).toBe(431162.37);
    expect(ledger.claimedCount).toBe(6);
    expect(ledger.paidNetTotal).toBe(119000);
    expect(ledger.paidCount).toBe(2);
    expect(ledger.outstandingNetTotal).toBe(312162.37);
    expect(ledger.outstandingCount).toBe(4);
    expect(ledger.retentionHeld).toBe(6000);
    expect(ledger.retentionPendingOnUnpaid).toBe(7250);
  });

  /**
   * THE EXCLUDED GROUPS ARE REPORTED, AND FOLDED INTO NOTHING.
   *
   * An unreported amount is not zero, and neither is a refused one. A planner
   * who cannot see the 22,500.00 the agency denied cannot act on it — and if
   * the denial were folded into `claimedGross` instead, the ceiling remaining
   * would be understated by that much, which is the direction that makes a
   * fund look spent when it is not.
   */
  it("reports drafts, denials and withdrawals without counting them as claimed", () => {
    const ledger = buildFixtureLedger();

    expect(ledger.draftCount).toBe(1);
    expect(ledger.draftNetTotal).toBe(15000);
    expect(ledger.deniedCount).toBe(1);
    expect(ledger.deniedGrossTotal).toBe(22500);
    expect(ledger.withdrawnCount).toBe(1);
    expect(ledger.withdrawnGrossTotal).toBe(9000);

    // None of the three reaches a claimed or outstanding figure.
    const excludedGross = 15000 + 22500 + 9000;
    expect(ledger.claimedGrossTotal + excludedGross).toBe(490912.37);
    expect(ledger.claimedGrossTotal).not.toBe(490912.37);
  });

  it("computes an unclamped remainder per recipient, category and year", () => {
    const alder = bucket(ALDER, "local_streets");
    expect(alder?.allocatedAmount).toBe(583043.28);
    expect(alder?.claimedGross).toBe(309412.37);
    expect(alder?.remainingAllocated).toBe(273630.91);
    expect(alder?.isOverClaimed).toBe(false);
    expect(alder?.paidNet).toBe(114000);
    expect(alder?.outstandingNet).toBe(182162.37);
  });

  /**
   * THE ONE FIGURE AN ADMINISTRATOR MUST ACT ON TODAY.
   *
   * Clamping at zero here would hide an over-claim against the ordinance's own
   * split entirely — the portfolio-level clamp in
   * `uninvoicedCommittedAwardAmount` is defensible because it mixes many
   * awards; per bucket it would be a silent loss.
   */
  it("leaves an over-claim visible and negative", () => {
    const cedar = bucket(CEDAR, "local_streets");
    expect(cedar?.allocatedAmount).toBe(114521.61);
    expect(cedar?.claimedGross).toBe(130000);
    expect(cedar?.remainingAllocated).toBe(-15478.39);
    expect(cedar?.isOverClaimed).toBe(true);

    expect(buildFixtureLedger().overClaimedBuckets.map((entry) => entry.recipientId)).toEqual([CEDAR]);
  });

  /**
   * AN ABSENT ALLOCATION IS NOT AN ALLOCATION OF NOTHING.
   *
   * Transit is pooled, so Birch has no per-recipient share. Reporting
   * `0 − 5,000 = −5,000` would accuse a city of over-claiming against a ceiling
   * the database never held.
   */
  it("reports a bucket with no recorded allocation as not determined, never as zero", () => {
    const birchTransit = bucket(BIRCH, "transit");
    expect(birchTransit?.claimedGross).toBe(5000);
    expect(birchTransit?.allocatedAmount).toBeNull();
    expect(birchTransit?.remainingAllocated).toBeNull();
    expect(birchTransit?.isOverClaimed).toBe(false);
  });

  /**
   * THE FUND CEILING COMES FROM CATEGORIES, NOT FROM SUMMING BUCKETS.
   *
   * Summing recipient buckets would silently drop the pooled transit
   * allocation — 952,843.35 of real money with no recipient row to be summed.
   */
  it("totals the ceiling over categories so pooled money is counted once and not lost", () => {
    const ledger = buildFixtureLedger();
    const byId = new Map(ledger.categoryTotals.map((total) => [total.categoryId, total]));

    expect(byId.get("local_streets")?.allocatedAmount).toBe(1905686.71);
    expect(byId.get("local_streets")?.claimedGross).toBe(439412.37);
    expect(byId.get("local_streets")?.remainingAllocated).toBe(1466274.34);
    expect(byId.get("transit")?.allocatedAmount).toBe(952843.35);
    expect(byId.get("transit")?.remainingAllocated).toBe(947843.35);

    expect(ledger.allocatedTotal).toBe(2858530.06);
    expect(ledger.remainingAllocatedTotal).toBe(2414117.69);

    // The bucket sum is DIFFERENT, and that difference is the pooled money.
    const bucketSum = ledger.buckets.reduce((sum, entry) => sum + (entry.allocatedAmount ?? 0), 0);
    expect(Math.round(bucketSum * 100) / 100).toBe(1905686.71);
    expect(ledger.allocatedTotal! - bucketSum).toBeCloseTo(952843.35, 2);
  });

  /**
   * A GAP IN THE READ IS REPORTED RATHER THAN DROPPED.
   *
   * An allocation whose period is not in the period set has an unknown fiscal
   * year. Folding it into a year would be worse than dropping it, and dropping
   * it silently understates the ceiling — which manufactures an over-claim. So
   * it is excluded AND counted.
   */
  it("counts allocations whose period it could not resolve", () => {
    const result = buildMeasureClaimLedger({
      claimRead: { ok: true, claims: CLAIMS },
      allocations: [...ALLOCATIONS, { period_id: "unknown-period", category_id: "transit", recipient_id: null, amount: "40000.00", computation_basis: "descriptor" }],
      periods: PERIODS,
    });
    if (!result.ok) throw new Error("expected a ledger");

    expect(result.ledger.allocationsWithUnknownPeriodCount).toBe(1);
    // Unchanged: the orphan reaches no total.
    expect(result.ledger.allocatedTotal).toBe(2858530.06);
  });

  it("flags a hand-entered allocation so no surface can show it as computed", () => {
    const manual = ALLOCATIONS.map((allocation) =>
      allocation.category_id === "transit" ? { ...allocation, computation_basis: "manual" } : allocation
    );
    const result = buildMeasureClaimLedger({ claimRead: { ok: true, claims: CLAIMS }, allocations: manual, periods: PERIODS });
    if (!result.ok) throw new Error("expected a ledger");

    expect(result.ledger.hasManualAllocation).toBe(true);
    expect(result.ledger.categoryTotals.find((total) => total.categoryId === "transit")?.hasManualAllocation).toBe(true);
    expect(result.ledger.categoryTotals.find((total) => total.categoryId === "local_streets")?.hasManualAllocation).toBe(false);
  });

  /**
   * A FAILED READ IS NOT AN EMPTY FUND.
   *
   * "This measure has claimed $0 of its $2.8M" reads as an urgent, actionable
   * fact and would be a database error wearing a number — on a page an
   * oversight committee reads.
   */
  it("refuses to build a ledger of zeros out of a failed read", () => {
    const failed = buildMeasureClaimLedger({
      claimRead: toMeasureClaimRead({ error: { message: "connection reset" } }),
      allocations: ALLOCATIONS,
      periods: PERIODS,
    });
    expect(failed.ok).toBe(false);
    if (failed.ok) throw new Error("unreachable");
    expect(failed.pending).toBe(false);
    expect(failed.message).toContain("connection reset");

    const pending = toMeasureClaimRead({
      error: { message: 'relation "public.measure_claims" does not exist' },
    });
    expect(pending.ok).toBe(false);
    if (pending.ok) throw new Error("unreachable");
    expect(pending.pending).toBe(true);
  });

  /**
   * A CATEGORY CAN BE OVER-CLAIMED TOO, AND ITS REMAINDER IS UNCLAMPED.
   *
   * ADDED BECAUSE A MUTATION SURVIVED. Wrapping the CATEGORY remainder in
   * `Math.max(0, …)` passed the whole suite: the main fixture has no
   * over-claimed category, only an over-claimed recipient bucket, so the
   * category-level clamp was invisible. That is exactly the shape of hollow
   * coverage this repo keeps finding — the property was described in a comment
   * and asserted nowhere.
   *
   * The case is a real one. A pooled category (the agency programs it itself,
   * no per-recipient shares) allocated 50,000.00 and claimed 75,000.00:
   *
   *   remaining = 50,000.00 − 75,000.00 = −25,000.00
   *
   * and the FUND total must carry the negative through rather than flooring it:
   *
   *   fund allocated = 50,000.00
   *   fund remaining = −25,000.00
   */
  it("leaves an over-claimed CATEGORY negative, at the category and the fund total", () => {
    const result = buildMeasureClaimLedger({
      claimRead: {
        ok: true,
        claims: [
          { id: "o1", recipient_id: BIRCH, period_id: PERIOD_ID, fiscal_year_label: "FY26", category_id: "bridge_program", amount: "75000.00", status: "approved", submitted_on: "2026-05-01" },
        ],
      },
      allocations: [
        { period_id: PERIOD_ID, category_id: "bridge_program", recipient_id: null, amount: "50000.00", computation_basis: "descriptor" },
      ],
      periods: PERIODS,
    });
    if (!result.ok) throw new Error("expected a ledger");

    const category = result.ledger.categoryTotals[0];
    expect(category.categoryId).toBe("bridge_program");
    expect(category.allocatedAmount).toBe(50000);
    expect(category.claimedGross).toBe(75000);
    expect(category.remainingAllocated).toBe(-25000);
    expect(category.isOverClaimed).toBe(true);

    expect(result.ledger.allocatedTotal).toBe(50000);
    expect(result.ledger.remainingAllocatedTotal).toBe(-25000);
  });

  /**
   * THE TOTALS ROUND AT EVERY STEP, NOT AT THE END.
   *
   * ADDED BECAUSE A MUTATION SURVIVED. Removing `roundCurrencyAmount` from the
   * running net total passed the whole suite, because the main fixture's
   * amounts happen to add exactly in binary floating point. They usually do —
   * which is precisely why the drift is a defect that ships.
   *
   * `summarizeBillingInvoiceRecords` rounds after every addition, and this
   * ledger must too, or the same claims would total differently on the measure
   * page and in the invoice register. Two claims of 100.10 and 200.20:
   *
   *   rounded at each step : 300.30
   *   summed then rounded  : 300.29999999999995      <- what the mutation gives
   *
   * The assertion is `toBe`, not `toBeCloseTo`, on purpose: a tolerance would
   * accept the drift this test exists to catch.
   */
  it("rounds after every addition, so a float residue cannot survive into a total", () => {
    const result = buildMeasureClaimLedger({
      claimRead: {
        ok: true,
        claims: [
          { id: "f1", recipient_id: ALDER, period_id: PERIOD_ID, fiscal_year_label: "FY26", category_id: "local_streets", amount: "100.10", status: "submitted", submitted_on: "2026-06-01" },
          { id: "f2", recipient_id: ALDER, period_id: PERIOD_ID, fiscal_year_label: "FY26", category_id: "local_streets", amount: "200.20", status: "submitted", submitted_on: "2026-06-02" },
        ],
      },
      allocations: [],
      periods: PERIODS,
    });
    if (!result.ok) throw new Error("expected a ledger");

    expect(100.1 + 200.2).not.toBe(300.3); // the drift is real, in this engine, today
    expect(result.ledger.claimedNetTotal).toBe(300.3);
    expect(result.ledger.claimedGrossTotal).toBe(300.3);
    expect(result.ledger.outstandingNetTotal).toBe(300.3);
    expect(result.ledger.buckets[0].claimedGross).toBe(300.3);
  });

  /**
   * The same rule on the maintenance-of-effort side, for the same reason.
   *
   *   70.05 + 0.10 + 0.05 rounded at each step = 70.20
   *                       summed then rounded  = 70.19999999999999
   */
  it("rounds the maintenance-of-effort totals at every step too", () => {
    const summary = buildMeasureMoeSummary({
      records: [
        { recipient_id: ALDER, fiscal_year_label: "FY26", required_amount: "0", reported_amount: "70.05", basis_note: "n" },
        { recipient_id: BIRCH, fiscal_year_label: "FY26", required_amount: "0", reported_amount: "0.10", basis_note: "n" },
        { recipient_id: CEDAR, fiscal_year_label: "FY26", required_amount: "0", reported_amount: "0.05", basis_note: "n" },
      ],
    });
    expect(70.05 + 0.1 + 0.05).not.toBe(70.2);
    expect(summary.netDifferenceTotal).toBe(70.2);
  });

  /**
   * A COUNT THAT CAN ONLY EVER BE ZERO, KEPT BECAUSE IT PROVES THE FIX HELD.
   *
   * `measure_claims_paid_has_a_date` makes a dateless paid claim unstorable.
   * The ledger still counts them, so if that CHECK is ever removed the number
   * on the page goes non-zero instead of the defect being invisible — which is
   * what happens on the invoice side, where the same count is a permanent
   * fact of life.
   */
  it("counts a paid claim with no date, which the database should make impossible", () => {
    const result = buildMeasureClaimLedger({
      claimRead: {
        ok: true,
        claims: [{ id: "x", recipient_id: ALDER, period_id: PERIOD_ID, fiscal_year_label: "FY26", category_id: "local_streets", amount: "100.00", status: "paid", paid_on: null }],
      },
      allocations: [],
      periods: PERIODS,
    });
    if (!result.ok) throw new Error("expected a ledger");
    expect(result.ledger.paidWithNoDateCount).toBe(1);
    expect(buildFixtureLedger().paidWithNoDateCount).toBe(0);
  });
});

describe("the claim status partition", () => {
  /**
   * ONE PARTITION, TWO VOCABULARIES.
   *
   * The invoice register's CLAIMED set and this one must have the same SHAPE —
   * everything asked for and not refused — or the two directions of the
   * reimbursement seam would answer "how much has been claimed" differently.
   * Asserted structurally rather than by copying the list, so a status added
   * to either side without a matching decision fails here.
   */
  it("mirrors the invoice register's partition", () => {
    expect(CLAIMED_MEASURE_CLAIM_STATUSES).toEqual(["submitted", "under_review", "approved", "paid"]);
    expect(CLAIMED_INVOICE_STATUSES).toEqual(["internal_review", "submitted", "approved_for_payment", "paid"]);
    expect(CLAIMED_MEASURE_CLAIM_STATUSES.length).toBe(CLAIMED_INVOICE_STATUSES.length);

    // Every status is on exactly one side of the line.
    const union = [...CLAIMED_MEASURE_CLAIM_STATUSES, ...EXCLUDED_MEASURE_CLAIM_STATUSES].sort();
    expect(union).toEqual([...MEASURE_CLAIM_STATUSES].sort());
    for (const status of EXCLUDED_MEASURE_CLAIM_STATUSES) {
      expect(isClaimedMeasureClaimStatus(status)).toBe(false);
    }
    for (const status of CLAIMED_MEASURE_CLAIM_STATUSES) {
      expect(isClaimedMeasureClaimStatus(status)).toBe(true);
    }
  });

  /** SEAM L2 -> L3: the reminder sweep's set is carved out of CLAIMED, not beside it. */
  it("keeps the awaiting-decision set inside the claimed set", () => {
    expect(MEASURE_CLAIM_AWAITING_DECISION_STATUSES).toEqual(["submitted", "under_review"]);
    for (const status of MEASURE_CLAIM_AWAITING_DECISION_STATUSES) {
      expect(isClaimedMeasureClaimStatus(status)).toBe(true);
    }
  });

  it("makes paid and denied terminal", () => {
    expect(MEASURE_CLAIM_TRANSITIONS.paid).toEqual([]);
    expect(MEASURE_CLAIM_TRANSITIONS.denied).toEqual([]);
    expect(isAllowedMeasureClaimTransition("paid", "approved")).toBe(false);
    expect(isAllowedMeasureClaimTransition("denied", "approved")).toBe(false);
    expect(isAllowedMeasureClaimTransition("draft", "paid")).toBe(false);
    expect(isAllowedMeasureClaimTransition("submitted", "approved")).toBe(true);
    expect(isAllowedMeasureClaimTransition("approved", "paid")).toBe(true);
  });

  /**
   * A PROJECTION TYPO IS A RUNTIME ERROR HERE.
   *
   * Supabase clients in this repo are untyped by design, so nothing checks a
   * `.select()` string against the schema. The columns the ledger and the
   * reminder sweep actually read are asserted by name.
   */
  it("selects every column the ledger and the sweep read", () => {
    for (const column of ["status", "amount", "retention_percent", "retention_amount", "paid_on", "denial_reason", "decided_by", "decided_at", "fiscal_year_label", "category_id", "recipient_id"]) {
      expect(MEASURE_CLAIM_COLUMNS).toContain(column);
    }
    for (const column of ["id", "workspace_id", "measure_fund_id", "recipient_id", "status", "submitted_on", "amount", "fiscal_year_label"]) {
      expect(MEASURE_CLAIM_SWEEP_COLUMNS).toContain(column);
    }
    // The sweep is narrow on purpose: a job running over every workspace has
    // no business holding a claim's description or its decision note.
    expect(MEASURE_CLAIM_SWEEP_COLUMNS).not.toContain("description");
    expect(MEASURE_CLAIM_SWEEP_COLUMNS).not.toContain("decision_note");
  });
});

describe("eligibility comes from the measure, never from code", () => {
  /**
   * THE SECOND, DIFFERENTLY-SHAPED MEASURE.
   *
   * Product non-negotiable #0 in executable form: two ordinances with nothing
   * in common — different category ids, different counts, different
   * distribution shapes — go through the same eligibility code, and each one's
   * categories are refused by the other. There is no category list anywhere in
   * `src/lib/measures/claims.ts` for either of them to match.
   */
  const quarterlySalesTax = parseMeasureAllocationRule({
    version: 1,
    offTheTop: [{ id: "admin", label: "Administration", percent: 1 }],
    reserves: [{ id: "regional_reserve", label: "Regional reserve", basis: "category:regional", percent: 10 }],
    categories: [
      { id: "local_streets", label: "Local streets and roads", percentOfAllocable: 40, distribution: { kind: "return_to_source", basisId: "population" } },
      { id: "regional", label: "Regional projects", percentOfAllocable: 35, distribution: { kind: "pooled" } },
      { id: "transit", label: "Transit operations", percentOfAllocable: 20, distribution: { kind: "pooled" } },
      { id: "active", label: "Active transportation", percentOfAllocable: 5, distribution: { kind: "pooled" } },
    ],
    basisDefinitions: [{ id: "population", label: "Population", statedSourceNote: "Stated by the agency from the source the ordinance names." }],
  });

  const monthlyLevy = parseMeasureAllocationRule({
    version: 1,
    reserves: [{ id: "contingency", label: "Contingency", basis: "gross", percent: 5 }],
    categories: [
      { id: "maintenance", label: "Road maintenance", percentOfAllocable: 100, distribution: { kind: "return_to_source", basisId: "parcels" } },
    ],
    basisDefinitions: [{ id: "parcels", label: "Parcel count", statedSourceNote: "Stated by the agency from the assessor's roll named in the levy." }],
  });

  it("accepts each measure's own categories and refuses the other's", () => {
    const salesTax = resolveMeasureClaimCategories({ rule: quarterlySalesTax });
    const levy = resolveMeasureClaimCategories({ rule: monthlyLevy });
    if (!salesTax.ok || !levy.ok) throw new Error("both rules declare categories");

    expect(salesTax.source).toBe("ordinance_rule");
    expect(salesTax.categories.map((category) => category.id)).toEqual([
      "local_streets",
      "regional",
      "transit",
      "active",
    ]);
    expect(levy.categories.map((category) => category.id)).toEqual(["maintenance"]);

    expect(checkMeasureClaimEligibility({ categories: salesTax.categories, categoryId: "transit" }).ok).toBe(true);
    expect(checkMeasureClaimEligibility({ categories: levy.categories, categoryId: "maintenance" }).ok).toBe(true);

    // Each measure refuses the other's vocabulary, and says what it declares.
    const wrong = checkMeasureClaimEligibility({ categories: levy.categories, categoryId: "transit" });
    expect(wrong.ok).toBe(false);
    if (wrong.ok) throw new Error("unreachable");
    expect(wrong.reason).toBe("category_not_in_measure");
    expect(wrong.declaredCategoryIds).toEqual(["maintenance"]);
    expect(wrong.message).toContain("maintenance");
  });

  /**
   * AN ORDINANCE THE DESCRIPTOR CANNOT EXPRESS still has categories: the ones
   * somebody has actually allocated to by hand. Blocking those agencies was
   * rejected; letting a claim invent its own category was rejected harder.
   */
  it("falls back to the hand-entered allocations for a narrative ordinance", () => {
    const narrative = parseMeasureAllocationRule({
      version: 1,
      kind: "narrative",
      text: "The ordinance apportions by a formula that this form cannot express.",
    });

    const resolved = resolveMeasureClaimCategories({
      rule: narrative,
      recordedAllocationCategoryIds: ["bridge_program", "arterials", "bridge_program"],
    });
    if (!resolved.ok) throw new Error("expected the hand-entered fallback");
    expect(resolved.source).toBe("recorded_allocations");
    expect(resolved.categories.map((category) => category.id)).toEqual(["arterials", "bridge_program"]);

    // And with nothing recorded at all, it refuses rather than accepting anything.
    const nothing = resolveMeasureClaimCategories({ rule: narrative, recordedAllocationCategoryIds: [] });
    expect(nothing.ok).toBe(false);
    if (nothing.ok) throw new Error("unreachable");
    expect(nothing.reason).toBe("no_categories_recorded");
  });

  it("refuses a retired recipient", () => {
    const salesTax = resolveMeasureClaimCategories({ rule: quarterlySalesTax });
    if (!salesTax.ok) throw new Error("expected categories");

    const refused = checkMeasureClaimEligibility({
      categories: salesTax.categories,
      categoryId: "transit",
      recipient: { name: "Birch", is_active: false },
    });
    expect(refused.ok).toBe(false);
    if (refused.ok) throw new Error("unreachable");
    expect(refused.reason).toBe("recipient_inactive");
    expect(refused.message).toContain("Birch");
  });
});

describe("maintenance of effort", () => {
  /**
   * HAND-DERIVED, and the not_determined cases are the point.
   *
   *   Alder  required 1,250,000.00  reported 1,310,455.12  -> +60,455.12  met
   *   Birch  required   900,000.00  reported   874,318.06  -> −25,681.94  shortfall
   *   Cedar  required   500,000.00  reported   (none)      -> not determined
   *   Delta  required   (none)      reported   640,000.00  -> not determined
   *
   *   shortfallTotal    = 25,681.94                       (a magnitude)
   *   netDifferenceTotal= 60,455.12 − 25,681.94 = 34,773.18
   */
  const RECORDS = [
    { recipient_id: ALDER, fiscal_year_label: "FY26", required_amount: "1250000.00", reported_amount: "1310455.12", basis_note: "Audited" },
    { recipient_id: BIRCH, fiscal_year_label: "FY26", required_amount: "900000.00", reported_amount: "874318.06", basis_note: "Audited" },
    { recipient_id: CEDAR, fiscal_year_label: "FY26", required_amount: "500000.00", reported_amount: null, basis_note: "Awaiting the city's report" },
    { recipient_id: DELTA, fiscal_year_label: "FY26", required_amount: null, reported_amount: "640000.00", basis_note: "Ordinance figure not yet confirmed" },
  ];

  it("compares only where both figures are present", () => {
    const summary = buildMeasureMoeSummary({ records: RECORDS });

    expect(summary.recordCount).toBe(4);
    expect(summary.comparableCount).toBe(2);
    expect(summary.notDeterminedCount).toBe(2);
    expect(summary.metCount).toBe(1);
    expect(summary.shortfallCount).toBe(1);
    expect(summary.shortfallTotal).toBe(25681.94);
    expect(summary.netDifferenceTotal).toBe(34773.18);

    const byRecipient = new Map(summary.lines.map((line) => [line.recipientId, line]));
    expect(byRecipient.get(ALDER)?.differenceAmount).toBe(60455.12);
    expect(byRecipient.get(ALDER)?.status).toBe("met");
    expect(byRecipient.get(BIRCH)?.differenceAmount).toBe(-25681.94);
    expect(byRecipient.get(BIRCH)?.status).toBe("shortfall");
  });

  /**
   * THE FAILURE MODE THIS PREVENTS, both directions.
   *
   * A missing REPORTED figure read as zero prints a quiet city as having
   * abandoned its local spending entirely (−500,000.00). A missing REQUIRED
   * figure read as zero prints every body as compliant (+640,000.00). Both are
   * statements about a public body's finances the database does not support.
   */
  it("answers not determined rather than inventing a zero on either side", () => {
    const summary = buildMeasureMoeSummary({ records: RECORDS });
    const byRecipient = new Map(summary.lines.map((line) => [line.recipientId, line]));

    expect(byRecipient.get(CEDAR)?.status).toBe("not_determined");
    expect(byRecipient.get(CEDAR)?.differenceAmount).toBeNull();
    expect(byRecipient.get(CEDAR)?.differenceAmount).not.toBe(-500000);
    expect(byRecipient.get(CEDAR)?.notDeterminedReason).toContain("has not reported");

    expect(byRecipient.get(DELTA)?.status).toBe("not_determined");
    expect(byRecipient.get(DELTA)?.differenceAmount).toBeNull();
    expect(byRecipient.get(DELTA)?.differenceAmount).not.toBe(640000);
    expect(byRecipient.get(DELTA)?.notDeterminedReason).toContain("required figure");
  });

  it("reports no totals at all when nothing is comparable", () => {
    const summary = buildMeasureMoeSummary({ records: [RECORDS[2], RECORDS[3]] });
    expect(summary.comparableCount).toBe(0);
    expect(summary.shortfallTotal).toBeNull();
    expect(summary.netDifferenceTotal).toBeNull();
  });

  /** Exactly meeting the requirement is met, not a shortfall. The boundary. */
  it("treats an exact match as met", () => {
    const summary = buildMeasureMoeSummary({
      records: [{ recipient_id: ALDER, fiscal_year_label: "FY27", required_amount: "1000000.00", reported_amount: "1000000.00", basis_note: "Audited" }],
    });
    expect(summary.lines[0].differenceAmount).toBe(0);
    expect(summary.lines[0].status).toBe("met");
    expect(summary.shortfallTotal).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import {
  buildMeasureCapWindow,
  buildMeasureReceiptLedger,
  toMeasureFundPeriodRead,
} from "@/lib/measures/receipts";
import type { MeasureFundPeriodRecord } from "@/lib/measures/fund";

/**
 * THE RECEIPT LEDGER — and the three states the whole design turns on.
 *
 * Every expected figure below was derived by hand before the module existed.
 * The four quarters are the Cedar Basin measure's first fiscal year and, like
 * the allocation fixtures, name no real place.
 *
 *   FY2030 Q1   forecast 4,750,000.00   received 4,812,340.17
 *   FY2030 Q2   forecast 4,750,000.00   received 4,690,118.42
 *   FY2030 Q3   forecast 4,800,000.00   received      (none)     <- MISSING
 *   FY2030 Q4   forecast 4,800,000.00   received         0.00    <- RECORDED
 *
 *   receivedTotal   4,812,340.17 + 4,690,118.42 + 0.00 = 9,502,458.59  (a FLOOR)
 *   forecastTotal                                       19,100,000.00
 *   variance, comparable periods only:
 *       Q1   +62,340.17
 *       Q2   −59,881.58
 *       Q4 −4,800,000.00
 *       Σ  −4,797,541.41 over 3 of 4 periods
 */

const FY = "FY2030";

function period(overrides: Partial<MeasureFundPeriodRecord> = {}): MeasureFundPeriodRecord {
  return {
    id: `period-${overrides.period_label ?? "x"}`,
    measure_fund_id: "fund-1",
    fiscal_year_label: FY,
    ...overrides,
  };
}

const QUARTERS: MeasureFundPeriodRecord[] = [
  period({
    period_label: "FY2030 Q1",
    period_start: "2029-07-01",
    period_end: "2029-09-30",
    forecast_amount: "4750000.00",
    forecast_basis_note: "Adopted budget, board resolution 29-114.",
    received_amount: "4812340.17",
    received_on: "2029-10-28",
    receipt_source_note: "Treasurer remittance advice 2029-Q1.",
  }),
  period({
    period_label: "FY2030 Q2",
    period_start: "2029-10-01",
    period_end: "2029-12-31",
    forecast_amount: "4750000.00",
    received_amount: "4690118.42",
    received_on: "2030-01-27",
  }),
  period({
    period_label: "FY2030 Q3",
    period_start: "2030-01-01",
    period_end: "2030-03-31",
    forecast_amount: "4800000.00",
    // received_amount deliberately absent: the period is open and nobody has
    // reported a receipt.
  }),
  period({
    period_label: "FY2030 Q4",
    period_start: "2030-04-01",
    period_end: "2030-06-30",
    forecast_amount: "4800000.00",
    received_amount: "0.00",
    received_on: "2030-07-25",
    receipt_source_note: "Treasurer confirmed no distribution this quarter.",
  }),
];

function ledgerOf(periods: MeasureFundPeriodRecord[], fiscalYearLabel?: string) {
  const result = buildMeasureReceiptLedger({
    periodRead: { ok: true, periods },
    fiscalYearLabel,
  });
  if (!result.ok) throw new Error(`ledger refused: ${result.message}`);
  return result.ledger;
}

describe("measure receipt ledger — the totals", () => {
  it("sums only what has been reported, to the cent", () => {
    const ledger = ledgerOf(QUARTERS);

    expect(ledger.receivedTotal).toBe(9502458.59);
    expect(ledger.forecastTotal).toBe(19100000);
    expect(ledger.forecastPeriodCount).toBe(4);
  });

  it("computes variance only where both sides are present, and says how far that goes", () => {
    const ledger = ledgerOf(QUARTERS);

    expect(ledger.comparablePeriodCount).toBe(3);
    expect(ledger.coverage.openedPeriodCount).toBe(4);
    expect(ledger.varianceTotal).toBe(-4797541.41);

    const byLabel = Object.fromEntries(ledger.lines.map((line) => [line.periodLabel, line.varianceAmount]));
    expect(byLabel["FY2030 Q1"]).toBe(62340.17);
    expect(byLabel["FY2030 Q2"]).toBe(-59881.58);
    // A missing receipt produces NO variance. Treating it as zero would report
    // the entire forecast as a shortfall.
    expect(byLabel["FY2030 Q3"]).toBeNull();
    expect(byLabel["FY2030 Q4"]).toBe(-4800000);
  });

  it("reports no variance at all when nothing is comparable", () => {
    const ledger = ledgerOf([period({ period_label: "Only", period_start: "2029-07-01", period_end: "2029-09-30", received_amount: "100.00" })]);

    expect(ledger.varianceTotal).toBeNull();
    expect(ledger.forecastTotal).toBeNull();
    expect(ledger.comparablePeriodCount).toBe(0);
  });

  it("orders the lines by period start regardless of the order they were read in", () => {
    const shuffled = [QUARTERS[3], QUARTERS[1], QUARTERS[0], QUARTERS[2]];
    expect(ledgerOf(shuffled).lines.map((line) => line.periodLabel)).toEqual([
      "FY2030 Q1",
      "FY2030 Q2",
      "FY2030 Q3",
      "FY2030 Q4",
    ]);
    // And the total does not depend on the order either.
    expect(ledgerOf(shuffled).receivedTotal).toBe(9502458.59);
  });
});

describe("measure receipt ledger — an unreported amount is not zero", () => {
  /**
   * THE ASSERTION THIS FILE EXISTS FOR.
   *
   * Two funds, both with a `receivedTotal` of 0.00, and the difference between
   * them is the difference between "the fund received nothing" and "nobody has
   * told us". The number alone cannot be read; `coverage.isFloor` is what a
   * surface must consult before printing it.
   */
  it("tells a recorded zero apart from an unreported period", () => {
    const recordedZero = ledgerOf([
      period({ period_label: "Q1", period_start: "2029-07-01", period_end: "2029-09-30", received_amount: "0.00" }),
    ]);
    const unreported = ledgerOf([
      period({ period_label: "Q1", period_start: "2029-07-01", period_end: "2029-09-30" }),
    ]);

    expect(recordedZero.receivedTotal).toBe(0);
    expect(unreported.receivedTotal).toBe(0);

    expect(recordedZero.coverage.isFloor).toBe(false);
    expect(recordedZero.coverage.reportedPeriodCount).toBe(1);
    expect(recordedZero.coverage.missingPeriodCount).toBe(0);
    expect(recordedZero.lines[0]?.receivedAmount).toBe(0);

    expect(unreported.coverage.isFloor).toBe(true);
    expect(unreported.coverage.reportedPeriodCount).toBe(0);
    expect(unreported.coverage.missingPeriodCount).toBe(1);
    expect(unreported.coverage.missingPeriods).toEqual(["Q1"]);
    expect(unreported.lines[0]?.receivedAmount).toBeNull();
  });

  it("names the missing periods so a total can never be printed bare", () => {
    const ledger = ledgerOf(QUARTERS);

    expect(ledger.coverage.isFloor).toBe(true);
    expect(ledger.coverage.missingPeriodCount).toBe(1);
    expect(ledger.coverage.missingPeriods).toEqual(["FY2030 Q3"]);
    expect(ledger.coverage.reportedPeriodCount).toBe(3);
  });

  /**
   * A NEGATIVE RECEIPT IS A DATA-ENTRY ERROR, not a smaller amount.
   * `parseOptionalAmount` returns null for it, so it lands in the missing
   * column rather than silently offsetting a real quarter. (The column also
   * CHECKs `>= 0`, so this is defence in depth against a service-role write
   * that predates the constraint.)
   */
  it("treats a negative receipt as unreported rather than subtracting it", () => {
    const ledger = ledgerOf([
      period({ period_label: "Q1", period_start: "2029-07-01", period_end: "2029-09-30", received_amount: "1000.00" }),
      period({ period_label: "Q2", period_start: "2029-10-01", period_end: "2029-12-31", received_amount: "-250.00" }),
    ]);

    expect(ledger.receivedTotal).toBe(1000);
    expect(ledger.coverage.missingPeriods).toEqual(["Q2"]);
    expect(ledger.coverage.isFloor).toBe(true);
  });

  /**
   * A PERIOD THAT WAS NEVER OPENED leaves no row, so the ledger cannot see it
   * directly — but the calendar hole between two rows that DO exist is a fact,
   * not an inference from a cadence nobody stated.
   */
  it("finds a period that was never opened by the hole it leaves in the calendar", () => {
    const withoutQ2 = ledgerOf([QUARTERS[0], QUARTERS[2], QUARTERS[3]]);

    expect(withoutQ2.coverage.calendarGaps).toEqual([
      { afterPeriodLabel: "FY2030 Q1", gapStart: "2029-10-01", gapEnd: "2030-01-01" },
    ]);
    expect(withoutQ2.coverage.isFloor).toBe(true);
  });

  it("does not invent a gap between periods that meet exactly", () => {
    const contiguous = ledgerOf([QUARTERS[0], QUARTERS[1]]);

    expect(contiguous.coverage.calendarGaps).toEqual([]);
    expect(contiguous.coverage.isFloor).toBe(false);
    expect(contiguous.receivedTotal).toBe(9502458.59);
  });
});

describe("measure receipt ledger — a failed read is not an empty fund", () => {
  it("classifies an unapplied migration as pending and never as zero receipts", () => {
    const read = toMeasureFundPeriodRead({
      error: { message: 'relation "public.measure_fund_periods" does not exist' },
    });

    expect(read.ok).toBe(false);
    if (read.ok) throw new Error("unreachable");
    expect(read.pending).toBe(true);

    const result = buildMeasureReceiptLedger({ periodRead: read });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.pending).toBe(true);
    // Nothing resembling a ledger comes back. "$0 received" on an oversight
    // page is a database error wearing a number.
    expect("ledger" in result).toBe(false);
  });

  it("classifies a real fault as a fault, not as a setup step", () => {
    const read = toMeasureFundPeriodRead({ error: { message: "permission denied for table measure_fund_periods" } });

    expect(read.ok).toBe(false);
    if (read.ok) throw new Error("unreachable");
    expect(read.pending).toBe(false);
    expect(read.message).toContain("permission denied");
  });

  it("an empty result set is a real, empty answer", () => {
    const read = toMeasureFundPeriodRead({ data: [] });
    expect(read.ok).toBe(true);

    const ledger = ledgerOf([]);
    expect(ledger.receivedTotal).toBe(0);
    expect(ledger.coverage.openedPeriodCount).toBe(0);
    // No opened period is no doubt about the periods that exist — but also no
    // periods, which a surface says rather than printing a total.
    expect(ledger.coverage.isFloor).toBe(false);
  });
});

describe("measure receipt ledger — the totals are rounded at every addition", () => {
  /**
   * WRITTEN BECAUSE A MUTATION SURVIVED.
   *
   * Removing `roundToCent` from the accumulators changed nothing against the
   * four quarters above — their float sum happens to be exact — so the rounding
   * line was untested and this file was claiming coverage it did not have.
   * These three amounts were searched for specifically: each is an ordinary
   * at-the-cent figure, and their naive float sum is 15,472,903.540000003
   * rather than 15,472,903.54.
   *
   * It is one cent of nothing on its own. It matters because the same total is
   * compared against an adopted forecast and printed beside a claim ledger that
   * rounds at every addition (`summarizeBillingInvoiceRecords`), and two
   * surfaces that disagree in the fifteenth decimal place eventually disagree
   * in the second.
   */
  const DRIFT: MeasureFundPeriodRecord[] = [
    period({
      period_label: "D1",
      period_start: "2031-07-01",
      period_end: "2031-09-30",
      received_amount: "5631645.44",
      forecast_amount: "7540263.35",
    }),
    period({
      period_label: "D2",
      period_start: "2031-10-01",
      period_end: "2031-12-31",
      received_amount: "5179209.91",
      forecast_amount: "1002092.44",
    }),
    period({
      period_label: "D3",
      period_start: "2032-01-01",
      period_end: "2032-03-31",
      received_amount: "4662048.19",
      forecast_amount: "3749367.20",
    }),
  ];

  it("sums receipts to the cent where a naive float sum would drift", () => {
    // The control: this is what the accumulator must NOT produce.
    expect(5631645.44 + 5179209.91 + 4662048.19).not.toBe(15472903.54);
    expect(ledgerOf(DRIFT).receivedTotal).toBe(15472903.54);
  });

  it("sums the variance to the cent too, sign and all", () => {
    const ledger = ledgerOf(DRIFT);

    expect(ledger.lines.map((line) => line.varianceAmount)).toEqual([-1908617.91, 4177117.47, 912680.99]);
    expect(-1908617.91 + 4177117.47 + 912680.99).not.toBe(3181180.55);
    expect(ledger.varianceTotal).toBe(3181180.55);
    expect(ledger.comparablePeriodCount).toBe(3);
  });

  it("sums the agency's own forecast to the cent as well", () => {
    // The forecast accumulator is its own line of code and needed its own
    // drifting fixture: the first triple chosen here summed exactly in float,
    // and the mutation that removed its rounding survived.
    expect(7540263.35 + 1002092.44 + 3749367.2).not.toBe(12291722.99);
    expect(ledgerOf(DRIFT).forecastTotal).toBe(12291722.99);
  });
});

describe("measure receipt ledger — the fiscal-year window for an annual cap", () => {
  it("scopes to one fiscal year and ignores the rest", () => {
    const twoYears = [
      ...QUARTERS,
      period({
        period_label: "FY2031 Q1",
        fiscal_year_label: "FY2031",
        period_start: "2030-07-01",
        period_end: "2030-09-30",
        received_amount: "5000000.00",
      }),
    ];

    expect(ledgerOf(twoYears).receivedTotal).toBe(14502458.59);
    expect(ledgerOf(twoYears, FY).receivedTotal).toBe(9502458.59);
    expect(ledgerOf(twoYears, "FY2031").receivedTotal).toBe(5000000);
    expect(ledgerOf(twoYears, "FY2031").coverage.isFloor).toBe(false);
  });

  /**
   * WHAT REPLACED `windowComplete` (2026-08-12), and why the change is a
   * correction rather than a relaxation.
   *
   * The window used to report whether every period in the year had a recorded
   * RECEIPT, and the allocator answered `not_evaluable` and took the clause
   * UNCAPPED when it did not. That was the wrong proxy twice over: receipts are
   * not takes, and "the cap cannot be evaluated" became "the cap does not
   * apply". Since 20260812000014 the takes themselves are recorded, so the
   * window sums what has actually been taken and the cap binds in every period.
   *
   * An unallocated period contributes a TRUE ZERO — nobody took anything from a
   * period nobody allocated — so the sum is exact and the year's completeness
   * has no bearing on it.
   */
  const takeRead = (takes: Array<{ period_id: string; off_the_top_id: string; amount: string }>) =>
    ({ ok: true as const, takes });

  it("sums what each clause has already taken across the year's periods", () => {
    const window = buildMeasureCapWindow({
      periodRead: { ok: true, periods: QUARTERS },
      fiscalYearLabel: FY,
      takeRead: takeRead([
        { period_id: "period-FY2030 Q1", off_the_top_id: "administration", amount: "48123.40" },
        { period_id: "period-FY2030 Q2", off_the_top_id: "administration", amount: "46901.18" },
        // A second clause in the same ordinance is kept apart from the first.
        { period_id: "period-FY2030 Q1", off_the_top_id: "audit", amount: "12000.00" },
      ]),
    });

    expect(window.ok).toBe(true);
    if (!window.ok) throw new Error("unreachable");
    expect(window.window.priorTakesKnown).toBe(true);
    // 48,123.40 + 46,901.18, at the cent.
    expect(window.window.priorTakenByOffTheTopId).toEqual({ administration: 95024.58, audit: 12000 });
  });

  it("leaves out the period being re-allocated, so a recompute is not capped against itself", () => {
    const window = buildMeasureCapWindow({
      periodRead: { ok: true, periods: QUARTERS },
      fiscalYearLabel: FY,
      takeRead: takeRead([
        { period_id: "period-FY2030 Q1", off_the_top_id: "administration", amount: "48123.40" },
        { period_id: "period-FY2030 Q2", off_the_top_id: "administration", amount: "46901.18" },
      ]),
      excludePeriodId: "period-FY2030 Q2",
    });

    if (!window.ok) throw new Error("unreachable");
    expect(window.window.priorTakenByOffTheTopId).toEqual({ administration: 48123.4 });
  });

  it("counts no take from a period of another fiscal year, even if the query returned it", () => {
    const window = buildMeasureCapWindow({
      periodRead: { ok: true, periods: QUARTERS },
      fiscalYearLabel: FY,
      takeRead: takeRead([
        { period_id: "period-FY2030 Q1", off_the_top_id: "administration", amount: "48123.40" },
        // Belongs to no period of FY2030. Folding it in would let last year's
        // administration take consume this year's cap.
        { period_id: "period-FY2031 Q1", off_the_top_id: "administration", amount: "50000.00" },
      ]),
    });

    if (!window.ok) throw new Error("unreachable");
    expect(window.window.priorTakenByOffTheTopId).toEqual({ administration: 48123.4 });
  });

  it("reports nothing taken for a year whose periods have never been allocated", () => {
    const window = buildMeasureCapWindow({
      periodRead: { ok: true, periods: QUARTERS },
      fiscalYearLabel: FY,
      takeRead: takeRead([]),
    });

    if (!window.ok) throw new Error("unreachable");
    // An exact zero, not an unknown: a period nobody allocated took nothing.
    expect(window.window.priorTakenByOffTheTopId).toEqual({});
    expect(window.window.priorTakesKnown).toBe(true);
  });

  it("propagates a failed PERIODS read rather than reporting a window", () => {
    const window = buildMeasureCapWindow({
      periodRead: { ok: false, pending: false, message: "connection reset" },
      fiscalYearLabel: FY,
      takeRead: takeRead([]),
    });

    expect(window.ok).toBe(false);
  });

  /**
   * THE SUBTLER OF THE TWO, and the reason `takeRead` is a result rather than
   * an array. A failed takes read that arrived as `[]` would say "nothing has
   * been taken this year" — the exact sentence that let four quarters each take
   * the whole annual cap.
   */
  it("propagates a failed TAKES read rather than reporting nothing taken", () => {
    const window = buildMeasureCapWindow({
      periodRead: { ok: true, periods: QUARTERS },
      fiscalYearLabel: FY,
      takeRead: { ok: false, pending: true, message: 'relation "measure_period_off_the_top" does not exist' },
    });

    expect(window.ok).toBe(false);
    if (window.ok) throw new Error("unreachable");
    expect(window.pending).toBe(true);
  });
});

import { parseOptionalAmount } from "@/lib/money/optional-amount";
import { looksLikePendingSchema } from "@/lib/supabase/pending-schema";
import type { MeasureFundPeriodRecord } from "@/lib/measures/fund";

/**
 * WHAT THE FUND HAS ACTUALLY RECEIVED — and what it has not been told.
 *
 * ============================================================================
 * THE THREE STATES, AND WHY THE WHOLE MODULE EXISTS TO KEEP THEM APART
 * ============================================================================
 *
 *   no row for the period          -- it was never opened
 *   received_amount IS NULL        -- opened, and no receipt reported
 *   received_amount = 0.00         -- a person recorded that nothing arrived
 *
 * Only the third is a zero. The first two are MISSING, and every total that
 * spans one is a FLOOR — the fund received at least this much, and possibly
 * more. `coverage` travels with every total so that no surface can print the
 * number without the sentence that qualifies it.
 *
 * This is the correction `drawdown-ledger.ts` has to make on every read because
 * `funding_awards.awarded_amount` is `NOT NULL DEFAULT 0` and cannot hold the
 * distinction. `measure_fund_periods.received_amount` is nullable with no
 * default so that the correction is unnecessary here, and `parseOptionalAmount`
 * propagates the absence rather than coercing it (see that module's header: a
 * negative is also null, because a negative receipt is a data-entry error and
 * treating it as arithmetic silently offsets a real figure elsewhere).
 *
 * ============================================================================
 * A FAILED READ IS NOT AN EMPTY FUND
 * ============================================================================
 *
 * `MeasureFundPeriodRead` is the `DrawdownInvoiceRead` shape
 * (`drawdown-ledger.ts:196`), copied deliberately. The ledger takes it rather
 * than an array so a failed query cannot arrive as `[]` and render as a
 * complete ledger of zeros. "This measure has received $0" reads as an urgent,
 * actionable fact and would be a database error wearing a number — on a page an
 * oversight committee reads.
 *
 * ============================================================================
 * WHAT IS NOT COMPUTED HERE
 * ============================================================================
 *
 * No projection, no extrapolation, no seasonal adjustment, no expected receipt.
 * A sales-tax projection is an economic forecast over taxable-sales growth that
 * this product has no input data for, and a projected figure on a fund page
 * will be programmed against. The only forecast in this module is the AGENCY'S
 * OWN, typed by a person into `forecast_amount`, and variance is computed only
 * where both figures are present — `comparablePeriodCount` of
 * `openedPeriodCount` says how far that goes.
 */

export type MeasureFundPeriodRead =
  | { ok: true; periods: MeasureFundPeriodRecord[] }
  | { ok: false; pending: boolean; message: string };

/**
 * Turn a Supabase `{ data, error }` into a read result.
 *
 * `pending` is true when the error is PostgREST reporting a missing table or
 * column, so the surface can say "finish setting up" rather than "error". Every
 * caller classifies the failure the same way because they all come through
 * here.
 */
export function toMeasureFundPeriodRead(result: {
  data?: MeasureFundPeriodRecord[] | null;
  error?: { message?: string | null } | null;
}): MeasureFundPeriodRead {
  if (result.error) {
    const message = result.error.message ?? "Measure period read failed.";
    return { ok: false, pending: looksLikePendingSchema(message), message };
  }

  return { ok: true, periods: result.data ?? [] };
}

/** One period as the ledger sees it. */
export type MeasureReceiptLine = {
  periodId: string | null;
  periodLabel: string;
  fiscalYearLabel: string;
  periodStart: string | null;
  periodEnd: string | null;
  /** Null when nobody has reported a receipt. NEVER coerced to 0. */
  receivedAmount: number | null;
  receivedOn: string | null;
  hasReceiptSourceNote: boolean;
  forecastAmount: number | null;
  hasForecastBasisNote: boolean;
  /** `received − forecast`, only where BOTH are present. */
  varianceAmount: number | null;
};

/**
 * A stretch of calendar between two OPENED periods that no period covers.
 *
 * Detected from the period rows themselves — the gap between one period's end
 * and the next one's start — rather than inferred from the fund's cadence. A
 * cadence-derived expectation would be a guess about a fund whose ordinance we
 * have not read; a calendar hole between two rows that both exist is a fact.
 *
 * NOTE WHAT THIS CANNOT SEE: a period missing from the START or the END of the
 * span, because there is no neighbouring row to bound it. `coverage.isFloor`
 * therefore understates rather than overstates the doubt, which is the safe
 * direction, and no surface may present the span as complete on its strength.
 */
export type MeasureReceiptGap = {
  afterPeriodLabel: string;
  gapStart: string;
  gapEnd: string;
};

export type MeasureReceiptCoverage = {
  /** Rows read, whatever state they are in. */
  openedPeriodCount: number;
  /** Rows carrying a reported receipt (including a recorded 0.00). */
  reportedPeriodCount: number;
  /** Rows opened with no receipt reported. These are what makes a total a floor. */
  missingPeriodCount: number;
  missingPeriods: string[];
  calendarGaps: MeasureReceiptGap[];
  /**
   * TRUE when the total is a lower bound rather than the answer.
   *
   * The only field a surface needs to consult to know whether it may print a
   * total as "the total". Derived, so a new source of doubt added below reaches
   * every caller at once.
   */
  isFloor: boolean;
};

export type MeasureReceiptLedger = {
  /** Σ recorded receipts. A FLOOR whenever `coverage.isFloor`. */
  receivedTotal: number;
  /** Σ adopted forecasts, over the periods that have one. Null when none do. */
  forecastTotal: number | null;
  forecastPeriodCount: number;
  /**
   * Σ (received − forecast) over periods where BOTH are present, and null when
   * there are none. Never computed against a missing side: a variance that
   * treats an absent forecast as zero reports the whole receipt as an overage.
   */
  varianceTotal: number | null;
  comparablePeriodCount: number;
  coverage: MeasureReceiptCoverage;
  lines: MeasureReceiptLine[];
};

export type MeasureReceiptLedgerResult =
  | { ok: true; ledger: MeasureReceiptLedger }
  | { ok: false; pending: boolean; message: string };

/** Round to the cent after each addition, so two surfaces cannot drift apart by float residue. */
function roundToCent(value: number): number {
  return Math.round(value * 100) / 100;
}

function text(value: string | null | undefined): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

/** The day after an ISO date, for gap detection. Date-only arithmetic, in UTC. */
function nextDay(isoDate: string): string | null {
  const parsed = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed.toISOString().slice(0, 10);
}

/**
 * Build the receipt ledger for one measure fund over the rows it was given.
 *
 * Pure: every figure is arithmetic over rows the caller already read through
 * its own client. Mechanical arithmetic nobody sounded worried about is exactly
 * where this repository's audits keep finding hollow code, so it is isolated
 * from I/O where a hand-derived fixture can pin every cent and a mutation to
 * any single line changes a number a test names by value.
 *
 * Optionally scoped to one fiscal year — the window an annual administration
 * cap is evaluated over. The scoping happens here rather than in the query so
 * that the caller cannot accidentally evaluate a cap against rows it filtered
 * differently from the ledger it printed.
 */
export function buildMeasureReceiptLedger({
  periodRead,
  fiscalYearLabel,
}: {
  periodRead: MeasureFundPeriodRead;
  fiscalYearLabel?: string;
}): MeasureReceiptLedgerResult {
  if (!periodRead.ok) {
    return { ok: false, pending: periodRead.pending, message: periodRead.message };
  }

  const periods = periodRead.periods
    .filter((period) => !fiscalYearLabel || period.fiscal_year_label === fiscalYearLabel)
    .slice()
    .sort((left, right) => (left.period_start ?? "").localeCompare(right.period_start ?? ""));

  const lines: MeasureReceiptLine[] = [];
  const missingPeriods: string[] = [];
  const calendarGaps: MeasureReceiptGap[] = [];

  let receivedTotal = 0;
  let reportedPeriodCount = 0;
  let forecastTotal = 0;
  let forecastPeriodCount = 0;
  let varianceTotal = 0;
  let comparablePeriodCount = 0;

  let previousEnd: string | null = null;
  let previousLabel = "";

  for (const period of periods) {
    const periodLabel = text(period.period_label) ?? "Unnamed period";
    const receivedAmount = parseOptionalAmount(period.received_amount);
    const forecastAmount = parseOptionalAmount(period.forecast_amount);
    const periodStart = text(period.period_start);
    const periodEnd = text(period.period_end);

    if (receivedAmount === null) {
      missingPeriods.push(periodLabel);
    } else {
      reportedPeriodCount += 1;
      receivedTotal = roundToCent(receivedTotal + receivedAmount);
    }

    if (forecastAmount !== null) {
      forecastPeriodCount += 1;
      forecastTotal = roundToCent(forecastTotal + forecastAmount);
    }

    // BOTH SIDES OR NEITHER. A variance against an absent forecast would report
    // the entire receipt as an overage, and a variance against an absent
    // receipt would report the entire forecast as a shortfall. Both are stories
    // about an agency's money that the database does not support.
    const varianceAmount =
      receivedAmount !== null && forecastAmount !== null ? roundToCent(receivedAmount - forecastAmount) : null;
    if (varianceAmount !== null) {
      comparablePeriodCount += 1;
      varianceTotal = roundToCent(varianceTotal + varianceAmount);
    }

    if (previousEnd && periodStart) {
      const expectedStart = nextDay(previousEnd);
      if (expectedStart && periodStart > expectedStart) {
        calendarGaps.push({
          afterPeriodLabel: previousLabel,
          gapStart: expectedStart,
          gapEnd: periodStart,
        });
      }
    }
    if (periodEnd) {
      previousEnd = periodEnd;
      previousLabel = periodLabel;
    }

    lines.push({
      periodId: text(period.id),
      periodLabel,
      fiscalYearLabel: text(period.fiscal_year_label) ?? "",
      periodStart,
      periodEnd,
      receivedAmount,
      receivedOn: text(period.received_on),
      hasReceiptSourceNote: Boolean(text(period.receipt_source_note)),
      forecastAmount,
      hasForecastBasisNote: Boolean(text(period.forecast_basis_note)),
      varianceAmount,
    });
  }

  const coverage: MeasureReceiptCoverage = {
    openedPeriodCount: periods.length,
    reportedPeriodCount,
    missingPeriodCount: missingPeriods.length,
    missingPeriods,
    calendarGaps,
    isFloor: missingPeriods.length > 0 || calendarGaps.length > 0,
  };

  return {
    ok: true,
    ledger: {
      receivedTotal,
      forecastTotal: forecastPeriodCount > 0 ? forecastTotal : null,
      forecastPeriodCount,
      varianceTotal: comparablePeriodCount > 0 ? varianceTotal : null,
      comparablePeriodCount,
      coverage,
      lines,
    },
  };
}

/**
 * One recorded off-the-top take, as `measure_period_off_the_top` stores it.
 *
 * `buildMeasureCapWindow` needs only the first three: which period, which
 * clause, how much. The rest are what an oversight surface needs in order to
 * SHOW the take — the clause's own name, what the ordinance's formula called
 * for before any limit applied, and whether a limit bit. All optional in the
 * type, because a caller reading the narrow shape for a cap must not be forced
 * to fabricate a `cap_status` it did not select (the `MeasureAllocationLike`
 * convention); every real read uses `MEASURE_OFF_THE_TOP_COLUMNS`, which has
 * them.
 */
export type MeasureOffTheTopTakeRecord = {
  period_id?: string | null;
  off_the_top_id?: string | null;
  amount?: number | string | null;
  label?: string | null;
  uncapped_amount?: number | string | null;
  cap_amount?: number | string | null;
  cap_basis?: string | null;
  cap_status?: string | null;
};

export type MeasureOffTheTopTakeRead =
  | { ok: true; takes: MeasureOffTheTopTakeRecord[] }
  | { ok: false; pending: boolean; message: string };

/** The `toMeasureFundPeriodRead` classifier, for the takes query. */
export function toMeasureOffTheTopTakeRead(result: {
  data?: MeasureOffTheTopTakeRecord[] | null;
  error?: { message?: string | null } | null;
}): MeasureOffTheTopTakeRead {
  if (result.error) {
    const message = result.error.message ?? "Measure off-the-top read failed.";
    return { ok: false, pending: looksLikePendingSchema(message), message };
  }
  return { ok: true, takes: result.data ?? [] };
}

/**
 * The fiscal-year window an off-the-top cap is evaluated over: what each clause
 * has ALREADY TAKEN in this year, summed from the recorded takes.
 *
 * ============================================================================
 * WHY THIS READS TAKES AND NOT RECEIPTS
 * ============================================================================
 *
 * An annual cap limits what the agency may TAKE, so the only figure that can
 * evaluate it is what the agency has taken. Until 20260812000014 nothing
 * persisted that, and this function's `priorTakenByOffTheTopId` was whatever
 * the caller passed — which, at the one call site there was, was nothing. Every
 * period's prior-taken was therefore 0, and a 1% take capped at 200,000/year
 * over four 25,000,000 quarters produced four 200,000 takes against a 200,000
 * cap, each labelled `capped`.
 *
 * `excludePeriodId` is the period being re-allocated. Its own recorded take is
 * about to be replaced, so counting it would cap this period against itself and
 * every recompute would take less than the one before it.
 *
 * ============================================================================
 * BOTH READS ARE LOAD-BEARING, AND THE PERIODS ONE IS THE SUBTLE ONE
 * ============================================================================
 *
 * The takes are addressed by period, and which periods belong to the fiscal
 * year comes from `periodRead`. A failed periods read would therefore hand this
 * function a SHORT list of period ids, the missing periods' takes would be
 * absent from the sum, prior-taken would be understated, and the cap would let
 * the agency take more than the ordinance allows — the same failure, arriving
 * by a different door. So a failure of either read refuses the window rather
 * than degrading it, and the caller refuses the allocation.
 */
export function buildMeasureCapWindow({
  periodRead,
  fiscalYearLabel,
  takeRead,
  excludePeriodId,
}: {
  periodRead: MeasureFundPeriodRead;
  fiscalYearLabel: string;
  takeRead: MeasureOffTheTopTakeRead;
  excludePeriodId?: string | null;
}):
  | { ok: true; window: { priorTakenByOffTheTopId: Record<string, number | string>; priorTakesKnown: true } }
  | { ok: false; pending: boolean; message: string } {
  const result = buildMeasureReceiptLedger({ periodRead, fiscalYearLabel });
  if (!result.ok) return result;
  if (!takeRead.ok) return { ok: false, pending: takeRead.pending, message: takeRead.message };

  // Only the periods this fiscal year holds. The caller queries by period id,
  // but filtering here as well means a caller that widened its query cannot
  // quietly fold another year's takes into this year's cap.
  const periodIdsInYear = new Set(
    result.ledger.lines.map((line) => line.periodId).filter((id): id is string => Boolean(id))
  );

  const priorTakenByOffTheTopId: Record<string, number | string> = {};
  for (const take of takeRead.takes) {
    const periodId = text(take.period_id ?? null);
    const offTheTopId = text(take.off_the_top_id ?? null);
    if (!periodId || !offTheTopId) continue;
    if (!periodIdsInYear.has(periodId)) continue;
    if (excludePeriodId && periodId === excludePeriodId) continue;

    // `parseOptionalAmount` refuses a negative, and the column's CHECK refuses
    // one too. A take that arrives unreadable is skipped rather than counted as
    // zero — but the two are the same number here, and that is worth naming:
    // an unreadable take UNDERSTATES prior-taken, in the direction that
    // overtakes. It cannot happen through this product's own writes (the column
    // is NOT NULL with a `>= 0` CHECK), and the honest place to catch it if it
    // ever does is the read, not the sum.
    const amount = parseOptionalAmount(take.amount ?? null);
    if (amount === null) continue;

    const running = priorTakenByOffTheTopId[offTheTopId];
    priorTakenByOffTheTopId[offTheTopId] = roundToCent(
      (typeof running === "number" ? running : Number(running ?? 0)) + amount
    );
  }

  return { ok: true, window: { priorTakenByOffTheTopId, priorTakesKnown: true } };
}

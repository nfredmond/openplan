"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import { MeasureField, MeasureSubmitFeedback, useMeasureSubmit } from "./measure-form-shell";
import type { MeasureReceiptLedger } from "@/lib/measures/receipts";
import { formatMoney } from "@/lib/money/format";

/**
 * The fund's periods: what arrived, what did not, and applying the ordinance.
 *
 * ============================================================================
 * THE COVERAGE SENTENCE IS NOT OPTIONAL
 * ============================================================================
 *
 * `receivedTotal` is a FLOOR whenever any period in the span is unreported or
 * the periods leave a calendar hole, and `coverage.isFloor` is the one field
 * that says so. The total and its qualifier are rendered by the same block
 * below — deliberately not two adjacent elements one edit could separate,
 * because "this fund has received $4.8M" beside a missing quarter is a number
 * the reader will treat as complete.
 *
 * A CLEARED AMOUNT IS NOT ZERO. The receipt input sends `null` when empty and
 * the number when filled, INCLUDING zero. "Nothing arrived this quarter" is a
 * fact somebody records; "nobody has told us yet" is the absence of one, and
 * this form is where the difference is either kept or lost.
 *
 * ============================================================================
 * AND A BLANK VINTAGE IS NOT AN EMPTY DISTRIBUTION
 * ============================================================================
 *
 * Leaving the vintage box empty used to allocate the period anyway, with every
 * return-to-source category held undistributed because "" matches no recorded
 * figure — cities allocated nothing, and a green "Period allocated" beside it.
 * The route refuses that now, for every caller. This panel refuses it BEFORE
 * the request, because the planner is standing here and the ordinance's own
 * category names are the part they can act on.
 *
 * `vintageDependentCategoryLabels` comes from
 * `measureCategoriesNeedingBasisVintage` over the rule the measure page
 * resolved — which is the rule in force at the LATEST period. Where a fund has
 * more than one rule version, an older period may need a vintage this list does
 * not know about; the route resolves the rule for the period it is actually
 * allocating and is the gate that holds. This one only avoids offering a button
 * that cannot work.
 */

export type MeasurePanelPeriod = {
  id: string;
  periodLabel: string;
  fiscalYearLabel: string;
  periodStart: string | null;
  periodEnd: string | null;
  receivedAmount: number | null;
  forecastAmount: number | null;
  varianceAmount: number | null;
  allocationRowCount: number;
};

/**
 * Receipt-ledger figures are reconciled against the agency's own adopted
 * forecast, so they are written to the cent and in the currency the measure
 * profile declares — never the browser's locale.
 */
function formatLedgerMoney(value: number | null, currencyCode: string): string {
  return formatMoney(value, { precision: "cents", currency: currencyCode, absent: "Not reported" });
}

export function MeasureFundPanel({
  measureId,
  currencyCode,
  ledger,
  periods,
  canWrite,
  vintageDependentCategoryLabels = [],
}: {
  measureId: string;
  currencyCode: string;
  ledger: MeasureReceiptLedger;
  periods: MeasurePanelPeriod[];
  canWrite: boolean;
  /** The ordinance's categories that are divided using the recorded figures. */
  vintageDependentCategoryLabels?: string[];
}) {
  const { state, submit } = useMeasureSubmit();
  const [openingPeriod, setOpeningPeriod] = useState(false);
  const [periodLabel, setPeriodLabel] = useState("");
  const [fiscalYearLabel, setFiscalYearLabel] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [receiptDrafts, setReceiptDrafts] = useState<Record<string, { amount: string; on: string; note: string }>>({});
  const [vintageLabel, setVintageLabel] = useState("");

  const draftFor = (periodId: string) => receiptDrafts[periodId] ?? { amount: "", on: "", note: "" };

  /**
   * Named rather than counted, and the categories are listed: "a vintage is
   * required" sends a planner to work out which part of the ordinance cares,
   * and the answer is already on this page.
   */
  const vintageMissing = vintageDependentCategoryLabels.length > 0 && !vintageLabel.trim();
  const vintageRefusal = vintageMissing
    ? `Name the edition of the figures in force before applying the ordinance. ` +
      `${vintageDependentCategoryLabels.join(", ")} ` +
      `${vintageDependentCategoryLabels.length === 1 ? "is" : "are"} divided between the cities and ` +
      `districts using the recorded figures, and with no edition named nothing matches — ` +
      `${vintageDependentCategoryLabels.length === 1 ? "that category" : "those categories"} would be ` +
      `held undistributed and the recipients would be allocated nothing.`
    : null;

  async function openPeriod() {
    const created = await submit({
      url: `/api/measures/${measureId}/periods`,
      method: "POST",
      successMessage: "Period opened. It has no receipt recorded yet.",
      body: { periodLabel, fiscalYearLabel, periodStart, periodEnd },
    });
    if (created) {
      setPeriodLabel("");
      setPeriodStart("");
      setPeriodEnd("");
      setOpeningPeriod(false);
    }
  }

  async function recordReceipt(periodId: string) {
    const draft = draftFor(periodId);
    await submit({
      url: `/api/measures/${measureId}/periods`,
      method: "PATCH",
      successMessage: "Receipt recorded.",
      body: {
        periodId,
        // "" reaches the route as null — unreported — and "0" reaches it as
        // zero. The route keeps them apart; this line is where the browser
        // would otherwise flatten both.
        receivedAmount: draft.amount,
        receivedOn: draft.on || null,
        receiptSourceNote: draft.note || null,
      },
    });
  }

  async function allocatePeriod(periodId: string) {
    await submit({
      url: `/api/measures/${measureId}/periods/${periodId}/allocate`,
      method: "POST",
      successMessage: "Period allocated from the ordinance rule in force.",
      body: { mode: "descriptor", basisVintageLabel: vintageLabel || undefined },
    });
  }

  return (
    <section className="rounded-[0.75rem] border border-border/70 bg-background/80 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">What the fund has received</h2>
          {/* THE TOTAL AND ITS COVERAGE, in one block on purpose. */}
          <p className="mt-1 text-2xl font-semibold tabular-nums">
            {formatLedgerMoney(ledger.receivedTotal, currencyCode)}
            {ledger.coverage.isFloor ? <span className="text-base font-normal text-muted-foreground"> or more</span> : null}
          </p>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {ledger.coverage.isFloor
              ? `This is a floor, not the total. ${ledger.coverage.reportedPeriodCount} of ` +
                `${ledger.coverage.openedPeriodCount} periods have a reported receipt` +
                (ledger.coverage.missingPeriodCount > 0
                  ? `; no receipt has been reported for ${ledger.coverage.missingPeriods.join(", ")}`
                  : "") +
                (ledger.coverage.calendarGaps.length > 0
                  ? `; ${ledger.coverage.calendarGaps.length} stretch(es) of calendar are covered by no period at all`
                  : "") +
                ". An unreported amount is not zero."
              : `Every one of the ${ledger.coverage.openedPeriodCount} periods opened has a reported receipt.`}
          </p>
          {ledger.varianceTotal !== null ? (
            <p className="mt-1 text-sm text-muted-foreground">
              Against the agency&rsquo;s own adopted forecast: {formatLedgerMoney(ledger.varianceTotal, currencyCode)} across{" "}
              {ledger.comparablePeriodCount} of {ledger.coverage.openedPeriodCount} periods where both figures are
              recorded. OpenPlan does not forecast receipts.
            </p>
          ) : null}
        </div>

        {canWrite ? (
          <Button type="button" variant="outline" size="sm" onClick={() => setOpeningPeriod((open) => !open)}>
            {openingPeriod ? "Cancel" : "Open a period"}
          </Button>
        ) : null}
      </div>

      {openingPeriod && canWrite ? (
        <div className="mt-4 grid gap-3 rounded-[0.5rem] border border-border/70 p-4 md:grid-cols-4">
          <MeasureField label="Period name" htmlFor="period-label" hint="The agency's own name for it.">
            <Input id="period-label" value={periodLabel} onChange={(event) => setPeriodLabel(event.target.value)} />
          </MeasureField>
          <MeasureField label="Fiscal year" htmlFor="period-fy" hint="Named, never derived from the dates.">
            <Input id="period-fy" value={fiscalYearLabel} onChange={(event) => setFiscalYearLabel(event.target.value)} />
          </MeasureField>
          <MeasureField label="Starts" htmlFor="period-start">
            <Input id="period-start" type="date" value={periodStart} onChange={(event) => setPeriodStart(event.target.value)} />
          </MeasureField>
          <MeasureField label="Ends" htmlFor="period-end">
            <Input id="period-end" type="date" value={periodEnd} onChange={(event) => setPeriodEnd(event.target.value)} />
          </MeasureField>
          <div className="md:col-span-4">
            <Button
              type="button"
              onClick={openPeriod}
              disabled={state.busy || !periodLabel.trim() || !fiscalYearLabel.trim() || !periodStart || !periodEnd}
            >
              Open the period
            </Button>
          </div>
        </div>
      ) : null}

      {canWrite ? (
        <div className="mt-4 max-w-sm">
          <MeasureField
            label="Apportionment vintage in force"
            htmlFor="basis-vintage"
            hint="Which edition of the population, mileage or parcel figures the ordinance says governs. Used when a period is allocated."
          >
            <Input id="basis-vintage" value={vintageLabel} onChange={(event) => setVintageLabel(event.target.value)} />
          </MeasureField>
          {vintageRefusal ? (
            <p role="status" className="mt-2 text-sm text-amber-700 dark:text-amber-300">
              {vintageRefusal}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[52rem] text-sm">
          <thead>
            <tr className="border-b border-border/70 text-left text-[0.72rem] uppercase tracking-[0.14em] text-muted-foreground">
              <th className="py-2 pr-3">Period</th>
              <th className="py-2 pr-3">Fiscal year</th>
              <th className="py-2 pr-3 text-right">Adopted forecast</th>
              <th className="py-2 pr-3 text-right">Received</th>
              <th className="py-2 pr-3">Allocation</th>
              {canWrite ? <th className="py-2">Record a receipt</th> : null}
            </tr>
          </thead>
          <tbody>
            {periods.map((period) => {
              const draft = draftFor(period.id);
              return (
                <tr key={period.id} className="border-b border-border/40 align-top">
                  <td className="py-3 pr-3">
                    <div className="font-medium">{period.periodLabel}</div>
                    <div className="text-xs text-muted-foreground">
                      {period.periodStart} – {period.periodEnd}
                    </div>
                  </td>
                  <td className="py-3 pr-3">{period.fiscalYearLabel}</td>
                  <td className="py-3 pr-3 text-right tabular-nums">
                    {period.forecastAmount === null ? (
                      <span className="text-muted-foreground">None adopted</span>
                    ) : (
                      formatLedgerMoney(period.forecastAmount, currencyCode)
                    )}
                  </td>
                  <td className="py-3 pr-3 text-right tabular-nums">
                    {period.receivedAmount === null ? (
                      <StatusBadge tone="warning">Not reported</StatusBadge>
                    ) : (
                      formatLedgerMoney(period.receivedAmount, currencyCode)
                    )}
                  </td>
                  <td className="py-3 pr-3">
                    {period.allocationRowCount > 0 ? (
                      <span className="text-xs text-muted-foreground">{period.allocationRowCount} line(s)</span>
                    ) : (
                      <span className="text-xs text-muted-foreground">Not allocated</span>
                    )}
                    {canWrite && period.receivedAmount !== null ? (
                      <div className="mt-1">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          // The button is not offered while the request would
                          // produce a zeroed allocation. The sentence above the
                          // table says why, so this is never a dead control.
                          disabled={state.busy || vintageMissing}
                          onClick={() => allocatePeriod(period.id)}
                        >
                          {period.allocationRowCount > 0 ? "Recompute" : "Apply the ordinance"}
                        </Button>
                      </div>
                    ) : null}
                  </td>
                  {canWrite ? (
                    <td className="py-3">
                      <div className="flex flex-wrap items-end gap-2">
                        <Input
                          aria-label={`Amount received in ${period.periodLabel}`}
                          className="w-32"
                          type="number"
                          min="0"
                          step="0.01"
                          value={draft.amount}
                          onChange={(event) =>
                            setReceiptDrafts((current) => ({
                              ...current,
                              [period.id]: { ...draftFor(period.id), amount: event.target.value },
                            }))
                          }
                        />
                        <Input
                          aria-label={`Date received for ${period.periodLabel}`}
                          className="w-40"
                          type="date"
                          value={draft.on}
                          onChange={(event) =>
                            setReceiptDrafts((current) => ({
                              ...current,
                              [period.id]: { ...draftFor(period.id), on: event.target.value },
                            }))
                          }
                        />
                        <Input
                          aria-label={`Where the figure for ${period.periodLabel} came from`}
                          className="w-48"
                          placeholder="Remittance source"
                          value={draft.note}
                          onChange={(event) =>
                            setReceiptDrafts((current) => ({
                              ...current,
                              [period.id]: { ...draftFor(period.id), note: event.target.value },
                            }))
                          }
                        />
                        <Button type="button" size="sm" disabled={state.busy} onClick={() => recordReceipt(period.id)}>
                          Save
                        </Button>
                      </div>
                    </td>
                  ) : null}
                </tr>
              );
            })}
            {periods.length === 0 ? (
              <tr>
                <td colSpan={canWrite ? 6 : 5} className="py-6 text-center text-sm text-muted-foreground">
                  No periods have been opened yet. A fund with no periods has not been told anything — which is
                  not the same as a fund that has received nothing.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="mt-3">
        <MeasureSubmitFeedback state={state} />
      </div>
    </section>
  );
}

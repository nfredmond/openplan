"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import type { MeasureMoeSummary } from "@/lib/measures/claims";
import { formatMoney } from "@/lib/money/format";
import { MeasureField, MeasureSubmitFeedback, useMeasureSubmit } from "./measure-form-shell";

/**
 * Maintenance of effort — and the "not determined" that outranks.
 *
 * Most self-help ordinances forbid a recipient from replacing its own local
 * spending with measure money. This panel shows what the ordinance requires of
 * each body and what that body reported, and the DIFFERENCE ONLY WHERE BOTH ARE
 * PRESENT. Where either side is missing it says so and stops.
 *
 * The temptation this design refuses is the obvious one: treating a missing
 * reported figure as zero would print every quiet city as having abandoned its
 * local spending entirely, and treating a missing required figure as zero would
 * print every one of them as compliant. Both are statements about a public
 * body's finances that nothing in the database supports.
 *
 * NO VERDICT IS STORED. The status chips below are derived at read time from
 * the two figures; there is no compliance column for anything to promote, and
 * that is deliberate (see the migration header).
 *
 * The net figure is shown with its caveat attached, because one city's surplus
 * does not cover another city's shortfall — maintenance of effort binds each
 * body separately.
 */

export function MoeEditor({
  measureId,
  summary,
  recipients,
  fiscalYearLabels,
  currencyCode,
  canWrite,
}: {
  measureId: string;
  summary: MeasureMoeSummary;
  recipients: Array<{ id: string; name: string }>;
  fiscalYearLabels: string[];
  currencyCode: string;
  canWrite: boolean;
}) {
  const { state, submit } = useMeasureSubmit();
  const [recipientId, setRecipientId] = useState("");
  const [fiscalYearLabel, setFiscalYearLabel] = useState("");
  const [requiredAmount, setRequiredAmount] = useState("");
  const [reportedAmount, setReportedAmount] = useState("");
  const [basisNote, setBasisNote] = useState("");

  const nameById = new Map(recipients.map((recipient) => [recipient.id, recipient.name]));
  // Maintenance-of-effort figures are compared against a required amount a
  // recipient is held to, so they are written to the cent, in the measure's
  // declared currency — never the browser's locale.
  const money = (value: number | null) =>
    formatMoney(value, { precision: "cents", currency: currencyCode });

  async function record() {
    const saved = await submit({
      url: `/api/measures/${measureId}/moe`,
      method: "POST",
      successMessage: "Maintenance-of-effort figures recorded.",
      body: {
        recipientId,
        fiscalYearLabel,
        // "" reaches the route as null. Either side may be left for later —
        // they arrive months apart.
        requiredAmount,
        reportedAmount,
        basisNote,
        statedOn: new Date().toISOString().slice(0, 10),
      },
    });
    if (saved) {
      setRequiredAmount("");
      setReportedAmount("");
    }
  }

  return (
    <section className="rounded-[0.75rem] border border-border/70 bg-background/80 p-5">
      <h2 className="text-base font-semibold">Maintenance of effort</h2>
      <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
        Whether each recipient kept spending its own money alongside the measure&rsquo;s. Compared only where both
        figures are recorded: {summary.comparableCount} of {summary.recordCount} records can be compared,
        {" "}{summary.notDeterminedCount} cannot.
        {summary.shortfallTotal !== null
          ? ` ${summary.shortfallCount} recipient(s) reported less than required, totalling ${money(summary.shortfallTotal)}.`
          : summary.comparableCount > 0
            ? " No comparable record is short."
            : ""}
      </p>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[46rem] text-sm">
          <thead>
            <tr className="border-b border-border/70 text-left text-[0.72rem] uppercase tracking-[0.14em] text-muted-foreground">
              <th className="py-2 pr-3">Recipient</th>
              <th className="py-2 pr-3">Fiscal year</th>
              <th className="py-2 pr-3 text-right">Required</th>
              <th className="py-2 pr-3 text-right">Reported</th>
              <th className="py-2 pr-3 text-right">Difference</th>
              <th className="py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {summary.lines.map((line) => (
              <tr key={`${line.recipientId}-${line.fiscalYearLabel}`} className="border-b border-border/40 align-top">
                <td className="py-2 pr-3">{nameById.get(line.recipientId ?? "") ?? line.recipientId}</td>
                <td className="py-2 pr-3">{line.fiscalYearLabel}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{money(line.requiredAmount)}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{money(line.reportedAmount)}</td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  {line.differenceAmount === null ? "—" : money(line.differenceAmount)}
                </td>
                <td className="py-2">
                  {line.status === "not_determined" ? (
                    <>
                      <StatusBadge tone="neutral">Not determined</StatusBadge>
                      <div className="mt-1 text-xs text-muted-foreground">{line.notDeterminedReason}</div>
                    </>
                  ) : line.status === "shortfall" ? (
                    <StatusBadge tone="danger">Short of the requirement</StatusBadge>
                  ) : (
                    <StatusBadge tone="success">Met</StatusBadge>
                  )}
                </td>
              </tr>
            ))}
            {summary.lines.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-4 text-sm text-muted-foreground">
                  No maintenance-of-effort figures recorded yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {summary.netDifferenceTotal !== null ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Across the comparable records the difference nets to {money(summary.netDifferenceTotal)}. That number is
          not a compliance figure: maintenance of effort binds each body separately, so one recipient&rsquo;s
          surplus does not cover another&rsquo;s shortfall.
        </p>
      ) : null}

      {canWrite ? (
        <div className="mt-4 grid gap-3 rounded-[0.5rem] border border-border/70 p-4 md:grid-cols-5">
          <MeasureField label="Recipient" htmlFor="moe-recipient">
            <select
              id="moe-recipient"
              className="flex h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
              value={recipientId}
              onChange={(event) => setRecipientId(event.target.value)}
            >
              <option value="">Choose…</option>
              {recipients.map((recipient) => (
                <option key={recipient.id} value={recipient.id}>
                  {recipient.name}
                </option>
              ))}
            </select>
          </MeasureField>

          <MeasureField label="Fiscal year" htmlFor="moe-year">
            <select
              id="moe-year"
              className="flex h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
              value={fiscalYearLabel}
              onChange={(event) => setFiscalYearLabel(event.target.value)}
            >
              <option value="">Choose…</option>
              {fiscalYearLabels.map((label) => (
                <option key={label} value={label}>
                  {label}
                </option>
              ))}
            </select>
          </MeasureField>

          <MeasureField label="Required" htmlFor="moe-required" hint="Leave empty until the ordinance figure is known.">
            <Input
              id="moe-required"
              type="number"
              min="0"
              step="0.01"
              value={requiredAmount}
              onChange={(event) => setRequiredAmount(event.target.value)}
            />
          </MeasureField>

          <MeasureField label="Reported" htmlFor="moe-reported" hint="Leave empty until the recipient reports.">
            <Input
              id="moe-reported"
              type="number"
              min="0"
              step="0.01"
              value={reportedAmount}
              onChange={(event) => setReportedAmount(event.target.value)}
            />
          </MeasureField>

          <MeasureField label="Where these come from" htmlFor="moe-basis">
            <Input id="moe-basis" value={basisNote} onChange={(event) => setBasisNote(event.target.value)} />
          </MeasureField>

          <div className="md:col-span-5 flex flex-wrap items-center gap-3">
            <Button
              type="button"
              onClick={record}
              disabled={state.busy || !recipientId || !fiscalYearLabel || !basisNote.trim()}
            >
              Record
            </Button>
            <MeasureSubmitFeedback state={state} />
          </div>
        </div>
      ) : null}
    </section>
  );
}

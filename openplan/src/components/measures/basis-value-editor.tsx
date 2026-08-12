"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import { MeasureField, MeasureSubmitFeedback, useMeasureSubmit } from "./measure-form-shell";

/**
 * The figures an ordinance apportions on — population, lane miles, parcels.
 *
 * ============================================================================
 * NO REFERENCE FIGURE IS SHOWN BESIDE THE INPUT. THAT IS THE FEATURE.
 * ============================================================================
 *
 * OpenPlan could look up a population for a place. It deliberately does not,
 * here (memo Q1, default built: no auto-fill, no reference figure). An
 * ordinance names its OWN source — a state finance department's January
 * estimate, a certified road-mileage report — and that figure is routinely not
 * what a general demographic API returns for the same place and year. A
 * convenience number rendered next to an empty box gets copied into it, and
 * the copy becomes a legal apportionment basis nobody checked.
 *
 * So a person states the figure and says where it came from, and the source
 * note is required rather than encouraged.
 *
 * A MISSING FIGURE IS NOT ZERO. If any ACTIVE recipient has no value for the
 * vintage in force, the whole category is reported allocated-but-undistributed
 * rather than split among the recipients that do have one — dropping a term
 * from the denominator inflates every other share, in the direction that
 * overpays. The banner below names exactly who is missing, because that is the
 * work.
 *
 * THERE IS NO EDIT. A stated figure with a named source, a stater and a date is
 * a record: correcting it means removing that row and stating the right one, or
 * recording a new vintage. An in-place edit would leave a person's name against
 * a number they never stated.
 *
 * ============================================================================
 * WHICH VINTAGE IS IN FORCE COMES FROM THE ORDINANCE OR FROM NOWHERE
 * ============================================================================
 *
 * It arrives on the basis definition, out of the recorded rule version, and it
 * is optional there. When the ordinance reading does not name one this
 * component says SO — it does not pick a vintage, and it does not badge a row
 * "In force". Until 2026-08-12 the page above passed
 * `basisValues[0]?.vintage_label`: the first row of an UNORDERED query, so
 * which edition of a population figure governed a jurisdiction's share of a
 * public fund depended on the order Postgres happened to return rows in, and
 * could change between two loads of the same page with nothing edited.
 *
 * PER BASIS, because an ordinance apportions one category on a dated population
 * estimate and another on a certified mileage report, and those are published
 * on different cycles. One vintage for the whole page could only ever have been
 * right for a measure with one basis.
 */

export type MeasureBasisValueRow = {
  id: string;
  recipientId: string;
  basisId: string;
  vintageLabel: string;
  basisValue: number;
  basisSourceNote: string;
  statedOn: string | null;
};

export function BasisValueEditor({
  measureId,
  recipients,
  basisDefinitions,
  basisValues,
  canWrite,
}: {
  measureId: string;
  recipients: Array<{ id: string; name: string; isActive: boolean }>;
  /**
   * From the ordinance rule in force. Empty when the measure declares none.
   *
   * `vintageInForce` is the ordinance's own answer and is null when the
   * recorded reading does not give one — never inferred from the stored rows.
   */
  basisDefinitions: Array<{
    id: string;
    label: string;
    statedSourceNote: string;
    vintageInForce?: string | null;
  }>;
  basisValues: MeasureBasisValueRow[];
  canWrite: boolean;
}) {
  const { state, submit } = useMeasureSubmit();
  const [recipientId, setRecipientId] = useState("");
  const [basisId, setBasisId] = useState("");
  const [vintageLabel, setVintageLabel] = useState("");
  const [basisValue, setBasisValue] = useState("");
  const [basisSourceNote, setBasisSourceNote] = useState("");

  const activeRecipients = recipients.filter((recipient) => recipient.isActive);
  const nameById = new Map(recipients.map((recipient) => [recipient.id, recipient.name]));
  const vintageInForceByBasis = new Map(
    basisDefinitions.map((definition) => [definition.id, definition.vintageInForce ?? null])
  );

  // Which active recipients have no figure for the vintage the ORDINANCE names,
  // per basis. Computed here rather than passed in so the banner cannot
  // disagree with the table beneath it.
  //
  // A basis whose vintage is not recorded produces NO gap list at all, rather
  // than a gap list computed against "". Every recipient is missing a figure for
  // a vintage nobody named, and printing that as a work-list would send someone
  // to enter figures under a label the ordinance never used.
  const gapsByBasis = basisDefinitions.map((definition) => {
    const vintage = definition.vintageInForce ?? null;
    const have = new Set(
      basisValues
        .filter((value) => value.basisId === definition.id && vintage !== null && value.vintageLabel === vintage)
        .map((value) => value.recipientId)
    );
    return {
      definition,
      vintage,
      missing: vintage === null ? [] : activeRecipients.filter((recipient) => !have.has(recipient.id)),
    };
  });

  const basesWithNoRecordedVintage = gapsByBasis.filter((gap) => gap.vintage === null);

  async function addValue() {
    const created = await submit({
      url: `/api/measures/${measureId}/basis-values`,
      method: "POST",
      successMessage: "Figure recorded.",
      body: {
        recipientId,
        basisId,
        vintageLabel,
        basisValue,
        basisSourceNote,
        statedOn: new Date().toISOString().slice(0, 10),
      },
    });
    if (created) {
      setBasisValue("");
      setBasisSourceNote("");
    }
  }

  async function removeValue(basisValueId: string) {
    await submit({
      url: `/api/measures/${measureId}/basis-values`,
      method: "DELETE",
      successMessage: "Figure removed.",
      body: { basisValueId },
    });
  }

  return (
    <section className="rounded-[0.75rem] border border-border/70 bg-background/80 p-5">
      <h2 className="text-base font-semibold">The figures the ordinance apportions on</h2>
      <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
        OpenPlan does not look these up. The ordinance names its own source, a person states the figure, and the
        source is recorded beside it.
      </p>

      <div className="mt-3 space-y-2">
        {basesWithNoRecordedVintage.length > 0 ? (
          <div className="rounded-[0.5rem] border border-border/70 bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
            Which edition governs is <span className="font-medium">not recorded</span> for{" "}
            {basesWithNoRecordedVintage.map((gap) => gap.definition.label).join(", ")}. That comes from the
            ordinance, so OpenPlan will not choose one: record it on the ordinance rule version and the figures
            below will be checked against it. Until then nothing here says which figures an allocation would use.
          </div>
        ) : null}

        {gapsByBasis
          .filter((gap) => gap.missing.length > 0)
          .map((gap) => (
            <div
              key={gap.definition.id}
              className="rounded-[0.5rem] border border-amber-300/70 bg-amber-50/70 px-3 py-2 text-sm dark:border-amber-900/60 dark:bg-amber-950/30"
            >
              <span className="font-medium">{gap.definition.label}</span> has no figure for vintage{" "}
              <span className="font-medium">{gap.vintage}</span> for{" "}
              {gap.missing.map((recipient) => recipient.name).join(", ")}. Until every active recipient has one,
              any category apportioned on this basis is held undistributed rather than split among the rest —
              a missing figure would otherwise inflate everyone else&rsquo;s share.
            </div>
          ))}
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[44rem] text-sm">
          <thead>
            <tr className="border-b border-border/70 text-left text-[0.72rem] uppercase tracking-[0.14em] text-muted-foreground">
              <th className="py-2 pr-3">Recipient</th>
              <th className="py-2 pr-3">Basis</th>
              <th className="py-2 pr-3">Vintage</th>
              <th className="py-2 pr-3 text-right">Figure</th>
              <th className="py-2 pr-3">Stated source</th>
              {canWrite ? <th className="py-2" /> : null}
            </tr>
          </thead>
          <tbody>
            {basisValues.map((value) => (
              <tr key={value.id} className="border-b border-border/40">
                <td className="py-2 pr-3">{nameById.get(value.recipientId) ?? value.recipientId}</td>
                <td className="py-2 pr-3">{value.basisId}</td>
                <td className="py-2 pr-3">
                  {value.vintageLabel}
                  {/* Badged against THIS row's own basis. A single page-wide
                      vintage would mark a road-mileage row "In force" because
                      the population basis happened to name the same label. */}
                  {vintageInForceByBasis.get(value.basisId) === value.vintageLabel ? (
                    <StatusBadge tone="success" className="ml-2">
                      In force
                    </StatusBadge>
                  ) : null}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">{value.basisValue.toLocaleString()}</td>
                <td className="py-2 pr-3 text-xs text-muted-foreground">{value.basisSourceNote}</td>
                {canWrite ? (
                  <td className="py-2 text-right">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={state.busy}
                      onClick={() => removeValue(value.id)}
                    >
                      Remove
                    </Button>
                  </td>
                ) : null}
              </tr>
            ))}
            {basisValues.length === 0 ? (
              <tr>
                <td colSpan={canWrite ? 6 : 5} className="py-4 text-sm text-muted-foreground">
                  No apportionment figures recorded yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {canWrite ? (
        <div className="mt-4 grid gap-3 rounded-[0.5rem] border border-border/70 p-4 md:grid-cols-5">
          <MeasureField label="Recipient" htmlFor="basis-recipient">
            <select
              id="basis-recipient"
              className="flex h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
              value={recipientId}
              onChange={(event) => setRecipientId(event.target.value)}
            >
              <option value="">Choose…</option>
              {activeRecipients.map((recipient) => (
                <option key={recipient.id} value={recipient.id}>
                  {recipient.name}
                </option>
              ))}
            </select>
          </MeasureField>

          <MeasureField label="Basis" htmlFor="basis-id">
            {basisDefinitions.length > 0 ? (
              <select
                id="basis-id"
                className="flex h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
                value={basisId}
                onChange={(event) => setBasisId(event.target.value)}
              >
                <option value="">Choose…</option>
                {basisDefinitions.map((definition) => (
                  <option key={definition.id} value={definition.id}>
                    {definition.label}
                  </option>
                ))}
              </select>
            ) : (
              <Input id="basis-id" value={basisId} onChange={(event) => setBasisId(event.target.value)} />
            )}
          </MeasureField>

          <MeasureField label="Vintage" htmlFor="basis-vintage-label">
            <Input
              id="basis-vintage-label"
              value={vintageLabel}
              onChange={(event) => setVintageLabel(event.target.value)}
            />
          </MeasureField>

          <MeasureField label="Figure" htmlFor="basis-figure">
            <Input
              id="basis-figure"
              type="number"
              min="0"
              step="0.0001"
              value={basisValue}
              onChange={(event) => setBasisValue(event.target.value)}
            />
          </MeasureField>

          <MeasureField label="Where it came from" htmlFor="basis-source">
            <Input
              id="basis-source"
              value={basisSourceNote}
              onChange={(event) => setBasisSourceNote(event.target.value)}
            />
          </MeasureField>

          <div className="md:col-span-5 flex flex-wrap items-center gap-3">
            <Button
              type="button"
              onClick={addValue}
              disabled={
                state.busy || !recipientId || !basisId.trim() || !vintageLabel.trim() || !basisValue || !basisSourceNote.trim()
              }
            >
              Record the figure
            </Button>
            <MeasureSubmitFeedback state={state} />
          </div>
        </div>
      ) : null}
    </section>
  );
}

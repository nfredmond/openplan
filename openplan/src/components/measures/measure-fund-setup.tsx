"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  MEASURE_RECEIPT_CADENCES,
  MEASURE_SUNSET_POSTURES,
} from "@/lib/measures/fund";
import { MeasureField, MeasureSubmitFeedback, useMeasureSubmit } from "./measure-form-shell";

/**
 * Setting up the fund behind a `local_measure` program, and recording what the
 * ordinance says the money splits into.
 *
 * TWO FORMS IN ONE COMPONENT because they are one act with a gap in the middle:
 * a fund with no allocation rule can record receipts and nothing else, so the
 * page shows the rule form the moment the fund exists rather than making a
 * planner go looking for it.
 *
 * NOTHING IS PREFILLED. No default currency (a `USD` default is a country
 * assumption), no default cadence, no example percentages. Every ordinance
 * slices differently and the split is DATA; the rule box takes the descriptor
 * JSON, and an ordinance the descriptor cannot express is recorded as narrative
 * text whose allocations are then entered by hand and labelled staff-entered.
 */

const RULE_PLACEHOLDER = `{
  "version": 1,
  "offTheTop": [],
  "reserves": [],
  "categories": [
    { "id": "", "label": "", "percentOfAllocable": 0, "distribution": { "kind": "pooled" } }
  ],
  "basisDefinitions": []
}`;

export function MeasureFundSetup({ programId, measureId }: { programId: string; measureId: string | null }) {
  const { state, submit } = useMeasureSubmit();

  const [receiptCadence, setReceiptCadence] = useState("");
  const [currencyCode, setCurrencyCode] = useState("");
  const [ordinanceReference, setOrdinanceReference] = useState("");
  const [rateLabel, setRateLabel] = useState("");
  const [adoptedOn, setAdoptedOn] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [sunsetPosture, setSunsetPosture] = useState("not_recorded");
  const [sunsetOn, setSunsetOn] = useState("");
  const [fiscalYearNote, setFiscalYearNote] = useState("");

  const [ruleMode, setRuleMode] = useState<"descriptor" | "narrative">("descriptor");
  const [ruleText, setRuleText] = useState("");
  const [narrativeText, setNarrativeText] = useState("");
  const [effectiveFromRule, setEffectiveFromRule] = useState("");
  const [adoptedNote, setAdoptedNote] = useState("");
  const [ruleError, setRuleError] = useState<string | null>(null);

  async function createFund() {
    await submit({
      url: "/api/measures",
      method: "POST",
      successMessage: "Measure fund set up. Record the ordinance's split next.",
      body: {
        programId,
        receiptCadence,
        currencyCode,
        ordinanceReference: ordinanceReference || undefined,
        rateLabel: rateLabel || undefined,
        adoptedOn: adoptedOn || undefined,
        effectiveFrom: effectiveFrom || undefined,
        sunsetPosture,
        sunsetOn: sunsetPosture === "dated" && sunsetOn ? sunsetOn : undefined,
        fiscalYearNote: fiscalYearNote || undefined,
      },
    });
  }

  async function recordRule() {
    if (!measureId) return;
    setRuleError(null);

    let rule: unknown;
    if (ruleMode === "narrative") {
      rule = { version: 1, kind: "narrative", text: narrativeText };
    } else {
      try {
        rule = JSON.parse(ruleText);
      } catch {
        // Caught here rather than sent to the server, because a JSON syntax
        // error is about the text box and the server's answer would be about
        // the ordinance.
        setRuleError("That is not valid JSON. Check for a missing comma or bracket.");
        return;
      }
    }

    const saved = await submit({
      url: `/api/measures/${measureId}/allocation-rules`,
      method: "POST",
      successMessage: "Ordinance rule recorded.",
      body: {
        rule,
        effectiveFrom: effectiveFromRule,
        adoptedNote,
        statedOn: new Date().toISOString().slice(0, 10),
      },
    });
    if (saved) {
      setRuleText("");
      setNarrativeText("");
    }
  }

  if (!measureId) {
    return (
      <section className="rounded-[0.75rem] border border-border/70 bg-background/80 p-5">
        <h2 className="text-base font-semibold">Set up this measure fund</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Record the ordinance behind this program so the fund can track what it receives, how the ordinance
          splits it, and what cities and districts claim against it.
        </p>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <MeasureField
            label="Accounting period"
            htmlFor="measure-cadence"
            hint="How often the fund closes a period — not how often deposits arrive."
          >
            <select
              id="measure-cadence"
              className="flex h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
              value={receiptCadence}
              onChange={(event) => setReceiptCadence(event.target.value)}
            >
              <option value="">Choose…</option>
              {MEASURE_RECEIPT_CADENCES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </MeasureField>

          <MeasureField
            label="Currency"
            htmlFor="measure-currency"
            hint="Three-letter code, e.g. USD, CAD, EUR. There is no default on purpose."
          >
            <Input
              id="measure-currency"
              maxLength={3}
              value={currencyCode}
              onChange={(event) => setCurrencyCode(event.target.value.toUpperCase())}
            />
          </MeasureField>

          <MeasureField label="Ordinance reference" htmlFor="measure-ordinance">
            <Input
              id="measure-ordinance"
              value={ordinanceReference}
              onChange={(event) => setOrdinanceReference(event.target.value)}
              placeholder="How the ordinance is cited locally"
            />
          </MeasureField>

          <MeasureField
            label="Rate, as people say it"
            htmlFor="measure-rate"
            hint="A label only. OpenPlan never multiplies by a tax rate — receipts are recorded, not computed."
          >
            <Input id="measure-rate" value={rateLabel} onChange={(event) => setRateLabel(event.target.value)} />
          </MeasureField>

          <MeasureField label="Adopted on" htmlFor="measure-adopted">
            <Input
              id="measure-adopted"
              type="date"
              value={adoptedOn}
              onChange={(event) => setAdoptedOn(event.target.value)}
            />
          </MeasureField>

          <MeasureField label="Collection starts" htmlFor="measure-effective">
            <Input
              id="measure-effective"
              type="date"
              value={effectiveFrom}
              onChange={(event) => setEffectiveFrom(event.target.value)}
            />
          </MeasureField>

          <MeasureField
            label="Sunset"
            htmlFor="measure-sunset-posture"
            hint="An empty date cannot mean 'never expires', so say which it is."
          >
            <select
              id="measure-sunset-posture"
              className="flex h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
              value={sunsetPosture}
              onChange={(event) => setSunsetPosture(event.target.value)}
            >
              {MEASURE_SUNSET_POSTURES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </MeasureField>

          {sunsetPosture === "dated" ? (
            <MeasureField label="Sunset date" htmlFor="measure-sunset-on">
              <Input
                id="measure-sunset-on"
                type="date"
                value={sunsetOn}
                onChange={(event) => setSunsetOn(event.target.value)}
              />
            </MeasureField>
          ) : null}

          <div className="md:col-span-2">
            <MeasureField
              label="How this agency names its fiscal year"
              htmlFor="measure-fy-note"
              hint="In your own words. OpenPlan never derives a fiscal year from a date — boundaries differ by jurisdiction."
            >
              <Input
                id="measure-fy-note"
                value={fiscalYearNote}
                onChange={(event) => setFiscalYearNote(event.target.value)}
              />
            </MeasureField>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button type="button" onClick={createFund} disabled={state.busy || !receiptCadence || currencyCode.length !== 3}>
            {state.busy ? "Setting up…" : "Set up the fund"}
          </Button>
          <MeasureSubmitFeedback state={state} />
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-[0.75rem] border border-border/70 bg-background/80 p-5">
      <h2 className="text-base font-semibold">Record what the ordinance says</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Each reading of the ordinance is dated and kept. Amending the ordinance records a new version — the old
        one stays, because the money already split under it points at it.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant={ruleMode === "descriptor" ? "default" : "outline"}
          onClick={() => setRuleMode("descriptor")}
        >
          The ordinance fits a rule
        </Button>
        <Button
          type="button"
          size="sm"
          variant={ruleMode === "narrative" ? "default" : "outline"}
          onClick={() => setRuleMode("narrative")}
        >
          It does not — record it as text
        </Button>
      </div>

      <div className="mt-3 grid gap-3">
        {ruleMode === "descriptor" ? (
          <MeasureField
            label="Allocation rule"
            htmlFor="measure-rule"
            hint="Category shares must add to exactly 100. Nothing is filled in for you: every ordinance slices differently."
          >
            <Textarea
              id="measure-rule"
              rows={12}
              className="font-mono text-xs"
              value={ruleText}
              placeholder={RULE_PLACEHOLDER}
              onChange={(event) => setRuleText(event.target.value)}
            />
          </MeasureField>
        ) : (
          <MeasureField
            label="What the ordinance says, in its own words"
            htmlFor="measure-narrative"
            hint="Allocations for this measure are then entered by hand and labelled staff-entered everywhere they appear."
          >
            <Textarea
              id="measure-narrative"
              rows={8}
              value={narrativeText}
              onChange={(event) => setNarrativeText(event.target.value)}
            />
          </MeasureField>
        )}

        <div className="grid gap-3 md:grid-cols-2">
          <MeasureField label="This version takes effect" htmlFor="measure-rule-effective">
            <Input
              id="measure-rule-effective"
              type="date"
              value={effectiveFromRule}
              onChange={(event) => setEffectiveFromRule(event.target.value)}
            />
          </MeasureField>
          <MeasureField
            label="Where this reading comes from"
            htmlFor="measure-rule-note"
            hint="The section, the amendment, the board action — whatever a reviewer would need to check it."
          >
            <Input
              id="measure-rule-note"
              value={adoptedNote}
              onChange={(event) => setAdoptedNote(event.target.value)}
            />
          </MeasureField>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button
          type="button"
          onClick={recordRule}
          disabled={state.busy || !effectiveFromRule || !adoptedNote.trim()}
        >
          {state.busy ? "Recording…" : "Record this version"}
        </Button>
        {ruleError ? <p className="text-sm text-destructive">{ruleError}</p> : <MeasureSubmitFeedback state={state} />}
      </div>
    </section>
  );
}

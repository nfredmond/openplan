"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  MEASURE_RECEIPT_CADENCES,
  MEASURE_SUNSET_POSTURES,
} from "@/lib/measures/fund";
import { MeasureField, MeasureSubmitFeedback, useMeasureSubmit } from "./measure-form-shell";
import { isNarrativeRule, parseMeasureAllocationRule } from "@/lib/measures/allocation";
import { AllocationRuleBuilder, draftCategorySummary } from "./allocation-rule-builder";
import {
  composeMeasureRuleDraft,
  describeFiledReference,
  emptyRuleDraft,
  orphanedFiledReferences,
  ruleDraftFromRule,
  type MeasureFiledCategoryReference,
  type MeasureRuleDraft,
} from "./allocation-rule-draft";

/**
 * Setting up the fund behind a `local_measure` program, and recording what the
 * ordinance says the money splits into.
 *
 * TWO FORMS IN ONE COMPONENT because they are one act with a gap in the middle:
 * a fund with no allocation rule can record receipts and nothing else, so the
 * page shows the rule form the moment the fund exists rather than making a
 * planner go looking for it.
 *
 * NOTHING IS INVENTED FOR A PLANNER. No default currency (a `USD` default is a
 * country assumption), no default cadence, no example percentages. Every
 * ordinance slices differently and the split is DATA.
 *
 * The one thing that IS filled in is the agency's own last reading of its own
 * ordinance, when the fund has one: the rule form is where an amendment is
 * written, and it opened blank under a heading that said so until 2026-08-12.
 * That is not a default — it is the record, handed back for editing.
 *
 * ============================================================================
 * THREE WAYS TO RECORD THE SPLIT, AND WHY ALL THREE STAY
 * ============================================================================
 *
 * 1. THE BUILDER, which is what a planner uses. Before it existed the only way
 *    in was hand-written rule text, and the two clauses real measures use most —
 *    a weighted "half by population, half by road miles" split and a minimum per
 *    jurisdiction — were expressible by the allocator and reachable by nobody.
 * 2. THE RULE TEXT, unchanged. The builder covers the ordinary ordinance; an
 *    unusual one that the descriptor can still express must not be blocked
 *    because a form has no box for it.
 * 3. THE ORDINANCE'S OWN WORDS, for a split the descriptor cannot express at
 *    all. Its allocations are entered by hand and labelled staff-entered
 *    wherever they appear.
 *
 * Losing either escape hatch would narrow the product to the ordinances someone
 * thought of.
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

/**
 * The latest recorded reading of the ordinance, read back into the form's boxes.
 *
 * A rule this build cannot parse is NOT silently discarded into a blank form —
 * the caller is told, in `startingPointNote`, and the planner reads it before
 * typing a split that would replace one nobody could see.
 */
function startingPoint(ruleInForce: unknown): {
  draft: MeasureRuleDraft;
  mode: "builder" | "narrative";
  narrativeText: string;
  startingPointNote: string | null;
} {
  const blank = { draft: emptyRuleDraft(), mode: "builder" as const, narrativeText: "", startingPointNote: null };
  if (ruleInForce === null || ruleInForce === undefined) return blank;

  let parsed;
  try {
    parsed = parseMeasureAllocationRule(ruleInForce);
  } catch (error) {
    return {
      ...blank,
      startingPointNote:
        "The version currently in force could not be read back into this form, so it starts empty. Check it " +
        `before recording a replacement: ${error instanceof Error ? error.message : "the recorded rule could not be read."}`,
    };
  }

  if (isNarrativeRule(parsed)) {
    return {
      draft: emptyRuleDraft(),
      mode: "narrative",
      narrativeText: parsed.text,
      startingPointNote: "This starts from the version currently in force. Edit it, and recording keeps both.",
    };
  }

  const draft = ruleDraftFromRule(parsed);
  if (!draft) return blank;
  return {
    draft,
    mode: "builder",
    narrativeText: "",
    startingPointNote: "This starts from the version currently in force. Edit it, and recording keeps both.",
  };
}

/** Hoisted so the default does not hand `useMemo` a new array on every render. */
const NOTHING_FILED: readonly MeasureFiledCategoryReference[] = [];

export function MeasureFundSetup({
  programId,
  measureId,
  ruleInForce = null,
  filedCategoryReferences = NOTHING_FILED,
}: {
  programId: string;
  measureId: string | null;
  /**
   * The rule row currently in force, exactly as it is stored. Absent on a fund
   * that has never recorded one; present on every amendment, which is what the
   * heading below has always claimed this form is for.
   */
  ruleInForce?: unknown;
  /**
   * Every category reference `measure_allocations` or `measure_claims` already
   * points at, with how many of each. Computed where the rows are — a browser
   * cannot count rows it was never sent, and guessing would be worse than not
   * warning at all.
   */
  filedCategoryReferences?: readonly MeasureFiledCategoryReference[];
}) {
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

  /*
   * THE FORM OPENS ON THE ORDINANCE THAT IS IN FORCE, not on a blank page.
   * Computed once, on mount: an amendment is an edit, and a planner retyping a
   * split from memory is how `local_streets_and_roads` becomes
   * `local_streets_&_roads` and orphans everything filed under it.
   */
  const [opening] = useState(() => startingPoint(ruleInForce));

  const [ruleMode, setRuleMode] = useState<"builder" | "descriptor" | "narrative">(opening.mode);
  const [ruleDraft, setRuleDraft] = useState<MeasureRuleDraft>(opening.draft);
  const [ruleText, setRuleText] = useState("");
  const [narrativeText, setNarrativeText] = useState(opening.narrativeText);
  const [effectiveFromRule, setEffectiveFromRule] = useState("");
  const [adoptedNote, setAdoptedNote] = useState("");
  const [ruleError, setRuleError] = useState<string | null>(null);
  const [retirementAcknowledged, setRetirementAcknowledged] = useState(false);

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

  /*
   * THE DRAFT, JUDGED BY THE PARSER ON EVERY KEYSTROKE.
   *
   * `composeMeasureRuleDraft` hands the composed rule to
   * `parseMeasureAllocationRule`, so what the form shows and what the route will
   * accept are the same judgement, made once. The save button is offered only
   * when a rule came back.
   */
  const builderResult = useMemo(() => composeMeasureRuleDraft(ruleDraft), [ruleDraft]);

  /*
   * WHAT THIS AMENDMENT WOULD ORPHAN. Only the builder can do this: the
   * written-out rule and the narrative words are the escape hatches, and this
   * form does not read a hand-typed descriptor's categories back out to second-
   * guess them. Retiring a category is a real amendment, so the planner is told
   * what is filed against it and has to say they mean it.
   */
  const retiredReferences = useMemo(
    () => (ruleMode === "builder" ? orphanedFiledReferences(ruleDraft, filedCategoryReferences) : []),
    [ruleMode, ruleDraft, filedCategoryReferences]
  );
  const retirementBlocks = retiredReferences.length > 0 && !retirementAcknowledged;

  async function recordRule() {
    if (!measureId) return;
    if (retirementBlocks) return;
    setRuleError(null);

    let rule: unknown;
    if (ruleMode === "narrative") {
      rule = { version: 1, kind: "narrative", text: narrativeText };
    } else if (ruleMode === "builder") {
      if (!builderResult.rule) return;
      rule = builderResult.rule;
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
      // The draft is NOT cleared. What was just recorded is now the version in
      // force, and emptying the form would put a planner back in front of the
      // blank page this whole seam exists to remove.
      setRetirementAcknowledged(false);
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
      {opening.startingPointNote ? (
        <p className="mt-2 text-sm text-muted-foreground">{opening.startingPointNote}</p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant={ruleMode === "builder" ? "default" : "outline"}
          onClick={() => setRuleMode("builder")}
        >
          Set out the split
        </Button>
        <Button
          type="button"
          size="sm"
          variant={ruleMode === "descriptor" ? "default" : "outline"}
          onClick={() => setRuleMode("descriptor")}
        >
          Write the rule out in full
        </Button>
        <Button
          type="button"
          size="sm"
          variant={ruleMode === "narrative" ? "default" : "outline"}
          onClick={() => setRuleMode("narrative")}
        >
          It does not fit a rule — record it as text
        </Button>
      </div>

      <div className="mt-3 grid gap-3">
        {ruleMode === "builder" ? (
          <AllocationRuleBuilder
            draft={ruleDraft}
            problems={builderResult.problems}
            onChange={setRuleDraft}
          />
        ) : ruleMode === "descriptor" ? (
          <MeasureField
            label="The rule, written out in full"
            htmlFor="measure-rule"
            hint="For an ordinance the form above cannot set out. Category shares must add to exactly 100."
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

      {retiredReferences.length > 0 ? (
        <div
          role="group"
          aria-label="Categories this amendment retires"
          className="mt-3 rounded-[0.5rem] border border-destructive/60 bg-destructive/5 p-3"
        >
          <h3 className="text-sm font-semibold">
            {retiredReferences.length === 1
              ? "This amendment drops a category that has money filed against it"
              : "This amendment drops categories that have money filed against them"}
          </h3>
          <ul className="mt-1 space-y-0.5 text-xs">
            {retiredReferences.map((row) => (
              <li key={row.reference}>{describeFiledReference(row)}</li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">
            Those records stay exactly as they are, filed against the version that created them. What changes is
            that nothing new can be allocated or claimed under the reference. If this is a rename rather than a
            retirement, put the old short reference back on the category instead — a reference is how a claim
            finds its clause, and a renamed one starts a different history.
          </p>
          <label className="mt-2 flex items-start gap-2 text-xs">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={retirementAcknowledged}
              onChange={(event) => setRetirementAcknowledged(event.target.checked)}
            />
            <span>The ordinance retires {retiredReferences.length === 1 ? "this category" : "these categories"}. Record it.</span>
          </label>
        </div>
      ) : null}

      {ruleMode === "builder" && builderResult.rule ? (
        <p className="mt-3 text-xs text-muted-foreground">
          Ready to record: {draftCategorySummary(ruleDraft)}.
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button
          type="button"
          onClick={recordRule}
          disabled={
            state.busy ||
            !effectiveFromRule ||
            !adoptedNote.trim() ||
            // The builder offers the button only for a split the parser has
            // already accepted, so nobody presses Record and is answered by the
            // server with a sentence about a form they can no longer see.
            (ruleMode === "builder" && !builderResult.rule) ||
            // A category with allocations or claims filed against it may be
            // retired, but not by accident.
            retirementBlocks
          }
        >
          {state.busy ? "Recording…" : "Record this version"}
        </Button>
        {ruleError ? <p className="text-sm text-destructive">{ruleError}</p> : <MeasureSubmitFeedback state={state} />}
      </div>
    </section>
  );
}

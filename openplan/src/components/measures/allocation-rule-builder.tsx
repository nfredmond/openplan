"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { MEASURE_CAP_BASES, type MeasureCapBasis } from "@/lib/measures/allocation";
import { MeasureField } from "./measure-form-shell";
import {
  draftPercentTotal,
  effectiveReference,
  emptyBasisDraft,
  emptyCategoryDraft,
  emptyFactorDraft,
  emptyOffTheTopDraft,
  emptyReserveDraft,
  normaliseReference,
  referenceFromLabel,
  type MeasureBasisDraft,
  type MeasureCategoryDraft,
  type MeasureFactorDraft,
  type MeasureOffTheTopDraft,
  type MeasureReserveDraft,
  type MeasureRuleDraft,
  type MeasureRuleProblem,
} from "./allocation-rule-draft";

/**
 * THE ORDINANCE'S SPLIT, ENTERED AS AN ORDINANCE RATHER THAN AS A DOCUMENT
 * FORMAT.
 *
 * Until this existed the only way to record a split was to hand-write the whole
 * rule into a text box, which meant the two clauses real measures use most —
 * "50% by population and 50% by maintained road miles", and "no jurisdiction
 * shall receive less than $100,000" — were expressible by the allocator and
 * unreachable by any planner. A complete, tested capability nobody can reach is
 * this repository's most expensive recurring defect and this is one of them.
 *
 * WHAT THIS COMPONENT IS NOT ALLOWED TO BE: a second statement of what a valid
 * rule is. It draws boxes and orders rows; `composeMeasureRuleDraft` hands the
 * result to `parseMeasureAllocationRule` and the parser's answer is what is
 * shown and what governs the save. The running totals come from
 * `measurePercentTotal`, the parser's own integer summation, so a meter reading
 * exactly 100 and a save refusing 99.9999 cannot both happen.
 *
 * THE ESCAPE HATCH STAYS. Every ordinance this builder cannot express is still
 * enterable — as the rule text itself, or as narrative words whose allocations
 * are hand-entered and labelled staff-entered. Narrowing that would remove
 * agencies from the product.
 */

function ProblemList({ problems, field }: { problems: MeasureRuleProblem[]; field: string }) {
  const mine = problems.filter((problem) => problem.field === field);
  if (mine.length === 0) return null;
  return (
    <ul className="mt-1 space-y-0.5 text-xs text-destructive">
      {mine.map((problem) => (
        <li key={problem.message}>{problem.message}</li>
      ))}
    </ul>
  );
}

/** A running total that reads the way the save will read it. */
function PercentMeter({ values, subject }: { values: readonly string[]; subject: string }) {
  const { total, isExactly100 } = draftPercentTotal(values);
  return (
    <p className={`text-xs ${isExactly100 ? "text-muted-foreground" : "text-destructive"}`}>
      {subject} add up to {total}%.{" "}
      {isExactly100 ? "That is the whole of it." : "They have to add up to exactly 100 before this can be saved."}
    </p>
  );
}

function RowControls({
  onMoveUp,
  onMoveDown,
  onRemove,
  removeLabel,
  canRemove,
}: {
  onMoveUp: (() => void) | null;
  onMoveDown: (() => void) | null;
  onRemove: () => void;
  removeLabel: string;
  canRemove: boolean;
}) {
  return (
    <div className="flex items-center gap-1">
      <Button type="button" size="sm" variant="ghost" disabled={!onMoveUp} onClick={() => onMoveUp?.()}>
        Move up
      </Button>
      <Button type="button" size="sm" variant="ghost" disabled={!onMoveDown} onClick={() => onMoveDown?.()}>
        Move down
      </Button>
      <Button type="button" size="sm" variant="ghost" disabled={!canRemove} onClick={onRemove}>
        {removeLabel}
      </Button>
    </div>
  );
}

function moved<T>(rows: readonly T[], index: number, delta: number): T[] {
  const next = [...rows];
  const target = index + delta;
  if (target < 0 || target >= next.length) return next;
  const [row] = next.splice(index, 1);
  next.splice(target, 0, row);
  return next;
}

export function AllocationRuleBuilder({
  draft,
  problems,
  onChange,
}: {
  draft: MeasureRuleDraft;
  problems: MeasureRuleProblem[];
  onChange: (next: MeasureRuleDraft) => void;
}) {
  const patch = (next: Partial<MeasureRuleDraft>) => onChange({ ...draft, ...next });

  const patchCategory = (key: string, next: Partial<MeasureCategoryDraft>) =>
    patch({
      categories: draft.categories.map((category) => (category.key === key ? { ...category, ...next } : category)),
    });
  const patchBasis = (key: string, next: Partial<MeasureBasisDraft>) =>
    patch({ basisDefinitions: draft.basisDefinitions.map((row) => (row.key === key ? { ...row, ...next } : row)) });
  const patchOffTheTop = (key: string, next: Partial<MeasureOffTheTopDraft>) =>
    patch({ offTheTop: draft.offTheTop.map((row) => (row.key === key ? { ...row, ...next } : row)) });
  const patchReserve = (key: string, next: Partial<MeasureReserveDraft>) =>
    patch({ reserves: draft.reserves.map((row) => (row.key === key ? { ...row, ...next } : row)) });
  const patchFactor = (categoryKey: string, factorKey: string, next: Partial<MeasureFactorDraft>) =>
    patchCategory(categoryKey, {
      factors: (draft.categories.find((category) => category.key === categoryKey)?.factors ?? []).map((factor) =>
        factor.key === factorKey ? { ...factor, ...next } : factor
      ),
    });

  const namedFigures = draft.basisDefinitions.map((basis, index) => ({
    key: basis.key,
    name: basis.label.trim() || `Figure ${index + 1}`,
  }));

  return (
    <div className="space-y-5">
      {/* ---------------------------------------------------------------- *
       * The figures the ordinance divides by
       * ---------------------------------------------------------------- */}
      <div className="rounded-[0.5rem] border border-border/70 p-4">
        <h3 className="text-sm font-semibold">Figures this ordinance divides by</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Only needed where the money goes back to the cities and districts — population, maintained road miles,
          assessed value, whatever the ordinance names. OpenPlan never looks one of these up: the ordinance names
          the source and a person records the number.
        </p>

        <div className="mt-3 space-y-3">
          {draft.basisDefinitions.map((basis, index) => (
            <div
              key={basis.key}
              role="group"
              aria-label={`Figure ${index + 1}`}
              className="rounded-[0.5rem] border border-border/50 p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Figure {index + 1}
                </span>
                <RowControls
                  onMoveUp={index > 0 ? () => patch({ basisDefinitions: moved(draft.basisDefinitions, index, -1) }) : null}
                  onMoveDown={
                    index < draft.basisDefinitions.length - 1
                      ? () => patch({ basisDefinitions: moved(draft.basisDefinitions, index, 1) })
                      : null
                  }
                  onRemove={() =>
                    patch({
                      basisDefinitions: draft.basisDefinitions.filter((row) => row.key !== basis.key),
                      categories: draft.categories.map((category) => ({
                        ...category,
                        factors: category.factors.map((factor) =>
                          factor.basisKey === basis.key ? { ...factor, basisKey: "" } : factor
                        ),
                      })),
                    })
                  }
                  removeLabel="Remove figure"
                  canRemove
                />
              </div>

              <div className="mt-2 grid gap-3 md:grid-cols-2">
                <MeasureField label="What it is called" htmlFor={`figure-label-${basis.key}`}>
                  <Input
                    id={`figure-label-${basis.key}`}
                    value={basis.label}
                    onChange={(event) => patchBasis(basis.key, { label: event.target.value })}
                  />
                </MeasureField>
                <MeasureField
                  label="Short reference"
                  htmlFor={`figure-reference-${basis.key}`}
                  hint="Kept on every record. Leave it blank and one is made from the name; keep it the same when the ordinance is amended."
                >
                  <Input
                    id={`figure-reference-${basis.key}`}
                    value={basis.reference}
                    placeholder={referenceFromLabel(basis.label)}
                    onChange={(event) => patchBasis(basis.key, { reference: normaliseReference(event.target.value) })}
                  />
                </MeasureField>
                <div className="md:col-span-2">
                  <MeasureField
                    label="Where the number comes from"
                    htmlFor={`figure-source-${basis.key}`}
                    hint="The ordinance's own words — which published figure, from whom."
                  >
                    <Input
                      id={`figure-source-${basis.key}`}
                      value={basis.sourceNote}
                      onChange={(event) => patchBasis(basis.key, { sourceNote: event.target.value })}
                    />
                  </MeasureField>
                </div>
                <MeasureField
                  label="Which edition governs (optional)"
                  htmlFor={`figure-vintage-${basis.key}`}
                  hint="If the ordinance does not say, leave this empty — the fund will say it is not recorded rather than pick one."
                >
                  <Input
                    id={`figure-vintage-${basis.key}`}
                    value={basis.vintageInForce}
                    onChange={(event) => patchBasis(basis.key, { vintageInForce: event.target.value })}
                  />
                </MeasureField>
                <MeasureField
                  label="What to do when a period straddles a change (optional)"
                  htmlFor={`figure-vintage-note-${basis.key}`}
                >
                  <Input
                    id={`figure-vintage-note-${basis.key}`}
                    value={basis.vintageRuleNote}
                    onChange={(event) => patchBasis(basis.key, { vintageRuleNote: event.target.value })}
                  />
                </MeasureField>
              </div>

              <ProblemList problems={problems} field={`basis:${basis.key}`} />
            </div>
          ))}
        </div>

        <Button
          type="button"
          size="sm"
          variant="outline"
          className="mt-3"
          onClick={() => patch({ basisDefinitions: [...draft.basisDefinitions, emptyBasisDraft()] })}
        >
          Add a figure
        </Button>
      </div>

      {/* ---------------------------------------------------------------- *
       * Off the top
       * ---------------------------------------------------------------- */}
      <div className="rounded-[0.5rem] border border-border/70 p-4">
        <h3 className="text-sm font-semibold">Taken off the top, before anything is split</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Administration, the collecting authority&rsquo;s fee, debt service — whatever the ordinance takes out of
          the receipt first, in the order it takes them.
        </p>

        <div className="mt-3 space-y-3">
          {draft.offTheTop.map((item, index) => (
            <div
              key={item.key}
              role="group"
              aria-label={`Deduction ${index + 1}`}
              className="rounded-[0.5rem] border border-border/50 p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Deduction {index + 1}
                </span>
                <RowControls
                  onMoveUp={index > 0 ? () => patch({ offTheTop: moved(draft.offTheTop, index, -1) }) : null}
                  onMoveDown={
                    index < draft.offTheTop.length - 1 ? () => patch({ offTheTop: moved(draft.offTheTop, index, 1) }) : null
                  }
                  onRemove={() => patch({ offTheTop: draft.offTheTop.filter((row) => row.key !== item.key) })}
                  removeLabel="Remove deduction"
                  canRemove
                />
              </div>

              <div className="mt-2 grid gap-3 md:grid-cols-2">
                <MeasureField label="What it is for" htmlFor={`deduction-label-${item.key}`}>
                  <Input
                    id={`deduction-label-${item.key}`}
                    value={item.label}
                    onChange={(event) => patchOffTheTop(item.key, { label: event.target.value })}
                  />
                </MeasureField>
                <MeasureField label="Short reference" htmlFor={`deduction-reference-${item.key}`}>
                  <Input
                    id={`deduction-reference-${item.key}`}
                    value={item.reference}
                    placeholder={referenceFromLabel(item.label)}
                    onChange={(event) => patchOffTheTop(item.key, { reference: normaliseReference(event.target.value) })}
                  />
                </MeasureField>
                <MeasureField label="How it is worked out" htmlFor={`deduction-mode-${item.key}`}>
                  <select
                    id={`deduction-mode-${item.key}`}
                    className="flex h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
                    value={item.mode}
                    onChange={(event) =>
                      patchOffTheTop(item.key, { mode: event.target.value === "amount" ? "amount" : "percent" })
                    }
                  >
                    <option value="percent">A percentage of what came in</option>
                    <option value="amount">A flat amount</option>
                  </select>
                </MeasureField>
                {item.mode === "percent" ? (
                  <MeasureField label="Percentage of the receipt" htmlFor={`deduction-percent-${item.key}`}>
                    <Input
                      id={`deduction-percent-${item.key}`}
                      inputMode="decimal"
                      value={item.percent}
                      onChange={(event) => patchOffTheTop(item.key, { percent: event.target.value })}
                    />
                  </MeasureField>
                ) : (
                  <MeasureField label="Amount each period" htmlFor={`deduction-amount-${item.key}`}>
                    <Input
                      id={`deduction-amount-${item.key}`}
                      inputMode="decimal"
                      value={item.amount}
                      onChange={(event) => patchOffTheTop(item.key, { amount: event.target.value })}
                    />
                  </MeasureField>
                )}

                <div className="md:col-span-2">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={item.capEnabled}
                      onChange={(event) => patchOffTheTop(item.key, { capEnabled: event.target.checked })}
                    />
                    The ordinance caps this deduction
                  </label>
                </div>

                {item.capEnabled ? (
                  <>
                    <MeasureField label="The most it may take" htmlFor={`deduction-cap-${item.key}`}>
                      <Input
                        id={`deduction-cap-${item.key}`}
                        inputMode="decimal"
                        value={item.capAmount}
                        onChange={(event) => patchOffTheTop(item.key, { capAmount: event.target.value })}
                      />
                    </MeasureField>
                    <MeasureField
                      label="Over what stretch"
                      htmlFor={`deduction-cap-basis-${item.key}`}
                      hint="A cap with no window is a cap nobody can check."
                    >
                      <select
                        id={`deduction-cap-basis-${item.key}`}
                        className="flex h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
                        value={item.capBasis}
                        onChange={(event) =>
                          patchOffTheTop(item.key, { capBasis: event.target.value as MeasureCapBasis })
                        }
                      >
                        {MEASURE_CAP_BASES.map((option) => (
                          <option key={option} value={option}>
                            {option === "per_period" ? "Each accounting period" : "Each fiscal year"}
                          </option>
                        ))}
                      </select>
                    </MeasureField>
                  </>
                ) : null}
              </div>

              <ProblemList problems={problems} field={`offthetop:${item.key}`} />
            </div>
          ))}
        </div>

        <Button
          type="button"
          size="sm"
          variant="outline"
          className="mt-3"
          onClick={() => patch({ offTheTop: [...draft.offTheTop, emptyOffTheTopDraft()] })}
        >
          Add a deduction
        </Button>
      </div>

      {/* ---------------------------------------------------------------- *
       * Reserves
       * ---------------------------------------------------------------- */}
      <div className="rounded-[0.5rem] border border-border/70 p-4">
        <h3 className="text-sm font-semibold">Held back in reserve</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          A reserve taken from the whole receipt, or from what is left after the deductions, is held before the
          split. A reserve on one category comes out of that category alone.
        </p>

        <div className="mt-3 space-y-3">
          {draft.reserves.map((item, index) => (
            <div
              key={item.key}
              role="group"
              aria-label={`Reserve ${index + 1}`}
              className="rounded-[0.5rem] border border-border/50 p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Reserve {index + 1}
                </span>
                <RowControls
                  onMoveUp={index > 0 ? () => patch({ reserves: moved(draft.reserves, index, -1) }) : null}
                  onMoveDown={
                    index < draft.reserves.length - 1 ? () => patch({ reserves: moved(draft.reserves, index, 1) }) : null
                  }
                  onRemove={() => patch({ reserves: draft.reserves.filter((row) => row.key !== item.key) })}
                  removeLabel="Remove reserve"
                  canRemove
                />
              </div>

              <div className="mt-2 grid gap-3 md:grid-cols-2">
                <MeasureField label="What it is for" htmlFor={`reserve-label-${item.key}`}>
                  <Input
                    id={`reserve-label-${item.key}`}
                    value={item.label}
                    onChange={(event) => patchReserve(item.key, { label: event.target.value })}
                  />
                </MeasureField>
                <MeasureField label="Short reference" htmlFor={`reserve-reference-${item.key}`}>
                  <Input
                    id={`reserve-reference-${item.key}`}
                    value={item.reference}
                    placeholder={referenceFromLabel(item.label)}
                    onChange={(event) => patchReserve(item.key, { reference: normaliseReference(event.target.value) })}
                  />
                </MeasureField>
                <MeasureField label="Percentage held" htmlFor={`reserve-percent-${item.key}`}>
                  <Input
                    id={`reserve-percent-${item.key}`}
                    inputMode="decimal"
                    value={item.percent}
                    onChange={(event) => patchReserve(item.key, { percent: event.target.value })}
                  />
                </MeasureField>
                <MeasureField label="Taken from" htmlFor={`reserve-target-${item.key}`}>
                  <select
                    id={`reserve-target-${item.key}`}
                    className="flex h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
                    value={item.target}
                    onChange={(event) => patchReserve(item.key, { target: event.target.value })}
                  >
                    <option value="gross">Everything that came in</option>
                    <option value="after_off_the_top">What is left after the deductions</option>
                    {draft.categories.map((category, categoryIndex) => (
                      <option key={category.key} value={category.key}>
                        {category.label.trim() || `Category ${categoryIndex + 1}`} only
                      </option>
                    ))}
                  </select>
                </MeasureField>
              </div>

              <ProblemList problems={problems} field={`reserve:${item.key}`} />
            </div>
          ))}
        </div>

        <Button
          type="button"
          size="sm"
          variant="outline"
          className="mt-3"
          onClick={() => patch({ reserves: [...draft.reserves, emptyReserveDraft()] })}
        >
          Add a reserve
        </Button>
      </div>

      {/* ---------------------------------------------------------------- *
       * The split itself
       * ---------------------------------------------------------------- */}
      <div className="rounded-[0.5rem] border border-border/70 p-4">
        <h3 className="text-sm font-semibold">What the rest is split into</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          The shares are of what is left after the deductions and the reserves above, and they have to add up to
          exactly 100.
        </p>

        <div className="mt-3 space-y-3">
          {draft.categories.map((category, index) => {
            const field = `category:${category.key}`;
            return (
              <div
                key={category.key}
                role="group"
                aria-label={`Category ${index + 1}`}
                className="rounded-[0.5rem] border border-border/50 p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    Category {index + 1}
                  </span>
                  <RowControls
                    onMoveUp={index > 0 ? () => patch({ categories: moved(draft.categories, index, -1) }) : null}
                    onMoveDown={
                      index < draft.categories.length - 1
                        ? () => patch({ categories: moved(draft.categories, index, 1) })
                        : null
                    }
                    onRemove={() =>
                      patch({
                        categories: draft.categories.filter((row) => row.key !== category.key),
                        reserves: draft.reserves.map((reserve) =>
                          reserve.target === category.key ? { ...reserve, target: "gross" } : reserve
                        ),
                        residualCategoryKey:
                          draft.residualCategoryKey === category.key ? "" : draft.residualCategoryKey,
                      })
                    }
                    removeLabel="Remove category"
                    canRemove={draft.categories.length > 1}
                  />
                </div>

                <div className="mt-2 grid gap-3 md:grid-cols-2">
                  <MeasureField label="What this share is for" htmlFor={`category-label-${category.key}`}>
                    <Input
                      id={`category-label-${category.key}`}
                      value={category.label}
                      onChange={(event) => patchCategory(category.key, { label: event.target.value })}
                    />
                  </MeasureField>
                  <MeasureField
                    label="Short reference"
                    htmlFor={`category-reference-${category.key}`}
                    hint="Claims and allocations are filed against this. It is stored in lower case with spaces as underscores, so that is how it types. Keep it the same when the ordinance is amended."
                  >
                    <Input
                      id={`category-reference-${category.key}`}
                      value={category.reference}
                      placeholder={referenceFromLabel(category.label)}
                      onChange={(event) => patchCategory(category.key, { reference: normaliseReference(event.target.value) })}
                    />
                  </MeasureField>
                  <MeasureField label="Share of what is left (%)" htmlFor={`category-share-${category.key}`}>
                    <Input
                      id={`category-share-${category.key}`}
                      inputMode="decimal"
                      value={category.share}
                      onChange={(event) => patchCategory(category.key, { share: event.target.value })}
                    />
                  </MeasureField>
                  <MeasureField label="Who gets it" htmlFor={`category-kind-${category.key}`}>
                    <select
                      id={`category-kind-${category.key}`}
                      className="flex h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
                      value={category.distributionKind}
                      onChange={(event) =>
                        patchCategory(category.key, {
                          distributionKind: event.target.value === "return_to_source" ? "return_to_source" : "pooled",
                        })
                      }
                    >
                      <option value="pooled">The agency programs it</option>
                      <option value="return_to_source">It goes back to the cities and districts</option>
                    </select>
                  </MeasureField>
                </div>

                {category.distributionKind === "return_to_source" ? (
                  <div className="mt-3 rounded-[0.5rem] border border-border/50 bg-muted/20 p-3">
                    <h4 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      How it is divided between them
                    </h4>
                    <p className="mt-1 text-xs text-muted-foreground">
                      One figure divides the whole share. Two or more divide it in the proportions the ordinance
                      states, and those proportions have to add up to exactly 100.
                    </p>

                    <div className="mt-2 space-y-2">
                      {category.factors.map((factor, factorIndex) => (
                        <div
                          key={factor.key}
                          role="group"
                          aria-label={`Category ${index + 1} figure ${factorIndex + 1}`}
                          className="grid gap-3 md:grid-cols-[1fr_auto_auto] md:items-end"
                        >
                          <MeasureField
                            label="Divided by"
                            htmlFor={`factor-basis-${category.key}-${factor.key}`}
                          >
                            <select
                              id={`factor-basis-${category.key}-${factor.key}`}
                              className="flex h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
                              value={factor.basisKey}
                              onChange={(event) =>
                                patchFactor(category.key, factor.key, { basisKey: event.target.value })
                              }
                            >
                              <option value="">Choose a figure…</option>
                              {namedFigures.map((figure) => (
                                <option key={figure.key} value={figure.key}>
                                  {figure.name}
                                </option>
                              ))}
                            </select>
                          </MeasureField>

                          {category.factors.length > 1 ? (
                            <MeasureField
                              label="Weight (%)"
                              htmlFor={`factor-weight-${category.key}-${factor.key}`}
                            >
                              <Input
                                id={`factor-weight-${category.key}-${factor.key}`}
                                className="w-28"
                                inputMode="decimal"
                                value={factor.weight}
                                onChange={(event) =>
                                  patchFactor(category.key, factor.key, { weight: event.target.value })
                                }
                              />
                            </MeasureField>
                          ) : (
                            <p className="text-xs text-muted-foreground md:pb-3">The whole of this share.</p>
                          )}

                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="md:mb-1"
                            disabled={category.factors.length <= 1}
                            onClick={() =>
                              patchCategory(category.key, {
                                factors: category.factors.filter((row) => row.key !== factor.key),
                              })
                            }
                          >
                            Remove figure
                          </Button>

                          <div className="md:col-span-3">
                            <ProblemList problems={problems} field={`${field}:factor:${factor.key}`} />
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-3">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          patchCategory(category.key, { factors: [...category.factors, emptyFactorDraft()] })
                        }
                      >
                        Add another figure
                      </Button>
                      {category.factors.length > 1 ? (
                        <PercentMeter
                          values={category.factors.map((factor) => factor.weight)}
                          subject={`The weights in ${category.label.trim() || `category ${index + 1}`}`}
                        />
                      ) : null}
                    </div>

                    <div className="mt-3 border-t border-border/50 pt-3">
                      <label className="flex items-start gap-2 text-sm">
                        <input
                          type="checkbox"
                          className="mt-1"
                          checked={category.floorEnabled}
                          onChange={(event) =>
                            patchCategory(category.key, { floorEnabled: event.target.checked })
                          }
                        />
                        <span>
                          The ordinance guarantees every recipient a minimum
                          <span className="mt-1 block text-xs text-muted-foreground">
                            Anyone whose share comes out below the minimum is brought up to it, and the difference
                            comes off the recipients above it, in proportion to how far above it they are. No money
                            is added to the fund. If the guarantees together are worth more than this category holds
                            for the period, nothing is paid out of it that period and the decision goes to the
                            board.
                          </span>
                        </span>
                      </label>

                      {category.floorEnabled ? (
                        <div className="mt-2 grid gap-3 md:grid-cols-2">
                          <MeasureField
                            label="The least a recipient may receive in one period"
                            htmlFor={`floor-amount-${category.key}`}
                            hint="For ONE accounting period. Most ordinances state this per year — if this fund closes quarterly, say which figure applies to a quarter."
                          >
                            <Input
                              id={`floor-amount-${category.key}`}
                              inputMode="decimal"
                              value={category.floorAmount}
                              onChange={(event) =>
                                patchCategory(category.key, { floorAmount: event.target.value })
                              }
                            />
                          </MeasureField>
                          <MeasureField
                            label="The ordinance's own words"
                            htmlFor={`floor-note-${category.key}`}
                            hint="Quoted on every allocation the guarantee moves money in."
                          >
                            <Textarea
                              id={`floor-note-${category.key}`}
                              rows={3}
                              value={category.floorNote}
                              onChange={(event) => patchCategory(category.key, { floorNote: event.target.value })}
                            />
                          </MeasureField>
                          <div className="md:col-span-2">
                            <ProblemList problems={problems} field={`${field}:floor`} />
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                <ProblemList problems={problems} field={field} />
              </div>
            );
          })}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => patch({ categories: [...draft.categories, emptyCategoryDraft()] })}
          >
            Add a category
          </Button>
          <PercentMeter values={draft.categories.map((category) => category.share)} subject="The category shares" />
        </div>

        <div className="mt-3 md:w-1/2">
          <MeasureField
            label="Which category takes the odd cent"
            htmlFor="residual-category"
            hint="A split rarely divides to the cent. The leftover goes here, and the fund reports it."
          >
            <select
              id="residual-category"
              className="flex h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
              value={draft.residualCategoryKey}
              onChange={(event) => patch({ residualCategoryKey: event.target.value })}
            >
              <option value="">The ordinance does not say — use the last by reference</option>
              {draft.categories.map((category, index) => (
                <option key={category.key} value={category.key}>
                  {category.label.trim() || `Category ${index + 1}`}
                </option>
              ))}
            </select>
          </MeasureField>
        </div>
      </div>

      <ProblemList problems={problems} field="form" />
    </div>
  );
}

/** What the composed rule will be saved under, for the review line above Save. */
export function draftCategorySummary(draft: MeasureRuleDraft): string {
  return draft.categories
    .map((category) => `${category.label.trim() || "(unnamed)"} (${effectiveReference(category) || "no reference"})`)
    .join(", ");
}

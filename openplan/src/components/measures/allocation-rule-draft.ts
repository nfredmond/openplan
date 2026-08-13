import {
  measurePercentTotal,
  parseMeasureAllocationRule,
  type MeasureAllocationRule,
  type MeasureCapBasis,
} from "@/lib/measures/allocation";

/**
 * WHAT THE ORDINANCE FORM HOLDS WHILE SOMEONE IS STILL TYPING IT, and the one
 * function that turns that into a rule the parser will accept.
 *
 * ============================================================================
 * WHY A DRAFT TYPE AT ALL, AND WHY EVERY NUMBER IS A STRING
 * ============================================================================
 *
 * A half-filled form is not a rule. A share box a planner has not reached yet
 * holds "", and "" is not 0 — a category with no stated share is a question, and
 * a category stated at zero is an ordinance that gives it nothing. Storing the
 * boxes as strings keeps those two apart until the moment the draft is composed,
 * which is the only place the difference is resolved and reported.
 *
 * ============================================================================
 * THE RULES ARE NOT RESTATED HERE
 * ============================================================================
 *
 * `composeMeasureRuleDraft` builds a candidate object and hands it to
 * `parseMeasureAllocationRule`. Whether the shares sum to exactly 100, whether
 * two categories share a reference, whether a weighted split's weights total
 * 100, whether a factor names a figure the ordinance never defined — all of that
 * is answered by the parser, in the parser's own words, and this module only
 * decides WHICH BOX on the screen the answer belongs next to.
 *
 * The one class of check that lives here is "this box is empty", because an
 * empty box has no value to hand the parser at all and `Too small: expected
 * string to have >=1 characters` is not a sentence to put in front of a clerk.
 * The parser still refuses the same drafts; these messages only arrive first.
 *
 * The live meters use `measurePercentTotal` — the parser's own integer
 * summation, exported for exactly this — so a meter can never read 100 for a
 * split the save is about to reject.
 */

/** Where a problem belongs on screen. `form` is a problem about the whole rule. */
export type MeasureRuleProblemField = string;

export type MeasureRuleProblem = {
  field: MeasureRuleProblemField;
  message: string;
};

export type MeasureFactorDraft = {
  /** Stable across reorders and removals, so React keeps the right input focused. */
  key: string;
  basisKey: string;
  weight: string;
};

export type MeasureCategoryDraft = {
  key: string;
  reference: string;
  label: string;
  share: string;
  distributionKind: "pooled" | "return_to_source";
  factors: MeasureFactorDraft[];
  floorEnabled: boolean;
  floorAmount: string;
  floorNote: string;
};

export type MeasureBasisDraft = {
  key: string;
  reference: string;
  label: string;
  sourceNote: string;
  vintageInForce: string;
  vintageRuleNote: string;
};

export type MeasureOffTheTopDraft = {
  key: string;
  reference: string;
  label: string;
  mode: "percent" | "amount";
  percent: string;
  amount: string;
  capEnabled: boolean;
  capAmount: string;
  capBasis: MeasureCapBasis;
};

export type MeasureReserveDraft = {
  key: string;
  reference: string;
  label: string;
  percent: string;
  /** `gross`, `after_off_the_top`, or the KEY of a category draft. */
  target: string;
};

export type MeasureRuleDraft = {
  offTheTop: MeasureOffTheTopDraft[];
  reserves: MeasureReserveDraft[];
  categories: MeasureCategoryDraft[];
  basisDefinitions: MeasureBasisDraft[];
  /** The KEY of a category draft, or "" for "the last one by reference". */
  residualCategoryKey: string;
};

export type MeasureRuleDraftResult = {
  /** The composed rule, present only when the parser accepted it. */
  rule: MeasureAllocationRule | null;
  problems: MeasureRuleProblem[];
};

let keyCounter = 0;

/** A key for a new row. Never rendered; only React and the problem list use it. */
export function newDraftKey(prefix: string): string {
  keyCounter += 1;
  return `${prefix}-${keyCounter}`;
}

export function emptyFactorDraft(): MeasureFactorDraft {
  return { key: newDraftKey("factor"), basisKey: "", weight: "" };
}

export function emptyCategoryDraft(): MeasureCategoryDraft {
  return {
    key: newDraftKey("category"),
    reference: "",
    label: "",
    share: "",
    distributionKind: "pooled",
    factors: [emptyFactorDraft()],
    floorEnabled: false,
    floorAmount: "",
    floorNote: "",
  };
}

export function emptyBasisDraft(): MeasureBasisDraft {
  return {
    key: newDraftKey("basis"),
    reference: "",
    label: "",
    sourceNote: "",
    vintageInForce: "",
    vintageRuleNote: "",
  };
}

export function emptyOffTheTopDraft(): MeasureOffTheTopDraft {
  return {
    key: newDraftKey("offthetop"),
    reference: "",
    label: "",
    mode: "percent",
    percent: "",
    amount: "",
    capEnabled: false,
    capAmount: "",
    capBasis: "fiscal_year",
  };
}

export function emptyReserveDraft(): MeasureReserveDraft {
  return { key: newDraftKey("reserve"), reference: "", label: "", percent: "", target: "gross" };
}

export function emptyRuleDraft(): MeasureRuleDraft {
  return {
    offTheTop: [],
    reserves: [],
    categories: [emptyCategoryDraft()],
    basisDefinitions: [],
    residualCategoryKey: "",
  };
}

/**
 * A label to the short reference that travels with every claim and allocation.
 *
 * Only used to PREFILL the reference box, never to overwrite one a person has
 * typed: the reference is how a category is recognised across ordinance
 * versions, and renaming a category in an amendment must not silently re-key
 * every record that points at the old one.
 */
export function referenceFromLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^[^a-z0-9]+/, "")
    .replace(/_+$/, "")
    .slice(0, 64);
}

/** The reference a row will actually be saved under: what was typed, or the label's. */
export function effectiveReference(row: { reference: string; label: string }): string {
  const typed = row.reference.trim();
  return typed || referenceFromLabel(row.label);
}

/** A number box's contents, or null when it is empty or not a number. */
function numberFrom(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

/**
 * The percentages a live meter adds up, read the way the parser reads them.
 *
 * An empty or unreadable box contributes nothing, so the meter shows what has
 * been stated so far rather than jumping to 100 because a blank counted as one.
 */
export function draftPercentTotal(values: readonly string[]): { total: number; isExactly100: boolean } {
  return measurePercentTotal(values.map((value) => numberFrom(value) ?? 0));
}

/**
 * WHICH BOX A PARSER SENTENCE BELONGS NEXT TO.
 *
 * The parser names the offending row by its reference — `category "transit"`,
 * `basis "population"` — so the reference is looked back up to the draft row it
 * came from. A sentence that names nothing this form drew stays on the form.
 */
function attributeProblem(
  message: string,
  referenceToField: ReadonlyMap<string, string>
): MeasureRuleProblem {
  for (const [reference, field] of referenceToField) {
    if (message.includes(`"${reference}"`)) return { field, message };
  }
  return { field: "form", message };
}

/**
 * A parser sentence as a planner should read it.
 *
 * Only the internal prefix is rewritten. The sentence itself is the parser's and
 * is not paraphrased — a softened rendering of "these sum to 99.9" is how a form
 * ends up disagreeing with the thing that actually refuses the save.
 */
function withoutInternalPrefix(message: string): string {
  const malformed = /^Measure allocation rule is not a valid descriptor: /;
  if (malformed.test(message)) {
    return `This ordinance rule cannot be recorded as written: ${message.replace(malformed, "")}`;
  }
  return message.replace(/^Measure allocation rule (category )?/, (_match, category: string | undefined) =>
    category ? "Category " : ""
  );
}

/**
 * Compose the form's boxes into an ordinance rule and let the parser judge it.
 *
 * Returns the rule only when the parser accepted it; the caller submits nothing
 * else. Every problem carries the field it belongs to so the form can print it
 * where the planner is looking rather than in a banner at the bottom.
 */
export function composeMeasureRuleDraft(draft: MeasureRuleDraft): MeasureRuleDraftResult {
  const problems: MeasureRuleProblem[] = [];
  const referenceToField = new Map<string, string>();

  const basisReferenceByKey = new Map<string, string>();
  for (const basis of draft.basisDefinitions) {
    const reference = effectiveReference(basis);
    basisReferenceByKey.set(basis.key, reference);
    if (reference) referenceToField.set(reference, `basis:${basis.key}`);
    if (!basis.label.trim()) {
      problems.push({ field: `basis:${basis.key}`, message: "Name the figure this ordinance divides by." });
    } else if (!reference) {
      problems.push({
        field: `basis:${basis.key}`,
        message: "Give this figure a short reference using letters or numbers.",
      });
    }
    if (!basis.sourceNote.trim()) {
      problems.push({
        field: `basis:${basis.key}`,
        message: "Say where this figure comes from, in the ordinance's own words.",
      });
    }
  }

  const categoryReferenceByKey = new Map<string, string>();
  for (const category of draft.categories) {
    const reference = effectiveReference(category);
    categoryReferenceByKey.set(category.key, reference);
    if (reference) referenceToField.set(reference, `category:${category.key}`);
  }

  const offTheTop = draft.offTheTop.map((item) => {
    const reference = effectiveReference(item);
    if (reference) referenceToField.set(reference, `offthetop:${item.key}`);
    if (!item.label.trim()) {
      problems.push({ field: `offthetop:${item.key}`, message: "Name what this deduction is for." });
    } else if (!reference) {
      problems.push({
        field: `offthetop:${item.key}`,
        message: "Give this deduction a short reference using letters or numbers.",
      });
    }
    const percent = numberFrom(item.percent);
    const amount = numberFrom(item.amount);
    if (item.mode === "percent" && percent === null) {
      problems.push({ field: `offthetop:${item.key}`, message: "State the percentage this deduction takes." });
    }
    if (item.mode === "amount" && amount === null) {
      problems.push({ field: `offthetop:${item.key}`, message: "State the amount this deduction takes." });
    }
    const capAmount = numberFrom(item.capAmount);
    if (item.capEnabled && capAmount === null) {
      problems.push({ field: `offthetop:${item.key}`, message: "State the most this deduction may take." });
    }
    return {
      id: reference,
      label: item.label.trim(),
      ...(item.mode === "percent" ? { percent: percent ?? 0 } : { amount: amount ?? 0 }),
      ...(item.capEnabled && capAmount !== null
        ? { capAmount, capBasis: item.capBasis }
        : {}),
    };
  });

  const reserves = draft.reserves.map((item) => {
    const reference = effectiveReference(item);
    if (reference) referenceToField.set(reference, `reserve:${item.key}`);
    if (!item.label.trim()) {
      problems.push({ field: `reserve:${item.key}`, message: "Name what this reserve is for." });
    } else if (!reference) {
      problems.push({
        field: `reserve:${item.key}`,
        message: "Give this reserve a short reference using letters or numbers.",
      });
    }
    const percent = numberFrom(item.percent);
    if (percent === null) {
      problems.push({ field: `reserve:${item.key}`, message: "State the percentage held in reserve." });
    }
    const categoryReference =
      item.target === "gross" || item.target === "after_off_the_top"
        ? null
        : categoryReferenceByKey.get(item.target) ?? "";
    return {
      id: reference,
      label: item.label.trim(),
      basis: categoryReference === null ? item.target : `category:${categoryReference}`,
      percent: percent ?? 0,
    };
  });

  const categories = draft.categories.map((category) => {
    const field = `category:${category.key}`;
    const reference = categoryReferenceByKey.get(category.key) ?? "";
    if (!category.label.trim()) {
      problems.push({ field, message: "Name what this share of the money is for." });
    } else if (!reference) {
      problems.push({ field, message: "Give this category a short reference using letters or numbers." });
    }
    const share = numberFrom(category.share);
    if (share === null) {
      problems.push({ field, message: "State this category's share of what is left to divide." });
    }

    if (category.distributionKind === "pooled") {
      return {
        id: reference,
        label: category.label.trim(),
        percentOfAllocable: share ?? 0,
        distribution: { kind: "pooled" as const },
      };
    }

    const factors = category.factors.map((factor) => {
      const basisReference = basisReferenceByKey.get(factor.basisKey) ?? "";
      if (!basisReference) {
        problems.push({
          field: `${field}:factor:${factor.key}`,
          message: "Choose which recorded figure this part of the share is divided by.",
        });
      }
      const weight = numberFrom(factor.weight);
      if (category.factors.length > 1 && weight === null) {
        problems.push({
          field: `${field}:factor:${factor.key}`,
          message: "State how much of this category is divided by that figure.",
        });
      }
      return { basisId: basisReference, weight: weight ?? 0 };
    });

    const floor = category.floorEnabled
      ? (() => {
          const amount = numberFrom(category.floorAmount);
          if (amount === null || !(amount > 0)) {
            problems.push({
              field: `${field}:floor`,
              message: "State the least a recipient may receive for one period.",
            });
          }
          if (!category.floorNote.trim()) {
            problems.push({
              field: `${field}:floor`,
              message: "Quote the ordinance's own words for this guarantee.",
            });
          }
          return { amountPerPeriod: amount ?? 0, statedRuleNote: category.floorNote.trim() };
        })()
      : null;

    /*
     * ONE FACTOR IS THE SINGLE-FIGURE FORM. The descriptor accepts either
     * spelling and refuses both at once; `measureReturnToSourceFactors` reads
     * them identically, and every rule recorded before weighted splits existed
     * is written the first way. A one-factor category composed as a weighted
     * list would be a needless second spelling of the same sentence.
     */
    const distribution =
      factors.length === 1
        ? {
            kind: "return_to_source" as const,
            basisId: factors[0].basisId,
            ...(floor ? { minimumPerRecipient: floor } : {}),
          }
        : {
            kind: "return_to_source" as const,
            factors,
            ...(floor ? { minimumPerRecipient: floor } : {}),
          };

    return {
      id: reference,
      label: category.label.trim(),
      percentOfAllocable: share ?? 0,
      distribution,
    };
  });

  const basisDefinitions = draft.basisDefinitions.map((basis) => ({
    id: basisReferenceByKey.get(basis.key) ?? "",
    label: basis.label.trim(),
    statedSourceNote: basis.sourceNote.trim(),
    ...(basis.vintageInForce.trim() ? { vintageInForce: basis.vintageInForce.trim() } : {}),
    ...(basis.vintageRuleNote.trim() ? { vintageRuleNote: basis.vintageRuleNote.trim() } : {}),
  }));

  const residualReference = draft.residualCategoryKey
    ? categoryReferenceByKey.get(draft.residualCategoryKey) ?? ""
    : "";

  const candidate = {
    version: 1,
    offTheTop,
    reserves,
    categories,
    basisDefinitions,
    ...(residualReference ? { residualCategoryId: residualReference } : {}),
  };

  /*
   * THE PARSER IS THE JUDGE, and it runs even when the boxes above already have
   * complaints — a planner who has left one field blank should still be told
   * that the shares add to 97, rather than discovering it one keystroke later.
   */
  let rule: MeasureAllocationRule | null = null;
  try {
    rule = parseMeasureAllocationRule(candidate);
  } catch (error) {
    const message = error instanceof Error ? error.message : "This ordinance rule could not be read.";
    problems.push(attributeProblem(withoutInternalPrefix(message), referenceToField));
  }

  return { rule: problems.length === 0 ? rule : null, problems };
}

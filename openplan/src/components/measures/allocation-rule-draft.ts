import {
  isNarrativeRule,
  measurePercentTotal,
  parseMeasureAllocationRule,
  type MeasureAllocationDescriptor,
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
 *
 * Stricter than `normaliseReference`, and deliberately unchanged: a hyphen in a
 * label becomes an underscore here, as it always has. Every reference derived
 * from a label so far is spelled that way and is stored on allocations and
 * claims, so a "nicer" derivation would re-key an amendment's categories away
 * from the records filed under them.
 */
export function referenceFromLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^[^a-z0-9]+/, "")
    .replace(/_+$/, "")
    .slice(0, 64);
}

/**
 * WHAT A PLANNER TYPES IN A SHORT REFERENCE BOX, AS THE RECORD WILL HOLD IT.
 *
 * Call this on every keystroke in a reference box, so the box shows exactly the
 * string the record will carry. Before it existed the likeliest mistake in the
 * whole form — typing `Transit` in a box labelled "Short reference" — reached
 * the descriptor's id rule and came back as "an id must be lower-case letters,
 * digits, hyphen or underscore", attached to no box, on a form with a dozen of
 * them. Normalising instead of refusing removes that error rather than wording
 * it better.
 *
 * A TRAILING UNDERSCORE SURVIVES, unlike in `referenceFromLabel`: someone
 * halfway through typing `transit_operations` has `transit_` in the box for one
 * keystroke, and eating it would make the rest of the word unreachable.
 * Anything this returns is either empty or a valid descriptor id — the leading
 * character is forced to a letter or digit and the length is capped — so no
 * reference box can produce that class of refusal again.
 */
export function normaliseReference(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^[^a-z0-9]+/, "")
    .slice(0, 64);
}

/** The reference a row will actually be saved under: what was typed, or the label's. */
export function effectiveReference(row: { reference: string; label: string }): string {
  return normaliseReference(row.reference) || referenceFromLabel(row.label);
}

/**
 * WHAT A NUMBER BOX HOLDS — and the difference between empty and unreadable.
 *
 * A box nobody has reached and a box holding `thirty-three` are two different
 * situations and used to produce one sentence: "State this category's share",
 * printed under a box a planner had just filled in, while the live meter
 * counted the box as 0. They are kept apart here so each can be said plainly.
 *
 * ONLY DECIMAL SPELLINGS ARE ACCEPTED. `Number()` reads `0x64` and `1e2` as
 * 100, and a share silently recorded as 100 because someone's paste carried a
 * stray `x` is the worst available behaviour for a fund an oversight committee
 * audits. A trailing `%` and thousands separators ARE tolerated and normalised
 * away, because a planner types `33.5%` in a box labelled "Share (%)" and
 * `1,000,000` in a box labelled "Amount" every time.
 */
type NumberBoxReading =
  | { kind: "empty" }
  | { kind: "unreadable"; text: string }
  | { kind: "number"; value: number };

/** Digits, with optional 3-digit grouping and an optional fractional part. */
const DECIMAL_SPELLING = /^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$|^[+-]?\.\d+$/;

function readNumberBox(text: string): NumberBoxReading {
  const trimmed = text.trim();
  if (!trimmed) return { kind: "empty" };
  const withoutPercent = (trimmed.endsWith("%") ? trimmed.slice(0, -1) : trimmed).trim();
  if (!DECIMAL_SPELLING.test(withoutPercent)) return { kind: "unreadable", text: trimmed };
  const value = Number(withoutPercent.replace(/,/g, ""));
  if (!Number.isFinite(value)) return { kind: "unreadable", text: trimmed };
  return { kind: "number", value };
}

function unreadableNumberMessage(text: string): string {
  return `"${text}" is not a number this form can read. Write it in digits — 33.5, 33.5% and 1,000 are all fine.`;
}

/**
 * Read one number box, pushing whichever sentence fits, and hand back the value.
 *
 * `emptyMessage` says what the box is FOR, and is only ever shown for a box
 * that is actually empty.
 */
function numberBoxValue(
  text: string,
  options: { field: string; emptyMessage: string; problems: MeasureRuleProblem[] }
): number | null {
  const reading = readNumberBox(text);
  if (reading.kind === "number") return reading.value;
  options.problems.push({
    field: options.field,
    message: reading.kind === "empty" ? options.emptyMessage : unreadableNumberMessage(reading.text),
  });
  return null;
}

/**
 * The percentages a live meter adds up, read the way the parser reads them.
 *
 * An empty or unreadable box contributes nothing, so the meter shows what has
 * been stated so far rather than jumping to 100 because a blank counted as one.
 * An unreadable box is named by its own problem sentence, so a meter short by
 * that box's value is never the only thing a planner has to go on.
 */
export function draftPercentTotal(values: readonly string[]): { total: number; isExactly100: boolean } {
  return measurePercentTotal(
    values.map((value) => {
      const reading = readNumberBox(value);
      return reading.kind === "number" ? reading.value : 0;
    })
  );
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
 * THE HANDFUL OF SCHEMA SENTENCES A PLANNER CAN ACTUALLY PROVOKE, in plain
 * words.
 *
 * These are the zod refusals — `Too big: expected number to be <=100`, the id
 * rule — which are written for whoever is holding the schema and are the only
 * thing a clerk sees when they land. Each entry replaces the WHOLE sentence,
 * because half of a zod message is not a sentence.
 *
 * NOTHING THE PARSER ITSELF WROTE IS IN HERE. "…weights its apportionment
 * factors to 99, not to exactly 100" is already the ordinance's own arithmetic
 * in plain words, and paraphrasing an arithmetic refusal is how a form ends up
 * disagreeing with the thing that actually refuses the save.
 *
 * EXPORTED FOR ITS GUARD, and only for that.
 * `measure-allocation-builder.test.tsx` walks this table and requires every
 * entry to be either provoked through the real form — typed in, and the plain
 * sentence read back off the screen — or recorded there as unreachable with the
 * construction that makes it unreachable. Adding an entry here and nowhere else
 * fails that guard, which is the only thing keeping the translation honest: the
 * whole table can be replaced by `return message` without any assertion on the
 * composed rule noticing.
 */
export const PLAIN_SCHEMA_SENTENCES: ReadonlyArray<{ match: RegExp; plain: string }> = [
  {
    match: /an id must be lower-case letters, digits, hyphen or underscore/i,
    plain:
      "A short reference may use only lower-case letters, digits, hyphens and underscores, and has to start " +
      "with a letter or a digit.",
  },
  {
    match: /a percentage may carry at most four decimal places/i,
    plain: "A percentage can be stated to at most four decimal places — 33.3333 is fine, 33.33335 is not.",
  },
  { match: /^Too big: expected number to be <=100$/i, plain: "A percentage cannot be more than 100." },
  { match: /^Too small: expected number to be >=0$/i, plain: "This cannot be a negative number." },
  {
    match: /^Too small: expected string to have >=1 characters$/i,
    plain: "Something the ordinance rule needs in words has been left empty.",
  },
  {
    match: /^Too big: expected string to have <=(\d+) characters$/i,
    plain: "One of the boxes above holds more text than this ordinance rule can store. Shorten it.",
  },
  {
    match: /^Invalid input: expected number, received/i,
    plain: "One of the number boxes above does not hold a number.",
  },
];

function inPlainWords(message: string): string {
  for (const entry of PLAIN_SCHEMA_SENTENCES) {
    if (entry.match.test(message)) return entry.plain;
  }
  return message;
}

/**
 * A parser sentence as a planner should read it.
 *
 * The internal prefix goes, and a schema refusal is swapped for its plain
 * rendering; a sentence the parser wrote about the ordinance is left alone.
 */
function withoutInternalPrefix(message: string): string {
  const malformed = /^Measure allocation rule is not a valid descriptor: /;
  if (malformed.test(message)) {
    return `This ordinance rule cannot be recorded as written: ${inPlainWords(message.replace(malformed, ""))}`;
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
    /*
     * ONLY THE BOX THE CHOSEN MODE USES IS READ. A planner who typed an amount,
     * then switched the deduction to a percentage, is not told their hidden
     * amount box is unreadable — but the composed deduction below carries the
     * mode's figure only, so the rule and the form still say the same thing.
     */
    const field = `offthetop:${item.key}`;
    const percent =
      item.mode === "percent"
        ? numberBoxValue(item.percent, {
            field,
            emptyMessage: "State the percentage this deduction takes.",
            problems,
          })
        : null;
    const amount =
      item.mode === "amount"
        ? numberBoxValue(item.amount, {
            field,
            emptyMessage: "State the amount this deduction takes.",
            problems,
          })
        : null;
    const capAmount = item.capEnabled
      ? numberBoxValue(item.capAmount, {
          field,
          emptyMessage: "State the most this deduction may take.",
          problems,
        })
      : null;
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
    const percent = numberBoxValue(item.percent, {
      field: `reserve:${item.key}`,
      emptyMessage: "State the percentage held in reserve.",
      problems,
    });
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
    const share = numberBoxValue(category.share, {
      field,
      emptyMessage: "State this category's share of what is left to divide.",
      problems,
    });

    if (category.distributionKind === "pooled") {
      /*
       * A FLOOR TICKED AND THEN POOLED IS NOT SILENTLY DROPPED. The boxes stay
       * filled — switching back restores them — but a minimum per recipient is
       * meaningless where the agency programs the money itself, and composing a
       * pooled category while quietly discarding a guarantee a planner ticked
       * and quoted the ordinance for would put a rule on the record that the
       * form on screen does not say.
       */
      if (category.floorEnabled) {
        problems.push({
          field,
          message:
            "A minimum for each recipient does not apply to a category the agency programs itself — there are " +
            "no recipients to guarantee it to. Untick the minimum, or say this share goes back to the cities " +
            "and districts.",
        });
      }
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
      // One figure divides the whole share, so its weight box is not on screen
      // and whatever it holds is not read.
      const weight =
        category.factors.length > 1
          ? numberBoxValue(factor.weight, {
              field: `${field}:factor:${factor.key}`,
              emptyMessage: "State how much of this category is divided by that figure.",
              problems,
            })
          : null;
      return { basisId: basisReference, weight: weight ?? 0 };
    });

    const floor = category.floorEnabled
      ? (() => {
          const amount = numberBoxValue(category.floorAmount, {
            field: `${field}:floor`,
            emptyMessage: "State the least a recipient may receive for one period.",
            problems,
          });
          if (amount !== null && !(amount > 0)) {
            problems.push({
              field: `${field}:floor`,
              message: "A minimum of zero is not a guarantee. State an amount above zero, or untick the minimum.",
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

/* ------------------------------------------------------------------ *
 * Amending an ordinance that is already in force
 * ------------------------------------------------------------------ */

/**
 * THE RULE IN FORCE, BACK IN THE FORM'S BOXES — the inverse of
 * `composeMeasureRuleDraft`.
 *
 * An amendment is an edit to a split that already exists, and until this
 * existed the builder opened blank underneath a heading that said "Amending the
 * ordinance records a new version". Retyping a split from a blank form is how a
 * category comes back spelled differently — `local_streets_and_roads` where the
 * allocations and claims on the record say `local_streets_&_roads` — and
 * `resolveMeasureClaimCategories` answers with the NEW rule's ids, so the old
 * ones stop being claimable with nothing said.
 *
 * Returns null for a narrative rule: there are no boxes to fill from a
 * paragraph, and inventing categories out of one would be authoring the
 * ordinance.
 */
export function ruleDraftFromRule(rule: MeasureAllocationRule): MeasureRuleDraft | null {
  if (isNarrativeRule(rule)) return null;
  const descriptor: MeasureAllocationDescriptor = rule;

  const basisKeyById = new Map<string, string>();
  const basisDefinitions: MeasureBasisDraft[] = descriptor.basisDefinitions.map((basis) => {
    const key = newDraftKey("basis");
    basisKeyById.set(basis.id, key);
    return {
      key,
      reference: basis.id,
      label: basis.label,
      sourceNote: basis.statedSourceNote,
      vintageInForce: basis.vintageInForce ?? "",
      vintageRuleNote: basis.vintageRuleNote ?? "",
    };
  });

  const categoryKeyById = new Map<string, string>();
  const categories: MeasureCategoryDraft[] = descriptor.categories.map((category) => {
    const key = newDraftKey("category");
    categoryKeyById.set(category.id, key);

    const distribution = category.distribution;
    const pooled = distribution.kind === "pooled";

    /*
     * THE TWO SPELLINGS COME BACK AS THEMSELVES. A single-basis category
     * becomes one factor row with no weight — the form hides the weight box for
     * a lone figure and `composeMeasureRuleDraft` writes it back as `basisId` —
     * so an amendment that changes nothing about a category re-composes the
     * identical sentence rather than a weighted list of one.
     */
    const factors: MeasureFactorDraft[] = pooled
      ? [emptyFactorDraft()]
      : distribution.factors
        ? distribution.factors.map((factor) => ({
            key: newDraftKey("factor"),
            basisKey: basisKeyById.get(factor.basisId) ?? "",
            weight: String(factor.weight),
          }))
        : [
            {
              key: newDraftKey("factor"),
              basisKey: distribution.basisId ? basisKeyById.get(distribution.basisId) ?? "" : "",
              weight: "",
            },
          ];

    const floor = pooled ? undefined : distribution.minimumPerRecipient;

    return {
      key,
      reference: category.id,
      label: category.label,
      share: String(category.percentOfAllocable),
      distributionKind: pooled ? "pooled" : "return_to_source",
      factors,
      floorEnabled: floor !== undefined,
      floorAmount: floor ? String(floor.amountPerPeriod) : "",
      floorNote: floor ? floor.statedRuleNote : "",
    };
  });

  const offTheTop: MeasureOffTheTopDraft[] = descriptor.offTheTop.map((item) => ({
    key: newDraftKey("offthetop"),
    reference: item.id,
    label: item.label,
    mode: item.amount !== undefined ? "amount" : "percent",
    percent: item.percent !== undefined ? String(item.percent) : "",
    amount: item.amount !== undefined ? String(item.amount) : "",
    capEnabled: item.capAmount !== undefined,
    capAmount: item.capAmount !== undefined ? String(item.capAmount) : "",
    capBasis: item.capBasis ?? "fiscal_year",
  }));

  const reserves: MeasureReserveDraft[] = descriptor.reserves.map((item) => ({
    key: newDraftKey("reserve"),
    reference: item.id,
    label: item.label,
    percent: String(item.percent),
    // A reserve on a category is held against that category's DRAFT KEY, so it
    // follows the category through a rename in the amendment being written.
    target: item.basis.startsWith("category:")
      ? categoryKeyById.get(item.basis.slice("category:".length)) ?? "gross"
      : item.basis,
  }));

  return {
    offTheTop,
    reserves,
    categories,
    basisDefinitions,
    residualCategoryKey: descriptor.residualCategoryId
      ? categoryKeyById.get(descriptor.residualCategoryId) ?? ""
      : "",
  };
}

/** A category reference that money or a claim has already been filed against. */
export type MeasureFiledCategoryReference = {
  reference: string;
  allocations: number;
  claims: number;
};

/**
 * WHAT THIS AMENDMENT WOULD ORPHAN.
 *
 * A category reference is what `measure_allocations.category_id` and
 * `measure_claims.category_id` hold, and it is the ONLY link between a recorded
 * figure and the ordinance clause it came from. Drop the reference from the
 * rule and those rows do not move, do not error, and stop being offered:
 * `resolveMeasureClaimCategories` returns the new rule's ids for a descriptor
 * rule, so the old reference is simply no longer a thing a city may claim for.
 *
 * Retiring a category IS a legitimate amendment, so this reports rather than
 * refuses — the form makes a planner say out loud that they mean it.
 */
export function orphanedFiledReferences(
  draft: MeasureRuleDraft,
  filed: readonly MeasureFiledCategoryReference[]
): MeasureFiledCategoryReference[] {
  const declared = new Set(
    draft.categories.map((category) => effectiveReference(category)).filter((reference) => reference.length > 0)
  );
  return filed.filter((row) => row.reference.trim().length > 0 && !declared.has(row.reference));
}

/** `"transit" — 12 recorded allocations and 3 claims are filed against it.` */
export function describeFiledReference(row: MeasureFiledCategoryReference): string {
  const parts: string[] = [];
  if (row.allocations > 0) {
    parts.push(`${row.allocations} recorded ${row.allocations === 1 ? "allocation" : "allocations"}`);
  }
  if (row.claims > 0) parts.push(`${row.claims} ${row.claims === 1 ? "claim" : "claims"}`);
  const total = row.allocations + row.claims;
  const what = parts.length > 0 ? parts.join(" and ") : "recorded history";
  return `"${row.reference}" — ${what} ${total === 1 ? "is" : "are"} filed against it.`;
}

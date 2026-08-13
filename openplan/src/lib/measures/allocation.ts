import { z } from "zod";

/**
 * THE ORDINANCE'S SPLIT, AS DATA — and the pure allocator that applies it.
 *
 * ============================================================================
 * WHY A DESCRIPTOR AND NOT CODE
 * ============================================================================
 *
 * Every self-help measure slices differently. One takes 1% off the top for
 * administration and splits the rest 40/35/20/5 with a reserve on one category;
 * the next takes nothing off the top, holds 5% of gross in reserve, and returns
 * the whole remainder to its two member jurisdictions by parcel count. Product
 * non-negotiable #0 says the difference between those two is DATA, and
 * `measure-allocation-arithmetic.test.ts` proves it by running both through
 * this one allocator with nothing but a different descriptor.
 *
 * The vocabulary below is CLOSED. An ordinance it cannot express is stored as
 * `{ version: 1, kind: "narrative", text }` and its allocations are entered by
 * hand (`measure_allocations.computation_basis = 'manual'`, which the database
 * requires to carry a rationale). Blocking those agencies was rejected;
 * presenting hand figures as computed was rejected harder.
 *
 * ============================================================================
 * WHY INTEGER CENTS AND BigInt, AND NOT `roundCurrencyAmount`
 * ============================================================================
 *
 * TWO REASONS, MEASURED RATHER THAN ASSUMED. An earlier draft of this comment
 * claimed the float path gets `1000000.01 / 2` wrong; it does not, and the
 * claim was removed rather than quietly softened. What is actually true:
 *
 * 1. THE HARD ONE — 2^53. The natural exact-integer alternative is to work in
 *    cents as plain Numbers. `poolCents * percentE4` overflows
 *    `Number.MAX_SAFE_INTEGER` once the pool passes $90,071,992.55, and a
 *    county-wide measure's ANNUAL figure passes that comfortably. Past it the
 *    arithmetic is silently approximate, which is the worst available
 *    behaviour: no error, no flag, a slightly wrong apportionment. BigInt has
 *    no such ceiling.
 *
 * 2. THE MEASURED ONE — the float path is USUALLY right and occasionally not.
 *    Over 3,000,000 random (pool, basis) draws at fund magnitudes,
 *    `Math.round(pool * basis / total * 100) / 100` disagreed with exact
 *    half-up 8 times: about 3 in a million. Rare — and undebuggable when it
 *    lands, because the missing cent is absorbed into a jurisdiction's share
 *    with NO residual line to say a rounding decision was made. Fixture D in
 *    `measure-allocation-arithmetic.test.ts` is one of those draws, kept as an
 *    executable negative control: the float path shorts one jurisdiction by a
 *    cent and its shares still sum to the pool, so nothing looks wrong.
 *
 * For a fund a citizens' oversight committee audits, "correct except about
 * three times in a million, and silent when it isn't" is not a property worth
 * having when exactness costs one BigInt.
 *
 * So: parse decimals to exact integers, divide with BigInt, round half-up on
 * the exact remainder, and convert back only at the boundary. Every figure this
 * module returns is a whole number of cents.
 *
 * `parseCurrencyAmount` / `roundCurrencyAmount` are still the right import for
 * the CLAIM ledger, where the arithmetic is ADDITION of already-stored
 * at-the-cent figures — no division, so no rounding decision — and agreeing to
 * the cent with the invoice register matters more. This module and that one
 * must never disagree, which is why this one only ever emits at-the-cent
 * values.
 *
 * ============================================================================
 * THE ORDER OF OPERATIONS, STATED ONCE
 * ============================================================================
 *
 *   1. OFF THE TOP, in declaration order, out of the receipt. Percent of the
 *      receipt or a flat amount, each optionally capped.
 *   2. POOL RESERVES — a reserve on 'gross' or 'after_off_the_top' comes out
 *      before the categories are cut, so it reduces the allocable pool.
 *   3. allocable = receipt − offTheTop − poolReserves.
 *   4. CATEGORIES take `percentOfAllocable` of the allocable pool. The rounding
 *      residual goes to `residualCategoryId` (or the last category by id
 *      ascending) and is REPORTED. NO CATEGORY MAY GO NEGATIVE doing it — see
 *      "the residual has a floor" below.
 *   5. CATEGORY RESERVES — a reserve on 'category:<id>' comes out of that
 *      category only, leaving its `programmableAmount`.
 *   6. RETURN TO SOURCE distributes a category's programmable amount over the
 *      recipients' stated basis values — ONE basis, or a weighted list of them
 *      whose weights total 100. Its residual goes to the recipient last by id
 *      ascending and is REPORTED.
 *   7. A MINIMUM PER RECIPIENT, if the ordinance states one, then redistributes
 *      within that category: recipients below the floor come up to it and the
 *      recipients above it pay, pro rata to how far above they are.
 *
 * INVARIANTS, asserted for every fixture: Σ category amounts === allocable
 * exactly, and Σ recipient shares === the distributed pool exactly.
 *
 * ============================================================================
 * THE RESIDUAL HAS A FLOOR, AND WHAT A $0.02 POOL ACROSS FOUR CATEGORIES OWES
 * ============================================================================
 *
 * Half-up rounding can over-allocate: four categories at 25% of $0.02 each
 * round to $0.01, so the naive shares sum to $0.04 and the residual is
 * −$0.02. Handing the whole of that to one category made its share −$0.01 — a
 * negative money figure, which `measure_allocations_amount_check (amount >= 0)`
 * rejects. Before the replacement was made atomic (20260812000014) that
 * rejection landed AFTER the period's previous allocations had been deleted,
 * so a $0.02 quarter emptied the period.
 *
 * THE RULE, stated once: the ordinance's residual category absorbs the
 * residual, in either direction, but NO CATEGORY'S SHARE MAY BE DRIVEN BELOW
 * ZERO. When the over-allocation is larger than the residual category holds,
 * that category goes to zero and the remainder is taken from the others in id
 * ascending order, each down to zero, and a note says it happened. The pool is
 * exhausted before the categories are, because the total to claw back
 * (Σ naive − allocable) is never more than Σ naive.
 *
 * So the honest answer for $0.02 across four equal categories a/b/c/d with no
 * declared residual category is a=$0.00, b=$0.01, c=$0.01, d=$0.00: the
 * residual category (last by id ascending, `d`) is zeroed first, then `a`. Two
 * cents cannot be divided four ways, every cent stays in the fund, and the two
 * categories that got nothing are a fact the note reports rather than a
 * rounding artefact nobody can see. What the rule REFUSES to do is invent a
 * negative allocation, which is not a quantity of money.
 *
 * ============================================================================
 * WHEN THE FLOORS CANNOT ALL BE MET — WHY THIS REFUSES INSTEAD OF CHOOSING
 * ============================================================================
 *
 * `recipients × floor > pool` is an ordinance whose own text cannot be honoured
 * this period. The category is reported `undistributed` with the reason
 * `recipient_floors_exceed_pool`, the money is held, and the note states the
 * three figures (floor, total required, available) and the shortfall.
 *
 * THE ALTERNATIVE THAT WAS PROPOSED and rejected on 2026-08-12: pay each floor
 * in full, in order of shortfall, until the pool is exhausted. It is a coherent
 * rule and it is not the ordinance's rule. Run it on four recipients with a
 * $100,000 floor and a $250,000 pool and the LARGEST jurisdiction — the one the
 * formula gives the most to — receives $0.00 while two small ones are paid in
 * full. It also has a cliff: at a pool of $400,001 every recipient clears the
 * floor and the large one keeps most of its share; at $399,999 it drops to
 * nothing. A rule with a discontinuity that size at an arbitrary threshold is
 * not what "no jurisdiction shall receive less than $100,000" means — it is one
 * of several defensible readings of a clause that has run out of money, and
 * "pay them pro rata anyway", "haircut every floor equally" and "carry the
 * shortfall to next period" are the others. The ordinance does not choose
 * between them, so this product does not either.
 *
 * That is the same rule as everything else in this module: a plausible wrong
 * apportionment is worse than a refusal, because a refusal sends the question
 * to the board and an apportionment gets published. The existing hand-entry
 * path (`computation_basis = 'manual'`, which requires a rationale) is where
 * the board's answer is recorded, and it labels itself staff-entered wherever
 * it appears.
 *
 * IT ALSO REMOVES THE LOOP. The naive floor algorithm — raise everyone short,
 * reduce everyone else pro rata, notice that reducing them made someone new
 * short, repeat — does not terminate when the floors do not fit. Refusing that
 * case at the door means the redistribution below is a single pass with no
 * fixpoint to reach.
 *
 * ============================================================================
 * A MISSING DENOMINATOR TERM IS NOT ZERO
 * ============================================================================
 *
 * If ANY active recipient lacks a basis value for the vintage in force, the
 * category is reported as `undistributed` and its money is allocated-but-not-
 * distributed. It is NOT split among the recipients that do have figures:
 * dropping a term from the denominator inflates every other share, silently and
 * in the direction that overpays. That is "an unreported amount is not zero"
 * applied to a divisor.
 *
 * WHICH VINTAGE GOVERNS a period that straddles an annexation is an ORDINANCE
 * question, not a code question. Both vintages coexist in
 * `measure_recipient_basis_values`; the caller states which one is in force and
 * this module uses exactly that one.
 *
 * AND AN UNSTATED VINTAGE IS REFUSED rather than treated as one nothing
 * matches. An empty label matched no recorded figure, so every recipient
 * counted as missing one and every return-to-source category came out
 * undistributed — a whole quarter's money held back with the surface reporting
 * success. See the refusal at the top of `allocateMeasureReceipt`.
 */

/* ------------------------------------------------------------------ *
 * Exact decimal arithmetic
 * ------------------------------------------------------------------ */

/**
 * BigInt CONSTANTS BUILT WITH THE CONSTRUCTOR, NOT THE `BIG_ZERO` LITERAL.
 *
 * `tsconfig.json` targets ES2017, where TypeScript rejects BigInt literals
 * (TS2737). The restriction is on the SYNTAX, not on BigInt — the runtime
 * behaviour of `BigInt(0)` and `BIG_ZERO` is identical, and every environment this
 * ships to has had BigInt for years. Bumping a shared compiler target for one
 * module is not a change this lane should make on its own, so the constants
 * live here instead.
 */
const BIG_ZERO = BigInt(0);
const BIG_ONE = BigInt(1);
const BIG_TWO = BigInt(2);
const BIG_TEN = BigInt(10);
const BIG_HUNDRED = BigInt(100);
const BIG_THOUSAND = BigInt(1000);

/** Cents in one unit of currency, and ten-thousandths in one percent. */
const CENT_SCALE = 2;
const PERCENT_SCALE = 4;
/** percent-e4 * amount-cents / PERCENT_DIVISOR = amount-cents. */
const PERCENT_DIVISOR = BIG_HUNDRED * BIG_TEN ** BigInt(PERCENT_SCALE);
/** Basis values are NUMERIC(18,4); the scale must match or a divisor loses precision. */
const BASIS_SCALE = 4;

/**
 * A decimal string to an exact scaled integer, rounding half-up on the first
 * dropped digit.
 *
 * String-first on purpose. PostgREST returns NUMERIC as a string precisely so
 * that precision survives the wire, and re-floating it before scaling would
 * throw that away at the only point where it is free to keep.
 */
function scaledFromDecimalText(text: string, scale: number): bigint | null {
  const match = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(text.trim());
  if (!match) return null;
  const whole = match[2] ?? "";
  const fractionRaw = match[3] ?? "";
  if (!whole && !fractionRaw) return null;

  const fraction = fractionRaw.slice(0, scale).padEnd(scale, "0");
  let scaled = BigInt((whole || "0") + fraction);

  // Half-up on the first digit we are dropping. '5' is 53; anything higher
  // rounds up too. `charCodeAt` past the end is NaN, which fails the compare.
  const nextDigit = fractionRaw.charCodeAt(scale);
  if (nextDigit >= 53) scaled += BIG_ONE;

  return match[1] === "-" ? -scaled : scaled;
}

function scaledFromValue(value: number | string, scale: number): bigint | null {
  if (typeof value === "string") return scaledFromDecimalText(value, scale);
  if (!Number.isFinite(value)) return null;
  // `String(0.1)` is "0.1" — V8 prints the shortest round-tripping decimal, so
  // this is the closest decimal the double actually denotes. Exponent notation
  // (very large or very small magnitudes) falls back to a fixed rendering.
  const text = String(value);
  return scaledFromDecimalText(/e/i.test(text) ? value.toFixed(scale + 2) : text, scale);
}

/** An amount to whole cents, or null when it is not a usable non-negative money value. */
export function amountToCents(value: number | string | null | undefined): bigint | null {
  if (value === null || value === undefined) return null;
  const cents = scaledFromValue(value, CENT_SCALE);
  if (cents === null || cents < BIG_ZERO) return null;
  return cents;
}

/** Whole cents back to the number a surface prints. Exact for any realistic fund. */
export function centsToAmount(cents: bigint): number {
  return Number(cents) / 100;
}

/**
 * Round-half-up integer division, for non-negative numerators only.
 *
 * Half-up and half-away-from-zero are the same rule while nothing is negative,
 * and nothing here is: amounts, percents and basis values all carry a `>= 0`
 * CHECK in the migration. `divideHalfUp` throws rather than guessing if that
 * ever stops being true, because silently switching rounding direction on a
 * negative is the kind of thing nobody finds for a year.
 */
function divideHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= BIG_ZERO) throw new Error("measure allocation: division by a non-positive denominator");
  if (numerator < BIG_ZERO) throw new Error("measure allocation: negative numerator is not a money quantity here");
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  return remainder * BIG_TWO >= denominator ? quotient + BIG_ONE : quotient;
}

/** percent (as e4) of an amount (as cents), rounded half-up to the cent. */
function percentOfCents(cents: bigint, percentE4: bigint): bigint {
  return divideHalfUp(cents * percentE4, PERCENT_DIVISOR);
}

function absBigInt(value: bigint): bigint {
  return value < BIG_ZERO ? -value : value;
}

/* ------------------------------------------------------------------ *
 * The descriptor
 * ------------------------------------------------------------------ */

const idSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9_-]*$/, "an id must be lower-case letters, digits, hyphen or underscore");

const labelSchema = z.string().trim().min(1).max(200);

/**
 * A percentage with at most four decimal places.
 *
 * Four rather than two because ordinances really do apportion in thirds
 * (33.3333%), and rejecting them would push a legitimate measure onto the
 * narrative escape hatch for no reason. More than four is refused rather than
 * quietly rounded: a rounded percentage is a different ordinance.
 */
const percentSchema = z
  .number()
  .min(0)
  .max(100)
  .refine((value) => {
    // A fifth decimal place shows up as a disagreement between rounding at 4
    // and truncating a wider reading back to 4. Asked this way rather than by
    // counting characters, because the value arrives as a double and its
    // shortest decimal rendering is the only honest thing to count.
    const atScale = scaledFromValue(value, PERCENT_SCALE);
    const wider = scaledFromValue(value, PERCENT_SCALE + 3);
    return atScale !== null && wider !== null && atScale === wider / BIG_THOUSAND;
  }, "a percentage may carry at most four decimal places");

const moneySchema = z.number().min(0);

export const MEASURE_CAP_BASES = ["per_period", "fiscal_year"] as const;
export type MeasureCapBasis = (typeof MEASURE_CAP_BASES)[number];

const offTheTopSchema = z
  .object({
    id: idSchema,
    label: labelSchema,
    /** Either a percentage of the receipt or a flat amount — exactly one. */
    percent: percentSchema.optional(),
    amount: moneySchema.optional(),
    capAmount: moneySchema.optional(),
    capBasis: z.enum(MEASURE_CAP_BASES).optional(),
  })
  .strict();

const reserveSchema = z
  .object({
    id: idSchema,
    label: labelSchema,
    /**
     * 'gross' and 'after_off_the_top' reduce the allocable pool before the
     * categories are cut. 'category:<id>' comes out of that one category and
     * leaves the rest of the split untouched.
     */
    basis: z.union([
      z.literal("gross"),
      z.literal("after_off_the_top"),
      z.string().regex(/^category:[a-z0-9][a-z0-9_-]*$/),
    ]),
    percent: percentSchema,
  })
  .strict();

/**
 * ONE TERM OF A WEIGHTED RETURN-TO-SOURCE FORMULA.
 *
 * "50% by population, 50% by maintained road miles" is the ordinary shape of a
 * California self-help measure's local-streets category, not an exotic one, and
 * until 2026-08-12 the descriptor could hold only ONE basis. An agency whose
 * ordinance names two had to record the whole measure as narrative text and
 * hand-enter every jurisdiction's share forever.
 *
 * The weights are percentages and must total exactly 100 across the factors —
 * the same integer comparison the category split gets, for the same reason.
 */
const returnToSourceFactorSchema = z
  .object({
    basisId: idSchema,
    weight: percentSchema,
  })
  .strict();

/**
 * "NO JURISDICTION SHALL RECEIVE LESS THAN $100,000."
 *
 * A floor per recipient, so a small town's share is a sum it can actually pave
 * with. It redistributes rather than adding money: recipients below the floor
 * come up to it, and the shortfall comes off the recipients above it, pro rata
 * to how far above they are.
 *
 * WHY THE FIELD IS NAMED `amountPerPeriod` AND CARRIES A REQUIRED NOTE. Almost
 * every ordinance states this floor ANNUALLY, and a fund that closes quarterly
 * allocates four times a year. Whether an annual floor becomes a quarter of
 * itself in each quarter, or is trued up in the last period, or is applied to
 * an annual allocation only, is a reading of the ordinance and of the agency's
 * own accounting — the same class of question as `vintageRuleNote` and the
 * fund's `fiscalYearNote`, both of which this product records rather than
 * derives. So the figure stored here is the one that applies to ONE accounting
 * period, a person states it, and `statedRuleNote` is where the ordinance's own
 * words go. A field called `amount` with no note would have let a quarterly
 * measure apply an annual floor four times over and call it the ordinance.
 */
const recipientFloorSchema = z
  .object({
    amountPerPeriod: moneySchema,
    statedRuleNote: z.string().trim().min(1).max(2000),
  })
  .strict();

const distributionSchema = z.union([
  z.object({ kind: z.literal("pooled") }).strict(),
  z
    .object({
      kind: z.literal("return_to_source"),
      /**
       * THE SINGLE-BASIS FORM, KEPT. Every rule recorded before 2026-08-12 is
       * written this way and is stored as JSON in `measure_allocation_rules`;
       * migrating the shape in the database would restate what an agency
       * recorded. `basisId` and `factors` are the same sentence written two
       * ways — exactly one of them, and `measureReturnToSourceFactors` is the
       * one place that turns the first into the second.
       */
      basisId: idSchema.optional(),
      factors: z.array(returnToSourceFactorSchema).min(1).optional(),
      minimumPerRecipient: recipientFloorSchema.optional(),
    })
    .strict(),
]);

const categorySchema = z
  .object({
    id: idSchema,
    label: labelSchema,
    percentOfAllocable: percentSchema,
    distribution: distributionSchema,
  })
  .strict();

const basisDefinitionSchema = z
  .object({
    id: idSchema,
    label: labelSchema,
    /**
     * WHERE THE NUMBER COMES FROM, in the ordinance's own words. Required, and
     * the reason this product never fetches a population and uses it as a
     * divisor: the ordinance names its source, a person states the figure.
     */
    statedSourceNote: z.string().trim().min(1).max(2000),
    /**
     * Which vintage governs a period that straddles a change — an ordinance
     * question recorded as text, never as logic. The caller states the vintage
     * in force; this note is what a planner reads to decide.
     */
    vintageRuleNote: z.string().trim().max(2000).optional(),
    /**
     * WHICH EDITION OF THIS FIGURE THE ORDINANCE SAYS GOVERNS, as a value the
     * product can match rows against — "2029 certified estimate", "FY2030
     * assessor roll".
     *
     * OPTIONAL, and its absence means exactly one thing: the agency's recorded
     * reading of the ordinance does not say. Surfaces must print "not
     * recorded", never a guess. Added 2026-08-12 because the in-workspace
     * measure page was deriving it from `basisValues[0].vintage_label` — the
     * first row of an unordered query — so which edition of a population figure
     * governed a jurisdiction's share of a public fund changed with row order.
     *
     * PER BASIS, not per rule: an ordinance routinely apportions one category
     * on a dated population estimate and another on a certified road-mileage
     * report, and those two are published on different cycles.
     *
     * IT DOES NOT DRIVE THE ALLOCATOR. `basisVintageLabel` is still stated by
     * the caller at allocate time, because applying a vintage to a period is a
     * judgement about a period (see `vintageRuleNote` above, which is what a
     * planner reads to make it) rather than a lookup. This field is what the
     * ordinance recorded; that one is what a person decided for one period.
     */
    vintageInForce: z.string().trim().min(1).max(120).optional(),
  })
  .strict();

const descriptorSchema = z
  .object({
    version: z.literal(1),
    kind: z.literal("descriptor").optional(),
    offTheTop: z.array(offTheTopSchema).default([]),
    reserves: z.array(reserveSchema).default([]),
    categories: z.array(categorySchema).min(1),
    residualCategoryId: idSchema.optional(),
    basisDefinitions: z.array(basisDefinitionSchema).default([]),
  })
  .strict();

const narrativeSchema = z
  .object({
    version: z.literal(1),
    kind: z.literal("narrative"),
    text: z.string().trim().min(1).max(20000),
  })
  .strict();

export type MeasureReturnToSourceDistribution = Extract<
  z.infer<typeof distributionSchema>,
  { kind: "return_to_source" }
>;

export type MeasureAllocationDescriptor = z.infer<typeof descriptorSchema>;
export type MeasureNarrativeRule = z.infer<typeof narrativeSchema>;
export type MeasureAllocationRule = MeasureAllocationDescriptor | MeasureNarrativeRule;

export function isNarrativeRule(rule: MeasureAllocationRule): rule is MeasureNarrativeRule {
  return "kind" in rule && rule.kind === "narrative";
}

/**
 * The ordered factor list a return-to-source category divides by — ONE reading
 * of the two shapes, used by the parser, the allocator and the builder.
 *
 * `{ basisId }` is `[{ basisId, weight: 100 }]`. A second answer to "what does
 * this category divide by?" is precisely the seam this repository keeps finding
 * reimplemented wrongly by whichever caller did not own it.
 */
export function measureReturnToSourceFactors(
  distribution: MeasureReturnToSourceDistribution
): Array<{ basisId: string; weight: number }> {
  if (distribution.factors && distribution.factors.length > 0) {
    return distribution.factors.map((factor) => ({ basisId: factor.basisId, weight: factor.weight }));
  }
  return distribution.basisId ? [{ basisId: distribution.basisId, weight: 100 }] : [];
}

/**
 * A list of percentages summed the way the PARSER sums them — exact integer
 * ten-thousandths, never a float.
 *
 * Exported so the setup form's live meter and `parseMeasureAllocationRule`
 * cannot disagree. A meter that added doubles would show a green "100%" for a
 * split of 33.33 / 33.33 / 33.34 rendered through floating point and then the
 * save would fail with the parser's own sentence, which is the post-submit
 * string this whole builder exists to remove.
 */
export function measurePercentTotal(values: readonly number[]): { total: number; isExactly100: boolean } {
  const scaled = values.reduce(
    (sum, value) => sum + (scaledFromValue(value, PERCENT_SCALE) ?? BIG_ZERO),
    BIG_ZERO
  );
  return {
    total: Number(scaled) / 10 ** PERCENT_SCALE,
    isExactly100: scaled === BIG_HUNDRED * BIG_TEN ** BigInt(PERCENT_SCALE),
  };
}

/**
 * Parse and validate an ordinance rule, THROWING on anything malformed.
 *
 * The `createReimbursementProfileRegistry` precedent (reimbursement-profiles.ts):
 * every failure here is a registration bug, not a runtime condition. A rule
 * whose category percentages sum to 99.9 is not "approximately the ordinance" —
 * it is a reading of the ordinance that would leave money unaccounted for in
 * every period forever, and the only safe moment to refuse it is before it is
 * stored.
 *
 * WHAT IS CHECKED BEYOND THE SHAPE:
 *   - category percentages sum to EXACTLY 100, compared as integer
 *     ten-thousandths so no float epsilon is involved;
 *   - every id is unique within its list;
 *   - every reference resolves — a category reserve's category, a
 *     return-to-source basis, the residual category;
 *   - an off-the-top declares exactly one of `percent` or `amount`, and a
 *     `capAmount` comes with the `capBasis` that says what window it covers.
 */
export function parseMeasureAllocationRule(input: unknown): MeasureAllocationRule {
  const narrative = narrativeSchema.safeParse(input);
  if (narrative.success) return narrative.data;

  const parsed = descriptorSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(`Measure allocation rule is not a valid descriptor: ${parsed.error.issues[0]?.message ?? "unknown"}`);
  }
  const rule = parsed.data;

  const requireUnique = (ids: readonly string[], what: string) => {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) throw new Error(`Measure allocation rule declares duplicate ${what} id "${id}"`);
      seen.add(id);
    }
  };

  requireUnique(rule.offTheTop.map((item) => item.id), "off-the-top");
  requireUnique(rule.reserves.map((item) => item.id), "reserve");
  requireUnique(rule.categories.map((item) => item.id), "category");
  requireUnique(rule.basisDefinitions.map((item) => item.id), "basis definition");

  for (const item of rule.offTheTop) {
    const hasPercent = item.percent !== undefined;
    const hasAmount = item.amount !== undefined;
    if (hasPercent === hasAmount) {
      throw new Error(
        `Measure allocation rule off-the-top "${item.id}" must declare exactly one of percent or amount`
      );
    }
    if ((item.capAmount === undefined) !== (item.capBasis === undefined)) {
      throw new Error(
        `Measure allocation rule off-the-top "${item.id}" must declare capAmount and capBasis together — ` +
          "a cap with no window is a cap nobody can evaluate"
      );
    }
  }

  const categoryIds = new Set(rule.categories.map((item) => item.id));
  const basisIds = new Set(rule.basisDefinitions.map((item) => item.id));

  for (const reserve of rule.reserves) {
    if (!reserve.basis.startsWith("category:")) continue;
    const categoryId = reserve.basis.slice("category:".length);
    if (!categoryIds.has(categoryId)) {
      throw new Error(`Measure allocation rule reserve "${reserve.id}" names unknown category "${categoryId}"`);
    }
  }

  for (const category of rule.categories) {
    if (category.distribution.kind !== "return_to_source") continue;
    const distribution = category.distribution;

    // EXACTLY ONE SHAPE. Both would be two statements of how the category
    // divides, and nothing in the descriptor says which one governs.
    const hasBasisId = distribution.basisId !== undefined;
    const hasFactors = distribution.factors !== undefined;
    if (hasBasisId === hasFactors) {
      throw new Error(
        `Measure allocation rule category "${category.id}" must declare exactly one of basisId or factors — ` +
          "a single apportionment figure, or a weighted list of them"
      );
    }

    const factors = measureReturnToSourceFactors(distribution);
    requireUnique(
      factors.map((factor) => factor.basisId),
      `factor basis in category "${category.id}"`
    );
    for (const factor of factors) {
      if (!basisIds.has(factor.basisId)) {
        throw new Error(
          `Measure allocation rule category "${category.id}" returns to source on unknown basis ` +
            `"${factor.basisId}"`
        );
      }
    }

    // The same exactly-100 rule the category split gets, for the same reason:
    // "approximately the ordinance" leaks the difference in every period.
    // Applied to the declared `factors` only — the single-basis form has one
    // implicit weight of 100 and cannot be wrong.
    if (hasFactors) {
      const weights = measurePercentTotal(factors.map((factor) => factor.weight));
      if (!weights.isExactly100) {
        throw new Error(
          `Measure allocation rule category "${category.id}" weights its apportionment factors to ` +
            `${weights.total}, not to exactly 100`
        );
      }
    }

    if (distribution.minimumPerRecipient && !(distribution.minimumPerRecipient.amountPerPeriod > 0)) {
      throw new Error(
        `Measure allocation rule category "${category.id}" declares a minimum per recipient of ` +
          "zero or less, which is not a floor. Remove it instead."
      );
    }
  }

  if (rule.residualCategoryId && !categoryIds.has(rule.residualCategoryId)) {
    throw new Error(`Measure allocation rule names unknown residual category "${rule.residualCategoryId}"`);
  }

  // EXACTLY 100, compared as integers. "Approximately 100" is a different
  // ordinance and would leak the difference in every period.
  const total = rule.categories.reduce(
    (sum, category) => sum + (scaledFromValue(category.percentOfAllocable, PERCENT_SCALE) ?? BIG_ZERO),
    BIG_ZERO
  );
  if (total !== BIG_HUNDRED * BIG_TEN ** BigInt(PERCENT_SCALE)) {
    throw new Error(
      `Measure allocation rule category percentages must sum to exactly 100 — they sum to ` +
        `${Number(total) / 10 ** PERCENT_SCALE}`
    );
  }

  return rule;
}

/* ------------------------------------------------------------------ *
 * The allocator
 * ------------------------------------------------------------------ */

export type MeasureRecipientLike = { id: string; is_active?: boolean | null };

export type MeasureBasisValueLike = {
  recipient_id: string;
  basis_id: string;
  vintage_label: string;
  basis_value: number | string;
};

/**
 * Fiscal-year context for an off-the-top cap whose window is the fiscal year.
 *
 * `priorTakenByOffTheTopId` is WHAT THE FUND HAS ALREADY TAKEN under each
 * clause in this fiscal year, read from `measure_period_off_the_top` — the
 * period's own row excluded, because this allocation replaces it. It is an
 * exact figure and not a floor: a period nobody allocated took nothing, so an
 * unreported period contributes a true zero rather than an unknown.
 *
 * THIS IS WHY THE WINDOW NO LONGER CARRIES `windowComplete`. Until
 * 20260812000014 nothing persisted what was taken, so the cap was evaluated
 * against RECEIPTS as a proxy, and an incomplete year meant the running total
 * was a floor — the cap looked further away than it was. The answer then was
 * `not_evaluable` plus taking the clause UNCAPPED, which is the wrong way round:
 * a cap that cannot be evaluated became a cap that did not apply. Now the takes
 * themselves are recorded, receipts are irrelevant to the cap, and
 * Σ takes ≤ cap holds at every moment regardless of which periods have been
 * reported.
 *
 * The one property this ordering does have, stated rather than hidden: whichever
 * period is allocated LAST is the one the cap squeezes. That is how an agency
 * administers a running annual cap, and re-allocating an earlier period after a
 * later one will therefore see the later one's take as prior. The alternative —
 * re-deriving every period's take from its receipt on the fly — would compute a
 * figure rather than read the one that was recorded, under whatever rule version
 * is in force today rather than the one that governed then.
 *
 * `priorTakesKnown` is FALSE when the caller could not read them. It exists so
 * that a window cannot be constructed out of nothing and silently behave like a
 * window with no prior takes at all — the defect that made every period's
 * `priorTaken` zero. When it is false the clause is limited to the FULL annual
 * cap for this one period and the caveat travels with the result; it is never
 * taken uncapped, and never pro-rated to a quarter nobody wrote.
 */
export type MeasureCapWindow = {
  priorTakenByOffTheTopId?: Readonly<Record<string, number | string>>;
  priorTakesKnown: boolean;
};

export type MeasureAllocationInput = {
  /**
   * Takes the rule UNION, not just the descriptor, so the narrative escape
   * hatch is refused here rather than being unrepresentable. An ordinance the
   * descriptor cannot express reaches this function in real code paths; the
   * honest answer is "enter these by hand", not a type error at the one call
   * site that remembered to narrow.
   */
  rule: MeasureAllocationRule;
  /** The RECORDED receipt for this period. Never a forecast, never derived. */
  receiptAmount: number | string | null | undefined;
  recipients?: readonly MeasureRecipientLike[];
  basisValues?: readonly MeasureBasisValueLike[];
  /** The vintage in force at the period start — the caller's (ordinance's) call. */
  basisVintageLabel?: string;
  capWindow?: MeasureCapWindow;
};

export type MeasureCapStatus = "no_cap" | "within_cap" | "capped" | "not_evaluable";

export type MeasureOffTheTopLine = {
  id: string;
  label: string;
  /** What is actually taken, after any cap and after clamping to what is left. */
  amount: number;
  /** What the rule alone would have taken. Equal to `amount` unless a cap bit. */
  uncappedAmount: number;
  capAmount: number | null;
  capBasis: MeasureCapBasis | null;
  capStatus: MeasureCapStatus;
};

export type MeasureReserveLine = {
  id: string;
  label: string;
  basis: string;
  /** The ordinance's own rate, carried so a surface can state it without the rule. */
  percent: number;
  /** The figure the percentage was taken of, so a reader can check it. */
  basisAmount: number;
  /** What was actually held back, after clamping to what was left. */
  amount: number;
  /**
   * What the percentage alone came to, before the clamp.
   *
   * The `uncappedAmount`/`amount` pairing an off-the-top line makes, for the one
   * limit a reserve has: it cannot hold back more than remains. They differ
   * exactly when `reserve_exceeds_remaining` fired, and both are needed for a
   * surface to say so without recomputing an old rule against an old receipt.
   */
  computedAmount: number;
};

/** What one recipient contributed to one weighted term of the formula. */
export type MeasureShareFactorValue = {
  basisId: string;
  weight: number;
  basisValue: number;
};

/**
 * WHAT THE FLOOR DID TO ONE RECIPIENT'S SHARE.
 *
 * Reported per recipient rather than only as a total, because "your city was
 * brought up to the floor" and "your city paid for someone else's floor" are
 * two different sentences an oversight committee is owed, and neither can be
 * recovered from the final figure alone.
 */
export type MeasureShareFloorEffect = "none" | "raised_to_floor" | "contributed_to_floors";

export type MeasureRecipientShare = {
  recipientId: string;
  /**
   * The apportionment figure, when the category divides by exactly one. NULL
   * for a weighted multi-factor split, where no single figure is the divisor —
   * `factorValues` carries the terms. Never the first factor standing in for
   * the formula.
   */
  basisValue: number | null;
  factorValues: MeasureShareFactorValue[];
  /** What the ordinance's formula alone gave, before any floor moved money. */
  formulaAmount: number;
  amount: number;
  /** True for the one recipient that absorbed the rounding residual. */
  carriesResidual: boolean;
  floorEffect: MeasureShareFloorEffect;
};

export type MeasureDistributionFactor = {
  basisId: string;
  weight: number;
  /** Σ of the active recipients' figures for this factor — the divisor. */
  basisTotal: number;
};

export type MeasureCategoryDistribution =
  | { kind: "pooled" }
  | {
      kind: "return_to_source";
      /** The single divisor, or null when the split is weighted across several. */
      basisId: string | null;
      factors: MeasureDistributionFactor[];
      vintageLabel: string;
      /** The single factor's divisor, or null when the split is weighted. */
      basisTotal: number | null;
      shares: MeasureRecipientShare[];
      roundingResidual: number;
      /** The ordinance's floor per recipient for one period, or null. */
      minimumPerRecipient: number | null;
      floorOutcome: MeasureFloorOutcome;
    }
  | {
      kind: "undistributed";
      basisId: string | null;
      factors: MeasureDistributionFactor[];
      vintageLabel: string;
      reason: MeasureUndistributedReason;
      missingRecipientIds: string[];
    };

export type MeasureFloorOutcome =
  /** The ordinance states no floor for this category. */
  | "not_declared"
  /** It states one and every share already cleared it. */
  | "not_needed"
  /** It states one, and money moved to meet it. */
  | "applied";

export type MeasureUndistributedReason =
  | "no_active_recipients"
  | "missing_basis_values"
  | "basis_total_is_zero"
  /** The floors together are worth more than the pool being divided. */
  | "recipient_floors_exceed_pool";

export type MeasureCategoryLine = {
  id: string;
  label: string;
  percentOfAllocable: number;
  /** This category's share of the allocable pool, residual included. */
  amount: number;
  reserveAmount: number;
  /** `amount − reserveAmount`: what is distributed or programmed. */
  programmableAmount: number;
  carriesResidual: boolean;
  distribution: MeasureCategoryDistribution;
};

export type MeasureAllocationNoteCode =
  | "off_the_top_cap_not_evaluable"
  | "off_the_top_exceeds_receipt"
  | "reserve_exceeds_remaining"
  /** The pool was too small to give every category a share; see the module header. */
  | "residual_exceeds_residual_category"
  | "category_undistributed"
  /** A floor moved money between recipients; who gained and who paid. */
  | "recipient_floor_applied";

export type MeasureAllocationNote = {
  code: MeasureAllocationNoteCode;
  /** The off-the-top, reserve or category the note is about. */
  subjectId: string;
  /** Staff-facing detail. Resident-facing wording is the oversight lane's. */
  detail: string;
};

export type MeasureAllocationResult = {
  receiptAmount: number;
  offTheTop: MeasureOffTheTopLine[];
  offTheTopTotal: number;
  poolReserves: MeasureReserveLine[];
  poolReserveTotal: number;
  /** receipt − off-the-top − pool reserves. Never negative. */
  allocableAmount: number;
  categories: MeasureCategoryLine[];
  categoryReserves: MeasureReserveLine[];
  /** allocable − Σ naive category shares. Reported, never hidden. */
  roundingResidual: number;
  /** Money a category holds that no recipient could be given. */
  undistributedAmount: number;
  notes: MeasureAllocationNote[];
};

export type MeasureAllocationOutcome =
  | { ok: true; allocation: MeasureAllocationResult }
  | {
      ok: false;
      reason: "receipt_not_recorded" | "narrative_rule" | "basis_vintage_not_stated";
      message: string;
    };

/**
 * The categories whose division DEPENDS on a stated basis vintage.
 *
 * ONE DEFINITION, TWO USERS. `allocateMeasureReceipt` refuses when this list is
 * non-empty and no vintage was stated; the measure page hands the same list to
 * the fund panel so the planner is stopped before they press the button rather
 * than after. A second answer to "does this ordinance need a vintage?" is
 * exactly the seam this repository keeps finding reimplemented wrongly by the
 * caller that did not own it.
 */
export function measureCategoriesNeedingBasisVintage(
  rule: MeasureAllocationRule
): Array<{ id: string; label: string; basisIds: string[] }> {
  if (isNarrativeRule(rule)) return [];
  return rule.categories.flatMap((category) =>
    category.distribution.kind === "return_to_source"
      ? [
          {
            id: category.id,
            label: category.label,
            // Plural since 2026-08-12: a weighted category needs a recorded
            // figure for EVERY factor, and naming only the first would send a
            // planner to fill in half of what the allocation will ask for.
            basisIds: measureReturnToSourceFactors(category.distribution).map((factor) => factor.basisId),
          },
        ]
      : []
  );
}

/**
 * Allocate ONE period's recorded receipt under ONE rule version.
 *
 * Refuses rather than returning zeros when there is no recorded receipt. A
 * period nobody has reported is not a period that received nothing, and an
 * allocation of $0.00 across every category is a sentence about an agency's
 * money that the database does not support.
 */
export function allocateMeasureReceipt(input: MeasureAllocationInput): MeasureAllocationOutcome {
  if (isNarrativeRule(input.rule)) {
    return {
      ok: false,
      reason: "narrative_rule",
      message:
        "This ordinance is recorded as narrative text because its split cannot be expressed as a rule. " +
        "Its allocations are entered by hand and are labelled staff-entered wherever they appear.",
    };
  }

  const receiptCents = amountToCents(input.receiptAmount);
  if (receiptCents === null) {
    return {
      ok: false,
      reason: "receipt_not_recorded",
      message:
        "No receipt has been recorded for this period, so there is nothing to allocate. " +
        "An unreported amount is not zero.",
    };
  }

  const rule = input.rule;

  /*
   * ============================================================================
   * A BLANK VINTAGE IS A REFUSAL, NOT AN EMPTY DISTRIBUTION
   * ============================================================================
   *
   * `basisVintageLabel` is matched against `measure_recipient_basis_values
   * .vintage_label` exactly. Unstated, it was "" — which matches no recorded
   * figure, so EVERY active recipient counted as missing one, so every
   * return-to-source category came out `undistributed` and the cities and
   * districts received nothing. A planner allocating a quarter of real money
   * got a whole set of $0 shares and a note, on a path where the honest answer
   * is that the request cannot be carried out.
   *
   * That was the same failure as a missing denominator term, one level up: the
   * absent value was treated as a value. Here the absence is fatal to the whole
   * request rather than to one term, so it is refused at the door.
   *
   * ONLY WHEN A RULE ACTUALLY NEEDS IT. An ordinance with no return-to-source
   * category never reads a basis figure, and a measure with no active recipient
   * has no figure to read: in both cases a blank vintage changes nothing and
   * refusing would block a legitimate allocation. `measure-allocation-
   * arithmetic.test.ts` allocates a recorded 0.00 through exactly that second
   * case.
   */
  const statedVintage = input.basisVintageLabel?.trim() ?? "";
  const vintageDependent = measureCategoriesNeedingBasisVintage(rule);
  const hasActiveRecipient = (input.recipients ?? []).some((recipient) => recipient.is_active !== false);
  if (!statedVintage && vintageDependent.length > 0 && hasActiveRecipient) {
    const named = vintageDependent
      .map((category) => `${category.label} (by ${category.basisIds.join(" and ")})`)
      .join(", ");
    return {
      ok: false,
      reason: "basis_vintage_not_stated",
      message:
        "Name which edition of the apportionment figures governs this period before allocating it. " +
        `${vintageDependent.length} ${vintageDependent.length === 1 ? "category" : "categories"} in this ` +
        `ordinance ${vintageDependent.length === 1 ? "is" : "are"} returned to source — ${named} — and no ` +
        "recorded figure matches a blank edition, so those categories would be held undistributed and the " +
        "recipients would be allocated nothing. Which edition governs a period is the ordinance's call and " +
        "is recorded per period, so this product will not choose one.",
    };
  }

  const notes: MeasureAllocationNote[] = [];

  /* 1. OFF THE TOP -------------------------------------------------- */
  const offTheTop: MeasureOffTheTopLine[] = [];
  let offTheTopTotal = BIG_ZERO;

  for (const item of rule.offTheTop) {
    const uncapped =
      item.percent !== undefined
        ? percentOfCents(receiptCents, scaledFromValue(item.percent, PERCENT_SCALE) ?? BIG_ZERO)
        : (amountToCents(item.amount ?? 0) ?? BIG_ZERO);

    const capCents = item.capAmount === undefined ? null : amountToCents(item.capAmount);
    const capBasis = item.capBasis ?? null;

    let taken = uncapped;
    let capStatus: MeasureCapStatus = "no_cap";

    if (capCents !== null && capBasis === "per_period") {
      capStatus = uncapped > capCents ? "capped" : "within_cap";
      taken = uncapped > capCents ? capCents : uncapped;
    } else if (capCents !== null && capBasis === "fiscal_year") {
      if (!input.capWindow || !input.capWindow.priorTakesKnown) {
        // NOT UNCAPPED. Without the year's recorded takes the running total is
        // unknown, so the annual cap cannot be enforced — but the ANNUAL CAP IS
        // STILL AN UPPER BOUND ON ONE PERIOD, and applying it here is the only
        // limit available that the ordinance actually wrote. Taking the clause
        // in full instead, as this branch used to, turns a cap that cannot be
        // evaluated into a cap that does not apply, which is the failure in the
        // direction that overtakes.
        capStatus = "not_evaluable";
        taken = uncapped > capCents ? capCents : uncapped;
        notes.push({
          code: "off_the_top_cap_not_evaluable",
          subjectId: item.id,
          detail:
            `The ${item.label} cap is set for the fiscal year and what has already been taken this ` +
            "year could not be read, so the cap could not be enforced across the year. This period " +
            `was limited to the full annual cap on its own; the year's total may still exceed it.`,
        });
      } else {
        const priorTaken = amountToCents(input.capWindow.priorTakenByOffTheTopId?.[item.id] ?? 0) ?? BIG_ZERO;
        const remainingCap = capCents > priorTaken ? capCents - priorTaken : BIG_ZERO;
        capStatus = uncapped > remainingCap ? "capped" : "within_cap";
        taken = uncapped > remainingCap ? remainingCap : uncapped;
      }
    }

    // Never take more than is left of the receipt: a negative allocable pool is
    // not a number any surface can render honestly.
    const remaining = receiptCents - offTheTopTotal;
    if (taken > remaining) {
      notes.push({
        code: "off_the_top_exceeds_receipt",
        subjectId: item.id,
        detail:
          `${item.label} would take more than the receipt has left. It was limited to the ` +
          "remaining balance; the ordinance rule and the recorded receipt disagree.",
      });
      taken = remaining;
    }

    offTheTopTotal += taken;
    offTheTop.push({
      id: item.id,
      label: item.label,
      amount: centsToAmount(taken),
      uncappedAmount: centsToAmount(uncapped),
      capAmount: capCents === null ? null : centsToAmount(capCents),
      capBasis,
      capStatus,
    });
  }

  /* 2. POOL RESERVES ------------------------------------------------ */
  const afterOffTheTop = receiptCents - offTheTopTotal;
  const poolReserves: MeasureReserveLine[] = [];
  let poolReserveTotal = BIG_ZERO;

  for (const reserve of rule.reserves) {
    if (reserve.basis !== "gross" && reserve.basis !== "after_off_the_top") continue;

    const basisCents = reserve.basis === "gross" ? receiptCents : afterOffTheTop;
    const computed = percentOfCents(basisCents, scaledFromValue(reserve.percent, PERCENT_SCALE) ?? BIG_ZERO);
    let amount = computed;

    const remaining = afterOffTheTop - poolReserveTotal;
    if (amount > remaining) {
      notes.push({
        code: "reserve_exceeds_remaining",
        subjectId: reserve.id,
        detail:
          `${reserve.label} would hold back more than remains after the off-the-top deductions. ` +
          "It was limited to the remaining balance.",
      });
      amount = remaining;
    }

    poolReserveTotal += amount;
    poolReserves.push({
      id: reserve.id,
      label: reserve.label,
      basis: reserve.basis,
      percent: reserve.percent,
      basisAmount: centsToAmount(basisCents),
      amount: centsToAmount(amount),
      computedAmount: centsToAmount(computed),
    });
  }

  const allocableCents = afterOffTheTop - poolReserveTotal;

  /* 3. CATEGORIES --------------------------------------------------- */
  // The residual lands on the declared residual category, or — when the
  // ordinance names none — on the last category by id ascending. A rule, not a
  // preference: the same input must produce the same cent in the same place on
  // every machine and every run.
  const residualCategoryId =
    rule.residualCategoryId ?? [...rule.categories].map((category) => category.id).sort().at(-1) ?? null;

  const naiveShares = new Map<string, bigint>();
  let naiveTotal = BIG_ZERO;
  for (const category of rule.categories) {
    const share = percentOfCents(allocableCents, scaledFromValue(category.percentOfAllocable, PERCENT_SCALE) ?? BIG_ZERO);
    naiveShares.set(category.id, share);
    naiveTotal += share;
  }
  // REPORTED AS COMPUTED, before placement. `roundingResidual` is the fact
  // "half-up over- or under-allocated the pool by this much"; where the cents
  // ended up is a separate question the categories themselves answer.
  const roundingResidual = allocableCents - naiveTotal;

  // Placement, with the floor. See the module header for the rule and for what
  // a $0.02 pool across four equal categories owes. `spilledCategoryIds` stays
  // empty in every ordinary period — a residual is at most a cent or two and
  // any real category absorbs it — and is non-empty exactly when the pool was
  // too small to express the ordinance's split at all.
  const spilledCategoryIds: string[] = [];
  let residualToPlace = roundingResidual;
  if (residualCategoryId && residualToPlace !== BIG_ZERO) {
    const place = (categoryId: string): void => {
      const current = naiveShares.get(categoryId) ?? BIG_ZERO;
      const next = current + residualToPlace;
      if (next >= BIG_ZERO) {
        naiveShares.set(categoryId, next);
        residualToPlace = BIG_ZERO;
        return;
      }
      // This category cannot absorb the whole clawback. It goes to zero and
      // what is left of the negative residual moves on.
      naiveShares.set(categoryId, BIG_ZERO);
      residualToPlace = next;
      spilledCategoryIds.push(categoryId);
    };

    place(residualCategoryId);
    // Id ascending, so the same input places the same cent in the same category
    // on every machine and every run — the rule the residual category itself
    // follows when the ordinance names none.
    for (const categoryId of rule.categories.map((category) => category.id).sort()) {
      if (residualToPlace === BIG_ZERO) break;
      if (categoryId === residualCategoryId) continue;
      place(categoryId);
    }
  }

  if (spilledCategoryIds.length > 0) {
    notes.push({
      code: "residual_exceeds_residual_category",
      subjectId: residualCategoryId ?? spilledCategoryIds[0],
      detail:
        `The amount left to divide (${centsToAmount(allocableCents).toFixed(2)}) is too small to give every ` +
        "category in the ordinance a share at the stated percentages. Rounding each share up would have " +
        `allocated more than the period received, so ${spilledCategoryIds.length} category or categories ` +
        `(${spilledCategoryIds.join(", ")}) were reduced to nothing rather than recorded as a negative ` +
        "amount. Every cent is still allocated.",
    });
  }

  /* 4. CATEGORY RESERVES -------------------------------------------- */
  const categoryReserves: MeasureReserveLine[] = [];
  const reserveByCategory = new Map<string, bigint>();
  for (const reserve of rule.reserves) {
    if (!reserve.basis.startsWith("category:")) continue;
    const categoryId = reserve.basis.slice("category:".length);
    const categoryCents = naiveShares.get(categoryId) ?? BIG_ZERO;
    const computed = percentOfCents(categoryCents, scaledFromValue(reserve.percent, PERCENT_SCALE) ?? BIG_ZERO);
    let amount = computed;

    const remaining = categoryCents - (reserveByCategory.get(categoryId) ?? BIG_ZERO);
    if (amount > remaining) {
      notes.push({
        code: "reserve_exceeds_remaining",
        subjectId: reserve.id,
        detail: `${reserve.label} would hold back more than its category received. It was limited to that category.`,
      });
      amount = remaining;
    }

    reserveByCategory.set(categoryId, (reserveByCategory.get(categoryId) ?? BIG_ZERO) + amount);
    categoryReserves.push({
      id: reserve.id,
      label: reserve.label,
      basis: reserve.basis,
      percent: reserve.percent,
      basisAmount: centsToAmount(categoryCents),
      amount: centsToAmount(amount),
      computedAmount: centsToAmount(computed),
    });
  }

  /* 5. RETURN TO SOURCE --------------------------------------------- */
  const activeRecipients = (input.recipients ?? [])
    .filter((recipient) => recipient.is_active !== false)
    .map((recipient) => recipient.id)
    .sort();
  // The trimmed reading, so the refusal above and the match below cannot
  // disagree about what "stated" means.
  const vintageLabel = statedVintage;

  const categories: MeasureCategoryLine[] = [];
  let undistributedCents = BIG_ZERO;

  for (const category of rule.categories) {
    const amountCents = naiveShares.get(category.id) ?? BIG_ZERO;
    const reserveCents = reserveByCategory.get(category.id) ?? BIG_ZERO;
    const programmableCents = amountCents - reserveCents;

    let distribution: MeasureCategoryDistribution = { kind: "pooled" };

    if (category.distribution.kind === "return_to_source") {
      const factorList = measureReturnToSourceFactors(category.distribution);
      const floorRule = category.distribution.minimumPerRecipient ?? null;

      /*
       * ONE DIVISOR PER FACTOR. The recorded figures are read once per factor
       * and the active recipients' figures are summed into that factor's
       * denominator — which is why a factor a recipient has no figure for makes
       * the WHOLE category undistributed rather than that one term zero.
       */
      const factorReadings = factorList.map((factor) => {
        const byRecipient = new Map<string, bigint>();
        for (const value of input.basisValues ?? []) {
          if (value.basis_id !== factor.basisId || value.vintage_label !== vintageLabel) continue;
          const scaled = scaledFromValue(value.basis_value, BASIS_SCALE);
          if (scaled === null || scaled < BIG_ZERO) continue;
          byRecipient.set(value.recipient_id, scaled);
        }
        return {
          basisId: factor.basisId,
          weightE4: scaledFromValue(factor.weight, PERCENT_SCALE) ?? BIG_ZERO,
          weight: factor.weight,
          byRecipient,
          total: activeRecipients.reduce((sum, id) => sum + (byRecipient.get(id) ?? BIG_ZERO), BIG_ZERO),
        };
      });

      const missing = activeRecipients.filter((id) =>
        factorReadings.some((factor) => !factor.byRecipient.has(id))
      );
      const reportedFactors: MeasureDistributionFactor[] = factorReadings.map((factor) => ({
        basisId: factor.basisId,
        weight: factor.weight,
        basisTotal: Number(factor.total) / 10 ** BASIS_SCALE,
      }));
      // The single-divisor convenience fields, and NULL rather than the first
      // factor when there is more than one: no single figure is the divisor of
      // a weighted split, and printing one as if it were would misstate the
      // ordinance on every surface that reads it.
      const singleBasisId = factorReadings.length === 1 ? factorReadings[0]!.basisId : null;
      const singleBasisTotal = factorReadings.length === 1 ? reportedFactors[0]!.basisTotal : null;

      const floorCents = floorRule ? amountToCents(floorRule.amountPerPeriod) : null;
      const floorsRequired = floorCents === null ? BIG_ZERO : floorCents * BigInt(activeRecipients.length);

      const reason: MeasureUndistributedReason | null =
        activeRecipients.length === 0
          ? "no_active_recipients"
          : missing.length > 0
            ? "missing_basis_values"
            : factorReadings.some((factor) => factor.total === BIG_ZERO)
              ? "basis_total_is_zero"
              : floorCents !== null && floorsRequired > programmableCents
                ? "recipient_floors_exceed_pool"
                : null;

      if (reason) {
        // NOT split among the recipients that DO have a figure. Dropping a term
        // from the denominator inflates every remaining share, in the direction
        // that overpays, and nothing on the page would say so.
        undistributedCents += programmableCents;
        distribution = {
          kind: "undistributed",
          basisId: singleBasisId,
          factors: reportedFactors,
          vintageLabel,
          reason,
          missingRecipientIds: missing,
        };
        const namedBases = factorReadings.map((factor) => factor.basisId).join(" and ");
        notes.push({
          code: "category_undistributed",
          subjectId: category.id,
          detail:
            reason === "missing_basis_values"
              ? `${category.label} could not be distributed: ${missing.length} active recipient(s) have no ` +
                `${namedBases} figure recorded for vintage "${vintageLabel}". The money is allocated to the ` +
                "category and held undistributed rather than being split among the rest."
              : reason === "no_active_recipients"
                ? `${category.label} returns to source but the measure has no active recipients.`
                : reason === "basis_total_is_zero"
                  ? `${category.label} could not be distributed: every recorded ${namedBases} figure is zero.`
                  : /*
                     * THE FLOORS DO NOT FIT, AND THIS PRODUCT WILL NOT PICK WHO GOES SHORT.
                     *
                     * See "when the floors cannot all be met" in the module
                     * header. The ordinance's own text is unsatisfiable for this
                     * period, and every way of resolving it is a policy choice
                     * the ordinance did not make.
                     */
                    `${category.label} could not be distributed: the ordinance guarantees each recipient at ` +
                    `least ${centsToAmount(floorCents ?? BIG_ZERO).toFixed(2)} for a period, which comes to ` +
                    `${centsToAmount(floorsRequired).toFixed(2)} for ${activeRecipients.length} active ` +
                    `recipients, and only ${centsToAmount(programmableCents).toFixed(2)} is available to ` +
                    `divide — short by ${centsToAmount(floorsRequired - programmableCents).toFixed(2)}. ` +
                    "Which recipients go without is a decision for the board, not an arithmetic rule, so " +
                    "the money is held and the shares for this period are entered by hand with a rationale.",
        });
      } else {
        /*
         * THE WEIGHTED FORMULA, OVER ONE COMMON DENOMINATOR.
         *
         *   share_r = pool × Σ_f ( weight_f / 100 ) × ( value_rf / total_f )
         *
         * evaluated as ONE exact rational per recipient and rounded half-up
         * ONCE, rather than as a per-factor sum of already-rounded amounts.
         * Rounding each term and adding them would round f times per recipient
         * and put the error in a place nothing reports.
         *
         *   D          = 100·10⁴ × Π_f total_f
         *   numerator_r = Σ_f weight-e4_f × value_rf × Π_{g≠f} total_g
         *
         * `productOfTotals / factor.total` is exact because `factor.total` is
         * one of the factors of that product. With exactly one factor the whole
         * expression reduces algebraically to `pool × value_r / total` — the
         * single-basis arithmetic that shipped before 2026-08-12, unchanged to
         * the cent, which `measure-allocation-arithmetic.test.ts` pins by
         * running the same ordinance through both spellings.
         */
        const productOfTotals = factorReadings.reduce((product, factor) => product * factor.total, BIG_ONE);
        const denominator = PERCENT_DIVISOR * productOfTotals;

        const shareCents = new Map<string, bigint>();
        let naiveShareTotal = BIG_ZERO;
        for (const recipientId of activeRecipients) {
          let numerator = BIG_ZERO;
          for (const factor of factorReadings) {
            const otherTotals = productOfTotals / factor.total;
            numerator += factor.weightE4 * (factor.byRecipient.get(recipientId) ?? BIG_ZERO) * otherTotals;
          }
          const share = divideHalfUp(programmableCents * numerator, denominator);
          shareCents.set(recipientId, share);
          naiveShareTotal += share;
        }
        // The pool's residual goes to the recipient LAST BY ID ASCENDING —
        // deterministic, so the same period allocates the same cent to the same
        // jurisdiction every time it is recomputed.
        const poolResidual = programmableCents - naiveShareTotal;
        const residualRecipientId = activeRecipients.at(-1) ?? null;
        if (residualRecipientId && poolResidual !== BIG_ZERO) {
          shareCents.set(residualRecipientId, (shareCents.get(residualRecipientId) ?? BIG_ZERO) + poolResidual);
        }

        // What the formula alone gave, kept before the floor moves anything.
        const formulaCents = new Map(shareCents);
        const floorEffects = new Map<string, MeasureShareFloorEffect>();
        let floorOutcome: MeasureFloorOutcome = floorCents === null ? "not_declared" : "not_needed";

        if (floorCents !== null) {
          const deficient = activeRecipients.filter((id) => (shareCents.get(id) ?? BIG_ZERO) < floorCents);
          if (deficient.length > 0) {
            floorOutcome = "applied";
            /*
             * WHO PAYS FOR THE FLOOR, AND IN WHAT PROPORTION.
             *
             * Everyone above the floor pays, pro rata to HEADROOM (how far
             * above the floor they are) rather than to their whole share. Pro
             * rata to the share would take from a recipient sitting a dollar
             * above the floor at the same rate as one sitting far above it, and
             * push the first one below the floor the clause exists to hold.
             *
             * NO ITERATION, AND NONE IS NEEDED. `totalShortfall −
             * totalHeadroom` is identically `recipients × floor − pool`, which
             * the `recipient_floors_exceed_pool` refusal above has already
             * proved is not positive; so the headroom always covers the
             * shortfall, no donor is asked for more than it has, and the naive
             * "raise everyone short, then reduce everyone else, then notice
             * someone new is short" fixpoint loop cannot arise.
             */
            const donors = activeRecipients.filter((id) => (shareCents.get(id) ?? BIG_ZERO) > floorCents);
            const headroom = new Map(
              donors.map((id) => [id, (shareCents.get(id) ?? BIG_ZERO) - floorCents] as const)
            );
            const totalShortfall = deficient.reduce(
              (sum, id) => sum + (floorCents - (shareCents.get(id) ?? BIG_ZERO)),
              BIG_ZERO
            );
            const totalHeadroom = donors.reduce((sum, id) => sum + (headroom.get(id) ?? BIG_ZERO), BIG_ZERO);

            const contribution = new Map<string, bigint>();
            let contributed = BIG_ZERO;
            for (const id of donors) {
              const share = divideHalfUp(totalShortfall * (headroom.get(id) ?? BIG_ZERO), totalHeadroom);
              contribution.set(id, share);
              contributed += share;
            }
            /*
             * Half-up per donor can miss the shortfall by a cent or two in
             * either direction. The remainder is placed on the donors in id
             * ascending order — deterministic — and bounded by each donor's
             * remaining headroom so no contribution can push a donor below the
             * floor it is paying for.
             *
             * THE BOUND IS NOT PROVEN COVERAGE, AND SAYING SO IS THE POINT.
             * Replacing `room` with the whole remainder survives the mutation
             * battery: in every fixture, and in a 32-million-configuration
             * search over donor headrooms, the FIRST donor by id always had
             * room for the whole leftover, so the walk never reached a second
             * donor and the clamp never bit. The algebra points the same way —
             * a saturated first donor forces the rounding error to zero. It is
             * kept anyway, because the failure it would prevent is a recipient
             * finishing a cent below the guarantee the clause exists to make,
             * and one `min` is a cheap price for a bound nobody has to trust.
             */
            let toPlace = totalShortfall - contributed;
            for (const id of donors) {
              if (toPlace === BIG_ZERO) break;
              const current = contribution.get(id) ?? BIG_ZERO;
              const room = toPlace > BIG_ZERO ? (headroom.get(id) ?? BIG_ZERO) - current : current;
              const magnitude = absBigInt(toPlace) < room ? absBigInt(toPlace) : room;
              const step = toPlace > BIG_ZERO ? magnitude : -magnitude;
              contribution.set(id, current + step);
              toPlace -= step;
            }

            for (const id of deficient) {
              shareCents.set(id, floorCents);
              floorEffects.set(id, "raised_to_floor");
            }
            for (const id of donors) {
              const given = contribution.get(id) ?? BIG_ZERO;
              if (given === BIG_ZERO) continue;
              shareCents.set(id, (shareCents.get(id) ?? BIG_ZERO) - given);
              floorEffects.set(id, "contributed_to_floors");
            }

            notes.push({
              code: "recipient_floor_applied",
              subjectId: category.id,
              detail:
                `${category.label} guarantees each recipient at least ` +
                `${centsToAmount(floorCents).toFixed(2)} for a period. ` +
                `${deficient.length} recipient(s) came in under that and were brought up to it; the ` +
                `${centsToAmount(totalShortfall).toFixed(2)} that took was met by the ` +
                `${donors.length} recipient(s) above the floor, in proportion to how far above it they ` +
                `were. Nothing was added to the fund. The ordinance's own words: "${floorRule?.statedRuleNote ?? ""}"`,
            });
          }
        }

        /*
         * THE INVARIANT, CHECKED RATHER THAN ASSUMED. Every branch above is
         * supposed to move money between recipients and never create or destroy
         * it. A throw here is a crash on a fund page, which is the correct
         * outcome: the alternative is writing a set of shares that does not add
         * up to the money the category holds, and nothing downstream would say
         * so. `divideHalfUp` takes the same posture one level down.
         */
        const distributedTotal = activeRecipients.reduce(
          (sum, id) => sum + (shareCents.get(id) ?? BIG_ZERO),
          BIG_ZERO
        );
        if (distributedTotal !== programmableCents) {
          throw new Error(
            `measure allocation: category "${category.id}" distributed ` +
              `${centsToAmount(distributedTotal).toFixed(2)} of ` +
              `${centsToAmount(programmableCents).toFixed(2)}`
          );
        }

        distribution = {
          kind: "return_to_source",
          basisId: singleBasisId,
          factors: reportedFactors,
          vintageLabel,
          basisTotal: singleBasisTotal,
          roundingResidual: centsToAmount(poolResidual),
          minimumPerRecipient: floorCents === null ? null : centsToAmount(floorCents),
          floorOutcome,
          shares: activeRecipients.map((recipientId) => ({
            recipientId,
            basisValue:
              factorReadings.length === 1
                ? Number(factorReadings[0]!.byRecipient.get(recipientId) ?? BIG_ZERO) / 10 ** BASIS_SCALE
                : null,
            factorValues: factorReadings.map((factor) => ({
              basisId: factor.basisId,
              weight: factor.weight,
              basisValue: Number(factor.byRecipient.get(recipientId) ?? BIG_ZERO) / 10 ** BASIS_SCALE,
            })),
            formulaAmount: centsToAmount(formulaCents.get(recipientId) ?? BIG_ZERO),
            amount: centsToAmount(shareCents.get(recipientId) ?? BIG_ZERO),
            carriesResidual: poolResidual !== BIG_ZERO && recipientId === residualRecipientId,
            floorEffect: floorEffects.get(recipientId) ?? "none",
          })),
        };
      }
    }

    categories.push({
      id: category.id,
      label: category.label,
      percentOfAllocable: category.percentOfAllocable,
      amount: centsToAmount(amountCents),
      reserveAmount: centsToAmount(reserveCents),
      programmableAmount: centsToAmount(programmableCents),
      carriesResidual: roundingResidual !== BIG_ZERO && category.id === residualCategoryId,
      distribution,
    });
  }

  return {
    ok: true,
    allocation: {
      receiptAmount: centsToAmount(receiptCents),
      offTheTop,
      offTheTopTotal: centsToAmount(offTheTopTotal),
      poolReserves,
      poolReserveTotal: centsToAmount(poolReserveTotal),
      allocableAmount: centsToAmount(allocableCents),
      categories,
      categoryReserves,
      roundingResidual: centsToAmount(roundingResidual),
      undistributedAmount: centsToAmount(undistributedCents),
      notes,
    },
  };
}

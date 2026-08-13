import { describe, expect, it } from "vitest";
import {
  allocateMeasureReceipt,
  measureCategoriesNeedingBasisVintage,
  measurePercentTotal,
  measureReturnToSourceFactors,
  parseMeasureAllocationRule,
  type MeasureAllocationDescriptor,
  type MeasureAllocationResult,
} from "@/lib/measures/allocation";

/**
 * TWO RULES REAL SELF-HELP ORDINANCES USE, PINNED TO THE CENT.
 *
 * ============================================================================
 * WHY THESE TWO AND NOT OTHERS
 * ============================================================================
 *
 * The descriptor could express a return-to-source category dividing by exactly
 * ONE figure, and no floor at all. Both gaps are ordinary rather than exotic in
 * California self-help measures: "50% population, 50% maintained road miles" is
 * the standard local-streets formula, and "no jurisdiction shall receive less
 * than $100,000 annually" is how a small town gets a share it can pave with.
 * An agency with either had to record the whole ordinance as narrative text and
 * hand-enter every jurisdiction's share for the life of the measure — which
 * makes the module decorative for exactly the measures it was built for.
 *
 * ============================================================================
 * HOW THESE NUMBERS WERE PRODUCED
 * ============================================================================
 *
 * Every expected value below was derived BEFORE the allocator was changed, with
 * a separate exact-rational derivation (Python `Fraction`, rounded half-up once
 * at the end) that shares no code and no algorithm with `allocation.ts` — the
 * implementation works in scaled BigInt integers over a common denominator.
 * Two different arithmetics agreeing is the evidence; a test that recomputed
 * the answer the way the code does would prove only self-consistency.
 *
 * The long divisions are written out in the fixture headers so a reader can
 * check them on paper without running anything.
 *
 * ============================================================================
 * MUTATIONS RUN (verified by breaking `allocation.ts`, running, restoring —
 * each line is what ACTUALLY happened, not a prediction)
 * ============================================================================
 *
 * 22 mutations plus a negative control, driven from a harness that read
 * `subprocess.returncode` rather than an exit code through a pipe. 20 killed.
 *
 * FOUR OF THEM ALSO BREAK `measure-allocation-arithmetic.test.ts` — the
 * single-basis fixtures run through the same weighted expression, which is the
 * strongest available evidence that the old spelling was not forked off onto a
 * quiet second code path.
 *
 *  M1  drop `factor.weightE4 *` from the numerator (all factors weigh the same)
 *      => "expected 1905684.81 to be 0.01" (Cedar Basin's residual) and
 *         "expected [0.18, 269246.49] to deeply equal [181146.44, 88100.23]".
 *  M2  `productOfTotals / factor.total` -> `productOfTotals`
 *      => "expected 1877139523084200 to be 935296.22".
 *  M3  drop `PERCENT_DIVISOR *` from the common denominator
 *      => "expected 935296224755.46 to be 935296.22".
 *  M4  single-basis factor weight 100 -> 50
 *      => "expected 467648.11 to be 935296.22" — exactly half, in the old
 *         fixtures, which is the migration path failing loudly.
 *  M5  never read `distribution.factors`
 *      => `Measure allocation rule category "road_repair" weights its
 *         apportionment factors to 0, not to exactly 100` — the weighted
 *         fixtures cannot be constructed at all.
 *  M6  accept factor weights that do not total 100 => "expected [Function] to
 *      throw an error".
 *  M7  accept a category declaring BOTH basisId and factors => two refusals
 *      fail, both "expected [Function] to throw an error".
 *  M8  `some` -> `every` in the missing-figure scan
 *      => "expected 'return_to_source' to be 'undistributed'": the category
 *         divided with a term missing from one denominator.
 *  M9  clawback pro rata to the whole SHARE instead of to headroom above the
 *      floor => "expected 188726 to be 194298.25", plus both cent fixtures.
 *  M10 never place the leftover cent of the clawback => killed by the balance
 *      invariant: "distributed 482357.61 of 482357.60" and "483070.30 of
 *      483070.31" — a cent conjured and a cent lost.
 *  M11 do not raise the deficient to the floor
 *      => "distributed 916000.00 of 1000000.00".
 *  M12 donors never pay => "distributed 1084000.00 of 1000000.00".
 *  M13 do not refuse floors that exceed the pool => "expected
 *      'return_to_source' to be 'undistributed'", and on the floor-bigger-
 *      than-the-pool fixture "distributed 400000.00 of 60000.00".
 *  M14 `>` -> `>=` on the floors-fit test => "category local_streets did not
 *      distribute (undistributed)": the exactly-fits period was held back.
 *  M15 SURVIVED — see below.
 *  M16 take the `formulaAmount` snapshot after the floor moved money
 *      => "expected 100000 to be 16000".
 *  M17 report the first factor as THE divisor of a weighted split
 *      => "expected 'population' to be null".
 *  M18 accept a floor of zero => "expected [Function] to throw an error".
 *  M19 drop the duplicate-factor-basis check => "expected [Function] to throw
 *      an error".
 *  M20 compare the percentage total as floats => "expected { total: 100,
 *      isExactly100: false } to deeply equal { total: 100, isExactly100: true }"
 *      on 28.1 / 35.95 / 35.95.
 *  M21 name only the first factor in the vintage refusal => the refusal message
 *      no longer contains "population and road_miles".
 *  M22 SURVIVED — see below.
 *  NEGATIVE CONTROL, a comment-only edit => everything still passes, which is
 *      how this battery shows it is not simply reporting red for any change.
 *
 * THE TWO SURVIVORS, STATED RATHER THAN HIDDEN:
 *
 *  M15 replaced the diff walk's headroom clamp with the whole remainder and
 *      nothing failed. The clamp is a bound no input in this file — or in a
 *      32-million-configuration search over donor headrooms — reaches, because
 *      the first donor by id always had room for the leftover cent. It is kept
 *      as a bound rather than as tested behaviour, and `allocation.ts` says so
 *      at the line. This test file proves nothing about it.
 *  M22 deleted the balance-invariant throw and nothing failed, which is
 *      correct: it is a net under the arithmetic, not a rule of its own. M10,
 *      M11, M12 and M13 are the evidence it is live — all four were caught by
 *      it and by nothing else, which is also why no assertion here names it.
 */

/* ------------------------------------------------------------------ *
 * Helpers — integer cents, so a float residue cannot pass for equality
 * ------------------------------------------------------------------ */

function cents(value: number): number {
  return Math.round(value * 100);
}

function sumCents(values: readonly number[]): number {
  return values.reduce((total, value) => total + cents(value), 0);
}

function unwrap(outcome: ReturnType<typeof allocateMeasureReceipt>): MeasureAllocationResult {
  if (!outcome.ok) throw new Error(`allocation refused: ${outcome.reason} — ${outcome.message}`);
  return outcome.allocation;
}

function categoryById(result: MeasureAllocationResult, id: string) {
  const category = result.categories.find((entry) => entry.id === id);
  if (!category) throw new Error(`no category ${id} in the allocation`);
  return category;
}

function sharesOf(result: MeasureAllocationResult, categoryId: string) {
  const distribution = categoryById(result, categoryId).distribution;
  if (distribution.kind !== "return_to_source") {
    throw new Error(`category ${categoryId} did not distribute (${distribution.kind})`);
  }
  return distribution;
}

function amountsByRecipient(result: MeasureAllocationResult, categoryId: string): Record<string, number> {
  return Object.fromEntries(sharesOf(result, categoryId).shares.map((share) => [share.recipientId, share.amount]));
}

/* ------------------------------------------------------------------ *
 * FIXTURE E — the Hallowmere County Road Repair Measure
 *
 * Weighted two-factor apportionment: 60% by population, 40% by maintained
 * road miles. UUID recipient ids, ascending in the same order as the names, so
 * "last by id ascending" is readable in the derivation. Invented jurisdictions
 * with realistic spellings — a pretend registry with placeholder spellings has
 * hidden a defect in this repository before.
 * ------------------------------------------------------------------ */

const HALLOWMERE_ASTERLY = "55555555-5555-4555-8555-555555555555";
const HALLOWMERE_BRINDLE = "66666666-6666-4666-8666-666666666666";
const HALLOWMERE_CULLEN = "77777777-7777-4777-8777-777777777777";
const HALLOWMERE_VINTAGE = "2032 certified estimate";

const hallowmereRecipients = [
  { id: HALLOWMERE_ASTERLY, is_active: true },
  { id: HALLOWMERE_BRINDLE, is_active: true },
  { id: HALLOWMERE_CULLEN, is_active: true },
];

const hallowmereBasisValues = [
  { recipient_id: HALLOWMERE_ASTERLY, basis_id: "population", vintage_label: HALLOWMERE_VINTAGE, basis_value: "41880" },
  { recipient_id: HALLOWMERE_BRINDLE, basis_id: "population", vintage_label: HALLOWMERE_VINTAGE, basis_value: "12315" },
  { recipient_id: HALLOWMERE_CULLEN, basis_id: "population", vintage_label: HALLOWMERE_VINTAGE, basis_value: "96205" },
  { recipient_id: HALLOWMERE_ASTERLY, basis_id: "road_miles", vintage_label: HALLOWMERE_VINTAGE, basis_value: "132.4000" },
  { recipient_id: HALLOWMERE_BRINDLE, basis_id: "road_miles", vintage_label: HALLOWMERE_VINTAGE, basis_value: "288.7500" },
  { recipient_id: HALLOWMERE_CULLEN, basis_id: "road_miles", vintage_label: HALLOWMERE_VINTAGE, basis_value: "61.3000" },
];

const HALLOWMERE_BASIS_DEFINITIONS = [
  {
    id: "population",
    label: "Population",
    statedSourceNote: "Certified population estimate named in Ordinance 22-7, stated by the Finance Director.",
  },
  {
    id: "road_miles",
    label: "Maintained road miles",
    statedSourceNote: "Centreline miles from the annual maintained mileage report, stated by the Public Works Director.",
  },
];

function hallowmereRule(
  factors: Array<{ basisId: string; weight: number }>,
  minimumPerRecipient?: { amountPerPeriod: number; statedRuleNote: string }
): MeasureAllocationDescriptor {
  return parseMeasureAllocationRule({
    version: 1,
    categories: [
      {
        id: "road_repair",
        label: "Road repair",
        percentOfAllocable: 100,
        distribution: { kind: "return_to_source", factors, ...(minimumPerRecipient ? { minimumPerRecipient } : {}) },
      },
    ],
    basisDefinitions: HALLOWMERE_BASIS_DEFINITIONS,
  }) as MeasureAllocationDescriptor;
}

function allocateHallowmere(rule: MeasureAllocationDescriptor, overrides: Record<string, unknown> = {}) {
  return allocateMeasureReceipt({
    rule,
    // PostgREST returns NUMERIC as a string; the fixture arrives that way.
    receiptAmount: "1428650.00",
    recipients: hallowmereRecipients,
    basisValues: hallowmereBasisValues,
    basisVintageLabel: HALLOWMERE_VINTAGE,
    ...overrides,
  });
}

describe("weighted multi-factor return to source — worked example E (Hallowmere, 60% population / 40% road miles)", () => {
  /**
   * DERIVED BY HAND, exact rational, before the allocator knew what a factor
   * was.
   *
   *   pool                 1,428,650.00   (no off-the-top, no reserve, one 100% category)
   *   population total       150,400
   *   road-mile total            482.45
   *
   *   weight fraction_r = 0.60 × pop_r/150,400  +  0.40 × miles_r/482.45
   *
   *   Asterly  0.60×41,880/150,400 = 0.167074468085
   *            0.40×132.40/482.45  = 0.109773033475   Σ 0.276847501560
   *            × 1,428,650.00 = 395,518.183104 -> 395,518.18
   *   Brindle  0.60×12,315/150,400 = 0.049128989362
   *            0.40×288.75/482.45  = 0.239403046947   Σ 0.288532036309
   *            × 1,428,650.00 = 412,211.293674 -> 412,211.29
   *   Cullen   0.60×96,205/150,400 = 0.383796542553
   *            0.40×61.30/482.45   = 0.050823919577   Σ 0.434620462130
   *            × 1,428,650.00 = 620,920.523223 -> 620,920.52
   *
   *   Σ naive 1,428,649.99 -> residual +0.01 to the LAST recipient by id
   *   ascending (Cullen), which therefore receives 620,920.53.
   */
  const sixtyForty = hallowmereRule([
    { basisId: "population", weight: 60 },
    { basisId: "road_miles", weight: 40 },
  ]);

  it("divides by both factors at their stated weights, to the cent", () => {
    const result = unwrap(allocateHallowmere(sixtyForty));
    const by = amountsByRecipient(result, "road_repair");

    expect(by[HALLOWMERE_ASTERLY]).toBe(395518.18);
    expect(by[HALLOWMERE_BRINDLE]).toBe(412211.29);
    expect(by[HALLOWMERE_CULLEN]).toBe(620920.53);
    expect(sharesOf(result, "road_repair").roundingResidual).toBe(0.01);
    expect(
      sharesOf(result, "road_repair").shares.find((share) => share.carriesResidual)?.recipientId
    ).toBe(HALLOWMERE_CULLEN);
    expect(sumCents(Object.values(by))).toBe(cents(1428650));
  });

  it("reports both divisors, and refuses to name one of them as THE divisor", () => {
    const distribution = sharesOf(unwrap(allocateHallowmere(sixtyForty)), "road_repair");

    expect(distribution.factors).toEqual([
      { basisId: "population", weight: 60, basisTotal: 150400 },
      { basisId: "road_miles", weight: 40, basisTotal: 482.45 },
    ]);
    // NULL, not "population". A weighted split has no single divisor, and a
    // surface printing the first factor as if it were one would misstate the
    // ordinance everywhere it appeared.
    expect(distribution.basisId).toBeNull();
    expect(distribution.basisTotal).toBeNull();

    const asterly = distribution.shares.find((share) => share.recipientId === HALLOWMERE_ASTERLY);
    expect(asterly?.basisValue).toBeNull();
    expect(asterly?.factorValues).toEqual([
      { basisId: "population", weight: 60, basisValue: 41880 },
      { basisId: "road_miles", weight: 40, basisValue: 132.4 },
    ]);
  });

  /**
   * THE BINDING IS VARIED, not just the value.
   *
   * One fixture cannot tell "reads each factor's weight" from "averages the
   * factors" or "uses the first one" — at 50/50 all three agree. Swapping the
   * weights to 40/60 must move every share, and by hand:
   *
   *   Asterly  0.40×41,880/150,400 + 0.60×132.40/482.45 -> 394,368.16
   *   Brindle  0.40×12,315/150,400 + 0.60×288.75/482.45 -> 559,826.83
   *   Cullen   0.40×96,205/150,400 + 0.60× 61.30/482.45 -> 474,455.01
   *   Σ 1,428,650.00 exactly — residual 0.00, so nobody carries one.
   */
  it("moves every share when the weights move", () => {
    const swapped = hallowmereRule([
      { basisId: "population", weight: 40 },
      { basisId: "road_miles", weight: 60 },
    ]);
    const result = unwrap(allocateHallowmere(swapped));
    const by = amountsByRecipient(result, "road_repair");

    expect(by[HALLOWMERE_ASTERLY]).toBe(394368.16);
    expect(by[HALLOWMERE_BRINDLE]).toBe(559826.83);
    expect(by[HALLOWMERE_CULLEN]).toBe(474455.01);
    expect(sharesOf(result, "road_repair").roundingResidual).toBe(0);
    expect(sharesOf(result, "road_repair").shares.some((share) => share.carriesResidual)).toBe(false);
    expect(sumCents(Object.values(by))).toBe(cents(1428650));
  });

  /**
   * THE MIGRATION PROOF. Every rule recorded before 2026-08-12 spells a
   * single-basis category as `{ basisId }`. It must keep parsing, and it must
   * allocate to the same cent as the same ordinance written the new way.
   *
   * Population alone over the same pool, by hand:
   *   Asterly 1,428,650 × 41,880/150,400 = 397,818.226...  -> 397,818.23
   *   Brindle 1,428,650 × 12,315/150,400 = 116,980.216...  -> 116,980.22
   *   Cullen  1,428,650 × 96,205/150,400 = 913,851.556...  -> 913,851.55  (rounds DOWN: .5558 of a cent... see below)
   *   Σ 1,428,650.00 exactly, residual 0.00
   *
   * (Cullen's exact share is 913,851.5557..., i.e. 91,385,155.57 cents, which
   * rounds to 91,385,156 — and the naive sum then over-allocates by a cent,
   * which comes back off Cullen as the residual carrier. Net 913,851.55.)
   */
  it("still parses and allocates a single-basis descriptor exactly as before", () => {
    const oldShape = parseMeasureAllocationRule({
      version: 1,
      categories: [
        {
          id: "road_repair",
          label: "Road repair",
          percentOfAllocable: 100,
          distribution: { kind: "return_to_source", basisId: "population" },
        },
      ],
      basisDefinitions: HALLOWMERE_BASIS_DEFINITIONS,
    }) as MeasureAllocationDescriptor;

    const newShape = hallowmereRule([{ basisId: "population", weight: 100 }]);

    const oldResult = unwrap(allocateHallowmere(oldShape));
    const newResult = unwrap(allocateHallowmere(newShape));

    const oldBy = amountsByRecipient(oldResult, "road_repair");
    expect(oldBy[HALLOWMERE_ASTERLY]).toBe(397818.23);
    expect(oldBy[HALLOWMERE_BRINDLE]).toBe(116980.22);
    expect(oldBy[HALLOWMERE_CULLEN]).toBe(913851.55);
    expect(sumCents(Object.values(oldBy))).toBe(cents(1428650));

    // The same ordinance, written both ways, to the cent.
    expect(amountsByRecipient(newResult, "road_repair")).toEqual(oldBy);

    // And the single-divisor convenience fields still carry the figure, because
    // there genuinely is one.
    expect(sharesOf(oldResult, "road_repair").basisId).toBe("population");
    expect(sharesOf(oldResult, "road_repair").basisTotal).toBe(150400);
    expect(
      sharesOf(oldResult, "road_repair").shares.find((s) => s.recipientId === HALLOWMERE_ASTERLY)?.basisValue
    ).toBe(41880);
    // …and the new spelling of the SAME single factor reports it identically.
    expect(sharesOf(newResult, "road_repair").basisId).toBe("population");
    expect(sharesOf(newResult, "road_repair").basisTotal).toBe(150400);
  });

  /**
   * A MISSING TERM IN THE SECOND FACTOR IS STILL A MISSING DENOMINATOR TERM.
   *
   * The single-basis rule was "if any active recipient has no figure, hold the
   * whole category". A weighted split has more ways to be incomplete and only
   * one honest answer: a recipient with a population but no road mileage cannot
   * be given 60% of its formula and nothing for the rest, and the others cannot
   * absorb the fourth of the pool the missing mileage would have divided.
   */
  it("holds the whole category when one recipient is missing ONE of the two figures", () => {
    const result = unwrap(
      allocateHallowmere(sixtyForty, {
        basisValues: hallowmereBasisValues.filter(
          (value) => !(value.recipient_id === HALLOWMERE_BRINDLE && value.basis_id === "road_miles")
        ),
      })
    );

    const distribution = categoryById(result, "road_repair").distribution;
    expect(distribution.kind).toBe("undistributed");
    if (distribution.kind !== "undistributed") throw new Error("unreachable");
    expect(distribution.reason).toBe("missing_basis_values");
    expect(distribution.missingRecipientIds).toEqual([HALLOWMERE_BRINDLE]);
    expect(result.undistributedAmount).toBe(1428650);
    // Both bases are named, so a planner knows which figures to go and record.
    expect(result.notes[0]?.detail).toContain("population and road_miles");
  });

  it("names every factor when it refuses an unstated vintage", () => {
    const outcome = allocateHallowmere(sixtyForty, { basisVintageLabel: undefined });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("unreachable");
    expect(outcome.reason).toBe("basis_vintage_not_stated");
    expect(outcome.message).toContain("population and road_miles");
  });

  it("tells the fund panel about both figures a weighted category needs", () => {
    expect(measureCategoriesNeedingBasisVintage(sixtyForty)).toEqual([
      { id: "road_repair", label: "Road repair", basisIds: ["population", "road_miles"] },
    ]);
  });

  it("reads the single-basis and weighted spellings into one factor list", () => {
    expect(measureReturnToSourceFactors({ kind: "return_to_source", basisId: "population" })).toEqual([
      { basisId: "population", weight: 100 },
    ]);
    expect(
      measureReturnToSourceFactors({
        kind: "return_to_source",
        factors: [
          { basisId: "population", weight: 60 },
          { basisId: "road_miles", weight: 40 },
        ],
      })
    ).toEqual([
      { basisId: "population", weight: 60 },
      { basisId: "road_miles", weight: 40 },
    ]);
  });
});

describe("weighted multi-factor return to source — what the descriptor refuses", () => {
  const base = (distribution: unknown) => ({
    version: 1,
    categories: [{ id: "all", label: "Everything", percentOfAllocable: 100, distribution }],
    basisDefinitions: HALLOWMERE_BASIS_DEFINITIONS,
  });

  it("refuses weights that do not total exactly 100", () => {
    expect(() =>
      parseMeasureAllocationRule(
        base({
          kind: "return_to_source",
          factors: [
            { basisId: "population", weight: 50 },
            { basisId: "road_miles", weight: 49.9 },
          ],
        })
      )
    ).toThrow(/weights its apportionment factors to 99.9, not to exactly 100/);
  });

  it("refuses a category that declares both a single basis and a factor list", () => {
    expect(() =>
      parseMeasureAllocationRule(
        base({
          kind: "return_to_source",
          basisId: "population",
          factors: [{ basisId: "population", weight: 100 }],
        })
      )
    ).toThrow(/exactly one of basisId or factors/);
  });

  it("refuses a return-to-source category that declares neither", () => {
    expect(() => parseMeasureAllocationRule(base({ kind: "return_to_source" }))).toThrow(
      /exactly one of basisId or factors/
    );
  });

  it("refuses a factor naming a basis the ordinance never defined", () => {
    expect(() =>
      parseMeasureAllocationRule(
        base({
          kind: "return_to_source",
          factors: [
            { basisId: "population", weight: 50 },
            { basisId: "parcels", weight: 50 },
          ],
        })
      )
    ).toThrow(/unknown basis "parcels"/);
  });

  it("refuses the same basis weighted twice, which would double-count it", () => {
    expect(() =>
      parseMeasureAllocationRule(
        base({
          kind: "return_to_source",
          factors: [
            { basisId: "population", weight: 50 },
            { basisId: "population", weight: 50 },
          ],
        })
      )
    ).toThrow(/duplicate factor basis in category "all" id "population"/);
  });

  it("refuses an empty factor list rather than reading it as no division at all", () => {
    expect(() => parseMeasureAllocationRule(base({ kind: "return_to_source", factors: [] }))).toThrow(
      /not a valid descriptor/
    );
  });

  /**
   * The meter the setup form draws and the parser must never disagree. This is
   * the integer comparison both use, on the split that a float sum gets wrong.
   */
  it("sums percentages as exact integers, the way the parser does", () => {
    expect(measurePercentTotal([33.33, 33.33, 33.34])).toEqual({ total: 100, isExactly100: true });
    expect(measurePercentTotal([33.3333, 33.3333, 33.3333])).toEqual({ total: 99.9999, isExactly100: false });
    expect(measurePercentTotal([0.1, 0.2])).toEqual({ total: 0.3, isExactly100: false });
    expect(measurePercentTotal([])).toEqual({ total: 0, isExactly100: false });
  });

  /**
   * THE SPLIT A FLOAT METER GETS WRONG, and the reason the meter may not be
   * written as `values.reduce((a, b) => a + b, 0) === 100`.
   *
   * 28.1 / 35.95 / 35.95 is an ordinary three-way ordinance split and it sums
   * to exactly 100. In IEEE doubles it sums to 100.00000000000001, so a float
   * meter would show a planner "99.99999%" — or refuse to enable the save
   * button — on a split the parser accepts. That is precisely the post-submit
   * disagreement the structured builder exists to remove, arriving instead as a
   * form that will not submit.
   */
  it("agrees with the parser on a split whose float sum is not 100", () => {
    expect(28.1 + 35.95 + 35.95).not.toBe(100);
    expect(measurePercentTotal([28.1, 35.95, 35.95])).toEqual({ total: 100, isExactly100: true });

    // And the parser itself accepts the same split, so the two cannot diverge.
    expect(() =>
      parseMeasureAllocationRule({
        version: 1,
        categories: [
          { id: "a", label: "A", percentOfAllocable: 28.1, distribution: { kind: "pooled" } },
          { id: "b", label: "B", percentOfAllocable: 35.95, distribution: { kind: "pooled" } },
          { id: "c", label: "C", percentOfAllocable: 35.95, distribution: { kind: "pooled" } },
        ],
      })
    ).not.toThrow();
  });
});

/* ------------------------------------------------------------------ *
 * FIXTURE F — the Marlbrook Valley Local Streets Measure
 *
 * A floor of $100,000 per recipient per period, on a population split. Four
 * jurisdictions whose ids ascend with their names.
 * ------------------------------------------------------------------ */

const MARLBROOK_ASHCOMBE = "11111111-aaaa-4aaa-8aaa-111111111111";
const MARLBROOK_BRIGHTWATER = "22222222-bbbb-4bbb-8bbb-222222222222";
const MARLBROOK_DUNMOOR = "33333333-cccc-4ccc-8ccc-333333333333";
const MARLBROOK_ELDERBECK = "44444444-dddd-4ddd-8ddd-444444444444";
const MARLBROOK_VINTAGE = "2031 state certified estimate";

const marlbrookRecipients = [
  { id: MARLBROOK_ASHCOMBE, is_active: true },
  { id: MARLBROOK_BRIGHTWATER, is_active: true },
  { id: MARLBROOK_DUNMOOR, is_active: true },
  { id: MARLBROOK_ELDERBECK, is_active: true },
];

const marlbrookBasisValues = [
  { recipient_id: MARLBROOK_ASHCOMBE, basis_id: "population", vintage_label: MARLBROOK_VINTAGE, basis_value: "3200" },
  { recipient_id: MARLBROOK_BRIGHTWATER, basis_id: "population", vintage_label: MARLBROOK_VINTAGE, basis_value: "41500" },
  { recipient_id: MARLBROOK_DUNMOOR, basis_id: "population", vintage_label: MARLBROOK_VINTAGE, basis_value: "88700" },
  { recipient_id: MARLBROOK_ELDERBECK, basis_id: "population", vintage_label: MARLBROOK_VINTAGE, basis_value: "66600" },
];

const MARLBROOK_FLOOR_NOTE =
  "Ordinance 31-4 §5(c): no jurisdiction shall receive less than $100,000 annually. This measure allocates " +
  "annually, so the annual figure is the figure for one period.";

function marlbrookRule(floorAmount: number | null): MeasureAllocationDescriptor {
  return parseMeasureAllocationRule({
    version: 1,
    categories: [
      {
        id: "local_streets",
        label: "Local streets and roads",
        percentOfAllocable: 100,
        distribution: {
          kind: "return_to_source",
          basisId: "population",
          ...(floorAmount === null
            ? {}
            : { minimumPerRecipient: { amountPerPeriod: floorAmount, statedRuleNote: MARLBROOK_FLOOR_NOTE } }),
        },
      },
    ],
    basisDefinitions: [
      {
        id: "population",
        label: "Population",
        statedSourceNote: "State Department of Finance certified estimate named in the ordinance, stated by the Auditor.",
      },
    ],
  }) as MeasureAllocationDescriptor;
}

function allocateMarlbrook(receiptAmount: string, floorAmount: number | null) {
  return allocateMeasureReceipt({
    rule: marlbrookRule(floorAmount),
    receiptAmount,
    recipients: marlbrookRecipients,
    basisValues: marlbrookBasisValues,
    basisVintageLabel: MARLBROOK_VINTAGE,
  });
}

describe("a minimum floor per recipient — worked example F (Marlbrook, $100,000 a period)", () => {
  /**
   * DERIVED BY HAND. Population 3,200 / 41,500 / 88,700 / 66,600 of 200,000,
   * over a pool of 1,000,000.00 — so each share is population × 5.00 and there
   * is no rounding anywhere in the formula step:
   *
   *   Ashcombe      16,000.00      Dunmoor      443,500.00
   *   Brightwater  207,500.00      Elderbeck    333,000.00      Σ 1,000,000.00
   *
   * Floor 100,000.00. Ashcombe is 84,000.00 short and nobody else is short.
   * 4 × 100,000 = 400,000 ≤ 1,000,000, so the floors fit and the shortfall is
   * met from the headroom of the three above the floor:
   *
   *   headroom   Brightwater 107,500.00   Dunmoor 343,500.00   Elderbeck 233,000.00
   *   Σ headroom 684,000.00
   *
   *   Brightwater  84,000 × 107,500/684,000 = 13,201.754386 -> 13,201.75
   *   Dunmoor      84,000 × 343,500/684,000 = 42,184.210526 -> 42,184.21
   *   Elderbeck    84,000 × 233,000/684,000 = 28,614.035088 -> 28,614.04
   *   Σ contributions 84,000.00 exactly — nothing left to place.
   *
   *   FINAL  Ashcombe    100,000.00   (raised)
   *          Brightwater 194,298.25   (207,500.00 − 13,201.75)
   *          Dunmoor     401,315.79   (443,500.00 − 42,184.21)
   *          Elderbeck   304,385.96   (333,000.00 − 28,614.04)
   *          Σ 1,000,000.00
   */
  it("raises the small town to the floor and takes it from the headroom above", () => {
    const result = unwrap(allocateMarlbrook("1000000.00", 100000));
    const by = amountsByRecipient(result, "local_streets");

    expect(by[MARLBROOK_ASHCOMBE]).toBe(100000);
    expect(by[MARLBROOK_BRIGHTWATER]).toBe(194298.25);
    expect(by[MARLBROOK_DUNMOOR]).toBe(401315.79);
    expect(by[MARLBROOK_ELDERBECK]).toBe(304385.96);

    // NOTHING WAS ADDED TO THE FUND. A floor that did not balance would be a
    // grant from nowhere.
    expect(sumCents(Object.values(by))).toBe(cents(1000000));
    expect(sumCents(Object.values(by))).toBe(cents(categoryById(result, "local_streets").programmableAmount));
  });

  it("says what the formula alone gave and who paid for the floor", () => {
    const distribution = sharesOf(unwrap(allocateMarlbrook("1000000.00", 100000)), "local_streets");
    const byId = Object.fromEntries(distribution.shares.map((share) => [share.recipientId, share]));

    expect(distribution.minimumPerRecipient).toBe(100000);
    expect(distribution.floorOutcome).toBe("applied");

    expect(byId[MARLBROOK_ASHCOMBE]?.formulaAmount).toBe(16000);
    expect(byId[MARLBROOK_ASHCOMBE]?.floorEffect).toBe("raised_to_floor");
    expect(byId[MARLBROOK_DUNMOOR]?.formulaAmount).toBe(443500);
    expect(byId[MARLBROOK_DUNMOOR]?.floorEffect).toBe("contributed_to_floors");

    const note = unwrap(allocateMarlbrook("1000000.00", 100000)).notes.find(
      (entry) => entry.code === "recipient_floor_applied"
    );
    expect(note?.subjectId).toBe("local_streets");
    expect(note?.detail).toContain("84,000.00".replace(/,/g, ""));
    // The ordinance's own words travel with the arithmetic.
    expect(note?.detail).toContain("no jurisdiction shall receive less than $100,000 annually");
  });

  /**
   * THE FLOOR MUST NOT FIRE WHEN IT IS NOT NEEDED. A clause every share already
   * clears must change nothing at all — a floor that quietly rebalanced an
   * ordinary period would be redistributing an agency's money on every cycle.
   */
  it("changes nothing when every share already clears the floor", () => {
    const withFloor = unwrap(allocateMarlbrook("1000000.00", 10000));
    const withoutFloor = unwrap(allocateMarlbrook("1000000.00", null));

    expect(amountsByRecipient(withFloor, "local_streets")).toEqual(
      amountsByRecipient(withoutFloor, "local_streets")
    );
    expect(sharesOf(withFloor, "local_streets").floorOutcome).toBe("not_needed");
    expect(sharesOf(withoutFloor, "local_streets").floorOutcome).toBe("not_declared");
    expect(sharesOf(withoutFloor, "local_streets").minimumPerRecipient).toBeNull();
    expect(withFloor.notes).toEqual([]);
    expect(withFloor.categories[0]?.distribution).toBeDefined();
    expect(
      sharesOf(withFloor, "local_streets").shares.every((share) => share.floorEffect === "none")
    ).toBe(true);
  });

  /**
   * WORKED EXAMPLE F2 — THE FLOORS DO NOT FIT, AND THE PRODUCT REFUSES.
   *
   * Pool 250,000.00, floor 100,000.00, four recipients: 4 × 100,000 = 400,000
   * against 250,000 available, short by 150,000.00. The ordinance's own text
   * cannot be honoured this period.
   *
   * The rejected alternative, for the record, is in the module header: paying
   * the floors in full in order of shortfall would give Ashcombe 100,000.00,
   * Brightwater 100,000.00, Elderbeck 50,000.00 and DUNMOOR — the largest
   * jurisdiction, 44% of the population — 0.00. That is a defensible reading of
   * a clause that has run out of money, and it is not the only one, and the
   * ordinance does not choose. So the money is held and the board decides.
   */
  it("refuses to invent an apportionment when the floors are worth more than the pool", () => {
    const result = unwrap(allocateMarlbrook("250000.00", 100000));
    const distribution = categoryById(result, "local_streets").distribution;

    expect(distribution.kind).toBe("undistributed");
    if (distribution.kind !== "undistributed") throw new Error("unreachable");
    expect(distribution.reason).toBe("recipient_floors_exceed_pool");

    // The money is ALLOCATED to the category and held — it does not vanish.
    expect(categoryById(result, "local_streets").amount).toBe(250000);
    expect(result.undistributedAmount).toBe(250000);

    const note = result.notes.find((entry) => entry.code === "category_undistributed");
    expect(note?.detail).toContain("400000.00");
    expect(note?.detail).toContain("250000.00");
    expect(note?.detail).toContain("short by 150000.00");
    expect(note?.detail).toContain("decision for the board");
  });

  /**
   * AND A FLOOR LARGER THAN THE WHOLE POOL REFUSES RATHER THAN LOOPING. The
   * naive algorithm — raise everyone short, reduce everyone else, repeat — has
   * no fixpoint here. There is no loop to run: the condition is checked before
   * any money moves.
   */
  it("refuses a floor bigger than the entire pool", () => {
    const result = unwrap(allocateMarlbrook("60000.00", 100000));
    const distribution = categoryById(result, "local_streets").distribution;

    expect(distribution.kind).toBe("undistributed");
    if (distribution.kind !== "undistributed") throw new Error("unreachable");
    expect(distribution.reason).toBe("recipient_floors_exceed_pool");
    expect(result.undistributedAmount).toBe(60000);
  });

  /**
   * WORKED EXAMPLE F5 — THE CONTRIBUTIONS DO NOT DIVIDE EVENLY, ONE CENT SHORT.
   *
   * Pool 482,357.60. Formula shares (population × pool / 200,000, half-up):
   *   Ashcombe 7,717.72  Brightwater 100,089.20  Dunmoor 213,925.60  Elderbeck 160,625.08
   *   (Σ exactly the pool, so no formula residual.)
   *
   * Only Ashcombe is short, by 92,282.28. Headroom 89.20 / 113,925.60 /
   * 60,625.08, Σ 174,639.88, and 4 × 100,000 = 400,000 ≤ 482,357.60 so it fits.
   *
   *   Brightwater  92,282.28 ×     89.20/174,639.88 =      47.134591 ->      47.13
   *   Dunmoor      92,282.28 × 113,925.60/174,639.88 =  60,199.961878 ->  60,199.96
   *   Elderbeck    92,282.28 ×  60,625.08/174,639.88 =  32,035.183531 ->  32,035.18
   *   Σ contributions 92,282.27 — ONE CENT SHORT of the shortfall.
   *
   * The cent is placed on the first donor by id ascending (Brightwater), whose
   * contribution becomes 47.14. FINAL:
   *   Ashcombe 100,000.00  Brightwater 100,042.06  Dunmoor 153,725.64  Elderbeck 128,589.90
   *   Σ 482,357.60
   */
  it("places the last cent of the clawback deterministically when it is short", () => {
    const result = unwrap(allocateMarlbrook("482357.60", 100000));
    const by = amountsByRecipient(result, "local_streets");

    expect(by[MARLBROOK_ASHCOMBE]).toBe(100000);
    expect(by[MARLBROOK_BRIGHTWATER]).toBe(100042.06);
    expect(by[MARLBROOK_DUNMOOR]).toBe(153725.64);
    expect(by[MARLBROOK_ELDERBECK]).toBe(128589.9);
    expect(sumCents(Object.values(by))).toBe(cents(482357.6));
    // AND NO DONOR WAS PUSHED BELOW THE FLOOR PAYING FOR SOMEONE ELSE'S.
    expect(Object.values(by).every((amount) => amount >= 100000)).toBe(true);
  });

  /**
   * WORKED EXAMPLE F6 — AND ONE CENT OVER, THE OTHER DIRECTION.
   *
   * Pool 483,070.31. Formula shares half-up: 7,729.12 / 100,237.09 /
   * 214,241.68 / 160,862.41, Σ 483,070.30 — a formula residual of +0.01 to the
   * LAST recipient by id ascending, so Elderbeck starts at 160,862.42. The
   * floor arithmetic then works on the post-residual figures.
   *
   * Ashcombe short 92,270.88; headroom 237.09 / 114,241.68 / 60,862.42,
   * Σ 175,341.19.
   *   Brightwater  92,270.88 ×    237.09/175,341.19 =     124.765339 ->     124.77
   *   Dunmoor      92,270.88 × 114,241.68/175,341.19 = 60,118.106569 -> 60,118.11
   *   Elderbeck    92,270.88 ×  60,862.42/175,341.19 = 32,028.008093 -> 32,028.01
   *   Σ contributions 92,270.89 — ONE CENT TOO MUCH.
   *
   * The cent comes back off the first donor by id ascending, whose contribution
   * becomes 124.76. FINAL:
   *   Ashcombe 100,000.00  Brightwater 100,112.33  Dunmoor 154,123.57  Elderbeck 128,834.41
   *   Σ 483,070.31
   */
  it("takes the last cent back off a donor when the clawback overshoots", () => {
    const result = unwrap(allocateMarlbrook("483070.31", 100000));
    const distribution = sharesOf(result, "local_streets");
    const by = amountsByRecipient(result, "local_streets");

    // The formula residual landed before the floor did.
    expect(distribution.roundingResidual).toBe(0.01);
    expect(
      distribution.shares.find((share) => share.recipientId === MARLBROOK_ELDERBECK)?.formulaAmount
    ).toBe(160862.42);

    expect(by[MARLBROOK_ASHCOMBE]).toBe(100000);
    expect(by[MARLBROOK_BRIGHTWATER]).toBe(100112.33);
    expect(by[MARLBROOK_DUNMOOR]).toBe(154123.57);
    expect(by[MARLBROOK_ELDERBECK]).toBe(128834.41);
    expect(sumCents(Object.values(by))).toBe(cents(483070.31));
    expect(Object.values(by).every((amount) => amount >= 100000)).toBe(true);
  });

  /**
   * THE BOUNDARY, WHICH IS A REAL ORDINANCE AND NOT AN EDGE CASE.
   *
   * `recipients × floor` EXACTLY equal to the pool is satisfiable and must be
   * satisfied: every recipient receives exactly the floor and nothing is held.
   * Refusing here — comparing with `>=` instead of `>` — would hold a whole
   * period's money back on the one input where the ordinance's guarantee is
   * met precisely, which is also the input an agency is most likely to hit
   * deliberately when it sets the floor from the budget.
   *
   * DERIVED BY HAND. Pool 400,000.00, population × 2.00:
   *   Ashcombe 6,400.00  Brightwater 83,000.00  Dunmoor 177,400.00  Elderbeck 133,200.00
   *   short  93,600.00 + 17,000.00 = 110,600.00
   *   headroom 77,400.00 + 33,200.00 = 110,600.00 — exactly equal, so each
   *   donor gives its whole headroom and every recipient lands on 100,000.00.
   */
  it("distributes when the floors exactly exhaust the pool, rather than refusing", () => {
    const result = unwrap(allocateMarlbrook("400000.00", 100000));
    const by = amountsByRecipient(result, "local_streets");

    expect(by[MARLBROOK_ASHCOMBE]).toBe(100000);
    expect(by[MARLBROOK_BRIGHTWATER]).toBe(100000);
    expect(by[MARLBROOK_DUNMOOR]).toBe(100000);
    expect(by[MARLBROOK_ELDERBECK]).toBe(100000);
    expect(sumCents(Object.values(by))).toBe(cents(400000));
    expect(result.undistributedAmount).toBe(0);
    expect(sharesOf(result, "local_streets").floorOutcome).toBe("applied");
  });

  /** And one cent under that boundary is genuinely unsatisfiable. */
  it("refuses one cent below the boundary", () => {
    const distribution = categoryById(unwrap(allocateMarlbrook("399999.99", 100000)), "local_streets").distribution;
    expect(distribution.kind).toBe("undistributed");
  });

  it("refuses a floor of zero rather than storing a clause that does nothing", () => {
    expect(() => marlbrookRule(0)).toThrow(/minimum per recipient of zero or less/);
  });
});

/* ------------------------------------------------------------------ *
 * FIXTURE G — both rules at once
 * ------------------------------------------------------------------ */

describe("worked example G — a weighted split with a floor on top of it", () => {
  /**
   * DERIVED BY HAND from fixture E's formula shares (60/40, residual placed):
   *
   *   Asterly 395,518.18   Brindle 412,211.29   Cullen 620,920.53
   *
   * Floor 450,000.00. 3 × 450,000 = 1,350,000 ≤ 1,428,650, so it fits.
   *   short   Asterly 54,481.82   Brindle 37,788.71     Σ  92,270.53
   *   headroom Cullen 170,920.53                        Σ 170,920.53
   *   Cullen is the only donor and pays the whole 92,270.53:
   *     620,920.53 − 92,270.53 = 528,650.00
   *
   *   FINAL  450,000.00 / 450,000.00 / 528,650.00   Σ 1,428,650.00
   *
   * The two rules compose: the floor operates on whatever the formula produced,
   * and does not care how many factors produced it.
   */
  it("applies the floor to the weighted formula's output", () => {
    const rule = hallowmereRule(
      [
        { basisId: "population", weight: 60 },
        { basisId: "road_miles", weight: 40 },
      ],
      {
        amountPerPeriod: 450000,
        statedRuleNote: "Ordinance 22-7 §9: each member shall receive not less than $450,000 in each fiscal year.",
      }
    );
    const result = unwrap(allocateHallowmere(rule));
    const distribution = sharesOf(result, "road_repair");
    const by = amountsByRecipient(result, "road_repair");

    expect(by[HALLOWMERE_ASTERLY]).toBe(450000);
    expect(by[HALLOWMERE_BRINDLE]).toBe(450000);
    expect(by[HALLOWMERE_CULLEN]).toBe(528650);
    expect(sumCents(Object.values(by))).toBe(cents(1428650));

    // And the formula's own figures are still reported beside the floored ones,
    // so a reader can see what the ordinance's split gave before the guarantee.
    const byId = Object.fromEntries(distribution.shares.map((share) => [share.recipientId, share]));
    expect(byId[HALLOWMERE_ASTERLY]?.formulaAmount).toBe(395518.18);
    expect(byId[HALLOWMERE_BRINDLE]?.formulaAmount).toBe(412211.29);
    expect(byId[HALLOWMERE_CULLEN]?.formulaAmount).toBe(620920.53);
    expect(byId[HALLOWMERE_CULLEN]?.floorEffect).toBe("contributed_to_floors");
    expect(distribution.factors).toHaveLength(2);
  });
});

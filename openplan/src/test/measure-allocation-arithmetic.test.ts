import { describe, expect, it } from "vitest";
import {
  allocateMeasureReceipt,
  amountToCents,
  centsToAmount,
  parseMeasureAllocationRule,
  type MeasureAllocationDescriptor,
  type MeasureAllocationResult,
} from "@/lib/measures/allocation";

/**
 * THE ORDINANCE ARITHMETIC, PINNED TO THE CENT.
 *
 * ============================================================================
 * HOW THESE NUMBERS WERE PRODUCED
 * ============================================================================
 *
 * Every expected value in this file was derived with exact decimal arithmetic
 * BEFORE `allocation.ts` existed, on the v0.17.0 drawdown-ledger precedent where
 * hand-deriving a worked example first found two live errors. They are literals
 * here on purpose: a test that recomputes the answer the same way the code does
 * proves only that the code is self-consistent.
 *
 * ============================================================================
 * TWO DIFFERENTLY-SHAPED MEASURES, ONE ALLOCATOR
 * ============================================================================
 *
 * Product non-negotiable #0 says an ordinance's split is DATA. The claim is only
 * worth anything if a SECOND, differently-shaped measure runs through the same
 * code, so both do:
 *
 *   CEDAR BASIN — quarterly, 1% off the top for administration, four categories
 *   at 40/35/20/5, a 10% reserve on one category only, and one category that
 *   returns to source over population.
 *
 *   LARKMOOR — monthly, NOTHING off the top, a 5% reserve of GROSS (which
 *   reduces the allocable pool rather than a category), a single 100% category,
 *   and return to source over parcel counts.
 *
 * They share no percentage, no category id, no basis and no structural feature.
 * Neither names a real place: these are invented jurisdictions with realistic
 * spellings, because a pretend registry with placeholder spellings has already
 * hidden a defect in this repository once.
 *
 * ============================================================================
 * WHY THE ALLOCATOR DOES NOT USE `roundCurrencyAmount`
 * ============================================================================
 *
 * Fixture C is the negative-residual case: two shares that each round UP, so
 * the leftover cent is negative and has to be taken back rather than handed
 * out. Fixture D is the float one — and it is deliberately modest about it. An
 * earlier draft of this file claimed `Math.round(value * 100) / 100` mishandles
 * `1000000.01 / 2`; it does not, and the correction is recorded in fixture D's
 * own header rather than quietly deleted.
 */

/* ------------------------------------------------------------------ *
 * Helpers — exact comparison, so a float residue cannot pass for equality
 * ------------------------------------------------------------------ */

function cents(value: number): number {
  return Math.round(value * 100);
}

function sumCents(values: readonly number[]): number {
  return values.reduce((total, value) => total + cents(value), 0);
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

function unwrap(outcome: ReturnType<typeof allocateMeasureReceipt>): MeasureAllocationResult {
  if (!outcome.ok) throw new Error(`allocation refused: ${outcome.reason} — ${outcome.message}`);
  return outcome.allocation;
}

/* ------------------------------------------------------------------ *
 * FIXTURE A — the Cedar Basin Transportation Investment Measure
 * ------------------------------------------------------------------ */

// Four member jurisdictions. UUIDs rather than readable keys, because the
// residual rule is "last recipient by id ascending" and a test using
// "city_a"-style keys would not exercise the ordering the database produces.
const CEDAR_HOLLISTON = "11111111-1111-4111-8111-111111111111";
const CEDAR_MARROWFIELD = "22222222-2222-4222-8222-222222222222";
const CEDAR_QUILLBROOK = "33333333-3333-4333-8333-333333333333";
const CEDAR_WESTMERE = "44444444-4444-4444-8444-444444444444";

const CEDAR_VINTAGE = "2029 certified estimate";

const cedarBasinRule: MeasureAllocationDescriptor = parseMeasureAllocationRule({
  version: 1,
  offTheTop: [
    { id: "administration", label: "Measure administration", percent: 1, capAmount: 200000, capBasis: "fiscal_year" },
  ],
  reserves: [{ id: "regional_reserve", label: "Regional project reserve", basis: "category:regional", percent: 10 }],
  categories: [
    {
      id: "local_streets",
      label: "Local streets and roads",
      percentOfAllocable: 40,
      distribution: { kind: "return_to_source", basisId: "population" },
    },
    { id: "regional", label: "Regional corridors", percentOfAllocable: 35, distribution: { kind: "pooled" } },
    { id: "transit", label: "Transit operations", percentOfAllocable: 20, distribution: { kind: "pooled" } },
    { id: "active", label: "Walking and cycling", percentOfAllocable: 5, distribution: { kind: "pooled" } },
  ],
  residualCategoryId: "active",
  basisDefinitions: [
    {
      id: "population",
      label: "Population",
      statedSourceNote: "Certified population estimate named in Ordinance 14-3, stated by the Finance Director.",
      vintageRuleNote: "The vintage in force at the start of the quarter governs the whole quarter.",
    },
  ],
}) as MeasureAllocationDescriptor;

const cedarRecipients = [
  { id: CEDAR_HOLLISTON, is_active: true },
  { id: CEDAR_MARROWFIELD, is_active: true },
  { id: CEDAR_QUILLBROOK, is_active: true },
  { id: CEDAR_WESTMERE, is_active: true },
];

const cedarBasisValues = [
  { recipient_id: CEDAR_HOLLISTON, basis_id: "population", vintage_label: CEDAR_VINTAGE, basis_value: "61404" },
  { recipient_id: CEDAR_MARROWFIELD, basis_id: "population", vintage_label: CEDAR_VINTAGE, basis_value: "28733" },
  { recipient_id: CEDAR_QUILLBROOK, basis_id: "population", vintage_label: CEDAR_VINTAGE, basis_value: "12061" },
  { recipient_id: CEDAR_WESTMERE, basis_id: "population", vintage_label: CEDAR_VINTAGE, basis_value: "98502" },
];

function allocateCedar(overrides: Partial<Parameters<typeof allocateMeasureReceipt>[0]> = {}) {
  return allocateMeasureReceipt({
    rule: cedarBasinRule,
    // PostgREST returns NUMERIC as a string; the fixture arrives the way the
    // database actually sends it.
    receiptAmount: "4812340.17",
    recipients: cedarRecipients,
    basisValues: cedarBasisValues,
    basisVintageLabel: CEDAR_VINTAGE,
    capWindow: { priorTakesKnown: true, priorTakenByOffTheTopId: {} },
    ...overrides,
  });
}

/* ------------------------------------------------------------------ *
 * FIXTURE B — the Larkmoor County Infrastructure Levy
 * ------------------------------------------------------------------ */

const LARKMOOR_ASHGROVE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LARKMOOR_TERNSIDE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const LARKMOOR_VINTAGE = "FY2030 assessor roll";

const larkmoorRule: MeasureAllocationDescriptor = parseMeasureAllocationRule({
  version: 1,
  reserves: [{ id: "contingency", label: "Levy contingency", basis: "gross", percent: 5 }],
  categories: [
    {
      id: "infrastructure",
      label: "Infrastructure works",
      percentOfAllocable: 100,
      distribution: { kind: "return_to_source", basisId: "parcels" },
    },
  ],
  basisDefinitions: [
    {
      id: "parcels",
      label: "Assessed parcels",
      statedSourceNote: "Parcel count from the assessor roll cited in the levy ordinance, stated by the Auditor.",
    },
  ],
}) as MeasureAllocationDescriptor;

function allocateLarkmoor() {
  return allocateMeasureReceipt({
    rule: larkmoorRule,
    receiptAmount: "283417.55",
    recipients: [
      { id: LARKMOOR_ASHGROVE, is_active: true },
      { id: LARKMOOR_TERNSIDE, is_active: true },
    ],
    basisValues: [
      { recipient_id: LARKMOOR_ASHGROVE, basis_id: "parcels", vintage_label: LARKMOOR_VINTAGE, basis_value: "26956" },
      { recipient_id: LARKMOOR_TERNSIDE, basis_id: "parcels", vintage_label: LARKMOOR_VINTAGE, basis_value: "13110" },
    ],
    basisVintageLabel: LARKMOOR_VINTAGE,
  });
}

/* ================================================================== */

describe("measure allocation — worked example A (Cedar Basin, quarterly, off the top, return to source)", () => {
  /**
   * DERIVED BY HAND, exact decimal, before any code existed:
   *
   *   receipt                     4,812,340.17
   *   administration 1%              48,123.4017 -> 48,123.40   (half-up)
   *   allocable                   4,764,216.77
   *   local streets 40%           1,905,686.708  -> 1,905,686.71
   *   regional      35%           1,667,475.8695 -> 1,667,475.87
   *   transit       20%             952,843.354  ->   952,843.35
   *   active         5%             238,210.8385 ->   238,210.84
   *   Σ                           4,764,216.77   -> residual 0.00
   *   regional reserve 10%          166,747.587  ->   166,747.59
   *   regional programmable       1,500,728.28
   */
  it("takes the off-the-top and cuts the allocable pool to the cent", () => {
    const result = unwrap(allocateCedar());

    expect(result.receiptAmount).toBe(4812340.17);
    expect(result.offTheTop).toHaveLength(1);
    expect(result.offTheTop[0]?.amount).toBe(48123.4);
    expect(result.offTheTop[0]?.uncappedAmount).toBe(48123.4);
    expect(result.offTheTop[0]?.capStatus).toBe("within_cap");
    expect(result.offTheTopTotal).toBe(48123.4);
    expect(result.poolReserveTotal).toBe(0);
    expect(result.allocableAmount).toBe(4764216.77);
  });

  it("splits the four categories exactly as the ordinance states", () => {
    const result = unwrap(allocateCedar());

    expect(categoryById(result, "local_streets").amount).toBe(1905686.71);
    expect(categoryById(result, "regional").amount).toBe(1667475.87);
    expect(categoryById(result, "transit").amount).toBe(952843.35);
    expect(categoryById(result, "active").amount).toBe(238210.84);
    expect(result.roundingResidual).toBe(0);
    expect(categoryById(result, "active").carriesResidual).toBe(false);
  });

  it("takes the reserve out of its own category and nothing else", () => {
    const result = unwrap(allocateCedar());

    expect(result.categoryReserves).toHaveLength(1);
    expect(result.categoryReserves[0]?.id).toBe("regional_reserve");
    expect(result.categoryReserves[0]?.basisAmount).toBe(1667475.87);
    expect(result.categoryReserves[0]?.amount).toBe(166747.59);

    expect(categoryById(result, "regional").reserveAmount).toBe(166747.59);
    expect(categoryById(result, "regional").programmableAmount).toBe(1500728.28);

    // The three categories the reserve does not name are untouched — a reserve
    // that quietly reduced the pool would rebalance every other share.
    expect(categoryById(result, "transit").programmableAmount).toBe(952843.35);
    expect(categoryById(result, "active").programmableAmount).toBe(238210.84);
    expect(result.allocableAmount).toBe(4764216.77);
  });

  /**
   * Basis {61,404 / 28,733 / 12,061 / 98,502}, total 200,700, over a pool of
   * 1,905,686.71:
   *
   *   583,043.28 / 272,825.59 / 114,521.61 / 935,296.22
   *   naive sum  1,905,686.70 -> residual +0.01 to the last recipient by id
   *   Westmere therefore receives 935,296.23.
   */
  it("returns local streets to source over the stated population, residual and all", () => {
    const distribution = sharesOf(unwrap(allocateCedar()), "local_streets");

    expect(distribution.basisId).toBe("population");
    expect(distribution.vintageLabel).toBe(CEDAR_VINTAGE);
    expect(distribution.basisTotal).toBe(200700);
    expect(distribution.roundingResidual).toBe(0.01);

    const byRecipient = Object.fromEntries(distribution.shares.map((share) => [share.recipientId, share.amount]));
    expect(byRecipient[CEDAR_HOLLISTON]).toBe(583043.28);
    expect(byRecipient[CEDAR_MARROWFIELD]).toBe(272825.59);
    expect(byRecipient[CEDAR_QUILLBROOK]).toBe(114521.61);
    expect(byRecipient[CEDAR_WESTMERE]).toBe(935296.23);

    expect(distribution.shares.find((share) => share.carriesResidual)?.recipientId).toBe(CEDAR_WESTMERE);
  });

  /**
   * THE BINDING IS VARIED, not just the value.
   *
   * One fixture cannot tell "reads the ids and picks the last" from "happens to
   * put the residual on the fourth element". Re-key the same four population
   * figures so a DIFFERENT recipient sorts last, and the cent must move with
   * it. Recorded as its own rule after a 2026-08-05 session where sixty tests
   * passed a hardcode mutation.
   */
  it("moves the residual when the id ordering moves", () => {
    const swapped = "00000000-0000-4000-8000-000000000000";
    const result = unwrap(
      allocateCedar({
        recipients: [
          { id: swapped, is_active: true },
          { id: CEDAR_MARROWFIELD, is_active: true },
          { id: CEDAR_QUILLBROOK, is_active: true },
          { id: CEDAR_WESTMERE, is_active: true },
        ],
        basisValues: [
          // Westmere and Holliston trade population figures AND ordering, so the
          // largest share and the residual end up on different recipients.
          { recipient_id: swapped, basis_id: "population", vintage_label: CEDAR_VINTAGE, basis_value: "98502" },
          { recipient_id: CEDAR_MARROWFIELD, basis_id: "population", vintage_label: CEDAR_VINTAGE, basis_value: "28733" },
          { recipient_id: CEDAR_QUILLBROOK, basis_id: "population", vintage_label: CEDAR_VINTAGE, basis_value: "12061" },
          { recipient_id: CEDAR_WESTMERE, basis_id: "population", vintage_label: CEDAR_VINTAGE, basis_value: "61404" },
        ],
      })
    );
    const distribution = sharesOf(result, "local_streets");

    const byRecipient = Object.fromEntries(distribution.shares.map((share) => [share.recipientId, share.amount]));
    expect(byRecipient[swapped]).toBe(935296.22);
    expect(byRecipient[CEDAR_WESTMERE]).toBe(583043.29);
    expect(distribution.shares.find((share) => share.carriesResidual)?.recipientId).toBe(CEDAR_WESTMERE);
  });

  it("distributes every cent of the pool and no more", () => {
    const result = unwrap(allocateCedar());
    const distribution = sharesOf(result, "local_streets");

    // Integer cents, so a float residue cannot pass for equality.
    expect(sumCents(distribution.shares.map((share) => share.amount))).toBe(
      cents(categoryById(result, "local_streets").programmableAmount)
    );
    expect(sumCents(result.categories.map((category) => category.amount))).toBe(cents(result.allocableAmount));
    expect(cents(result.allocableAmount) + cents(result.offTheTopTotal) + cents(result.poolReserveTotal)).toBe(
      cents(result.receiptAmount)
    );
    expect(result.undistributedAmount).toBe(0);
    expect(result.notes).toEqual([]);
  });
});

describe("measure allocation — worked example B (Larkmoor, a differently-shaped ordinance)", () => {
  /**
   * DERIVED BY HAND:
   *   receipt              283,417.55
   *   contingency 5% gross  14,170.8775 -> 14,170.88
   *   allocable            269,246.67
   *   single category 100% 269,246.67
   *   parcels 26,956 / 13,110 of 40,066
   *     -> 181,146.44 / 88,100.23, residual 0.00
   */
  it("runs an ordinance with no off-the-top, a gross reserve and one category", () => {
    const result = unwrap(allocateLarkmoor());

    expect(result.offTheTop).toEqual([]);
    expect(result.offTheTopTotal).toBe(0);
    expect(result.poolReserves).toHaveLength(1);
    expect(result.poolReserves[0]?.basis).toBe("gross");
    expect(result.poolReserves[0]?.basisAmount).toBe(283417.55);
    expect(result.poolReserves[0]?.amount).toBe(14170.88);
    expect(result.poolReserveTotal).toBe(14170.88);
    expect(result.allocableAmount).toBe(269246.67);

    expect(result.categories).toHaveLength(1);
    expect(categoryById(result, "infrastructure").amount).toBe(269246.67);
    expect(categoryById(result, "infrastructure").reserveAmount).toBe(0);
    expect(result.roundingResidual).toBe(0);
  });

  it("returns the whole allocable pool to source over parcel counts", () => {
    const distribution = sharesOf(unwrap(allocateLarkmoor()), "infrastructure");

    expect(distribution.basisTotal).toBe(40066);
    expect(distribution.shares.map((share) => share.amount)).toEqual([181146.44, 88100.23]);
    expect(distribution.roundingResidual).toBe(0);
    expect(distribution.shares.some((share) => share.carriesResidual)).toBe(false);
    expect(sumCents(distribution.shares.map((share) => share.amount))).toBe(cents(269246.67));
  });

  /**
   * A GROSS RESERVE IS NOT A CATEGORY RESERVE, and the two measures are what
   * proves the difference is read from the descriptor rather than assumed.
   * Cedar's reserve leaves `allocableAmount` alone; Larkmoor's cuts it.
   */
  it("keeps the two reserve bases distinct", () => {
    const larkmoor = unwrap(allocateLarkmoor());
    const cedar = unwrap(allocateCedar());

    expect(larkmoor.poolReserveTotal).toBe(14170.88);
    expect(larkmoor.categoryReserves).toEqual([]);
    expect(cedar.poolReserveTotal).toBe(0);
    expect(cedar.categoryReserves).toHaveLength(1);
  });
});

describe("measure allocation — worked example C (the residual with the other sign)", () => {
  const halfAndHalf: MeasureAllocationDescriptor = parseMeasureAllocationRule({
    version: 1,
    categories: [
      { id: "capital", label: "Capital works", percentOfAllocable: 50, distribution: { kind: "pooled" } },
      { id: "operations", label: "Operations", percentOfAllocable: 50, distribution: { kind: "pooled" } },
    ],
    residualCategoryId: "capital",
  }) as MeasureAllocationDescriptor;

  /**
   * 1,000,000.01 at 50/50. Each naive share is an exact 500,000.005, which
   * rounds half-up to 500,000.01 — so the two shares sum to 1,000,000.02 and
   * the residual is NEGATIVE one cent. A residual rule tested only against
   * fixture A would have been written as "add the leftover" and would be wrong
   * here in the direction that hands out money the fund never received.
   */
  it("carries a negative residual and still balances exactly", () => {
    const result = unwrap(
      allocateMeasureReceipt({ rule: halfAndHalf, receiptAmount: "1000000.01" })
    );

    expect(result.allocableAmount).toBe(1000000.01);
    expect(result.roundingResidual).toBe(-0.01);
    expect(categoryById(result, "capital").amount).toBe(500000);
    expect(categoryById(result, "operations").amount).toBe(500000.01);
    expect(categoryById(result, "capital").carriesResidual).toBe(true);
    expect(sumCents(result.categories.map((category) => category.amount))).toBe(cents(1000000.01));
  });

  /**
   * WORKED EXAMPLE C2 — THE POOL TOO SMALL FOR ITS OWN ORDINANCE.
   *
   * DERIVED BY HAND. Four categories at 25% of an allocable pool of $0.02:
   *
   *   each naive share  0.005 -> half-up 0.01
   *   Σ naive                            0.04
   *   residual          0.02 − 0.04  =  −0.02
   *
   * The residual category (no `residualCategoryId` declared, so the last by id
   * ascending: `d`) can absorb only −0.01 before going negative. It goes to
   * 0.00 and the remaining −0.01 moves to `a`, the first by id ascending, which
   * also goes to 0.00. Result 0.00 / 0.01 / 0.01 / 0.00, summing to exactly the
   * $0.02 the fund has.
   *
   * BEFORE 2026-08-12 this produced `d = −0.01`. It was not a curiosity: a
   * negative amount is refused by `measure_allocations_amount_check`, and the
   * refusal arrived AFTER the route had deleted the period's previous
   * allocations, so a two-cent quarter emptied the period. The database CHECK
   * is still the second lock — this fixture is the first.
   */
  it("floors the residual instead of allocating a negative share", () => {
    const fourWays = parseMeasureAllocationRule({
      version: 1,
      categories: [
        { id: "a", label: "A", percentOfAllocable: 25, distribution: { kind: "pooled" } },
        { id: "b", label: "B", percentOfAllocable: 25, distribution: { kind: "pooled" } },
        { id: "c", label: "C", percentOfAllocable: 25, distribution: { kind: "pooled" } },
        { id: "d", label: "D", percentOfAllocable: 25, distribution: { kind: "pooled" } },
      ],
    }) as MeasureAllocationDescriptor;

    const result = unwrap(allocateMeasureReceipt({ rule: fourWays, receiptAmount: "0.02" }));

    expect(result.allocableAmount).toBe(0.02);
    expect(result.roundingResidual).toBe(-0.02);
    expect(result.categories.map((category) => category.amount)).toEqual([0, 0.01, 0.01, 0]);
    // NOT A SINGLE NEGATIVE, which is the whole point — and every cent placed.
    expect(result.categories.every((category) => category.amount >= 0)).toBe(true);
    expect(sumCents(result.categories.map((category) => category.amount))).toBe(cents(0.02));
    expect(result.notes.map((note) => note.code)).toContain("residual_exceeds_residual_category");
  });

  /**
   * THE BINDING IS VARIED, not just the value. A rule that hardcoded "zero the
   * last and then the first" would pass the fixture above. Naming `b` as the
   * ordinance's residual category must move which categories are zeroed.
   */
  it("zeroes the ordinance's declared residual category first, not a positional one", () => {
    const fourWays = parseMeasureAllocationRule({
      version: 1,
      categories: [
        { id: "a", label: "A", percentOfAllocable: 25, distribution: { kind: "pooled" } },
        { id: "b", label: "B", percentOfAllocable: 25, distribution: { kind: "pooled" } },
        { id: "c", label: "C", percentOfAllocable: 25, distribution: { kind: "pooled" } },
        { id: "d", label: "D", percentOfAllocable: 25, distribution: { kind: "pooled" } },
      ],
      residualCategoryId: "b",
    }) as MeasureAllocationDescriptor;

    const result = unwrap(allocateMeasureReceipt({ rule: fourWays, receiptAmount: "0.02" }));

    // `b` is zeroed first, then `a` (first by id ascending among the rest).
    expect(result.categories.map((category) => category.amount)).toEqual([0, 0, 0.01, 0.01]);
    expect(sumCents(result.categories.map((category) => category.amount))).toBe(cents(0.02));
  });

  /**
   * AND THE FLOOR MUST NOT FIRE IN AN ORDINARY PERIOD. Fixture C's −0.01
   * residual is absorbed whole by a category holding 500,000.01, so the note
   * must be absent and the shares must be exactly what fixture C pinned. A
   * clawback that spilled here would be redistributing an agency's money on
   * every quarter.
   */
  it("leaves an ordinary negative residual on the residual category alone", () => {
    const result = unwrap(allocateMeasureReceipt({ rule: halfAndHalf, receiptAmount: "1000000.01" }));

    expect(categoryById(result, "capital").amount).toBe(500000);
    expect(result.notes).toEqual([]);
  });

  /** The scaling primitive itself, on the same boundary. */
  it("rounds a half up rather than to even or down", () => {
    expect(amountToCents("500000.005")).toBe(BigInt(50000001));
    expect(amountToCents(500000.005)).toBe(BigInt(50000001));
    expect(amountToCents("0.005")).toBe(BigInt(1));
    expect(amountToCents("0.004")).toBe(BigInt(0));
    expect(centsToAmount(BigInt(50000001))).toBe(500000.01);
  });
});

describe("measure allocation — worked example D (the cent the float path loses)", () => {
  /**
   * THE NEGATIVE CONTROL FOR THE BigInt DECISION, and a correction of record.
   *
   * An earlier draft of `allocation.ts` justified integer-cent arithmetic by
   * claiming `Math.round(value * 100) / 100` mishandles `1000000.01 / 2`. IT
   * DOES NOT — the double nearest 500,000.005 sits slightly ABOVE the exact
   * half, so the float path rounds up and gets the right answer. The claim was
   * wrong and is recorded here as wrong rather than quietly dropped.
   *
   * The disagreement is real but RARE. Over 3,000,000 random (pool, basis)
   * draws at fund magnitudes, `Math.round(pool * basis / total * 100) / 100`
   * disagreed with exact half-up 8 times — about 3 in a million. This fixture
   * is one of those draws, and it is the case that matters:
   *
   *   pool 4,622,777.88 over basis {9,089 / 130,967}, total 140,056
   *     exact half-up   299,997.35  +  4,322,780.54  = 4,622,777.89
   *                                   residual −0.01 -> 4,322,780.53
   *     float path      299,997.34  +  4,322,780.54  = 4,622,777.88
   *
   * NOTE WHAT THE FLOAT PATH LOOKS LIKE FROM THE PAGE: its two shares sum to
   * the pool exactly, so the invariant a reviewer would check passes. The
   * smaller jurisdiction is simply one cent short, and because no residual was
   * ever computed there is no line anywhere saying a rounding decision was made
   * or who absorbed it. That is the property this module buys — not "the float
   * is usually wrong", but "when it is wrong nothing says so".
   */
  const SMALL = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const LARGE = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const VINTAGE = "2031 assessor estimate";

  const straightThrough: MeasureAllocationDescriptor = parseMeasureAllocationRule({
    version: 1,
    categories: [
      {
        id: "shared",
        label: "Shared works",
        percentOfAllocable: 100,
        distribution: { kind: "return_to_source", basisId: "population" },
      },
    ],
    basisDefinitions: [
      { id: "population", label: "Population", statedSourceNote: "Stated by the fund administrator." },
    ],
  }) as MeasureAllocationDescriptor;

  function allocate() {
    return unwrap(
      allocateMeasureReceipt({
        rule: straightThrough,
        receiptAmount: "4622777.88",
        recipients: [
          { id: SMALL, is_active: true },
          { id: LARGE, is_active: true },
        ],
        basisValues: [
          { recipient_id: SMALL, basis_id: "population", vintage_label: VINTAGE, basis_value: "9089" },
          { recipient_id: LARGE, basis_id: "population", vintage_label: VINTAGE, basis_value: "130967" },
        ],
        basisVintageLabel: VINTAGE,
      })
    );
  }

  it("gives the smaller jurisdiction the cent the float path would have taken", () => {
    const distribution = sharesOf(allocate(), "shared");
    const byRecipient = Object.fromEntries(distribution.shares.map((share) => [share.recipientId, share.amount]));

    expect(byRecipient[SMALL]).toBe(299997.35);

    // What `roundCurrencyAmount` would have produced for the same share.
    const floatShare = Math.round(((4622777.88 * 9089) / 140056) * 100) / 100;
    expect(floatShare).toBe(299997.34);
    expect(byRecipient[SMALL]).not.toBe(floatShare);
  });

  it("reports the residual and names who carries it, which the float path cannot", () => {
    const distribution = sharesOf(allocate(), "shared");
    const byRecipient = Object.fromEntries(distribution.shares.map((share) => [share.recipientId, share.amount]));

    expect(distribution.roundingResidual).toBe(-0.01);
    expect(byRecipient[LARGE]).toBe(4322780.53);
    expect(distribution.shares.find((share) => share.carriesResidual)?.recipientId).toBe(LARGE);
    expect(sumCents(distribution.shares.map((share) => share.amount))).toBe(cents(4622777.88));

    // And the float path's two shares ALSO sum to the pool — which is why the
    // missing cent is invisible without an exact residual to compare against.
    const floatSmall = Math.round(((4622777.88 * 9089) / 140056) * 100) / 100;
    const floatLarge = Math.round(((4622777.88 * 130967) / 140056) * 100) / 100;
    expect(cents(floatSmall) + cents(floatLarge)).toBe(cents(4622777.88));
  });
});

describe("measure allocation — an unreported amount is not zero", () => {
  it("refuses to allocate a period with no recorded receipt", () => {
    const outcome = allocateMeasureReceipt({ rule: cedarBasinRule, receiptAmount: null });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("unreachable");
    expect(outcome.reason).toBe("receipt_not_recorded");
    expect(outcome.message).toContain("not zero");
  });

  it("allocates a RECORDED zero, because that is a fact somebody entered", () => {
    const result = unwrap(allocateMeasureReceipt({ rule: cedarBasinRule, receiptAmount: "0.00" }));

    expect(result.receiptAmount).toBe(0);
    expect(result.allocableAmount).toBe(0);
    expect(categoryById(result, "local_streets").amount).toBe(0);
  });

  /**
   * THE DIVISOR RULE, which is the same rule one level down.
   *
   * Quillbrook has no population figure for the vintage in force. Splitting the
   * category among the three that do would inflate every one of their shares —
   * silently, and in the direction that overpays. The category is reported
   * UNDISTRIBUTED and its money is held.
   */
  it("holds a category undistributed when one active recipient has no basis value", () => {
    const result = unwrap(
      allocateCedar({
        basisValues: cedarBasisValues.filter((value) => value.recipient_id !== CEDAR_QUILLBROOK),
      })
    );

    const distribution = categoryById(result, "local_streets").distribution;
    expect(distribution.kind).toBe("undistributed");
    if (distribution.kind !== "undistributed") throw new Error("unreachable");
    expect(distribution.reason).toBe("missing_basis_values");
    expect(distribution.missingRecipientIds).toEqual([CEDAR_QUILLBROOK]);

    // The money is still ALLOCATED to the category — it is the distribution that
    // could not happen — and it is reported as undistributed.
    expect(categoryById(result, "local_streets").amount).toBe(1905686.71);
    expect(result.undistributedAmount).toBe(1905686.71);
    expect(result.notes.map((note) => note.code)).toContain("category_undistributed");

    // And nothing leaked into the other three recipients.
    expect(categoryById(result, "regional").amount).toBe(1667475.87);
  });

  it("treats a basis value from the wrong vintage as absent, not as a substitute", () => {
    const result = unwrap(
      allocateCedar({
        basisValues: cedarBasisValues.map((value) =>
          value.recipient_id === CEDAR_QUILLBROOK ? { ...value, vintage_label: "2019 certified estimate" } : value
        ),
      })
    );

    const distribution = categoryById(result, "local_streets").distribution;
    expect(distribution.kind).toBe("undistributed");
  });

  it("does not distribute a category whose recipients are all retired", () => {
    const result = unwrap(
      allocateCedar({ recipients: cedarRecipients.map((recipient) => ({ ...recipient, is_active: false })) })
    );

    const distribution = categoryById(result, "local_streets").distribution;
    expect(distribution.kind).toBe("undistributed");
    if (distribution.kind !== "undistributed") throw new Error("unreachable");
    expect(distribution.reason).toBe("no_active_recipients");
  });
});

describe("measure allocation — the annual administration cap", () => {
  /**
   * THE FOUR-QUARTER WORKED EXAMPLE, hand-derived, that the cap used to fail.
   *
   * Cedar Basin's ordinance takes 1% off the top for administration, capped at
   * 200,000 for the fiscal year. Four quarters of exactly 25,000,000:
   *
   *   Q1  1% = 250,000.00   prior 0.00        cap left 200,000.00  -> takes 200,000.00  capped
   *   Q2  1% = 250,000.00   prior 200,000.00  cap left       0.00  -> takes       0.00  capped
   *   Q3  1% = 250,000.00   prior 200,000.00  cap left       0.00  -> takes       0.00  capped
   *   Q4  1% = 250,000.00   prior 200,000.00  cap left       0.00  -> takes       0.00  capped
   *                                                    year total  =  200,000.00
   *
   * WHAT IT DID BEFORE 2026-08-12: the route never passed
   * `priorTakenByOffTheTopId`, so `priorTaken` was 0 in every period and all
   * four quarters took the full 200,000 — 800,000 against a 200,000 cap, each
   * one labelled `capped`, which is worse than unlabelled because the label
   * says the cap was applied. The figures below are the ones the ordinance
   * actually calls for, and the running total is asserted by value.
   */
  it("holds a fiscal-year cap across four quarters instead of applying it four times", () => {
    const quarterlyReceipt = "25000000.00";
    const takes: number[] = [];
    let runningTotal = 0;

    for (let quarter = 0; quarter < 4; quarter += 1) {
      const result = unwrap(
        allocateCedar({
          receiptAmount: quarterlyReceipt,
          capWindow: {
            priorTakesKnown: true,
            priorTakenByOffTheTopId: { administration: runningTotal.toFixed(2) },
          },
        })
      );
      const line = result.offTheTop[0];
      if (!line) throw new Error("no off-the-top line");

      expect(line.uncappedAmount).toBe(250000);
      expect(line.capStatus).toBe("capped");
      takes.push(line.amount);
      runningTotal = Math.round((runningTotal + line.amount) * 100) / 100;
    }

    expect(takes).toEqual([200000, 0, 0, 0]);
    expect(runningTotal).toBe(200000);
  });

  /**
   * THE INCOMPLETE-YEAR BRANCH, WHICH USED TO BE THE WORST OF THE THREE.
   *
   * It reported `not_evaluable` and then took the clause UNCAPPED, turning a
   * cap that could not be evaluated into a cap that did not apply. It now
   * limits the period to the FULL annual cap on its own — the only bound the
   * ordinance actually wrote — and says in the note that the year's total may
   * still exceed it. Never uncapped, and never pro-rated to a quarter nobody
   * wrote.
   */
  it("limits a period to the annual cap rather than taking it uncapped when prior takes are unknown", () => {
    // 1% of 30,000,000 is 300,000, above the 200,000 annual cap.
    const result = unwrap(
      allocateCedar({ receiptAmount: "30000000.00", capWindow: { priorTakesKnown: false } })
    );

    expect(result.offTheTop[0]?.capStatus).toBe("not_evaluable");
    expect(result.offTheTop[0]?.uncappedAmount).toBe(300000);
    expect(result.offTheTop[0]?.amount).toBe(200000);
    expect(result.notes.map((note) => note.code)).toContain("off_the_top_cap_not_evaluable");
    // And the money the cap kept back stays in the allocable pool.
    expect(result.allocableAmount).toBe(29800000);
  });

  it("makes no window at all behave exactly like unknown prior takes", () => {
    const noWindow = unwrap(allocateCedar({ receiptAmount: "30000000.00", capWindow: undefined }));

    expect(noWindow.offTheTop[0]?.capStatus).toBe("not_evaluable");
    expect(noWindow.offTheTop[0]?.amount).toBe(200000);
  });

  it("bites when the year to date has already used most of the cap", () => {
    const result = unwrap(
      allocateCedar({
        capWindow: { priorTakesKnown: true, priorTakenByOffTheTopId: { administration: "170000.00" } },
      })
    );

    // 200,000 cap − 170,000 already taken = 30,000 left, against 48,123.40 due.
    expect(result.offTheTop[0]?.uncappedAmount).toBe(48123.4);
    expect(result.offTheTop[0]?.amount).toBe(30000);
    expect(result.offTheTop[0]?.capStatus).toBe("capped");
    // And the money the cap kept back stays in the allocable pool.
    expect(result.allocableAmount).toBe(4782340.17);
    expect(cents(result.allocableAmount) + cents(30000)).toBe(cents(4812340.17));
  });

  it("takes nothing more once the cap is exhausted", () => {
    const result = unwrap(
      allocateCedar({
        capWindow: { priorTakesKnown: true, priorTakenByOffTheTopId: { administration: "200000.00" } },
      })
    );

    expect(result.offTheTop[0]?.amount).toBe(0);
    expect(result.allocableAmount).toBe(4812340.17);
  });

  /**
   * WRITTEN BECAUSE A MUTATION SURVIVED. Removing the clamp that stops an
   * off-the-top from taking more than the receipt changed no number any test
   * named, so the clamp was untested.
   *
   * It is not a theoretical case: a flat administration allowance written for a
   * quarterly measure meets a quarter in which the fund received almost
   * nothing. Without the clamp the allocable pool goes NEGATIVE, and every
   * category share below it becomes a negative number the allocator would then
   * try to divide among recipients — `divideHalfUp` throws on a negative
   * numerator, so the surface would get a crash instead of a fund page.
   */
  it("never lets an off-the-top take more than the receipt", () => {
    const flatAllowance = parseMeasureAllocationRule({
      version: 1,
      offTheTop: [{ id: "allowance", label: "Fixed administration allowance", amount: 500000 }],
      categories: [{ id: "all", label: "Everything", percentOfAllocable: 100, distribution: { kind: "pooled" } }],
    }) as MeasureAllocationDescriptor;

    const result = unwrap(allocateMeasureReceipt({ rule: flatAllowance, receiptAmount: "112430.08" }));

    expect(result.offTheTop[0]?.uncappedAmount).toBe(500000);
    expect(result.offTheTop[0]?.amount).toBe(112430.08);
    expect(result.offTheTopTotal).toBe(112430.08);
    expect(result.allocableAmount).toBe(0);
    expect(categoryById(result, "all").amount).toBe(0);
    expect(result.notes.map((note) => note.code)).toContain("off_the_top_exceeds_receipt");
  });

  it("applies a per-period cap without any window at all", () => {
    const perPeriod = parseMeasureAllocationRule({
      version: 1,
      offTheTop: [{ id: "admin", label: "Administration", percent: 1, capAmount: 10000, capBasis: "per_period" }],
      categories: [{ id: "all", label: "Everything", percentOfAllocable: 100, distribution: { kind: "pooled" } }],
    }) as MeasureAllocationDescriptor;

    const result = unwrap(allocateMeasureReceipt({ rule: perPeriod, receiptAmount: "4812340.17" }));
    expect(result.offTheTop[0]?.amount).toBe(10000);
    expect(result.offTheTop[0]?.capStatus).toBe("capped");
    expect(result.allocableAmount).toBe(4802340.17);
  });
});

describe("measure allocation — the descriptor refuses a rule it cannot honour", () => {
  const base = {
    version: 1,
    categories: [
      { id: "a", label: "A", percentOfAllocable: 50, distribution: { kind: "pooled" } },
      { id: "b", label: "B", percentOfAllocable: 50, distribution: { kind: "pooled" } },
    ],
  };

  it("accepts a split that sums to exactly 100", () => {
    expect(() => parseMeasureAllocationRule(base)).not.toThrow();
  });

  it("rejects a split that only nearly sums to 100", () => {
    expect(() =>
      parseMeasureAllocationRule({ ...base, categories: [{ ...base.categories[0], percentOfAllocable: 49.9 }, base.categories[1]] })
    ).toThrow(/sum to exactly 100/);
  });

  it("accepts thirds at four decimal places and rejects a fifth", () => {
    expect(() =>
      parseMeasureAllocationRule({
        version: 1,
        categories: [
          { id: "a", label: "A", percentOfAllocable: 33.3333, distribution: { kind: "pooled" } },
          { id: "b", label: "B", percentOfAllocable: 33.3333, distribution: { kind: "pooled" } },
          { id: "c", label: "C", percentOfAllocable: 33.3334, distribution: { kind: "pooled" } },
        ],
      })
    ).not.toThrow();

    expect(() =>
      parseMeasureAllocationRule({
        version: 1,
        categories: [
          { id: "a", label: "A", percentOfAllocable: 33.33335, distribution: { kind: "pooled" } },
          { id: "b", label: "B", percentOfAllocable: 66.66665, distribution: { kind: "pooled" } },
        ],
      })
    ).toThrow(/four decimal places|not a valid descriptor/);
  });

  it("rejects a reserve, a basis or a residual that names something that does not exist", () => {
    expect(() =>
      parseMeasureAllocationRule({ ...base, reserves: [{ id: "r", label: "R", basis: "category:nope", percent: 5 }] })
    ).toThrow(/unknown category/);

    expect(() =>
      parseMeasureAllocationRule({
        version: 1,
        categories: [
          { id: "a", label: "A", percentOfAllocable: 100, distribution: { kind: "return_to_source", basisId: "ghost" } },
        ],
      })
    ).toThrow(/unknown basis/);

    expect(() => parseMeasureAllocationRule({ ...base, residualCategoryId: "nope" })).toThrow(
      /unknown residual category/
    );
  });

  it("rejects duplicate ids", () => {
    expect(() =>
      parseMeasureAllocationRule({
        version: 1,
        categories: [
          { id: "a", label: "A", percentOfAllocable: 50, distribution: { kind: "pooled" } },
          { id: "a", label: "A again", percentOfAllocable: 50, distribution: { kind: "pooled" } },
        ],
      })
    ).toThrow(/duplicate category id/);
  });

  it("rejects an off-the-top that is both a percentage and an amount, or neither", () => {
    expect(() =>
      parseMeasureAllocationRule({ ...base, offTheTop: [{ id: "x", label: "X", percent: 1, amount: 100 }] })
    ).toThrow(/exactly one of percent or amount/);

    expect(() => parseMeasureAllocationRule({ ...base, offTheTop: [{ id: "x", label: "X" }] })).toThrow(
      /exactly one of percent or amount/
    );
  });

  it("rejects a cap with no window, because nobody could evaluate it", () => {
    expect(() =>
      parseMeasureAllocationRule({ ...base, offTheTop: [{ id: "x", label: "X", percent: 1, capAmount: 500 }] })
    ).toThrow(/capAmount and capBasis together/);
  });

  it("rejects a field the vocabulary does not declare rather than ignoring it", () => {
    // `.strict()` throughout: a descriptor carrying `percentOfGross` because
    // somebody guessed the field name must fail loudly, not silently allocate
    // nothing under that clause.
    expect(() =>
      parseMeasureAllocationRule({
        version: 1,
        categories: [{ id: "a", label: "A", percentOfAllocable: 100, percentOfGross: 50, distribution: { kind: "pooled" } }],
      })
    ).toThrow(/not a valid descriptor/);
  });
});

describe("measure allocation — the narrative escape hatch", () => {
  /**
   * An ordinance the closed vocabulary cannot express is STORED, not rejected,
   * and its allocations are entered by hand and labelled staff-entered. Blocking
   * those agencies was rejected; presenting hand figures as computed was
   * rejected harder.
   */
  it("parses a narrative rule and refuses to compute from it", () => {
    const rule = parseMeasureAllocationRule({
      version: 1,
      kind: "narrative",
      text: "Apportionment is set annually by the joint powers board under Article VII and is not formulaic.",
    });

    const outcome = allocateMeasureReceipt({ rule, receiptAmount: "100000.00" });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("unreachable");
    expect(outcome.reason).toBe("narrative_rule");
    expect(outcome.message).toContain("by hand");
  });
});

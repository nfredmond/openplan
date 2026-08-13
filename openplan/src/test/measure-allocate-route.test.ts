import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * ALLOCATING ONE PERIOD — the write that used to be able to empty it.
 *
 * ============================================================================
 * WHY THIS FILE EXISTS
 * ============================================================================
 *
 * `measure-allocation-arithmetic.test.ts` pins the ordinance arithmetic to the
 * cent and knows nothing about the database. This file is about the two things
 * the ROUTE is responsible for, both of which were live defects on 2026-08-12:
 *
 *   1. THE REPLACEMENT WAS TWO TRANSACTIONS. A DELETE through supabase-js
 *      followed by an INSERT through supabase-js is two HTTP requests, and any
 *      failure of the second left the period with NOTHING — no old figures, no
 *      new ones. The fix is `replace_measure_period_allocation`
 *      (20260812000014), and the assertion below is that the route reaches for
 *      that RPC and NEVER for `.delete()` on `measure_allocations`. The
 *      atomicity itself is a property of Postgres and was proven against the
 *      live database with the probe recorded at the bottom of this file; what a
 *      fake can prove is that the route uses the mechanism.
 *
 *   2. THE ANNUAL CAP NEVER BOUND. `buildMeasureCapWindow` was called without
 *      any prior-taken figures, so every period computed prior-taken = 0 and a
 *      1%-of-receipt take capped at 200,000/year took 200,000 in each of four
 *      quarters. The route now reads `measure_period_off_the_top` for the
 *      year's periods and passes the sum, so the assertions here are about the
 *      QUERY — which table, which filters — and about what the route refuses to
 *      do when that query fails.
 *
 * ============================================================================
 * WHAT THE FAKE HONOURS AND WHAT IT CANNOT
 * ============================================================================
 *
 * `.eq()` and `.in()` FILTER FOR REAL rather than being recorded and ignored.
 * A fake that returned every row regardless would make a route that forgot to
 * scope the takes query to this fund indistinguishable from one that scoped it,
 * and scoping is the entire fix. Every filter is also recorded, because on a
 * path like this the `.eq()` chain IS the tenant scope (`service-role-pages-
 * have-no-rls-net`).
 *
 * WHAT IT CANNOT PROVE: RLS, the CHECK constraints, and that a failed INSERT
 * rolls the DELETE back. Those are the live probe's job.
 */

const createClientMock = vi.fn();
const membershipMock = vi.fn();
const mockAudit = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

const MEASURE_ID = "44444444-4444-4444-8444-444444444444";
const PERIOD_ID = "55555555-5555-4555-8555-555555555555";
const WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";
const USER_ID = "00000000-0000-4000-8000-000000000001";
const RULE_ID = "66666666-6666-4666-8666-666666666666";

/** 1% off the top for administration, capped at 200,000 for the fiscal year. */
const CAPPED_RULE = {
  version: 1,
  offTheTop: [
    { id: "administration", label: "Measure administration", percent: 1, capAmount: 200000, capBasis: "fiscal_year" },
  ],
  categories: [
    { id: "streets", label: "Local streets", percentOfAllocable: 60, distribution: { kind: "pooled" } },
    { id: "transit", label: "Transit service", percentOfAllocable: 40, distribution: { kind: "pooled" } },
  ],
  basisDefinitions: [],
};

/**
 * The four quarters of FY2030, each receiving exactly 25,000,000.
 *
 * Real uuids rather than readable keys: the route validates `periodId` as one,
 * and a fixture that skipped that would exercise a door the product does not
 * have.
 */
const QUARTER_IDS = [
  "aaaaaaaa-0001-4aaa-8aaa-aaaaaaaaaaaa",
  "aaaaaaaa-0002-4aaa-8aaa-aaaaaaaaaaaa",
  "aaaaaaaa-0003-4aaa-8aaa-aaaaaaaaaaaa",
  "aaaaaaaa-0004-4aaa-8aaa-aaaaaaaaaaaa",
] as const;

const QUARTERS = ["Q1", "Q2", "Q3", "Q4"].map((label, index) => ({
  id: QUARTER_IDS[index],
  measure_fund_id: MEASURE_ID,
  period_label: `FY2030 ${label}`,
  fiscal_year_label: "FY2030",
  period_start: `2029-${String(7 + index * 3).padStart(2, "0")}-01`,
  period_end: `2029-${String(9 + index * 3).padStart(2, "0")}-30`,
  received_amount: "25000000.00",
}));

/**
 * AN ORDINANCE THAT RETURNS TWO CATEGORIES TO SOURCE.
 *
 * Deliberately different in every binding from `CAPPED_RULE`: different
 * category ids, different labels, a different basis id, two return-to-source
 * categories rather than none. A refusal that named a category correctly here
 * and by coincidence would have to coincide twice, with strings that appear
 * nowhere else in this file.
 */
const RETURN_TO_SOURCE_RULE = {
  version: 1,
  offTheTop: [],
  categories: [
    {
      id: "neighbourhood_repair",
      label: "Neighbourhood street repair",
      percentOfAllocable: 55,
      distribution: { kind: "return_to_source", basisId: "population" },
    },
    {
      id: "bus_operations",
      label: "Bus operations",
      percentOfAllocable: 30,
      distribution: { kind: "return_to_source", basisId: "population" },
    },
    { id: "corridor_works", label: "Corridor works", percentOfAllocable: 15, distribution: { kind: "pooled" } },
  ],
  basisDefinitions: [
    {
      id: "population",
      label: "Population",
      statedSourceNote: "The certified estimate named in the ordinance, stated by the Finance Director.",
    },
  ],
};

/**
 * THE SAME 1% TAKE, PLUS ONE RESERVE OF EACH KIND.
 *
 * A pool reserve comes out before the ordinance's categories are cut and a
 * purpose-level one comes out of a single category afterwards, so the two are
 * written from different figures and only the second carries a category. A
 * fixture with one of them cannot tell a route that keeps them apart from one
 * that treats every reserve as coming out of the whole receipt.
 */
const RESERVE_RULE = {
  version: 1,
  offTheTop: [
    { id: "administration", label: "Measure administration", percent: 1, capAmount: 200000, capBasis: "fiscal_year" },
  ],
  reserves: [
    { id: "rainy_day", label: "Rainy-day fund", basis: "gross", percent: 2 },
    { id: "transit_hold", label: "Bus replacement fund", basis: "category:transit", percent: 10 },
  ],
  categories: [
    { id: "streets", label: "Local streets", percentOfAllocable: 60, distribution: { kind: "pooled" } },
    { id: "transit", label: "Transit service", percentOfAllocable: 40, distribution: { kind: "pooled" } },
  ],
  basisDefinitions: [],
};

const RECIPIENT_ID = "bbbbbbbb-0001-4bbb-8bbb-bbbbbbbbbbbb";

type Scenario = {
  role: string;
  periods: Array<Record<string, unknown>>;
  takes: Array<Record<string, unknown>>;
  errors: Record<string, { message: string }>;
  rpcResult: { data: unknown; error: { message: string; code?: string } | null };
  /** The ordinance in force. Varied so a refusal cannot be hardcoded to one rule. */
  rule: Record<string, unknown>;
  recipients: Array<Record<string, unknown>>;
  basisValues: Array<Record<string, unknown>>;
};

let scenario: Scenario;
let capturedFilters: Array<{ table: string; column: string; value: unknown }> = [];
let capturedSelects: Array<{ table: string; columns: string }> = [];
let capturedRpc: Array<{ fn: string; args: Record<string, unknown> }> = [];
let capturedDeletes: string[] = [];
let capturedInserts: Array<{ table: string; rows: unknown }> = [];

function rowsFor(table: string): unknown {
  switch (table) {
    case "measure_funds":
      return { id: MEASURE_ID, workspace_id: WORKSPACE_ID, program_id: "p-1", currency_code: "USD" };
    case "measure_fund_periods":
      return scenario.periods;
    case "measure_allocation_rules":
      return [{ id: RULE_ID, measure_fund_id: MEASURE_ID, rule: scenario.rule, effective_from: "2029-01-01" }];
    case "measure_recipients":
      return scenario.recipients;
    case "measure_recipient_basis_values":
      return scenario.basisValues;
    case "measure_period_off_the_top":
      return scenario.takes;
    default:
      throw new Error(`Unexpected table: ${table}`);
  }
}

function chain(table: string, rows: unknown): Record<string, unknown> {
  const error = scenario.errors[table] ?? null;
  const result = { data: error ? null : rows, error };
  const node: Record<string, unknown> = {
    maybeSingle: async () => (Array.isArray(result.data) ? { data: result.data[0] ?? null, error } : result),
    single: async () => result,
    then: (resolve: (value: unknown) => unknown) => resolve(result),
  };
  node.eq = (column: string, value: unknown) => {
    capturedFilters.push({ table, column, value });
    const next = Array.isArray(rows)
      ? (rows as Array<Record<string, unknown>>).filter((row) => !(column in row) || row[column] === value)
      : rows;
    return chain(table, next);
  };
  node.in = (column: string, values: readonly unknown[]) => {
    capturedFilters.push({ table, column, value: values });
    const next = Array.isArray(rows)
      ? (rows as Array<Record<string, unknown>>).filter((row) => !(column in row) || values.includes(row[column]))
      : rows;
    return chain(table, next);
  };
  node.order = () => chain(table, rows);
  return node;
}

const fromMock = vi.fn((table: string) => ({
  select: (columns: string) => {
    capturedSelects.push({ table, columns });
    return chain(table, rowsFor(table));
  },
  // Present ON PURPOSE, and expected never to be reached. If the route goes
  // back to a two-statement replacement this records it rather than throwing an
  // unrelated "not a function".
  delete: () => {
    capturedDeletes.push(table);
    return chain(table, []);
  },
  insert: (rows: unknown) => {
    capturedInserts.push({ table, rows });
    return chain(table, rows);
  },
}));

const rpcMock = vi.fn(async (fn: string, args: Record<string, unknown>) => {
  capturedRpc.push({ fn, args });
  return scenario.rpcResult;
});

vi.mock("@/lib/supabase/server", () => ({ createClient: () => createClientMock() }));
vi.mock("@/lib/observability/audit", () => ({ createApiAuditLogger: () => mockAudit }));
vi.mock("@/lib/workspaces/current", () => ({
  loadCurrentWorkspaceMembership: () => membershipMock(),
}));

import { POST as allocate } from "@/app/api/measures/[measureId]/periods/[periodId]/allocate/route";

function context(periodId = PERIOD_ID) {
  return { params: Promise.resolve({ measureId: MEASURE_ID, periodId }) };
}

function post(body: unknown) {
  return new NextRequest("http://localhost/api/measures/x/periods/y/allocate", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

/** The allocation rows the RPC was handed, whatever shape the route built. */
function allocationRowsSent(): Array<Record<string, unknown>> {
  return (capturedRpc[0]?.args.p_allocations ?? []) as Array<Record<string, unknown>>;
}

function offTheTopRowsSent(): Array<Record<string, unknown>> {
  return (capturedRpc[0]?.args.p_off_the_top ?? []) as Array<Record<string, unknown>>;
}

/**
 * NOT `?? []`. The whole failure this argument exists to prevent is a route
 * that omits it and lets the function's default clear a period's reserves and
 * write none, so the tests below have to be able to see the difference between
 * "sent an empty array" and "sent nothing at all".
 */
function reserveRowsSent(): unknown {
  return capturedRpc[0]?.args.p_reserves;
}

beforeEach(() => {
  vi.clearAllMocks();
  capturedFilters = [];
  capturedSelects = [];
  capturedRpc = [];
  capturedDeletes = [];
  capturedInserts = [];
  scenario = {
    role: "admin",
    periods: QUARTERS,
    takes: [],
    errors: {},
    rule: CAPPED_RULE,
    recipients: [],
    basisValues: [],
    rpcResult: {
      data: { replaced_allocation_count: 2, replaced_off_the_top_count: 1, allocations: [] },
      error: null,
    },
  };
  membershipMock.mockImplementation(async () => ({
    membership: { workspace_id: WORKSPACE_ID, role: scenario.role },
  }));
  createClientMock.mockImplementation(() => ({
    auth: { getUser: async () => ({ data: { user: { id: USER_ID } } }) },
    from: fromMock,
    rpc: rpcMock,
  }));
});

describe("allocate route — the replacement is one transaction", () => {
  it("replaces the period through the atomic RPC and never through a bare DELETE", async () => {
    const response = await allocate(post({ mode: "descriptor" }), context(QUARTER_IDS[0]));

    expect(response.status).toBe(201);
    expect(capturedRpc.map((call) => call.fn)).toEqual(["replace_measure_period_allocation"]);
    expect(capturedRpc[0]?.args.p_measure_fund_id).toBe(MEASURE_ID);
    expect(capturedRpc[0]?.args.p_period_id).toBe(QUARTER_IDS[0]);

    // THE POINT OF THE FIX. A delete on `measure_allocations` outside the
    // function is a window in which the period holds nothing.
    expect(capturedDeletes).toEqual([]);
    expect(capturedInserts.map((entry) => entry.table)).toEqual([]);
  });

  it("keeps the previous allocation and says so when the replacement is refused", async () => {
    scenario.rpcResult = {
      data: null,
      error: { message: 'duplicate key value violates unique constraint "ux_measure_allocations_pooled"', code: "23505" },
    };

    const response = await allocate(post({ mode: "descriptor" }), context(QUARTER_IDS[0]));
    const body = await response.json();

    expect(response.status).toBe(500);
    // The sentence a person needs, and the one the two-statement path could not
    // honestly offer: the money that was there is still there.
    expect(body.details).toMatch(/previous allocation was left exactly as it was/i);
  });

  it("writes the off-the-top take beside the category rows, in the same call", async () => {
    const response = await allocate(post({ mode: "descriptor" }), context(QUARTER_IDS[0]));
    expect(response.status).toBe(201);

    const takes = offTheTopRowsSent();
    expect(takes).toHaveLength(1);
    expect(takes[0]).toMatchObject({
      off_the_top_id: "administration",
      label: "Measure administration",
      // 1% of 25,000,000 is 250,000; the annual cap of 200,000 bites.
      uncapped_amount: 250000,
      amount: 200000,
      cap_amount: 200000,
      cap_basis: "fiscal_year",
      cap_status: "capped",
      period_id: QUARTER_IDS[0],
      measure_fund_id: MEASURE_ID,
      workspace_id: WORKSPACE_ID,
      allocation_rule_id: RULE_ID,
    });
  });

  /**
   * A manual allocation has no clause list to attribute a take to. The rows
   * must be EMPTY rather than invented — and the replacement still runs, so a
   * period recomputed by hand does not keep a stale computed take.
   */
  it("sends no off-the-top rows for a manual allocation but still replaces the period", async () => {
    const response = await allocate(
      post({
        mode: "manual",
        allocations: [{ categoryId: "streets", amount: 1000, rationale: "Board minute 4, 12 March." }],
      }),
      context(QUARTER_IDS[0])
    );

    expect(response.status).toBe(201);
    expect(offTheTopRowsSent()).toEqual([]);
    // AN EMPTY ARRAY, NOT AN ABSENT ARGUMENT. Both clear the period's reserves,
    // so the distinction is invisible in the database — but omitting the
    // argument here would also be indistinguishable from a descriptor path that
    // forgot it, and that one silently loses every reserve a fund keeps.
    expect(reserveRowsSent()).toEqual([]);
    expect(allocationRowsSent()).toHaveLength(1);
    expect(allocationRowsSent()[0]).toMatchObject({ computation_basis: "manual", category_id: "streets" });
  });

  /**
   * WHAT THE PERIOD KEPT BACK, WRITTEN IN THE SAME CALL — hand-derived.
   *
   * 25,000,000.00 received under `RESERVE_RULE`:
   *
   *   1% administration            250,000.00, annual cap 200,000 bites -> 200,000.00
   *   after that                24,800,000.00
   *   rainy-day, 2% of GROSS       500,000.00   (2% of 25,000,000.00)
   *   pool to divide            24,300,000.00
   *   streets 60%               14,580,000.00
   *   transit 40%                9,720,000.00
   *   bus replacement, 10% of transit  972,000.00
   *   transit after that         8,748,000.00
   *
   * Note that the rainy-day reserve is 2% of the RECEIPT and not 2% of what was
   * left after the take: `basis: 'gross'`. 2% of 24,800,000.00 would be
   * 496,000.00, so a route or allocator that used the wrong base is four
   * thousand dollars out and this fixture says which.
   */
  it("writes what the period kept back in reserve, in the same call as the categories", async () => {
    scenario.rule = RESERVE_RULE;

    const response = await allocate(post({ mode: "descriptor" }), context(QUARTER_IDS[0]));
    expect(response.status).toBe(201);

    const reserves = reserveRowsSent() as Array<Record<string, unknown>>;
    expect(reserves).toHaveLength(2);

    // THE POOL RESERVE: out of everything that came in, no category.
    expect(reserves[0]).toMatchObject({
      reserve_id: "rainy_day",
      label: "Rainy-day fund",
      basis_kind: "gross",
      basis_category_id: null,
      basis_category_label: null,
      basis_amount: 25000000,
      percent: 2,
      amount: 500000,
      computed_amount: 500000,
      period_id: QUARTER_IDS[0],
      measure_fund_id: MEASURE_ID,
      workspace_id: WORKSPACE_ID,
      allocation_rule_id: RULE_ID,
    });

    // THE PURPOSE-LEVEL RESERVE: out of the transit share only, and carrying
    // the purpose's LABEL as well as its id. The label is denormalized so a
    // later rule version renaming the purpose cannot leave this row unable to
    // say what it came out of.
    expect(reserves[1]).toMatchObject({
      reserve_id: "transit_hold",
      label: "Bus replacement fund",
      basis_kind: "category",
      basis_category_id: "transit",
      basis_category_label: "Transit service",
      basis_amount: 9720000,
      percent: 10,
      amount: 972000,
      computed_amount: 972000,
    });
    // The prefix belongs to the descriptor's own spelling and must not survive
    // into a column a surface reads.
    expect(reserves[1].basis_kind).not.toBe("category:transit");

    // AND THE CATEGORY ROWS ARE NET OF IT. This is the invariant the public
    // page's arithmetic rests on: Σ allocations = receipt − takes − reserves.
    const rows = allocationRowsSent();
    const byCategory = new Map(rows.map((row) => [row.category_id, Number(row.amount)]));
    expect(byCategory.get("streets")).toBe(14580000);
    expect(byCategory.get("transit")).toBe(8748000);
    const allocated = rows.reduce((sum, row) => sum + Number(row.amount), 0);
    expect(allocated).toBe(25000000 - 200000 - 500000 - 972000);
    expect(allocated).toBe(23328000);
  });
});

describe("allocate route — the annual cap is evaluated against what was already taken", () => {
  it("reads this fiscal year's recorded takes, scoped to the fund and the year's periods", async () => {
    await allocate(post({ mode: "descriptor" }), context(QUARTER_IDS[0]));

    expect(capturedSelects.some((entry) => entry.table === "measure_period_off_the_top")).toBe(true);

    const takeFilters = capturedFilters.filter((entry) => entry.table === "measure_period_off_the_top");
    expect(takeFilters).toContainEqual({
      table: "measure_period_off_the_top",
      column: "measure_fund_id",
      value: MEASURE_ID,
    });
    // Scoped by the year's period ids — NOT by the fund alone, which would fold
    // every other year's takes into this year's cap.
    expect(takeFilters).toContainEqual({
      table: "measure_period_off_the_top",
      column: "period_id",
      value: [...QUARTER_IDS],
    });

    // And the periods themselves were scoped to the one fiscal year.
    expect(capturedFilters).toContainEqual({
      table: "measure_fund_periods",
      column: "fiscal_year_label",
      value: "FY2030",
    });
  });

  /**
   * THE WHOLE DEFECT, END TO END AND HAND-DERIVED.
   *
   * Four quarters of 25,000,000 under a 1% take capped at 200,000/year:
   *
   *   Q1  1% = 250,000.00   prior       0.00  -> takes 200,000.00
   *   Q2  1% = 250,000.00   prior 200,000.00  -> takes       0.00
   *   Q3  1% = 250,000.00   prior 200,000.00  -> takes       0.00
   *   Q4  1% = 250,000.00   prior 200,000.00  -> takes       0.00
   *                                 year total  200,000.00
   *
   * Before 2026-08-12 the same four calls each took 200,000 — 800,000 against a
   * 200,000 cap — and each one was labelled `capped`. The takes recorded by one
   * quarter are fed to the next exactly as the database would return them.
   */
  it("holds the annual cap across four quarters allocated in turn", async () => {
    const recorded: Array<Record<string, unknown>> = [];
    const taken: number[] = [];

    for (const quarter of QUARTERS) {
      capturedRpc = [];
      scenario.takes = [...recorded];
      const response = await allocate(post({ mode: "descriptor" }), context(quarter.id));
      expect(response.status).toBe(201);

      const line = offTheTopRowsSent()[0];
      taken.push(line.amount as number);
      recorded.push({
        period_id: quarter.id,
        measure_fund_id: MEASURE_ID,
        off_the_top_id: line.off_the_top_id,
        amount: String(line.amount),
      });
    }

    expect(taken).toEqual([200000, 0, 0, 0]);
    expect(taken.reduce((sum, value) => sum + value, 0)).toBe(200000);
  });

  /**
   * Re-allocating a quarter must not be capped against its own recorded take.
   * Q1 has already taken the whole 200,000; recomputing Q1 must take 200,000
   * again, not zero.
   */
  it("does not cap a re-allocated period against the take it is replacing", async () => {
    scenario.takes = [
      { period_id: QUARTER_IDS[0], measure_fund_id: MEASURE_ID, off_the_top_id: "administration", amount: "200000.00" },
    ];

    await allocate(post({ mode: "descriptor" }), context(QUARTER_IDS[0]));
    expect(offTheTopRowsSent()[0]?.amount).toBe(200000);

    // …while the NEXT quarter still sees it.
    capturedRpc = [];
    await allocate(post({ mode: "descriptor" }), context(QUARTER_IDS[1]));
    expect(offTheTopRowsSent()[0]?.amount).toBe(0);
  });

  /**
   * A FAILED READ IS NOT AN EMPTY YEAR. If the takes query fails, "nothing has
   * been taken" is the sentence that lets the agency take the cap again — so
   * the route refuses the allocation instead of writing one.
   */
  it("refuses to allocate at all when the recorded takes cannot be read", async () => {
    scenario.errors.measure_period_off_the_top = { message: "connection reset by peer" };

    const response = await allocate(post({ mode: "descriptor" }), context(QUARTER_IDS[0]));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toMatch(/already been taken/i);
    expect(capturedRpc).toEqual([]);
  });

  it("refuses just as hard when the year's own periods cannot be read", async () => {
    scenario.errors.measure_fund_periods = { message: "connection reset by peer" };

    const response = await allocate(post({ mode: "descriptor" }), context(QUARTER_IDS[0]));
    expect(response.status).toBe(500);
    expect(capturedRpc).toEqual([]);
  });
});

/**
 * ============================================================================
 * A BLANK VINTAGE IS REFUSED, NOT ALLOCATED AS NOTHING
 * ============================================================================
 *
 * The live defect: leaving the vintage box empty sent no `basisVintageLabel`,
 * the allocator matched recorded figures against "", every active recipient
 * counted as missing one, and every return-to-source category came out
 * `undistributed`. The period was written, the panel said "Period allocated",
 * and the cities received nothing. A planner allocating a quarter of real money
 * had no way to see that from the surface.
 *
 * BOTH DIRECTIONS ARE ASSERTED, because a refusal that fires on every blank
 * vintage would block every ordinance that never reads a basis figure — and
 * there is nothing wrong with those.
 */
describe("allocate route — a blank apportionment vintage", () => {
  beforeEach(() => {
    scenario.rule = RETURN_TO_SOURCE_RULE;
    scenario.recipients = [{ id: RECIPIENT_ID, measure_fund_id: MEASURE_ID, is_active: true }];
    scenario.basisValues = [
      {
        recipient_id: RECIPIENT_ID,
        basis_id: "population",
        vintage_label: "2029 certified estimate",
        basis_value: "41255",
      },
    ];
  });

  it("refuses the allocation and names the categories that depend on the missing edition", async () => {
    const response = await allocate(post({ mode: "descriptor" }), context(QUARTER_IDS[0]));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.reason).toBe("basis_vintage_not_stated");
    // NAMED, not counted. "A vintage is required" sends a planner to work out
    // which part of the ordinance cares; the answer is already known here.
    expect(body.error).toContain("Neighbourhood street repair");
    expect(body.error).toContain("Bus operations");
    expect(body.error).toContain("population");
    // The pooled category is not part of the refusal — it needs no figures.
    expect(body.error).not.toContain("Corridor works");

    // AND NOTHING WAS WRITTEN. The defect was not a bad message; it was a
    // period allocated with every jurisdiction's share at zero.
    expect(capturedRpc).toEqual([]);
  });

  it("refuses a vintage that is only whitespace, which is the same absence", async () => {
    const response = await allocate(
      post({ mode: "descriptor", basisVintageLabel: "   " }),
      context(QUARTER_IDS[0])
    );

    // The route's own schema trims and rejects an empty string, so this never
    // reaches the allocator — either way it must not allocate.
    expect([400, 409]).toContain(response.status);
    expect(capturedRpc).toEqual([]);
  });

  it("allocates normally once the edition in force is named", async () => {
    const response = await allocate(
      post({ mode: "descriptor", basisVintageLabel: "2029 certified estimate" }),
      context(QUARTER_IDS[0])
    );

    expect(response.status).toBe(201);
    // The whole receipt reached the one recipient through the two
    // return-to-source categories, and the pooled one holds its own share:
    // 55% + 30% of 25,000,000 = 21,250,000 to the recipient, 3,750,000 pooled.
    const rows = allocationRowsSent();
    const toRecipient = rows
      .filter((row) => row.recipient_id === RECIPIENT_ID)
      .reduce((sum, row) => sum + Number(row.amount), 0);
    expect(toRecipient).toBe(21250000);
    expect(rows.some((row) => row.category_id === "corridor_works" && Number(row.amount) === 3750000)).toBe(true);
  });

  /**
   * The other direction, with a completely different ordinance: `CAPPED_RULE`
   * has no return-to-source category, so no basis figure is ever read and a
   * blank vintage changes nothing about what is written.
   */
  it("allocates on a blank vintage when no category is divided on recorded figures", async () => {
    scenario.rule = CAPPED_RULE;
    scenario.recipients = [];
    scenario.basisValues = [];

    const response = await allocate(post({ mode: "descriptor" }), context(QUARTER_IDS[0]));

    expect(response.status).toBe(201);
    expect(capturedRpc.map((call) => call.fn)).toEqual(["replace_measure_period_allocation"]);
    expect(allocationRowsSent().map((row) => row.category_id).sort()).toEqual(["streets", "transit"]);
  });
});

/*
 * ==========================================================================
 * MUTATION RESULTS — 2026-08-12
 * ==========================================================================
 *
 * Every assertion above was verified by reverting the code it guards, running
 * this file, and confirming it failed for the right reason.
 *
 *   route: RPC call -> the old `.delete().eq().eq().select("id")` +
 *     `.insert(rows)` pair
 *       -> "replaces the period through the atomic RPC and never through a bare
 *          DELETE" fails on capturedDeletes, and the refusal test fails because
 *          a two-statement path has no "nothing was replaced" sentence to give.
 *   route: drop `takeRead` from the buildMeasureCapWindow call (the live defect)
 *       -> "holds the annual cap across four quarters" fails with
 *          [200000, 200000, 200000, 200000].
 *   route: drop `excludePeriodId`
 *       -> "does not cap a re-allocated period against the take it is
 *          replacing" fails with 0.
 *   route: scope the takes query by `measure_fund_id` alone
 *       -> the `.in("period_id", …)` filter assertion fails.
 *   route: `offTheTopRows` left empty in descriptor mode
 *       -> "writes the off-the-top take beside the category rows" fails.
 *
 * THE BLANK VINTAGE, added later the same day. Same runner, same negative
 * control as `measure-oversight-public-page.test.tsx` records.
 *
 *   allocation.ts: the refusal removed (the live defect restored)
 *       -> "refuses the allocation and names the categories" fails, and the
 *          period is allocated with every recipient's share at zero.
 *   allocation.ts: refuse on EVERY blank vintage, whatever the ordinance says
 *       -> 13 fail across this file and `measure-allocation-arithmetic`,
 *          including "allocates a RECORDED zero, because that is a fact
 *          somebody entered". That is the boundary the second half of this
 *          block exists to hold: the refusal must fire only where a rule
 *          actually reads a recorded figure.
 *   allocation.ts: the message counts the categories instead of naming them
 *       -> the refusal test fails on "Neighbourhood street repair".
 *
 * ==========================================================================
 * WHAT A FAKE CANNOT PROVE, AND HOW IT WAS PROVEN INSTEAD
 * ==========================================================================
 *
 * That a failed INSERT rolls the DELETE back is a property of Postgres, and it
 * was proven against the live local database rather than reasoned about. The
 * probe seeded a period holding one allocation and one off-the-top take, then
 * called `replace_measure_period_allocation` three times inside savepoints —
 * emulating PostgREST's per-request transaction — with (a) a −0.01 category
 * amount, (b) two pooled rows colliding on `ux_measure_allocations_pooled`, and
 * (c) a row naming a different period. Each raised
 * (`measure_allocations_amount_check`, `ux_measure_allocations_pooled`, and the
 * function's own scope check), and after each rollback the period still held
 * its original 1 allocation of 100.00 and its 1 recorded take. The happy path
 * then replaced both sets and returned
 * `replaced_allocation_count: 1, replaced_off_the_top_count: 1`.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * THE TWO ROUTES THAT PUBLISH A MEASURE FUND — the share switch and the annual
 * statement.
 *
 * ============================================================================
 * WHY THESE NEED THEIR OWN FILE
 * ============================================================================
 *
 * `measure-oversight-public-page.test.tsx` drives the page and
 * `measure-oversight-statement.test.ts` drives the document builder. Neither
 * touches the routes, and the routes are where the two decisions with
 * consequences live: whether a share token is minted or reused, and how one
 * fiscal year is CUT OUT of a fund's whole history before any figure is
 * derived. Both are the sort of mechanical plumbing this repository's audits
 * keep finding hollow.
 *
 * ============================================================================
 * WHAT IS MOCKED AND WHAT IS NOT
 * ============================================================================
 *
 * The Supabase client and the membership lookup are mocked. `canAccessWorkspaceAction`
 * is NOT — `authorizeMeasureWrite` runs for real against the real role matrix,
 * so "a viewer may not publish" is a statement about the product's policy table
 * rather than about a boolean this file invented. The ledgers and the document
 * builder are not mocked either: the statement route's output below is the
 * document a person would actually download.
 *
 * WHAT A MOCKED CLIENT CANNOT PROVE: RLS, and a missing `.select()` column.
 * Every filter the routes apply is therefore RECORDED and asserted — the
 * `.eq()` chain IS the tenant scope on a service-role-adjacent path, and a fake
 * that ignores its arguments proves none of it (the recorded lesson in
 * `service-role-pages-have-no-rls-net`).
 *
 * Mutation results are recorded at the bottom of this file.
 */

const createClientMock = vi.fn();
const membershipMock = vi.fn();
const mockAudit = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

const MEASURE_ID = "44444444-4444-4444-8444-444444444444";
const WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";
const PROGRAM_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "00000000-0000-4000-8000-000000000001";

const ORDINANCE_RULE = {
  version: 1,
  offTheTop: [{ id: "admin", label: "Administration", percent: 1 }],
  /*
   * ONE RESERVE OF EACH KIND, because they behave differently and a fixture
   * with only one cannot tell them apart. A 'gross' reserve reduces the pool
   * before the categories are cut; a 'category:' reserve comes out of ONE
   * purpose after the cut, and only the second needs the "kept back out of"
   * column to say anything.
   */
  reserves: [
    { id: "rainy_day", label: "Rainy-day fund", basis: "gross", percent: 2 },
    { id: "transit_hold", label: "Bus replacement fund", basis: "category:transit", percent: 10 },
  ],
  categories: [
    { id: "streets", label: "Local streets", percentOfAllocable: 70, distribution: { kind: "pooled" } },
    { id: "transit", label: "Transit service", percentOfAllocable: 30, distribution: { kind: "pooled" } },
  ],
  basisDefinitions: [],
};

type Scenario = {
  role: string;
  fund: Record<string, unknown> | null;
  /** Every period the FUND has. The route is expected to ask for one year. */
  periods: Array<Record<string, unknown>>;
  claims: Array<Record<string, unknown>>;
  allocations: Array<Record<string, unknown>>;
  /** What the ordinance took out of each period, across every year the fund has. */
  takes: Array<Record<string, unknown>>;
  /** What the ordinance kept back out of each period, across every year the fund has. */
  reserves: Array<Record<string, unknown>>;
  updateReturns: Array<Record<string, unknown>>;
  errors: Record<string, { message: string }>;
};

let scenario: Scenario;
let capturedSelects: Array<{ table: string; columns: string }> = [];
let capturedUpdates: Array<Record<string, unknown>> = [];
let capturedFilters: Array<{ table: string; column: string; value: unknown }> = [];

function rowsFor(table: string): unknown {
  switch (table) {
    case "measure_funds":
      return scenario.fund;
    case "programs":
      return { id: PROGRAM_ID, title: "Example County Transportation Measure" };
    case "workspaces":
      return { id: WORKSPACE_ID, name: "Example County Transportation Commission" };
    case "measure_fund_periods":
      return scenario.periods;
    case "measure_recipients":
      return [{ id: "r-1", measure_fund_id: MEASURE_ID, name: "City of Example Falls", recipient_kind: "municipality" }];
    case "measure_allocation_rules":
      return [{ id: "rule-1", rule: ORDINANCE_RULE, effective_from: "2025-01-01" }];
    case "measure_allocations":
      return scenario.allocations;
    case "measure_period_off_the_top":
      return scenario.takes;
    case "measure_period_reserve":
      return scenario.reserves;
    case "measure_claims":
      return scenario.claims;
    case "measure_moe_records":
      return [];
    default:
      throw new Error(`Unexpected table: ${table}`);
  }
}

/**
 * A chain that honours `.eq()` on the columns the routes actually scope by.
 *
 * `fiscal_year_label` is applied for real rather than recorded and ignored:
 * the whole point of the statement route is that a year is cut out BEFORE the
 * ledgers see it, and a fake that returned every row regardless would make a
 * route that forgot the filter indistinguishable from one that applied it.
 */
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
      ? (rows as Array<Record<string, unknown>>).filter(
          (row) => !(column in row) || row[column] === value
        )
      : rows;
    return chain(table, next);
  };
  node.in = (column: string, values: readonly unknown[]) => {
    capturedFilters.push({ table, column, value: values });
    const next = Array.isArray(rows)
      ? (rows as Array<Record<string, unknown>>).filter(
          (row) => !(column in row) || values.includes(row[column])
        )
      : rows;
    return chain(table, next);
  };
  node.order = () => chain(table, rows);
  node.limit = () => chain(table, rows);
  return node;
}

const fromMock = vi.fn((table: string) => ({
  select: (columns: string) => {
    capturedSelects.push({ table, columns });
    return chain(table, rowsFor(table));
  },
  update: (row: Record<string, unknown>) => {
    capturedUpdates.push(row);
    const updateChain = (): Record<string, unknown> => ({
      eq: (column: string, value: unknown) => {
        capturedFilters.push({ table: `${table}#update`, column, value });
        return updateChain();
      },
      select: (columns: string) => {
        capturedSelects.push({ table: `${table}#update`, columns });
        const error = scenario.errors[`${table}#update`] ?? null;
        return Promise.resolve({ data: error ? null : scenario.updateReturns, error });
      },
    });
    return updateChain();
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));
vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: () => mockAudit,
}));
vi.mock("@/lib/workspaces/current", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    loadCurrentWorkspaceMembership: async () => membershipMock(),
  };
});

import { POST as setPublicShare } from "@/app/api/measures/[measureId]/public-share/route";
import { GET as getStatement } from "@/app/api/measures/[measureId]/statement/route";
import { MEASURE_OVERSIGHT_COPY } from "@/lib/measures/oversight";
import { PROHIBITED_PUBLIC_CLAIMS, sourceWithoutExplicitCaveats } from "./public-page-claims-guardrails.test";

function measureContext() {
  return { params: Promise.resolve({ measureId: MEASURE_ID }) };
}

function sharePost(body: Record<string, unknown>) {
  return new NextRequest(`http://localhost/api/measures/${MEASURE_ID}/public-share`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

function statementGet(query: string) {
  return new NextRequest(`http://localhost/api/measures/${MEASURE_ID}/statement${query}`);
}

/** A fund with two fiscal years on the books — the statement must see one. */
function defaultScenario(): Scenario {
  return {
    role: "admin",
    fund: {
      id: MEASURE_ID,
      workspace_id: WORKSPACE_ID,
      program_id: PROGRAM_ID,
      currency_code: "USD",
      rate_label: "Half-cent sales tax",
      ordinance_reference: "Ordinance 2024-11",
      receipt_cadence: "quarterly",
      public_share_enabled: false,
      public_share_token: null,
    },
    periods: [
      {
        id: "p-2025",
        measure_fund_id: MEASURE_ID,
        period_label: "FY25 Q4",
        fiscal_year_label: "FY 2025",
        period_start: "2025-04-01",
        period_end: "2025-06-30",
        received_amount: "2000000.00",
        received_on: "2025-07-18",
      },
      {
        id: "p-2026a",
        measure_fund_id: MEASURE_ID,
        period_label: "FY26 Q1",
        fiscal_year_label: "FY 2026",
        period_start: "2025-07-01",
        period_end: "2025-09-30",
        received_amount: "4812340.17",
        received_on: "2025-10-20",
      },
      {
        id: "p-2026b",
        measure_fund_id: MEASURE_ID,
        period_label: "FY26 Q2",
        fiscal_year_label: "FY 2026",
        period_start: "2025-10-01",
        period_end: "2025-12-31",
        received_amount: null,
        received_on: null,
      },
    ],
    claims: [
      {
        id: "c-2025",
        measure_fund_id: MEASURE_ID,
        recipient_id: "r-1",
        period_id: "p-2025",
        fiscal_year_label: "FY 2025",
        category_id: "streets",
        amount: "900000.00",
        retention_percent: "0",
        retention_amount: "0",
        status: "paid",
        submitted_on: "2025-07-10",
        paid_on: "2025-08-01",
      },
      {
        id: "c-2026",
        measure_fund_id: MEASURE_ID,
        recipient_id: "r-1",
        period_id: "p-2026a",
        fiscal_year_label: "FY 2026",
        category_id: "streets",
        amount: "150000.00",
        retention_percent: "0",
        retention_amount: "0",
        status: "submitted",
        submitted_on: "2025-11-02",
        paid_on: null,
      },
    ],
    allocations: [
      { id: "a-2025", measure_fund_id: MEASURE_ID, period_id: "p-2025", category_id: "streets", recipient_id: null, amount: "700000.00", computation_basis: "descriptor" },
      { id: "a-2026", measure_fund_id: MEASURE_ID, period_id: "p-2026a", category_id: "streets", recipient_id: null, amount: "1200000.00", computation_basis: "descriptor" },
    ],
    /*
     * NO TAKE RECORDED AGAINST EITHER YEAR by default, which is a real state
     * and not a convenience: a fund whose periods were divided up before
     * 20260812000014 began persisting what the ordinance took has exactly these
     * rows. The statement must render that honestly rather than as an ordinance
     * that takes nothing — see the test that names this case.
     */
    takes: [],
    /*
     * AND NO RESERVE RECORDED, for exactly the same reason: a fund divided up
     * before 20260812000019 began persisting what was kept back has none of
     * these rows either. The statement must print a real 0.00 for it without
     * inventing an ordinance that keeps nothing back.
     */
    reserves: [],
    updateReturns: [{ id: MEASURE_ID, public_share_enabled: true }],
    errors: {},
  };
}

/**
 * ONE FISCAL YEAR WHOSE ARITHMETIC CLOSES, hand-derived to the cent.
 *
 * The ordinance takes 1% off the top, keeps 2% of everything that came in as a
 * rainy-day fund, divides the rest 70/30, and then keeps 10% of the transit
 * share back for bus replacement. FY 2026 has one period with money in it, and
 * every figure below was worked out on paper before this fixture existed:
 *
 *   FY26 Q1   received                    4,812,340.17
 *             1% taken off the top           48,123.40   (× 0.01, at the cent)
 *             after that                  4,764,216.77
 *             rainy-day 2% of GROSS          96,246.80   (96,246.8034 half-up)
 *             pool to divide              4,667,969.97
 *             streets 70%                 3,267,578.98   (3,267,578.979 half-up)
 *             transit 30%                 1,400,390.99   (1,400,390.991 half-up)
 *                                    Σ    4,667,969.97   (exact — no residual)
 *             bus replacement, 10% of transit  140,039.10 (140,039.099 half-up)
 *             transit after that          1,260,351.89
 *
 *             kept back in reserve, both  236,285.90     (96,246.80 + 140,039.10)
 *             left for the purposes       4,527,930.87
 *             the two headings            4,527,930.87   <- must close on this
 *                                                        (3,267,578.98 + 1,260,351.89)
 *
 * THE RESERVE IS WHAT MAKES THE CHAIN REAL. Without it `received − taken out`
 * happened to equal what the purposes were given, so a document that never
 * subtracted a reserve at all would still have closed. It cannot now: leave the
 * held-back figure out and the two headings are 236,285.90 short.
 *
 * FY25 Q4 keeps a take (20,000.00) and a reserve (12,000.00) of its own that
 * must NOT reach an FY 2026 statement. Neither table has a year column — both
 * are addressed by period — so the only thing keeping the years apart is the
 * `period_id IN (…)` join, the same join the allocations read makes. A route
 * that scoped two of the three would subtract one year's figures from another
 * year's receipts, which is worse than the section it replaced.
 */
function seedDividedYear() {
  scenario.allocations = [
    { id: "a-2025", measure_fund_id: MEASURE_ID, period_id: "p-2025", category_id: "streets", recipient_id: null, amount: "700000.00", computation_basis: "descriptor" },
    { id: "a-2026s", measure_fund_id: MEASURE_ID, period_id: "p-2026a", category_id: "streets", recipient_id: null, amount: "3267578.98", computation_basis: "descriptor" },
    { id: "a-2026t", measure_fund_id: MEASURE_ID, period_id: "p-2026a", category_id: "transit", recipient_id: null, amount: "1260351.89", computation_basis: "descriptor" },
  ];
  scenario.takes = [
    { id: "t-2025", measure_fund_id: MEASURE_ID, period_id: "p-2025", off_the_top_id: "admin", label: "Running the programme", amount: "20000.00", uncapped_amount: "20000.00", cap_amount: null, cap_basis: null, cap_status: "within_cap", allocation_rule_id: "rule-1", stated_by: USER_ID, stated_on: "2025-07-20" },
    { id: "t-2026", measure_fund_id: MEASURE_ID, period_id: "p-2026a", off_the_top_id: "admin", label: "Running the programme", amount: "48123.40", uncapped_amount: "48123.40", cap_amount: null, cap_basis: null, cap_status: "within_cap", allocation_rule_id: "rule-1", stated_by: USER_ID, stated_on: "2025-10-22" },
  ];
  scenario.reserves = [
    { id: "v-2025", measure_fund_id: MEASURE_ID, period_id: "p-2025", reserve_id: "rainy_day", label: "Rainy-day fund", basis_kind: "gross", basis_category_id: null, basis_category_label: null, basis_amount: "600000.00", percent: "2.0000", amount: "12000.00", computed_amount: "12000.00", allocation_rule_id: "rule-1", stated_by: USER_ID, stated_on: "2025-07-20" },
    { id: "v-2026r", measure_fund_id: MEASURE_ID, period_id: "p-2026a", reserve_id: "rainy_day", label: "Rainy-day fund", basis_kind: "gross", basis_category_id: null, basis_category_label: null, basis_amount: "4812340.17", percent: "2.0000", amount: "96246.80", computed_amount: "96246.80", allocation_rule_id: "rule-1", stated_by: USER_ID, stated_on: "2025-10-22" },
    { id: "v-2026t", measure_fund_id: MEASURE_ID, period_id: "p-2026a", reserve_id: "transit_hold", label: "Bus replacement fund", basis_kind: "category", basis_category_id: "transit", basis_category_label: "Transit service", basis_amount: "1400390.99", percent: "10.0000", amount: "140039.10", computed_amount: "140039.10", allocation_rule_id: "rule-1", stated_by: USER_ID, stated_on: "2025-10-22" },
  ];
}

/** The amount inside the figure block headed `heading`, as a number. */
function figureAmount(html: string, heading: string): number {
  const at = html.indexOf(`<h2>${heading}</h2>`);
  expect(at, `the statement has no figure headed "${heading}"`).toBeGreaterThan(-1);
  const amount = /<p class="figure">([^<]+)/.exec(html.slice(at))?.[1] ?? "";
  return Number(amount.replace(/[^0-9.-]/g, ""));
}

/** The "Set aside" column of the ordinance's own table, in row order. */
function setAsideColumn(html: string): number[] {
  const from = html.indexOf(MEASURE_OVERSIGHT_COPY.ordinanceHeading);
  const to = html.indexOf(MEASURE_OVERSIGHT_COPY.recipientsHeading);
  const cells = [...html.slice(from, to).matchAll(/<td class="num">([^<]*)</g)].map((match) => match[1]);
  // Two numeric cells per row — set aside, then claimed against it.
  return cells.filter((_, index) => index % 2 === 0).map((cell) => Number(cell.replace(/[^0-9.-]/g, "")));
}

beforeEach(() => {
  scenario = defaultScenario();
  capturedSelects = [];
  capturedUpdates = [];
  capturedFilters = [];
  mockAudit.info.mockClear();
  mockAudit.warn.mockClear();
  mockAudit.error.mockClear();
  createClientMock.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: USER_ID } } }) },
    from: fromMock,
  });
  membershipMock.mockResolvedValue({ membership: { workspace_id: WORKSPACE_ID, role: scenario.role } });
});

describe("the public-share route", () => {
  it("mints a 40-character token the first time the page is published", async () => {
    const response = await setPublicShare(sharePost({ enabled: true }), measureContext());
    const body = (await response.json()) as { enabled: boolean; token: string; shareUrl: string };

    expect(response.status).toBe(200);
    expect(body.enabled).toBe(true);
    expect(body.token).toHaveLength(40);
    expect(body.token).toMatch(/^[0-9a-f]{40}$/);
    expect(body.shareUrl).toBe(`/measure/${body.token}`);

    expect(capturedUpdates).toHaveLength(1);
    expect(capturedUpdates[0].public_share_enabled).toBe(true);
    expect(capturedUpdates[0].public_share_token).toBe(body.token);
  });

  it("REUSES an existing token, so a link already in an agenda keeps working", async () => {
    scenario.fund = { ...(scenario.fund as Record<string, unknown>), public_share_token: "existing-token-0123456789abcdef0123" };

    const response = await setPublicShare(sharePost({ enabled: true }), measureContext());
    const body = (await response.json()) as { token: string };

    expect(body.token).toBe("existing-token-0123456789abcdef0123");
    // The mint is the mutation to watch for: rotating on every publish would
    // silently kill every previously published link.
    expect(capturedUpdates[0]).not.toHaveProperty("public_share_token");
  });

  it("keeps the token when the page is taken down, and offers no URL", async () => {
    scenario.fund = {
      ...(scenario.fund as Record<string, unknown>),
      public_share_enabled: true,
      public_share_token: "existing-token-0123456789abcdef0123",
    };
    scenario.updateReturns = [{ id: MEASURE_ID, public_share_enabled: false }];

    const response = await setPublicShare(sharePost({ enabled: false }), measureContext());
    const body = (await response.json()) as { enabled: boolean; token: string; shareUrl: string | null };

    expect(body.enabled).toBe(false);
    expect(body.token).toBe("existing-token-0123456789abcdef0123");
    expect(body.shareUrl).toBeNull();
    expect(capturedUpdates[0]).toEqual({ public_share_enabled: false });
  });

  it("scopes the write to the caller's own workspace as well as the fund", async () => {
    await setPublicShare(sharePost({ enabled: true }), measureContext());

    const updateFilters = capturedFilters.filter((filter) => filter.table === "measure_funds#update");
    expect(updateFilters).toEqual([
      { table: "measure_funds#update", column: "id", value: MEASURE_ID },
      { table: "measure_funds#update", column: "workspace_id", value: WORKSPACE_ID },
    ]);
  });

  it("refuses a viewer, through the real role matrix", async () => {
    membershipMock.mockResolvedValue({ membership: { workspace_id: WORKSPACE_ID, role: "viewer" } });

    const response = await setPublicShare(sharePost({ enabled: true }), measureContext());

    expect(response.status).toBe(403);
    expect(capturedUpdates).toHaveLength(0);
  });

  it("does not report success when the write changed no row", async () => {
    // PostgREST answers an update that matched nothing with a 200 and no error.
    // Unhandled, this route would tell an agency its oversight page is live.
    scenario.updateReturns = [];

    const response = await setPublicShare(sharePost({ enabled: true }), measureContext());
    const body = (await response.json()) as { error: string; details: string };

    expect(response.status).toBe(409);
    expect(body.error).toBe("Nothing was changed");
    expect(body.details).toContain("changed no row");
  });

  it("rejects a payload that does not say which way to set it", async () => {
    const response = await setPublicShare(sharePost({ enable: "yes" }), measureContext());
    expect(response.status).toBe(400);
    expect(capturedUpdates).toHaveLength(0);
  });
});

describe("the annual statement route", () => {
  it("insists on being told which year it covers", async () => {
    const response = await getStatement(statementGet(""), measureContext());
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("fiscal year");
  });

  it("cuts the year out in the QUERIES, before any figure is derived", async () => {
    await getStatement(statementGet("?fiscalYearLabel=FY%202026"), measureContext());

    const yearFilters = capturedFilters.filter((filter) => filter.column === "fiscal_year_label");
    expect(yearFilters.map((filter) => filter.table).sort()).toEqual([
      "measure_claims",
      "measure_fund_periods",
      "measure_moe_records",
    ]);
    for (const filter of yearFilters) expect(filter.value).toBe("FY 2026");

    // And the allocations are scoped by THIS YEAR'S periods, not by the fund.
    const allocationScope = capturedFilters.find(
      (filter) => filter.table === "measure_allocations" && filter.column === "period_id"
    );
    expect(allocationScope?.value).toEqual(["p-2026a", "p-2026b"]);
  });

  it("reports only the requested year's money, and says which periods it has", async () => {
    const response = await getStatement(statementGet("?fiscalYearLabel=FY%202026"), measureContext());
    const html = (await response.text()).replaceAll("\u00a0", " ");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(response.headers.get("content-disposition")).toContain("annual-statement-fy-2026.html");

    // FY 2026 received 4,812,340.17 — the FY 2025 receipt of 2,000,000.00 must
    // not appear, and neither must the 6,812,340.17 that summing both gives.
    expect(html).toContain("USD 4,812,340.17");
    expect(html).not.toContain("2,000,000.00");
    expect(html).not.toContain("6,812,340.17");

    // FY26 Q2 is open and unreported, so the year is partial and says so.
    expect(html).toContain("Covers 1 reporting period in FY 2026 — FY26 Q1");
    expect(html).toContain("1 further period has been opened for this year with no amount recorded yet (FY26 Q2)");

    // Claims and allocations are the year's too: 150,000.00 asked for against
    // 1,200,000.00 set aside — never the FY 2025 figures.
    expect(html).toContain("USD 150,000.00");
    expect(html).toContain("USD 1,200,000.00");
    expect(html).not.toContain("900,000.00");
    expect(html).not.toContain("700,000.00");
    expect(html).not.toContain("1,900,000.00");
  });

  /**
   * THE SENTENCE HAS TO SAY WHAT THE FIGURE COUNTED, and until 2026-08-12 it
   * said the opposite.
   *
   * Every read in this route is filtered to one `fiscal_year_label` — the test
   * above proves it — and the claim figures were then printed under "across
   * every year on the record". On a document a citizens' oversight committee
   * downloads and files, that told a reader the number spanned the measure's
   * whole life. Four annual statements added together would have looked like
   * four copies of a lifetime total.
   *
   * The figures were always right. The sentence describing them was wrong, and
   * on a surface whose entire honesty mechanism is "no total without a sentence
   * saying what it counted", a wrong sentence is the defect.
   */
  it("says the claim figures cover the requested year, not every year on the record", async () => {
    const response = await getStatement(statementGet("?fiscalYearLabel=FY%202026"), measureContext());
    const html = (await response.text()).replaceAll(" ", " ");

    expect(html).toContain("been filed and not taken back, in FY 2026.");
    expect(html).toContain("recorded as paid, in FY 2026.");
    // THE NEGATIVE ASSERTION IS THE ONE THAT MATTERS. A page that gained the
    // year and kept the old clause would still be lying, just at greater length.
    expect(html).not.toContain("across every year on the record");
  });

  /* ---------------- what the ordinance took out before the rest was divided ---------------- */

  /**
   * THE ARITHMETIC A COMMITTEE MEMBER DOES, CLOSED ON THE DOCUMENT THEY FILE.
   *
   * Until 2026-08-12 this statement printed received, asked for, paid out and
   * the category table with no line for the amount the ordinance takes first,
   * so the obvious subtraction found money that had vanished with nothing on
   * the page to say where. Later the same day the second half landed: what the
   * ordinance KEPT BACK was equally absent, so for any fund holding a reserve
   * the chain still did not close and the document had to name a cause it could
   * not show. Both halves are asserted here against the numbers the STATEMENT
   * printed, not against the model that produced them.
   */
  it("closes the arithmetic on the rendered statement: received − taken out − kept back = the headings", async () => {
    seedDividedYear();

    const response = await getStatement(statementGet("?fiscalYearLabel=FY%202026"), measureContext());
    const html = (await response.text()).replaceAll(" ", " ");
    expect(response.status).toBe(200);

    const received = figureAmount(html, MEASURE_OVERSIGHT_COPY.divisionReceivedHeading);
    const takenOut = figureAmount(html, MEASURE_OVERSIGHT_COPY.divisionTakenOutHeading);
    const heldBack = figureAmount(html, MEASURE_OVERSIGHT_COPY.divisionHeldBackHeading);
    const leftForPurposes = figureAmount(html, MEASURE_OVERSIGHT_COPY.divisionLeftHeading);

    expect(received).toBe(4812340.17);
    expect(takenOut).toBe(48123.4);
    // 96,246.80 rainy-day + 140,039.10 bus replacement.
    expect(heldBack).toBe(236285.9);
    expect(Number((received - takenOut - heldBack).toFixed(2))).toBe(leftForPurposes);
    expect(leftForPurposes).toBe(4527930.87);

    // And the ordinance's own headings add back up to it.
    expect(setAsideColumn(html)).toEqual([3267578.98, 1260351.89]);
    expect(Number(setAsideColumn(html).reduce((sum, value) => sum + value, 0).toFixed(2))).toBe(
      leftForPurposes
    );

    // In words too, for the reader who does not add the column up.
    expect(html).toContain("the same as the amount left for them");
    // Both clauses are named, so a reader can see WHAT was taken and kept and
    // not only how much. These are the labels the agency recorded.
    expect(html).toContain("Running the programme");
    expect(html).toContain("USD 48,123.40");
    expect(html).toContain("Rainy-day fund");
    expect(html).toContain("Bus replacement fund");
    // A purpose-level reserve says which purpose. Without that column a reader
    // cannot tell 140,039.10 held out of transit from the same amount held out
    // of the whole payment, and only one of those changes what transit got.
    expect(html).toContain("Everything that came in");
    // The rate and the figure it was applied to, so the line is checkable
    // rather than merely disclosed.
    expect(html).toContain("The ordinance sets this at 2% of USD 4,812,340.17.");
    expect(html).toContain("The ordinance sets this at 10% of USD 1,400,390.99.");
  });

  it("takes the same year off the top, and keeps back the same year, as it takes the receipts from", async () => {
    seedDividedYear();

    const response = await getStatement(statementGet("?fiscalYearLabel=FY%202026"), measureContext());
    const html = (await response.text()).replaceAll(" ", " ");

    // The join, recorded: takes are scoped by THIS year's periods, like the
    // allocations, because the table has no fiscal-year column of its own.
    const takeScope = capturedFilters.filter((filter) => filter.table === "measure_period_off_the_top");
    expect(takeScope).toEqual([
      { table: "measure_period_off_the_top", column: "measure_fund_id", value: MEASURE_ID },
      { table: "measure_period_off_the_top", column: "period_id", value: ["p-2026a", "p-2026b"] },
    ]);
    // AND THE RESERVES, THE SAME WAY. A third row set scoped a fourth way would
    // subtract one span from another — the failure this section exists to
    // prevent, arriving through the newest door.
    const reserveScope = capturedFilters.filter((filter) => filter.table === "measure_period_reserve");
    expect(reserveScope).toEqual([
      { table: "measure_period_reserve", column: "measure_fund_id", value: MEASURE_ID },
      { table: "measure_period_reserve", column: "period_id", value: ["p-2026a", "p-2026b"] },
    ]);

    // FY 2025 took 20,000.00 and kept 12,000.00 of its own. Neither, nor the
    // 68,123.40 and 108,246.80 that summing both years gives, may appear under
    // an FY 2026 heading.
    expect(html).not.toContain("20,000.00");
    expect(html).not.toContain("68,123.40");
    expect(html).not.toContain("12,000.00");
    expect(html).not.toContain("108,246.80");
  });

  it("says the section covers one fiscal year, not the measure's whole history", async () => {
    seedDividedYear();

    const response = await getStatement(statementGet("?fiscalYearLabel=FY%202026"), measureContext());
    const html = (await response.text()).replaceAll(" ", " ");

    // The shared builder's coverage sentences speak of "the periods this
    // measure has divided up". On a one-year document that phrase needs the
    // year said out loud, or four annual statements read as four lifetimes.
    expect(html).toContain("Everything in this section is limited to FY 2026.");
  });

  /**
   * A YEAR WITH NO RECORDED TAKES IS NOT A YEAR THE ORDINANCE TOOK NOTHING FROM.
   *
   * The default fixture is a fund whose periods were divided up before this
   * product began persisting what was taken — the commonest real state. The
   * figure is genuinely 0.00 because that is what is on the record, and it may
   * only be printed with the sentence saying the record is what is missing.
   */
  it("prints a year with no recorded takes as a floor, not as an ordinance that took nothing", async () => {
    const response = await getStatement(statementGet("?fiscalYearLabel=FY%202026"), measureContext());
    const html = (await response.text()).replaceAll(" ", " ");

    expect(figureAmount(html, MEASURE_OVERSIGHT_COPY.divisionTakenOutHeading)).toBe(0);
    // The zero never stands alone: the caveat, and the flag that says the
    // figure is a lower bound, travel with it.
    expect(html).toContain("no amount recorded as taken out");
    expect(html).toContain("so this is at least what was taken");
    expect(html).toContain("At least this much");
    // And the difference is disclosed rather than the document looking balanced.
    expect(html).toContain("less than the amount left for them");
  });

  /**
   * A YEAR WITH NO RECORDED RESERVE IS NOT AUTOMATICALLY A DOUBTFUL YEAR.
   *
   * The default fixture has no reserve rows, which is what BOTH an ordinance
   * that keeps nothing back and a period divided up before 20260812000019 look
   * like. The figure is a real 0.00 and it does NOT carry a floor flag of its
   * own — a flag that fires for every fund without a reserve clause is a flag
   * nobody reads, and it would attach itself to the one number the whole
   * section exists to close.
   *
   * The honest half is that the possibility is still named — in the settlement
   * sentence, which fires exactly when the headings do not add up, i.e. exactly
   * when an unrecorded reserve would be doing harm.
   */
  it("prints a year with no recorded reserve as a real zero, and names the periods only when it matters", async () => {
    const response = await getStatement(statementGet("?fiscalYearLabel=FY%202026"), measureContext());
    const html = (await response.text()).replaceAll(String.fromCharCode(160), " ");

    expect(figureAmount(html, MEASURE_OVERSIGHT_COPY.divisionHeldBackHeading)).toBe(0);
    expect(html).toContain("The ordinance kept nothing back in reserve out of these periods.");
    // The headings do not add up in this fixture, so the cause IS named — by
    // period, not as a standing "some ordinances hold an amount back".
    expect(html).toContain("nothing recorded as kept back in reserve");
    expect(html).toContain("FY26 Q1");
  });

  /**
   * THE SENTENCE THAT WAS REPLACED, and must not come back.
   *
   * Before reserves were persisted the settlement had to offer "some ordinances
   * hold an amount back in reserve, and this page does not yet show what was
   * held back as its own line" on EVERY shortfall — a cause the product could
   * neither show nor rule out. It can now, so that sentence is a claim about a
   * missing capability that is no longer missing.
   */
  it("no longer offers a reserve as an unrecoverable cause", async () => {
    const response = await getStatement(statementGet("?fiscalYearLabel=FY%202026"), measureContext());
    const html = (await response.text()).replaceAll(" ", " ");

    expect(html).not.toContain("Some ordinances hold an amount back in reserve");
    expect(html).not.toContain("does not yet show what was held back");
    // The difference is still disclosed, and still not called money gone
    // astray — dropping the whole sentence would have been the other failure.
    expect(html).toContain("rather than as money that has gone astray");
  });

  it("produces no statement at all when what was taken out could not be read", async () => {
    seedDividedYear();
    scenario.errors.measure_period_off_the_top = {
      message: "permission denied for table measure_period_off_the_top",
    };

    const response = await getStatement(statementGet("?fiscalYearLabel=FY%202026"), measureContext());

    // A page can disclose the section it could not load. A document that gets
    // printed and filed cannot: a subtraction that silently does not close is
    // the artefact this section was added to prevent, and `?? []` would print
    // an ordinance that took nothing — the agency's word, put there by a failed
    // query.
    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toContain("application/json");
    const body = (await response.json()) as { error: string; hint?: string };
    expect(body.error).toContain("what the ordinance took out first");
    expect(body.hint).toContain("not an empty result");
    expect(mockAudit.error).toHaveBeenCalledWith("off_the_top_read_failed", expect.anything());
  });

  it("tells an operator to migrate when the takes table is not there yet", async () => {
    // The table arrived in 20260812000014. On a deployment mid-upgrade the read
    // fails with a missing-relation message, which is transient and fixable —
    // 503 with the fix named, never a document with a zero in it.
    scenario.errors.measure_period_off_the_top = {
      message: 'relation "public.measure_period_off_the_top" does not exist',
    };

    const response = await getStatement(statementGet("?fiscalYearLabel=FY%202026"), measureContext());

    expect(response.status).toBe(503);
    expect((await response.json()).hint).toContain("Apply the latest Supabase migrations");
  });

  /**
   * THE SAME REFUSAL FOR THE RESERVES, and it is not redundant with the one
   * above: they are two reads of two tables that fail independently, and a
   * route that guarded one and defaulted the other to `[]` would print a
   * document whose chain is complete in the middle and wrong at the end.
   */
  it("produces no statement at all when what was kept back could not be read", async () => {
    seedDividedYear();
    scenario.errors.measure_period_reserve = {
      message: "permission denied for table measure_period_reserve",
    };

    const response = await getStatement(statementGet("?fiscalYearLabel=FY%202026"), measureContext());

    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toContain("application/json");
    const body = (await response.json()) as { error: string; hint?: string };
    expect(body.error).toContain("what the ordinance kept back in reserve");
    expect(body.hint).toContain("not an empty result");
    expect(mockAudit.error).toHaveBeenCalledWith("reserve_read_failed", expect.anything());
  });

  it("tells an operator to migrate when the reserve table is not there yet", async () => {
    // The table arrived in 20260812000019. Mid-upgrade the read fails with a
    // missing-relation message, which is transient and fixable — 503 with the
    // fix named, never a document that prints a reserve of zero.
    scenario.errors.measure_period_reserve = {
      message: 'relation "public.measure_period_reserve" does not exist',
    };

    const response = await getStatement(statementGet("?fiscalYearLabel=FY%202026"), measureContext());

    expect(response.status).toBe(503);
    expect((await response.json()).hint).toContain("Apply the latest Supabase migrations");
  });

  /**
   * THE PUBLIC CLAIM BOUNDARY ON THE RENDERED DOCUMENT.
   *
   * `public-page-claims-guardrails.test.ts` derives its corpus from
   * `src/app/(public)` and, since 2026-08-12, from the API routes that serve
   * HTML. This is the deep net over what a committee member actually receives:
   * the settlement sentence and the clause notes are assembled at runtime from
   * figures and exist in no source file to scan.
   */
  it("keeps the whole rendered statement inside the public-copy boundaries", async () => {
    seedDividedYear();

    const response = await getStatement(statementGet("?fiscalYearLabel=FY%202026"), measureContext());
    const html = (await response.text()).replaceAll(" ", " ");

    // The runtime-assembled section is really in it, or both loops below pass
    // over copy that was never rendered.
    expect(html).toContain(MEASURE_OVERSIGHT_COPY.divisionHeading);
    expect(html).toContain("the same as the amount left for them");

    for (const { label, pattern } of PROHIBITED_PUBLIC_CLAIMS) {
      expect(
        sourceWithoutExplicitCaveats(html),
        `the rendered statement makes a prohibited claim: ${label}`
      ).not.toMatch(pattern);
    }
    for (const jargon of [
      "off the top",
      "off-the-top",
      "apportionment",
      "allocable",
      "residual",
      "computation basis",
      "descriptor",
    ]) {
      expect(html.toLowerCase(), `a committee-facing document must not say "${jargon}"`).not.toContain(jargon);
    }
    // And it still says in as many words what it is not.
    expect(html).toContain("not an audited financial statement");
  });

  it("refuses a year the fund has no periods for", async () => {
    const response = await getStatement(statementGet("?fiscalYearLabel=FY%202099"), measureContext());

    expect(response.status).toBe(404);
    expect((await response.json()).error).toContain("FY 2099");
  });

  it("refuses to produce a document at all when a section could not be read", async () => {
    // A page can disclose a section it could not load. A document that gets
    // printed and filed cannot.
    scenario.errors.measure_claims = { message: "permission denied for table measure_claims" };

    const response = await getStatement(statementGet("?fiscalYearLabel=FY%202026"), measureContext());

    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(mockAudit.error).toHaveBeenCalledWith("claims_read_failed", expect.anything());
  });

  it("404s for a measure the caller cannot see, rather than confirming it exists", async () => {
    scenario.fund = null;

    const response = await getStatement(statementGet("?fiscalYearLabel=FY%202026"), measureContext());
    expect(response.status).toBe(404);
  });
});

/**
 * ============================================================================
 * MUTATION LOG — recorded after a GREEN BASELINE and a NEGATIVE CONTROL.
 * ============================================================================
 *
 * BASELINE: 13 passed before any mutation.
 * NEGATIVE CONTROL: a semantically neutral rename in the statement route
 * (`const fiscalYearLabel` -> `const requestedYear`) left it green.
 *
 * Applied to the source, RUN, and reverted:
 *
 *  T1 the share route mints a fresh token even when one exists -> "REUSES an
 *     existing token" fails. Unkilled, every publish would kill every
 *     previously printed link.
 *  T2 the disable path clears `public_share_token` -> the take-down test fails
 *     on the exact update payload.
 *  T3 `.eq("workspace_id", …)` dropped from the update -> the scope assertion
 *     fails.
 *  T4 the empty-`updated` branch removed -> "does not report success when the
 *     write changed no row" fails with a 200.
 *  T5 the statement route drops `.eq("fiscal_year_label", …)` from the periods
 *     read -> the year-scoping test fails, and the money test reports
 *     6,812,340.17, which is two years of receipts under one year's heading.
 *  T6 the allocations read scoped by `measure_fund_id` only -> FY 2025's
 *     700,000.00 appears in an FY 2026 statement. Fails.
 *  T7 the read-failure loop deleted -> a failed claims read produces a
 *     document reporting a year of nothing. Fails with a 200.
 *  T8 the coverage built from every line rather than the reported ones
 *     -> "Covers 2 reporting periods" for a year with one reported. Fails.
 *  T9 `assertStatementCoverage`'s catch mapped to a 500 instead of a 404
 *     -> "refuses a year the fund has no periods for" fails.
 *
 * 9 mutations, 9 killed.
 *
 * ============================================================================
 * SECOND ROUND — 2026-08-12, what the ordinance took out first
 * ============================================================================
 *
 * BASELINE: 392 passed across this file, `measure-oversight-statement`,
 * `measure-oversight-public-page` and `public-page-claims-guardrails`.
 * NEGATIVE CONTROL: a throwaway `expect(received).toBe(1)` inside the
 * reconciliation test below exited 1; removing it exited 0.
 *
 *  T10 the takes entry removed from the load-bearing read-failure loop. 2
 *      failed — a permission failure produced a 200 statement reporting an
 *      ordinance that took nothing, and a missing table produced the same
 *      instead of the 503 that names the migration.
 *  T11 the takes read scoped by `measure_fund_id` alone, without
 *      `.in("period_id", periodIds)`. 1 failed, on the recorded filters.
 *      WORTH READING: only the filter assertion killed it. The money figures
 *      stayed right, because `buildMeasureDivisionSummary` independently drops
 *      takes belonging to periods it has no allocation for — FY 2025's take
 *      never reached the total. That is real defence in depth and it is also
 *      exactly why the `.eq()`/`.in()` chain is asserted directly: the day a
 *      fund has an allocation in one year and a take in another, the builder's
 *      filter stops saving the route, and nothing else here would have noticed.
 *  T12 `division` dropped from the `buildMeasureAnnualStatementHtml` call.
 *      Killed by TSC, not by vitest: `MeasureAnnualStatementData.division` is
 *      required, so a statement cannot be built without the section at all.
 *      `tsc --noEmit` exits 2 with "Property 'division' is missing".
 *  T13 `!model.division || !model.division.ok` removed from the narrowing.
 *      SURVIVED under vitest and was KILLED BY TSC (exit 2, TS18047 +
 *      TS2339). Recorded rather than papered over: with the takes read already
 *      refused above, there is no runtime path that reaches an unbuilt
 *      division, so no assertion here could see it. The type system is what
 *      keeps the route from asserting the fact with a cast.
 *  T14 NEUTRAL, predicted and SURVIVED: passing the takes to the model as
 *      `{ ok: true, takes: takesResult.data ?? [] }` while LEAVING the loop in
 *      place changed nothing, because the loop refuses first. Said plainly
 *      because it matters: `?? []` is guarded here by the refusal loop and not
 *      by the model input, so T10 is the mutation that protects against it.
 *
 * 3 real mutations killed (2 by vitest, 1 by tsc), 1 killed only by tsc and
 * recorded as such, 1 declared-neutral survivor.
 */

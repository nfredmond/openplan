import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PROHIBITED_PUBLIC_CLAIMS,
  sourceWithoutExplicitCaveats,
} from "./public-page-claims-guardrails.test";

/**
 * THE PUBLIC OVERSIGHT PAGE, rendered as a resident would get it.
 *
 * This file drives the REAL page component against a fake service-role client.
 * A test of `buildMeasureOversightModel` alone would prove the model is right
 * and say nothing about the surface — and the surface is where this repository
 * keeps finding the defect: a complete, tested capability that no person can
 * reach, or a caveat the model produced and the JSX dropped.
 *
 * FOUR CLAIM GUARDS, each named in the design memo and each asserted here
 * against the rendered DOM:
 *
 *   (i)   NO TOTAL PRINTS WITHOUT ITS COVERAGE SENTENCE. The fixture has an
 *         unreported quarter, so the received figure is a FLOOR — and the words
 *         that say so must be on the page beside it.
 *   (ii)  A STAFF-ENTERED ALLOCATION IS LABELLED. One of the two allocations is
 *         `computation_basis: 'manual'`; its category row carries the badge and
 *         the page leads with the sentence. The other must NOT be badged — a
 *         badge everywhere proves nothing.
 *   (iii) MAINTENANCE OF EFFORT PRINTS NOT-DETERMINED where either side is
 *         absent, and never a zero.
 *   (iv)  A FAILED READ IS NOT AN EMPTY FUND. Two separate cases: the whole
 *         record failing (an amber notice, never a 404) and one section failing
 *         (that section unavailable, the rest of the page intact).
 *
 * Plus the two things that make a token-URL page safe at all: the read is
 * matched on BOTH the token and the enabled flag, and the page is noindex.
 *
 * THE FIXTURE IS HAND-DERIVED. Every money figure asserted below was worked out
 * on paper before this file existed; the derivations are in the comments beside
 * each assertion so a future session can check them without re-running the
 * code. Mutation results are recorded at the bottom.
 */

const notFoundMock = vi.fn(() => {
  throw new Error("notFound");
});

vi.mock("next/navigation", () => ({
  notFound: () => notFoundMock(),
}));

type RecordedRead = { table: string; columns: string; filters: Array<{ column: string; value: unknown }> };

const readLog: RecordedRead[] = [];
let tableData: Record<string, unknown>;
let tableErrors: Record<string, { message: string }>;

type FakeResult = { data: unknown; error: { message: string } | null };

function fakeQuery(tableName: string, record: RecordedRead) {
  const resolveResult = (): FakeResult => {
    const error = tableErrors[tableName];
    if (error) return { data: null, error };
    const seeded = tableData[tableName];
    return { data: seeded === undefined ? [] : seeded, error: null };
  };

  const q: {
    eq: (column: string, value: unknown) => typeof q;
    in: (column: string, values: unknown) => typeof q;
    order: () => typeof q;
    limit: () => typeof q;
    maybeSingle: () => Promise<FakeResult>;
    then: (resolve: (value: FakeResult) => unknown) => Promise<unknown>;
  } = {
    eq: (column, value) => {
      record.filters.push({ column, value });
      return q;
    },
    in: (column, values) => {
      record.filters.push({ column, value: values });
      return q;
    },
    order: () => q,
    limit: () => q,
    maybeSingle: async () => resolveResult(),
    then: (resolve) => Promise.resolve(resolveResult()).then(resolve),
  };
  return q;
}

const fromMock = vi.fn((tableName: string) => ({
  select: vi.fn((columns: string) => {
    const record: RecordedRead = { table: tableName, columns, filters: [] };
    readLog.push(record);
    return fakeQuery(tableName, record);
  }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createServiceRoleClient: () => ({ from: fromMock }),
}));

import PublicMeasureOversightPage, {
  metadata,
} from "@/app/(public)/measure/[shareToken]/page";

const SHARE_TOKEN = "measure-share-token-abcdefghijklmnop";
const FUND_ID = "fund-1";

/** Non-breaking space: `currencyDisplay: "code"` separates the code with U+00A0. */
const NB = " ";

/**
 * ONE FICTIONAL MEASURE, deliberately not any real place.
 *
 * Quarterly, one percent off the top, four categories. Two quarters reported,
 * one opened and unreported, and the fourth never opened at all — which is the
 * three-state distinction `measure_fund_periods` exists for, present in one
 * fixture.
 */
function seed() {
  readLog.length = 0;
  tableErrors = {};
  tableData = {
    measure_funds: {
      id: FUND_ID,
      workspace_id: "workspace-1",
      program_id: "program-1",
      ordinance_reference: "Ordinance 2024-11",
      rate_label: "Half-cent sales tax",
      adopted_on: "2024-11-05",
      sunset_posture: "dated",
      sunset_on: "2044-06-30",
      receipt_cadence: "quarterly",
      currency_code: "USD",
    },
    programs: {
      id: "program-1",
      title: "Example County Transportation Measure",
      summary: "A half-cent sales tax approved by voters in November 2024.",
    },
    measure_fund_periods: [
      {
        // A SECOND FISCAL YEAR, and it is load-bearing rather than colour: the
        // page sums a category's set-aside and claimed figures ACROSS the
        // years the ledger reports, and a one-year fixture cannot tell a
        // running total from "the last row wins". Two mutations survived until
        // this period existed.
        id: "p0",
        measure_fund_id: FUND_ID,
        period_label: "FY25 Q4",
        fiscal_year_label: "FY 2025",
        period_start: "2025-04-01",
        period_end: "2025-06-30",
        received_amount: "2000000.00",
        received_on: "2025-07-18",
        receipt_source_note: "State remittance advice",
        forecast_amount: null,
        forecast_basis_note: null,
      },
      {
        id: "p1",
        measure_fund_id: FUND_ID,
        period_label: "FY26 Q1",
        fiscal_year_label: "FY 2026",
        period_start: "2025-07-01",
        period_end: "2025-09-30",
        received_amount: "4812340.17",
        received_on: "2025-10-20",
        receipt_source_note: "State remittance advice",
        forecast_amount: null,
        forecast_basis_note: null,
      },
      {
        id: "p2",
        measure_fund_id: FUND_ID,
        period_label: "FY26 Q2",
        fiscal_year_label: "FY 2026",
        period_start: "2025-10-01",
        period_end: "2025-12-31",
        received_amount: "5000000.00",
        received_on: "2026-01-21",
        receipt_source_note: "State remittance advice",
        forecast_amount: null,
        forecast_basis_note: null,
      },
      {
        // OPENED, NOT REPORTED. This is what makes every total below a floor.
        id: "p3",
        measure_fund_id: FUND_ID,
        period_label: "FY26 Q3",
        fiscal_year_label: "FY 2026",
        period_start: "2026-01-01",
        period_end: "2026-03-31",
        received_amount: null,
        received_on: null,
        receipt_source_note: null,
        forecast_amount: null,
        forecast_basis_note: null,
      },
    ],
    measure_recipients: [
      { id: "r-city", measure_fund_id: FUND_ID, name: "City of Example Falls", recipient_kind: "municipality", external_reference: null, is_active: true, inactive_note: null },
      { id: "r-district", measure_fund_id: FUND_ID, name: "Example Valley Transit District", recipient_kind: "transit_operator", external_reference: null, is_active: true, inactive_note: null },
    ],
    measure_allocation_rules: [
      {
        id: "rule-1",
        measure_fund_id: FUND_ID,
        effective_from: "2025-07-01",
        adopted_note: "As adopted.",
        stated_by: "user-1",
        stated_on: "2025-07-05",
        rule: {
          version: 1,
          // The cap is DECLARED here as well as recorded on the take rows. It
          // was only on the rows until 2026-08-12, so the ordinance this page
          // renders and the figures it renders disagreed about whether a limit
          // existed at all.
          offTheTop: [
            { id: "admin", label: "Administration", percent: 1, capAmount: 40000, capBasis: "per_period" },
          ],
          /*
           * ONE RESERVE OF EACH KIND, and both are load-bearing. A 'gross'
           * reserve reduces what every purpose gets; a 'category:' reserve
           * reduces exactly one. A fixture with only the first cannot tell a
           * page that attributes a purpose-level reserve correctly from one
           * that lumps it in with the pool, and the difference is which
           * heading below a resident is told lost the money.
           */
          reserves: [
            { id: "rainy_day", label: "Rainy-day fund", basis: "gross", percent: 2 },
            { id: "active_hold", label: "Trail maintenance fund", basis: "category:active", percent: 10 },
          ],
          categories: [
            { id: "local_streets", label: "Local streets and roads", percentOfAllocable: 40, distribution: { kind: "pooled" } },
            { id: "transit", label: "Transit service", percentOfAllocable: 35, distribution: { kind: "pooled" } },
            { id: "regional", label: "Regional highway projects", percentOfAllocable: 20, distribution: { kind: "pooled" } },
            { id: "active", label: "Walking and biking", percentOfAllocable: 5, distribution: { kind: "pooled" } },
          ],
          basisDefinitions: [],
        },
      },
    ],
    measure_allocations: [
      { id: "a0", measure_fund_id: FUND_ID, period_id: "p0", category_id: "local_streets", recipient_id: null, allocation_rule_id: "rule-1", amount: "800000.00", computation_basis: "descriptor", rationale: null, stated_by: null, stated_on: null },
      { id: "a1", measure_fund_id: FUND_ID, period_id: "p1", category_id: "local_streets", recipient_id: null, allocation_rule_id: "rule-1", amount: "1905686.71", computation_basis: "descriptor", rationale: null, stated_by: null, stated_on: null },
      // HAND-ENTERED. Guard (ii) hangs off exactly this row.
      { id: "a2", measure_fund_id: FUND_ID, period_id: "p1", category_id: "transit", recipient_id: null, allocation_rule_id: null, amount: "952843.35", computation_basis: "manual", rationale: "Board action 2025-08-14 set this figure directly.", stated_by: "user-1", stated_on: "2025-08-15" },
    ],
    measure_claims: [
      // PAID WITH RETENTION, so gross and net differ. Without it a rollup that
      // summed gross where it should sum net was indistinguishable from a
      // correct one — that mutation survived until this row changed.
      { id: "c0", measure_fund_id: FUND_ID, recipient_id: "r-city", period_id: "p0", fiscal_year_label: "FY 2025", category_id: "local_streets", claim_reference: "CL-0", amount: "400000.00", retention_percent: "0", retention_amount: "0", status: "paid", submitted_on: "2025-07-10", paid_on: "2025-08-01", decided_at: "2025-07-25", denial_reason: null },
      { id: "c1", measure_fund_id: FUND_ID, recipient_id: "r-city", period_id: "p1", fiscal_year_label: "FY 2026", category_id: "local_streets", claim_reference: "CL-1", amount: "1200000.00", retention_percent: "5", retention_amount: "0", status: "paid", submitted_on: "2025-11-03", paid_on: "2026-02-10", decided_at: "2026-01-30", denial_reason: null },
      { id: "c2", measure_fund_id: FUND_ID, recipient_id: "r-city", period_id: "p2", fiscal_year_label: "FY 2026", category_id: "local_streets", claim_reference: "CL-2", amount: "300000.00", retention_percent: "0", retention_amount: "0", status: "submitted", submitted_on: "2026-03-02", paid_on: null, decided_at: null, denial_reason: null },
      { id: "c3", measure_fund_id: FUND_ID, recipient_id: "r-district", period_id: "p2", fiscal_year_label: "FY 2026", category_id: "transit", claim_reference: "CL-3", amount: "750000.50", retention_percent: "5", retention_amount: "0", status: "approved", submitted_on: "2026-01-15", paid_on: null, decided_at: "2026-02-02", denial_reason: null },
      { id: "c4", measure_fund_id: FUND_ID, recipient_id: "r-district", period_id: "p2", fiscal_year_label: "FY 2026", category_id: "transit", claim_reference: "CL-4", amount: "90000.00", retention_percent: "0", retention_amount: "0", status: "denied", submitted_on: "2026-02-01", paid_on: null, decided_at: "2026-02-20", denial_reason: "Not an eligible expense under the ordinance." },
      { id: "c5", measure_fund_id: FUND_ID, recipient_id: "r-city", period_id: "p2", fiscal_year_label: "FY 2026", category_id: "active", claim_reference: null, amount: "25000.00", retention_percent: "0", retention_amount: "0", status: "draft", submitted_on: null, paid_on: null, decided_at: null, denial_reason: null },
      // A CLAIM IN A CATEGORY NOTHING HAS BEEN ALLOCATED TO. This produces a
      // category total whose `allocatedAmount` is null, which is the only way
      // to reach the branch that keeps "nothing set aside" out of being a zero.
      // That branch survived mutation until this row existed.
      { id: "c7", measure_fund_id: FUND_ID, recipient_id: "r-district", period_id: "p2", fiscal_year_label: "FY 2026", category_id: "regional", claim_reference: "CL-7", amount: "10000.00", retention_percent: "0", retention_amount: "0", status: "submitted", submitted_on: "2026-03-05", paid_on: null, decided_at: null, denial_reason: null },
    ],
    measure_moe_records: [
      { id: "m1", measure_fund_id: FUND_ID, recipient_id: "r-city", fiscal_year_label: "FY 2026", required_amount: "500000.00", reported_amount: "465000.00", basis_note: "Adopted budget", stated_by: "user-1", stated_on: "2026-07-01" },
      // ONE SIDE ABSENT. Guard (iii) hangs off exactly this row.
      { id: "m2", measure_fund_id: FUND_ID, recipient_id: "r-district", fiscal_year_label: "FY 2026", required_amount: "200000.00", reported_amount: null, basis_note: null, stated_by: "user-1", stated_on: "2026-07-01" },
    ],
  };
}

async function renderPage() {
  const ui = await PublicMeasureOversightPage({ params: Promise.resolve({ shareToken: SHARE_TOKEN }) });
  render(ui);
}

/** Collapse the non-breaking spaces Intl emits, so assertions read as money. */
function plain(text: string | null | undefined): string {
  return (text ?? "").replaceAll(NB, " ").replace(/\s+/g, " ").trim();
}

/**
 * A money string the page printed, back to a number.
 *
 * Deliberately parses what was RENDERED rather than reaching into the model.
 * The claim under test is that a reader can do the arithmetic with the figures
 * in front of them, and a test that added up the model's own numbers would pass
 * while the page printed three unrelated ones.
 */
function money(text: string | null | undefined): number {
  const match = /-?[\d,]+\.\d{2}/.exec(plain(text));
  if (!match) throw new Error(`no money figure in ${JSON.stringify(plain(text))}`);
  return Number(match[0].replaceAll(",", ""));
}

/** The amount inside one `<Figure>` card, found by its heading. */
function figureAmount(heading: string): number {
  const card = screen.getByText(heading).closest("div") as HTMLElement;
  return money(card.querySelector(".tabular-nums")?.textContent);
}

/**
 * ONE ORDINANCE APPLIED TO TWO QUARTERS, hand-derived to the cent.
 *
 * 1% off the top for administration, capped at 40,000 in any one period; 2% of
 * everything that came in kept as a rainy-day fund; 40/35/20/5 over what is
 * left; then 10% of the walking-and-biking share kept for trail maintenance.
 * EVERY FIGURE BELOW WAS WORKED OUT ON PAPER BEFORE THIS FIXTURE EXISTED —
 * half-up at the cent throughout.
 *
 *   FY25 Q4  received                     2,000,000.00
 *            1% off the top                  20,000.00   under the 40,000 limit
 *            rainy-day, 2% of gross          40,000.00
 *            pool to divide               1,940,000.00
 *            40/35/20/5                     776,000.00 / 679,000.00
 *                                           388,000.00 /  97,000.00
 *            trail fund, 10% of active        9,700.00
 *            active after that               87,300.00
 *
 *   FY26 Q1  received                     4,812,340.17
 *            1% = 48,123.40, LIMITED to      40,000.00
 *            rainy-day, 2% of gross          96,246.80   (96,246.8034 half-up)
 *            pool to divide               4,676,093.37
 *            40/35/20/5                   1,870,437.35   (…348 half-up)
 *                                         1,636,632.68   (…6795 half-up)
 *                                           935,218.67   (…674 half-up)
 *                                           233,804.67   (…6685 half-up)
 *                                       Σ 4,676,093.37   exact — no residual
 *            trail fund, 10% of active       23,380.47   (23,380.467 half-up)
 *            active after that              210,424.20
 *
 *   received in these two    6,812,340.17
 *   taken out first             60,000.00   (20,000.00 + 40,000.00)
 *   kept back in reserve       169,327.27   (136,246.80 + 33,080.47)
 *   left for the purposes    6,583,012.90
 *   the four headings        6,583,012.90   <- the page must close on this
 *                                           (2,646,437.35 + 2,315,632.68
 *                                            + 1,323,218.67 + 297,724.20)
 *
 * THREE THINGS HERE ARE NOT DECORATION.
 *
 * The cap biting in one period and not the other is the only way the clause
 * row's "the ordinance called for more than was taken" sentence is exercised,
 * and the aggregate (68,123.40 called for, 60,000.00 taken) cannot be produced
 * by a fixture where both periods behave the same.
 *
 * The RESERVES are what make the chain's third subtraction real: leave them out
 * and `received − taken out` is 6,752,340.17 while the headings add to
 * 6,583,012.90, which is exactly the shortfall this lane closed.
 *
 * And having ONE of each KIND is what distinguishes a page that attributes a
 * purpose-level reserve to its purpose from one that treats every reserve as
 * coming out of the whole payment. Only the second is wrong, and only the
 * "kept back out of" column can tell them apart.
 */
function seedTwoDividedQuarters() {
  tableData.measure_allocations = [
    { id: "d1", measure_fund_id: FUND_ID, period_id: "p0", category_id: "local_streets", recipient_id: null, allocation_rule_id: "rule-1", amount: "776000.00", computation_basis: "descriptor", rationale: null, stated_by: null, stated_on: null },
    { id: "d2", measure_fund_id: FUND_ID, period_id: "p0", category_id: "transit", recipient_id: null, allocation_rule_id: "rule-1", amount: "679000.00", computation_basis: "descriptor", rationale: null, stated_by: null, stated_on: null },
    { id: "d3", measure_fund_id: FUND_ID, period_id: "p0", category_id: "regional", recipient_id: null, allocation_rule_id: "rule-1", amount: "388000.00", computation_basis: "descriptor", rationale: null, stated_by: null, stated_on: null },
    { id: "d4", measure_fund_id: FUND_ID, period_id: "p0", category_id: "active", recipient_id: null, allocation_rule_id: "rule-1", amount: "87300.00", computation_basis: "descriptor", rationale: null, stated_by: null, stated_on: null },
    { id: "d5", measure_fund_id: FUND_ID, period_id: "p1", category_id: "local_streets", recipient_id: null, allocation_rule_id: "rule-1", amount: "1870437.35", computation_basis: "descriptor", rationale: null, stated_by: null, stated_on: null },
    { id: "d6", measure_fund_id: FUND_ID, period_id: "p1", category_id: "transit", recipient_id: null, allocation_rule_id: "rule-1", amount: "1636632.68", computation_basis: "descriptor", rationale: null, stated_by: null, stated_on: null },
    { id: "d7", measure_fund_id: FUND_ID, period_id: "p1", category_id: "regional", recipient_id: null, allocation_rule_id: "rule-1", amount: "935218.67", computation_basis: "descriptor", rationale: null, stated_by: null, stated_on: null },
    { id: "d8", measure_fund_id: FUND_ID, period_id: "p1", category_id: "active", recipient_id: null, allocation_rule_id: "rule-1", amount: "210424.20", computation_basis: "descriptor", rationale: null, stated_by: null, stated_on: null },
  ];
  tableData.measure_period_off_the_top = [
    { id: "t0", measure_fund_id: FUND_ID, period_id: "p0", off_the_top_id: "admin", label: "Administration", amount: "20000.00", uncapped_amount: "20000.00", cap_amount: "40000.00", cap_basis: "per_period", cap_status: "within_cap", allocation_rule_id: "rule-1", stated_by: "user-1", stated_on: "2025-07-20" },
    { id: "t1", measure_fund_id: FUND_ID, period_id: "p1", off_the_top_id: "admin", label: "Administration", amount: "40000.00", uncapped_amount: "48123.40", cap_amount: "40000.00", cap_basis: "per_period", cap_status: "capped", allocation_rule_id: "rule-1", stated_by: "user-1", stated_on: "2025-10-22" },
  ];
  tableData.measure_period_reserve = [
    { id: "v0r", measure_fund_id: FUND_ID, period_id: "p0", reserve_id: "rainy_day", label: "Rainy-day fund", basis_kind: "gross", basis_category_id: null, basis_category_label: null, basis_amount: "2000000.00", percent: "2.0000", amount: "40000.00", computed_amount: "40000.00", allocation_rule_id: "rule-1", stated_by: "user-1", stated_on: "2025-07-20" },
    { id: "v0a", measure_fund_id: FUND_ID, period_id: "p0", reserve_id: "active_hold", label: "Trail maintenance fund", basis_kind: "category", basis_category_id: "active", basis_category_label: "Walking and biking", basis_amount: "97000.00", percent: "10.0000", amount: "9700.00", computed_amount: "9700.00", allocation_rule_id: "rule-1", stated_by: "user-1", stated_on: "2025-07-20" },
    { id: "v1r", measure_fund_id: FUND_ID, period_id: "p1", reserve_id: "rainy_day", label: "Rainy-day fund", basis_kind: "gross", basis_category_id: null, basis_category_label: null, basis_amount: "4812340.17", percent: "2.0000", amount: "96246.80", computed_amount: "96246.80", allocation_rule_id: "rule-1", stated_by: "user-1", stated_on: "2025-10-22" },
    { id: "v1a", measure_fund_id: FUND_ID, period_id: "p1", reserve_id: "active_hold", label: "Trail maintenance fund", basis_kind: "category", basis_category_id: "active", basis_category_label: "Walking and biking", basis_amount: "233804.67", percent: "10.0000", amount: "23380.47", computed_amount: "23380.47", allocation_rule_id: "rule-1", stated_by: "user-1", stated_on: "2025-10-22" },
    /*
     * A RESERVE AGAINST A PERIOD NOBODY HAS DIVIDED UP. FY26 Q2 has money
     * recorded and no allocations, so it is outside the scope these three
     * figures span — and 250,000.00 folded into a 169,327.27 total would be
     * subtracted from receipts it was never taken out of. The chain would then
     * fail to close by that amount and the page would report a shortfall that
     * exists only because a clerk has not pressed a button yet.
     */
    { id: "v2r", measure_fund_id: FUND_ID, period_id: "p2", reserve_id: "rainy_day", label: "Rainy-day fund", basis_kind: "gross", basis_category_id: null, basis_category_label: null, basis_amount: "5000000.00", percent: "2.0000", amount: "250000.00", computed_amount: "250000.00", allocation_rule_id: "rule-1", stated_by: "user-1", stated_on: "2026-01-25" },
  ];
}

beforeEach(() => {
  seed();
  notFoundMock.mockClear();
});

describe("the public measure oversight page", () => {
  it("opens only on a token whose fund also has sharing switched on", async () => {
    await renderPage();

    const fundRead = readLog.find((read) => read.table === "measure_funds");
    expect(fundRead).toBeDefined();
    // BOTH filters. A token match alone would leave every previously-published
    // link live after an agency took the page down.
    expect(fundRead?.filters).toEqual(
      expect.arrayContaining([
        { column: "public_share_token", value: SHARE_TOKEN },
        { column: "public_share_enabled", value: true },
      ])
    );
    // And the credential itself is never selected into a public render.
    expect(fundRead?.columns).not.toContain("public_share_token,");
    expect(fundRead?.columns).not.toMatch(/\bpublic_share_token\b/);
  });

  it("is not indexable — the URL is the credential", () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  /* ---------------- guard (i) ---------------- */

  it("prints the received total as a floor, with the sentence that says what it counted", async () => {
    await renderPage();

    // 2,000,000.00 + 4,812,340.17 + 5,000,000.00 = 11,812,340.17. FY26 Q3 is
    // open and unreported, so the total is a lower bound, and FY26 Q4 was never
    // opened at all — which this page cannot even see.
    expect(plain(screen.getByText(/USD.11,812,340\.17/).textContent)).toBe("USD 11,812,340.17");

    const coverage = screen.getByText(/Adds up the 3 reporting periods/);
    expect(plain(coverage.textContent)).toBe(
      "Adds up the 3 reporting periods the agency has recorded a receipt for, covering April 1, 2025 to " +
        "December 31, 2025. 1 period has been opened with no amount recorded yet (FY26 Q3), so this is at " +
        "least what came in — not necessarily all of it."
    );
    // The floor is also said in a word beside the number, for a reader who does
    // not read the sentence. Scoped to THIS figure's own card: the page carries
    // more than one figure that can be a floor, and a bare `getByText` here
    // would pass on any of them — including one in a different section about a
    // different amount.
    expect(within(coverage.closest("div") as HTMLElement).getByText("At least this much")).toBeTruthy();
  });

  it("names an unreported period as unreported rather than as zero", async () => {
    await renderPage();

    const row = screen.getByText("FY26 Q3").closest("tr");
    expect(row).toBeTruthy();
    expect(within(row as HTMLElement).getByText("Not reported yet")).toBeTruthy();
    // The single most important negative assertion on this page.
    expect(plain((row as HTMLElement).textContent)).not.toMatch(/USD 0\.00/);
  });

  it("says what the claim totals counted and what they left out", async () => {
    await renderPage();

    // Claimed = 400,000.00 + 1,200,000.00 + 300,000.00 + 750,000.50 + 10,000.00
    //         = 2,660,000.50 over five claims. Draft and denied are excluded.
    expect(plain(screen.getByText(/USD.2,660,000\.50/).textContent)).toBe("USD 2,660,000.50");
    expect(
      plain(screen.getByText(/Adds up the 5 claims that have been filed/).textContent)
    ).toBe(
      "Adds up the 5 claims that have been filed and not taken back, across every year on the record. " +
        "Not included: 1 still being prepared, 1 turned down and 0 withdrawn."
    );

    // Paid = the two paid claims' NET. CL-0 has no retention (400,000.00);
    // CL-1 withholds 5% of 1,200,000.00 = 60,000.00, so its net is
    // 1,140,000.00. Total 1,540,000.00 — deliberately NOT the gross, which
    // would be 1,600,000.00.
    const paidBlock = screen
      .getByText(/Adds up the 2 claims the agency has recorded as paid/)
      .closest("div") as HTMLElement;
    expect(plain(paidBlock.textContent)).toContain("USD 1,540,000.00");
    expect(plain(paidBlock.textContent)).not.toContain("USD 1,600,000.00");
    // Retention is held back, so the paid figure says it is not the whole story.
    expect(plain(paidBlock.textContent)).toContain(
      "Amounts the agency is holding back until work is finished are not part of this figure."
    );
  });

  /* ---------------- guard (ii) ---------------- */

  it("labels the hand-entered allocation and only the hand-entered one", async () => {
    await renderPage();

    const transitRow = screen.getByText("Transit service").closest("tr") as HTMLElement;
    expect(within(transitRow).getByText("Entered by staff")).toBeTruthy();
    // 952,843.35 set aside, 750,000.50 claimed against it (the denied 90,000
    // consumes no ceiling).
    expect(plain(transitRow.textContent)).toContain("USD 952,843.35");
    expect(plain(transitRow.textContent)).toContain("USD 750,000.50");

    const streetsRow = screen.getByText("Local streets and roads").closest("tr") as HTMLElement;
    expect(within(streetsRow).queryByText("Entered by staff")).toBeNull();
    // ACROSS BOTH YEARS: 800,000.00 (FY 2025) + 1,905,686.71 (FY 2026)
    // = 2,705,686.71 set aside, and 400,000.00 + 1,200,000.00 + 300,000.00
    // = 1,900,000.00 claimed against it. Neither is the last year's figure
    // alone, which is what a rollup that forgot its accumulator would print.
    expect(plain(streetsRow.textContent)).toContain("USD 2,705,686.71");
    expect(plain(streetsRow.textContent)).toContain("USD 1,900,000.00");
    expect(plain(streetsRow.textContent)).not.toContain("USD 1,905,686.71");

    // And the page leads with the sentence, once.
    expect(
      screen.getAllByText(/typed in by agency staff rather than worked out from the ordinance/).length
    ).toBeGreaterThan(0);
  });

  it("does not invent a set-aside for a category nothing has been allocated to", async () => {
    await renderPage();

    // Regional has a claim against it (10,000.00) and no allocation, so its
    // ceiling is UNKNOWN — not zero. A zero here would read as "the ordinance
    // set nothing aside for regional projects", which is a claim about an
    // adopted ordinance that this page has no basis for.
    const regionalRow = screen.getByText("Regional highway projects").closest("tr") as HTMLElement;
    expect(within(regionalRow).getByText("Nothing set aside on the record")).toBeTruthy();
    expect(plain(regionalRow.textContent)).toContain("USD 10,000.00");
    expect(plain(regionalRow.textContent)).not.toContain("USD 0.00");
  });

  /* ---------------- the arithmetic closes ----------------
   *
   * The defect this covers: the amount the ordinance takes before the
   * categories are cut appeared NOWHERE on this page. A committee member
   * subtracting what the headings received from what came in found a gap with
   * nothing on the page to explain it — on the one surface whose reader has no
   * other copy of the figures and no way to ask.
   */

  it("shows what the ordinance took out first, clause by clause, with the limit that bit", async () => {
    seedTwoDividedQuarters();
    await renderPage();

    const clauseRow = screen.getByText("Administration").closest("tr") as HTMLElement;
    // 20,000.00 + 40,000.00 across the two quarters.
    expect(plain(clauseRow.textContent)).toContain("USD 60,000.00");
    // And what the ordinance's own working called for before the limit applied:
    // 20,000.00 + 48,123.40 = 68,123.40. A page that printed only what was
    // taken could not tell a committee that a limit had been reached at all.
    expect(plain(clauseRow.textContent)).toContain("USD 68,123.40");
    expect(plain(clauseRow.textContent)).toContain("because the ordinance sets a limit on it");
  });

  it("shows what the ordinance kept back, out of what, and at what rate", async () => {
    seedTwoDividedQuarters();
    await renderPage();

    // 40,000.00 + 96,246.80 across the two quarters, out of everything that
    // came in — and the rate and base, so the line can be checked rather than
    // merely believed.
    const poolRow = screen.getByText("Rainy-day fund").closest("tr") as HTMLElement;
    expect(plain(poolRow.textContent)).toContain("USD 136,246.80");
    expect(plain(poolRow.textContent)).toContain("Everything that came in");
    expect(plain(poolRow.textContent)).toContain("The ordinance sets this at 2% of USD 6,812,340.17.");
    // NOT 386,246.80: FY26 Q2 has a recorded reserve and nobody has divided it
    // up, so it is outside the scope these figures span. Counting it would
    // subtract money from receipts that are not in the total above it.
    expect(plain(poolRow.textContent)).not.toContain("386,246.80");

    // 9,700.00 + 23,380.47, out of ONE purpose — named. Without the name a
    // resident cannot tell which heading below lost the money, and the two
    // reserves would look like the same kind of thing.
    const categoryRow = screen.getByText("Trail maintenance fund").closest("tr") as HTMLElement;
    expect(plain(categoryRow.textContent)).toContain("USD 33,080.47");
    expect(plain(categoryRow.textContent)).toContain("Walking and biking");
    expect(plain(categoryRow.textContent)).toContain("The ordinance sets this at 10% of USD 330,804.67.");
    expect(plain(categoryRow.textContent)).not.toContain("Everything that came in");
  });

  it("closes the arithmetic on the rendered page: received − taken out − kept back = the headings", async () => {
    seedTwoDividedQuarters();
    await renderPage();

    /* ---- the chain, read back off the page ---- */
    const received = figureAmount("Received in these periods");
    const takenOut = figureAmount("Taken out first");
    const heldBack = figureAmount("Kept back in reserve");
    const leftForPurposes = figureAmount("Left for the purposes below");

    expect(received).toBe(6812340.17);
    expect(takenOut).toBe(60000);
    expect(heldBack).toBe(169327.27);
    // THE SUBTRACTION A COMMITTEE MEMBER DOES, asserted against the four
    // numbers the page actually printed rather than against the model.
    expect(Number((received - takenOut - heldBack).toFixed(2))).toBe(leftForPurposes);
    expect(leftForPurposes).toBe(6583012.9);
    // And NOT the figure the page printed before reserves were recorded. That
    // number is still a correct intermediate — it is what was left after the
    // amounts taken out — and printing it as what the purposes were given
    // overstated them by the whole reserve.
    expect(leftForPurposes).not.toBe(6752340.17);

    /* ---- and the headings add back up to it ---- */
    const ordinanceTable = screen.getByText("Set aside").closest("table") as HTMLElement;
    const setAsideCells = [...ordinanceTable.querySelectorAll("tbody tr")].map((row) =>
      money(row.children[2].textContent)
    );
    // 2,646,437.35 + 2,315,632.68 + 1,323,218.67 + 297,724.20, each the sum of
    // the two quarters' shares under that heading, net of the trail fund on the
    // last one.
    expect(setAsideCells).toEqual([2646437.35, 2315632.68, 1323218.67, 297724.2]);
    expect(Number(setAsideCells.reduce((sum, value) => sum + value, 0).toFixed(2))).toBe(leftForPurposes);

    // The page says so in words too, because a reader who does not add the
    // column up is still owed the answer.
    expect(
      screen.getByText(/The purposes below add up to USD.6,583,012\.90 — the same as the amount left for them/)
    ).toBeTruthy();
  });

  it("scopes the three figures to the periods that have actually been divided up, and says which", async () => {
    seedTwoDividedQuarters();
    await renderPage();

    const card = screen.getByText("Received in these periods").closest("div") as HTMLElement;
    const coverage = plain(card.textContent);
    // NOT the fund's lifetime 11,812,340.17: FY26 Q2 has money recorded that
    // nobody has divided up, and counting it would manufacture a shortfall that
    // is an artefact of when a clerk last pressed a button.
    expect(coverage).toContain("FY25 Q4 and FY26 Q1");
    expect(coverage).toContain("1 further period has money recorded but has not been divided up yet (FY26 Q2)");
    expect(coverage).not.toContain("11,812,340.17");
  });

  it("states the difference as a figure when the headings do not add up to what was left", async () => {
    seedTwoDividedQuarters();
    // One heading's quarter goes missing from the record — the shape a partial
    // recompute or a hand-edited row leaves behind.
    tableData.measure_allocations = (tableData.measure_allocations as unknown[]).filter(
      (row) => (row as { id: string }).id !== "d7"
    );

    await renderPage();

    // 6,583,012.90 − 935,218.67 = 5,647,794.23 shown, so 935,218.67 is
    // unaccounted for and the page says so rather than looking balanced.
    expect(screen.getByText(/USD.935,218\.67 less than the amount left for them/)).toBeTruthy();
    expect(screen.queryByText(/the same as the amount left for them/)).toBeNull();
    // Every period here HAS its reserves recorded, so the settlement may not
    // offer an unrecorded reserve as a cause. Before 2026-08-12 it offered one
    // unconditionally, which on this fixture would be a false explanation for a
    // difference whose real cause is a missing allocation row.
    expect(screen.queryByText(/nothing recorded as kept back in reserve/)).toBeNull();
    expect(screen.queryByText(/Some ordinances hold an amount back in reserve/)).toBeNull();
  });

  /**
   * THE OTHER DIRECTION, and the reason the cause is named conditionally.
   *
   * A fund divided up before 20260812000019 has allocations and no reserve
   * rows. The page cannot tell that apart from an ordinance that keeps nothing
   * back — so it says nothing while the arithmetic closes, and names the
   * periods only once the headings fall short, which is the only circumstance
   * in which an unrecorded reserve would explain anything.
   */
  it("names the periods with no recorded reserve only when the headings fall short", async () => {
    seedTwoDividedQuarters();
    tableData.measure_period_reserve = [];

    await renderPage();

    // With the reserves gone the chain says 6,752,340.17 was left and the
    // headings still add to 6,583,012.90 — 169,327.27 short, which is exactly
    // the reserve nobody recorded.
    expect(figureAmount("Kept back in reserve")).toBe(0);
    expect(screen.getByText("The ordinance kept nothing back in reserve out of these periods.")).toBeTruthy();
    expect(screen.getByText(/USD.169,327\.27 less than the amount left for them/)).toBeTruthy();
    const cause = screen.getByText(/nothing recorded as kept back in reserve/);
    expect(plain(cause.textContent)).toContain("FY25 Q4 and FY26 Q1");
    expect(plain(cause.textContent)).toContain(
      "divided up before this page began recording reserves as their own line"
    );
  });

  it("does not print a failed reserves read as an ordinance that kept nothing back", async () => {
    seedTwoDividedQuarters();
    tableErrors.measure_period_reserve = { message: "permission denied for table measure_period_reserve" };

    await renderPage();

    // A zero here says the ordinance keeps nothing back, which is the agency's
    // word and not a failed query's — and the whole chain goes with it, because
    // the four figures only mean anything together.
    expect(screen.queryByText("Kept back in reserve")).toBeNull();
    expect(screen.queryByText("Taken out first")).toBeNull();
    expect(screen.getByText(/it does not mean nothing was kept back/)).toBeTruthy();
    expect(screen.getByText(/some sections are shown as unavailable rather than as zero/)).toBeTruthy();
  });

  it("does not print a failed takes read as an ordinance that took nothing", async () => {
    seedTwoDividedQuarters();
    tableErrors.measure_period_off_the_top = { message: "permission denied for table measure_period_off_the_top" };

    await renderPage();

    // THE SENTENCE THAT MUST NOT APPEAR: a zero here says the ordinance takes
    // nothing before dividing, which for most measures is false and is the
    // agency's word, not a failed query's.
    expect(screen.queryByText("Taken out first")).toBeNull();
    expect(screen.getByText(/it does not mean nothing was taken out/)).toBeTruthy();
    expect(screen.getByText(/some sections are shown as unavailable rather than as zero/)).toBeTruthy();
  });

  it("says nothing has been divided up rather than showing a row of zeros", async () => {
    // The default fixture's allocations are replaced with none at all: the fund
    // has receipts, and no period has had the ordinance applied to it.
    tableData.measure_allocations = [];

    await renderPage();

    expect(
      screen.getByText(/No reporting period has been divided up under the ordinance yet/)
    ).toBeTruthy();
    expect(screen.queryByText("Taken out first")).toBeNull();
  });

  /* ---------------- guard (iii) ---------------- */

  it("says not-determined where one side of a local-spending commitment is missing", async () => {
    await renderPage();

    const districtRow = screen
      .getAllByText("Example Valley Transit District")
      .map((node) => node.closest("tr") as HTMLElement)
      .find((row) => row && /Not recorded/.test(row.textContent ?? ""));
    expect(districtRow).toBeTruthy();
    expect(plain((districtRow as HTMLElement).textContent)).toContain("Not enough recorded to say");
    expect(plain((districtRow as HTMLElement).textContent)).toContain(
      "The recipient has not reported its own spending for this year."
    );
    // Never a computed difference against an absent figure.
    expect(plain((districtRow as HTMLElement).textContent)).not.toMatch(/less than required|more than required/);

    // The comparable one DOES get a difference: 465,000.00 − 500,000.00 = −35,000.00.
    const cityRow = screen
      .getAllByText("City of Example Falls")
      .map((node) => node.closest("tr") as HTMLElement)
      .find((row) => row && /less than required/.test(row.textContent ?? ""));
    expect(plain((cityRow as HTMLElement).textContent)).toContain("USD 35,000.00 less than required");

    // And the page refuses to net one area's surplus against another's shortfall.
    expect(
      screen.getAllByText(/one area spending more does not make up for another spending less/).length
    ).toBeGreaterThan(0);
  });

  /* ---------------- who asked and what they got ---------------- */

  it("rolls claims up per recipient without double counting or dropping the excluded ones", async () => {
    await renderPage();

    const cityRow = screen
      .getAllByText("City of Example Falls")
      .map((node) => node.closest("tr") as HTMLElement)
      .find((row) => row && /asked|claim/i.test(row.textContent ?? "") && /paid/i.test(row.textContent ?? ""));
    const cityText = plain((cityRow as HTMLElement).textContent);
    // Asked for 400,000.00 + 1,200,000.00 + 300,000.00 = 1,900,000.00 over 3
    // claims. Paid is NET: 400,000.00 + 1,140,000.00 = 1,540,000.00, never the
    // 1,600,000.00 gross. The 25,000.00 draft is counted in neither.
    expect(cityText).toContain("USD 1,900,000.00");
    expect(cityText).toContain("3 claims");
    expect(cityText).toContain("USD 1,540,000.00");
    expect(cityText).not.toContain("USD 1,600,000.00");
    expect(cityText).toContain("2 paid");
    expect(cityText).toContain("1 waiting on a decision");
    expect(cityText).toContain("1 not counted");
    expect(cityText).toContain("FY 2025 and FY 2026");
  });

  /* ---------------- guard (iv) ---------------- */

  it("shows a failed record read as a load failure, never as a 404 and never as an empty fund", async () => {
    tableErrors.measure_funds = { message: "column measure_funds.public_share_enabled does not exist" };

    await renderPage();

    expect(notFoundMock).not.toHaveBeenCalled();
    expect(screen.getByText("This record could not be loaded")).toBeTruthy();
    expect(
      screen.getByText(/it does not mean the record is missing, unpublished, or that the fund has received nothing/)
    ).toBeTruthy();
    // The database's own words are operator detail and stay off a public page.
    expect(screen.queryByText(/public_share_enabled does not exist/)).toBeNull();
  });

  it("404s on a token that matches nothing — that is a real absence", async () => {
    tableData.measure_funds = null;

    await expect(renderPage()).rejects.toThrow("notFound");
    expect(notFoundMock).toHaveBeenCalled();
  });

  it("shows one failed section as unavailable and keeps the rest of the page", async () => {
    tableErrors.measure_claims = { message: "permission denied for table measure_claims" };

    await renderPage();

    // The receipts still render...
    expect(screen.getByText(/USD.11,812,340\.17/)).toBeTruthy();
    // ...and the claims say they could not be read, in the resident's words.
    expect(
      screen.getAllByText(/it does not mean nobody has claimed anything/).length
    ).toBeGreaterThan(0);
    expect(
      screen.getByText(/some sections are shown as unavailable rather than as zero/)
    ).toBeTruthy();
  });

  it("says the ordinance could not be read rather than showing no purposes", async () => {
    tableErrors.measure_allocation_rules = { message: "permission denied for table measure_allocation_rules" };

    await renderPage();

    expect(
      screen.getByText(/That is a problem loading the page, not an ordinance that says nothing/)
    ).toBeTruthy();
    expect(screen.queryByText("Local streets and roads")).toBeNull();
  });

  /*
   * ---------------- guard (iv), the three reads that arrived as `[]` ----------------
   *
   * Each of these was `result.data ?? []` until 2026-08-12, and each `??`
   * turned a failed query into a sentence about the agency. The assertions
   * that matter here are the NEGATIVE ones: what the page must no longer say.
   * A test that only checked for the new amber wording would pass while the
   * old false sentence sat underneath it.
   */

  it("does not print a failed allocations read as nothing set aside", async () => {
    tableErrors.measure_allocations = { message: "permission denied for table measure_allocations" };

    await renderPage();

    // THE SENTENCE THAT MUST BE GONE. Under every heading of the ordinance, it
    // said the agency had put no money behind its own voter-approved purposes.
    expect(screen.queryByText("Nothing set aside on the record")).toBeNull();
    expect(screen.getAllByText("Could not be loaded").length).toBeGreaterThan(0);
    // The headings themselves still render — the ordinance read fine.
    expect(screen.getByText("Local streets and roads")).toBeTruthy();
    expect(screen.getByText(/it does not mean nothing has been set aside/)).toBeTruthy();
  });

  it("does not print a failed maintenance-of-effort read as no commitments", async () => {
    tableErrors.measure_moe_records = { message: "permission denied for table measure_moe_records" };

    await renderPage();

    // A statement about what an ordinance requires of every city in the county,
    // made on the agency's behalf by a failed query.
    expect(screen.queryByText("No local-spending commitments have been recorded for this measure.")).toBeNull();
    expect(screen.getByText(/it does not mean no area promised anything/)).toBeTruthy();
  });

  it("does not print a failed recipients read as areas the agency never named", async () => {
    tableErrors.measure_recipients = { message: "permission denied for table measure_recipients" };

    await renderPage();

    expect(screen.queryByText(/An area the agency has not named/)).toBeNull();
    expect(screen.getByText(/it does not mean nobody has asked/)).toBeTruthy();
  });

  /*
   * ---------------- guard (v): the public claim boundary, on the RENDERED page ----------------
   *
   * `public-page-claims-guardrails.test.ts` scans this page's source and, since
   * 2026-08-12, the copy modules it imports. That is the cheap net over every
   * public surface. This is the deep one over the surface whose figures are
   * money: it applies the same patterns to the HTML a resident actually gets,
   * so copy assembled at runtime, or reached through a module the file scanner
   * does not follow, is still covered.
   */
  it("makes no audited, official, certified or final claim about the figures it shows", async () => {
    await renderPage();

    const rendered = sourceWithoutExplicitCaveats(plain(document.body.textContent));
    for (const { label, pattern } of PROHIBITED_PUBLIC_CLAIMS) {
      expect(rendered, `the rendered public page makes a prohibited claim: ${label}`).not.toMatch(pattern);
    }
  });

  /**
   * THE SAME TWO GUARDS OVER THE SECTION THE DEFAULT FIXTURE CANNOT REACH.
   *
   * The reconciliation's sentences are assembled at runtime from figures, and
   * most of them only appear once a period has actually been divided up — the
   * clause rows, the limit note, the sentence that says the headings add up.
   * The file-scanning guard sees the literal fragments in `oversight.ts`; only
   * a render of THIS fixture sees the assembled sentence a resident gets.
   */
  it("keeps the reconciliation's own words inside both public-copy boundaries", async () => {
    seedTwoDividedQuarters();
    await renderPage();

    const body = plain(document.body.textContent);
    // The section is really on the page — otherwise both loops below would pass
    // over copy that was never rendered.
    expect(body).toContain("What was taken out and kept back before the rest was divided");
    expect(body).toContain("the same as the amount left for them");
    // The reserve rows are runtime-assembled sentences of their own and exist
    // in no source file for the derived guard to scan.
    expect(body).toContain("The ordinance sets this at 2% of USD 6,812,340.17.");

    for (const { label, pattern } of PROHIBITED_PUBLIC_CLAIMS) {
      expect(
        sourceWithoutExplicitCaveats(body),
        `the rendered reconciliation makes a prohibited claim: ${label}`
      ).not.toMatch(pattern);
    }
    // And it says none of it in staff words. "Off the top" is the term every
    // module in this lane uses for exactly this amount, which is precisely why
    // it must not reach a resident.
    for (const jargon of [
      "off the top",
      "off-the-top",
      "apportionment",
      "allocable",
      "residual",
      "computation basis",
      "descriptor",
    ]) {
      expect(body.toLowerCase(), `resident-facing copy must not say "${jargon}"`).not.toContain(jargon);
    }
  });

  it("still says in as many words what it is not", async () => {
    await renderPage();

    const body = plain(document.body.textContent);
    // The caveat the guard above must never make anyone delete.
    expect(body).toContain("not an audited financial statement");
    expect(body).toContain("not the agency's official accounting");
  });

  /* ---------------- the words themselves ---------------- */

  it("speaks to residents and never to staff", async () => {
    await renderPage();

    expect(screen.getByText("Where the money came from")).toBeTruthy();
    expect(screen.getByText("What the ordinance says it must pay for")).toBeTruthy();
    expect(screen.getByText("Who asked for it and what they got")).toBeTruthy();

    const body = plain(document.body.textContent);
    // Internal vocabulary that must not reach this surface. Each of these is a
    // real term used in the staff-facing modules of this same lane.
    for (const jargon of [
      "off the top",
      "off-the-top",
      "apportionment basis",
      "sub-recipient",
      "maintenance of effort",
      "computation basis",
      "descriptor",
      "workspace",
    ]) {
      expect(body.toLowerCase(), `resident-facing copy must not say "${jargon}"`).not.toContain(jargon);
    }
    // And no instruction addressed to somebody with an account.
    expect(body).not.toMatch(/\bsign in\b/i);
  });
});

/**
 * ============================================================================
 * MUTATION LOG — recorded after a GREEN BASELINE and a NEGATIVE CONTROL.
 * ============================================================================
 *
 * BASELINE: 14 passed before any mutation.
 * NEGATIVE CONTROL: a semantically neutral rename inside
 * `receiptCoverageSentence` (`reported` -> `reportedLines`) left it green, so
 * the runner reports a pass rather than exiting non-zero unconditionally. This
 * matters: a lane last cycle reported 18/18 killed from a runner that always
 * exited 1.
 *
 * Every mutation below was applied to the source, RUN, and reverted. Each line
 * records the failure it produced.
 *
 *  M1  `receiptCoverageSentence` returns "" -> `oversightFigure` THROWS, and
 *      11 of 14 tests fail. This is the structural half of guard (i): there is
 *      no path from this page to a number without its sentence.
 *  M2  span taken over every period rather than the reported ones -> the exact
 *      coverage string fails ("March 31, 2026" for a quarter nobody reported).
 *  M3  `isFloor` forced false -> "At least this much" absent. 1 failed.
 *  M4  a null receipt rendered as `formatOversightMoney(0, …)` -> the FY26 Q3
 *      row prints USD 0.00. 1 failed, on the negative assertion that matters.
 *  M5  `isStaffEntered` set to `totals.length > 0` (badge everywhere) -> the
 *      local-streets row gains a badge. 1 failed.
 *  M6  `notDeterminedSentence` replaced with null -> the district's MOE row
 *      prints "more than required" against an absent figure. 1 failed.
 *  M7  the recipient rollup counts non-claimed lines into `askedForGross`
 *      -> the city row reads 1,925,000.00. 1 failed.
 *  M7b the rollup sums GROSS instead of NET for paid claims -> 1,600,000.00
 *      instead of 1,540,000.00. SURVIVED on the first pass, because every paid
 *      claim in the fixture had zero retention; CL-1 now withholds 5% and the
 *      mutation is killed. Recorded because the survival was the finding.
 *  M7c the set-aside rollup forgets its accumulator -> 1,905,686.71 instead of
 *      2,705,686.71. SURVIVED on the first pass (one fiscal year cannot tell a
 *      running total from "last row wins"); FY 2025 now exists and it is killed.
 *  M7d the claimed rollup forgets its accumulator -> 1,500,000.00 instead of
 *      1,900,000.00. Same story, same fix.
 *  M7e a category total with a null allocation becomes 0 -> the regional row
 *      prints USD 0.00 as a ceiling. SURVIVED twice: first because no category
 *      total existed for regional at all, then killed once a claim against an
 *      unallocated category put one there.
 *  M8  the excluded-claims clause dropped from the claim coverage sentence
 *      -> the exact string fails.
 *  M9  a failed claims read treated as an empty ledger -> "shows one failed
 *      section as unavailable" fails.
 *  M10 the public read drops `.eq("public_share_enabled", true)` -> the filter
 *      assertion fails. (A revoked link would have stayed live.)
 *  M11 the failed-fund branch calls `notFound()` -> 1 failed.
 *  M12 `robots` flipped to indexable -> 1 failed.
 *  M13 `<Figure>` stops rendering `coverageSentence` -> 2 failed.
 *  M14 the read-failure banner suppressed -> 1 failed.
 *
 *  M15 `claimCoverageSentence` stops agreeing its verb with its count ("1
 *      claims that have been filed") -> the exact-string assertion fails. Not
 *      a money defect, and pinned anyway: the coverage sentence is the thing
 *      standing between a resident and a bare total, and copy that reads as
 *      broken is copy people stop reading.
 *
 * 19 mutations against this file, 19 killed — three of them only after the
 * fixture was corrected, and those three are the finding worth carrying
 * forward: a single-year, zero-retention, fully-allocated fixture cannot tell
 * correct rollup code from three different wrong ones. Nothing survived
 * silently.
 *
 * ==========================================================================
 * 2026-08-12 — the three reads that arrived as `[]`, and the rendered claim
 * ==========================================================================
 *
 *  M16 `allocationsUnavailableSentence` forced null (the page's old
 *      `allocationsResult.data ?? []`) -> "does not print a failed allocations
 *      read as nothing set aside" fails: every ordinance heading goes back to
 *      "Nothing set aside on the record".
 *  M17 `moeUnavailableSentence` forced null -> the page goes back to "No
 *      local-spending commitments have been recorded for this measure." 1 failed.
 *  M18 `recipientsUnavailableSentence` forced null -> "An area the agency has
 *      not named" returns. 1 failed.
 *  M19 the reviewer's exact overclaim written into `MEASURE_OVERSIGHT_COPY
 *      .preparedNote` ("These figures are the agency's audited financial
 *      statement and its official accounting. They are complete and final.")
 *      -> 3 failed, including "makes no audited, official, certified or final
 *      claim about the figures it shows" on the RENDERED page. Before this
 *      session that string changed nothing: the file-scanning guard's page list
 *      was hand-kept and had never gained this page, and the words live in a
 *      copy module the guard did not follow either.
 *
 * ==========================================================================
 * 2026-08-12 — the arithmetic that did not close
 * ==========================================================================
 *
 * BASELINE: 73 passed before the section existed. NEGATIVE CONTROL: a throwaway
 * `expect(1).toBe(2)` appended to this file exited 1 and its removal exited 0,
 * on the same `npm test -- <this file>` invocation and with the exit code read
 * directly rather than through a pipe. Two lanes this cycle produced mutation
 * batteries from runners that could not fail; this one was shown to.
 *
 *  M20 the whole "What was taken out before the rest was divided" section is
 *      not rendered (`{false && model.division …}`, i.e. the page as it stood
 *      on 2026-08-12) -> ALL SIX new tests fail, including the two shaped as
 *      negatives, which is what proves they are not vacuous.
 *  M21 the received figure sums every reporting period instead of the divided
 *      ones -> the closure fails (11,812,340.17 against 6,812,340.17) and so do
 *      the scope and difference tests. It also breaks TWO older tests, because
 *      the fund-wide figure is the one they already pin.
 *  M22 the page passes `{ ok: true, takes: takesResult.data ?? [] }` — the
 *      `?? []` this lane has now made three times -> "does not print a failed
 *      takes read as an ordinance that took nothing" fails.
 *  M23 `leftToDivide` forgets the subtraction -> the closure fails.
 *  M24 the settlement always reports the headings as matching -> "states the
 *      difference as a figure" fails.
 *  M25 the clause row drops the "the ordinance called for more than was taken"
 *      note -> the limit test fails (68,123.40 absent).
 *  M26 the page renders the section but drops `settlementSentence` -> 2 fail.
 *  M27 the "nothing has been divided up yet" branch is unreachable -> that test
 *      fails, and a fund with no allocations shows three zero figures instead.
 *  M28 `setAsideShownTotal` stops accumulating -> the closure and difference
 *      tests fail, because the page compares against a total of nothing.
 *  M29 `divisionExplainer` says "off the top" -> the rendered-copy guard AND
 *      the older "speaks to residents" test both fail.
 *  M30 the settlement sentence claims the amounts "have been independently
 *      verified and are complete and final" -> 4 fail across BOTH guards: the
 *      file-derived one over `oversight.ts` and the rendered one here.
 *
 * 11 mutations, 11 killed, nothing survived.
 *
 *  ONE SURVIVOR, RECORDED RATHER THAN HIDDEN. Emptying `moe.rows` in
 *  `buildMeasureOversightModel` when the read failed changed nothing, because a
 *  caller with a failed read has no records to summarise and the rows are
 *  already empty. The branch was UNREACHABLE, so it was deleted rather than
 *  left as a safeguard nobody can check; the page's own
 *  `unavailableSentence ? … : rows.length === 0 ? …` ternary is the mechanism,
 *  and M17 kills it. The vacuous "no partial table" assertion that went with it
 *  was deleted too.
 */

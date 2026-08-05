import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * THE PUBLIC DRAFT-REVIEW PAGE — the actual RTP document, read by a resident.
 *
 * This file drives the REAL page (never a stub of its loader) through the paths
 * that decide whether an agency tells a member of the public something false:
 *
 *   - a failed cycle read must NOT 404, because "this plan does not exist" is a
 *     claim, and a broken query cannot make it;
 *   - a genuinely absent token MUST 404, or the two states have collapsed into
 *     one and the page has stopped distinguishing anything;
 *   - a failed CHAPTER read must not render as a plan with no text in it;
 *   - a failed PROJECT-LINK read must not let the fiscal engine compute
 *     "Fiscally constrained" out of an empty array — the engine cannot tell a
 *     failed read from a plan that programmes nothing, so the page must;
 *   - the review window must be stated in every one of its four states, because
 *     a resident who cannot tell whether their comment counts has been failed by
 *     the page whether or not it renders;
 *   - the database's own words never reach the reader.
 *
 * THE PROJECTION STRINGS ARE ASSERTED AS STRINGS. A mocked Supabase client hands
 * back the fixture whatever columns were asked for, so every render assertion
 * below stays green if a column is dropped from a `.select()` while the real
 * page renders `undefined`. The `.select()` string is the only artifact that
 * decides what the database returns (see CLAUDE.md).
 *
 * AND THE SAME IS TRUE OF THE FILTERS — which on this page matter more than the
 * columns do. It runs on the SERVICE-ROLE client, so row-level security is not
 * in play and the `.eq()` calls are the entire access control. A fake answers
 * with the fixture whatever it was told to filter on, so the render assertions
 * are blind to a missing filter as well. Proven by mutation on 2026-08-05: with
 * `.eq("public_share_enabled", true)` deleted from all three reads, with
 * `.eq("public_share_token", …)` deleted from the gate, and with the
 * `rtp_cycle_id` scope deleted from the chapter and project-link reads, all 36
 * tests still passed. The filters are therefore recorded and asserted the same
 * way the projections are — see "the filters are the access control" below.
 */

const notFoundMock = vi.fn(() => {
  throw new Error("notFound");
});

vi.mock("next/navigation", () => ({
  notFound: () => notFoundMock(),
}));

// ---------------------------------------------------------------------------
// A fake service-role client. Routes on TABLE NAME, records every select string
// AND every filter, and can be told to make a named table FAIL — the only way
// to exercise the failure paths, since a mock otherwise answers with the
// fixture regardless.
// ---------------------------------------------------------------------------

/**
 * One read as the page issued it. The FILTERS are here because this page uses
 * the service-role client: `.eq("public_share_enabled", true)` is not a
 * refinement of a query, it is the thing that stops an unpublished draft being
 * served, and nothing else in this file can see it.
 */
type RecordedRead = {
  table: string;
  columns: string;
  filters: Array<{ column: string; value: unknown }>;
};

const readLog: RecordedRead[] = [];
const selectCalls: Record<string, string[]> = {};
let tableData: Record<string, unknown>;
/**
 * `whenSelectIncludes` models the only failure a RETRY can help with: a
 * deployment that has not applied a migration answers the projection naming the
 * new column with an error and the narrower projection perfectly well. Without
 * it the fake fails both reads and the fallback path is unreachable — a fake
 * that cannot express the situation cannot test the code written for it.
 */
let tableErrors: Record<string, { message: string; whenSelectIncludes?: string }>;

type FakeResult = { data: unknown; error: { message: string } | null };

function fakeQuery(tableName: string, columns: string, record: RecordedRead) {
  const resolveResult = (): FakeResult => {
    const error = tableErrors[tableName];
    // A failed read carries no rows. Returning the fixture AND an error would
    // let the page look correct while ignoring the error entirely.
    if (error && (!error.whenSelectIncludes || columns.includes(error.whenSelectIncludes))) {
      return { data: null, error: { message: error.message } };
    }
    // An EXPLICIT null is a successful read that found nothing — the genuine
    // absence, which must stay distinguishable from a failure.
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
    (selectCalls[tableName] ??= []).push(columns);
    const record: RecordedRead = { table: tableName, columns, filters: [] };
    readLog.push(record);
    return fakeQuery(tableName, columns, record);
  }),
}));

/** Every read of `table`, in the order the page issued them. */
function readsOf(table: string): RecordedRead[] {
  return readLog.filter((read) => read.table === table);
}

/**
 * The value a read was filtered on, or `undefined` when it was not filtered on
 * that column at all — which is the case an assertion here has to catch.
 */
function filterValue(read: RecordedRead | undefined, column: string): unknown {
  return read?.filters.find((filter) => filter.column === column)?.value;
}

vi.mock("@/lib/supabase/server", () => ({
  createServiceRoleClient: () => ({ from: fromMock }),
}));

import PublicRtpDocumentPage, {
  generateMetadata,
} from "@/app/(public)/plan/[shareToken]/document/page";
import {
  RTP_FINANCIAL_ASSUMPTION_COLUMNS,
  RTP_HORIZON_BAND_COLUMNS,
  RTP_PERFORMANCE_MEASURE_COLUMNS,
} from "@/lib/rtp/financial-element-queries";

const SHARE_TOKEN = "public-share-token-1";
/** The id every child read must be scoped to — shared with the fixture below. */
const PLAN_ID = "cycle-1";

const DAY = 24 * 60 * 60 * 1000;
const YESTERDAY = new Date(Date.now() - DAY).toISOString();
const LAST_MONTH = new Date(Date.now() - 30 * DAY).toISOString();
const NEXT_MONTH = new Date(Date.now() + 30 * DAY).toISOString();
const NEXT_YEAR = new Date(Date.now() + 365 * DAY).toISOString();

/**
 * A plan that is COMPLETE and fiscally constrained, so that every failure test
 * below is a real change of behaviour rather than a page that had nothing to
 * say either way. $1,000,000 revenue against $400,000 of programmed capital and
 * $100,000 of operations and maintenance, all in 2026 dollars with no inflation
 * rate — which the engine reports as constant dollars, not year-of-expenditure.
 */
function seed() {
  for (const key of Object.keys(selectCalls)) delete selectCalls[key];
  readLog.length = 0;
  tableErrors = {};
  tableData = {
    rtp_cycles: {
      id: PLAN_ID,
      title: "Example Region RTP 2050",
      status: "public_review",
      geography_label: "Example Region",
      horizon_start_year: 2026,
      horizon_end_year: 2050,
      summary: "A draft plan published for public review.",
      public_review_open_at: LAST_MONTH,
      public_review_close_at: NEXT_MONTH,
      financial_basis_year: 2026,
      annual_inflation_rate: null,
    },
    rtp_cycle_chapters: [
      {
        id: "chapter-1",
        chapter_key: "vision_goals_policy",
        title: "Vision, goals, and policy framework",
        section_type: "policy",
        status: "complete",
        summary: "What the region is trying to achieve.",
        content_markdown: "## Our goals\n\nSafer streets and fewer miles driven.",
        sort_order: 10,
        required: true,
      },
      {
        id: "chapter-2",
        chapter_key: "financial_element",
        title: "Financial element and fiscal constraint",
        section_type: "financial",
        status: "not_started",
        summary: "How the plan will be paid for.",
        content_markdown: null,
        sort_order: 20,
        required: true,
      },
    ],
    project_rtp_cycle_links: [
      {
        id: "link-1",
        portfolio_role: "constrained",
        priority_rationale: "Closes the worst gap in the bike network.",
        horizon_band_id: "band-1",
        estimated_cost: "400000",
        cost_basis_year: 2026,
        projects: { id: "p1", name: "Main Street complete street", summary: null },
      },
      {
        id: "link-2",
        portfolio_role: "illustrative",
        priority_rationale: null,
        horizon_band_id: "band-1",
        estimated_cost: null,
        cost_basis_year: null,
        projects: { id: "p2", name: "Regional trail extension", summary: "A long-term ambition." },
      },
    ],
    rtp_horizon_bands: [
      {
        id: "band-1",
        label: "First ten years",
        start_year: 2026,
        end_year: 2035,
        escalation_target_year: 2030,
        cost_estimate_basis: "itemized",
        sort_order: 10,
      },
    ],
    rtp_financial_assumptions: [
      {
        id: "line-1",
        horizon_band_id: "band-1",
        entry_kind: "revenue",
        source_name: "Local sales tax",
        amount: "1000000",
        amount_basis_year: 2026,
        notes: null,
      },
      {
        id: "line-2",
        horizon_band_id: "band-1",
        entry_kind: "operations_maintenance",
        source_name: "Pavement maintenance",
        amount: "100000",
        amount_basis_year: 2026,
        notes: null,
      },
    ],
    rtp_performance_measures: [
      {
        id: "measure-1",
        measure_key: "fatalities",
        label: "Traffic deaths per year",
        unit: "deaths",
        // ZERO IS A REAL MEASUREMENT. If this rendered as "Not recorded" the
        // page would be treating a target of zero deaths as an absent target.
        baseline_value: "7",
        baseline_year: 2024,
        target_value: "0",
        target_year: 2050,
        data_source: "State crash records",
        notes: null,
        sort_order: 10,
      },
      {
        id: "measure-2",
        measure_key: "vmt_per_capita_change",
        label: "Change in miles driven per person",
        unit: "percent",
        // A NEGATIVE TARGET IS THE POINT OF THIS MEASURE — driving less is the
        // goal. `parseOptionalAmount` returns null for a negative (correctly,
        // for money: a negative cost is a data-entry error), so reaching for the
        // money helper here would publish this agency's headline climate target
        // as "Not recorded".
        baseline_value: "0",
        baseline_year: 2024,
        target_value: "-12",
        target_year: 2050,
        data_source: "Regional travel model",
        notes: null,
        sort_order: 20,
      },
    ],
  };
}

async function renderPage() {
  return render(await PublicRtpDocumentPage({ params: Promise.resolve({ shareToken: SHARE_TOKEN }) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  seed();
});

// ---------------------------------------------------------------------------
// Projections
// ---------------------------------------------------------------------------

describe("public RTP document page — it asks the database for the columns it renders", () => {
  it("selects every cycle column the header, the review window, and the money need", async () => {
    await renderPage();

    const selects = selectCalls["rtp_cycles"] ?? [];
    expect(selects.length).toBeGreaterThan(0);
    const projection = selects[selects.length - 1];
    for (const column of [
      "id",
      "title",
      "status",
      "geography_label",
      "horizon_start_year",
      "horizon_end_year",
      "summary",
      // The review window: without these the page cannot say whether a comment
      // would count, and would fall through to "no dates published".
      "public_review_open_at",
      "public_review_close_at",
      // The dollar basis: dropping either makes the fiscal engine silently
      // report constant dollars of an unstated base year.
      "financial_basis_year",
      "annual_inflation_rate",
    ]) {
      expect(projection, `rtp_cycles select lost "${column}"`).toContain(column);
    }
  });

  it("selects the chapter columns the document renders — and not the internal guidance", async () => {
    await renderPage();

    const projection = (selectCalls["rtp_cycle_chapters"] ?? [])[0] ?? "";
    for (const column of [
      "chapter_key",
      "title",
      "section_type",
      "status",
      "summary",
      "content_markdown",
      "sort_order",
      "required",
    ]) {
      expect(projection, `rtp_cycle_chapters select lost "${column}"`).toContain(column);
    }
    // `guidance` is the agency's editorial note to its own staff. Publishing it
    // would put internal process instructions inside the draft a resident is
    // being asked to comment on.
    expect(projection).not.toContain("guidance");
  });

  it("selects the per-plan cost columns, which are what make the money on this page real", async () => {
    await renderPage();

    const projection = (selectCalls["project_rtp_cycle_links"] ?? [])[0] ?? "";
    for (const column of [
      "portfolio_role",
      "priority_rationale",
      "horizon_band_id",
      "estimated_cost",
      "cost_basis_year",
      "projects(",
    ]) {
      expect(projection, `project_rtp_cycle_links select lost "${column}"`).toContain(column);
    }
  });

  it("reads the financial element through the shared loader's projections, not a private copy", async () => {
    await renderPage();

    // Asserting EQUALITY with the exported constants is what proves the page
    // goes through `loadRtpFinancialElement`. A hand-rolled select that merely
    // happened to contain the same words would drift from the export the next
    // time a column is added, and this page would silently stop rendering it.
    expect((selectCalls["rtp_horizon_bands"] ?? [])[0]).toBe(RTP_HORIZON_BAND_COLUMNS);
    expect((selectCalls["rtp_financial_assumptions"] ?? [])[0]).toBe(RTP_FINANCIAL_ASSUMPTION_COLUMNS);
    expect((selectCalls["rtp_performance_measures"] ?? [])[0]).toBe(RTP_PERFORMANCE_MEASURE_COLUMNS);
  });
});

// ---------------------------------------------------------------------------
// The filters, which on this page ARE the access control
// ---------------------------------------------------------------------------

/**
 * NOTHING ELSE IN THIS FILE CAN SEE A MISSING FILTER. The page holds a
 * service-role client, so RLS is not enforcing anything here — the `.eq()`
 * calls are. Every one of the mutations below left all 36 render assertions
 * green before these four tests existed:
 *
 *   - deleting `.eq("public_share_enabled", true)` from all three reads, which
 *     in production means a plan an agency UNPUBLISHED keeps serving to anyone
 *     who ever held the link;
 *   - deleting `.eq("public_share_token", shareToken)` from the gate, which
 *     means `maybeSingle()` hands back an arbitrary cycle — any workspace's
 *     unpublished draft — to any token-shaped URL;
 *   - deleting `.eq("rtp_cycle_id", cycle.id)` from the chapter read and from
 *     the project-link read, which publishes every other agency's chapters and
 *     project costs inside this agency's draft.
 *
 * The last two are cross-tenant disclosure on a page with no login.
 */
describe("public RTP document page — the filters are the access control", () => {
  it("gates the plan read on the share token AND on sharing still being switched on", async () => {
    await renderPage();

    const [read] = readsOf("rtp_cycles");
    expect(filterValue(read, "public_share_token")).toBe(SHARE_TOKEN);
    // Unpublishing has to actually unpublish. Without this the only way to
    // withdraw a draft is to rotate the token, which the UI does not offer.
    expect(filterValue(read, "public_share_enabled")).toBe(true);
  });

  it("keeps the pre-migration fallback read behind exactly the same gate", async () => {
    tableErrors.rtp_cycles = {
      message: "column rtp_cycles.annual_inflation_rate does not exist",
      whenSelectIncludes: "annual_inflation_rate",
    };

    await renderPage();

    const reads = readsOf("rtp_cycles");
    expect(reads.length).toBe(2);
    const fallback = reads[1];
    // A degrade path is still a read of somebody's plan. It does not get a
    // weaker gate because it is the unlucky side of a deploy window.
    expect(filterValue(fallback, "public_share_token")).toBe(SHARE_TOKEN);
    expect(filterValue(fallback, "public_share_enabled")).toBe(true);
    // And it must still ASK for everything the header renders. The fixture is
    // returned whatever was selected, so the "the title still shows" assertion
    // elsewhere proves nothing about this projection — only the string does.
    for (const column of [
      "id",
      "title",
      "status",
      "geography_label",
      "horizon_start_year",
      "horizon_end_year",
      "summary",
      "public_review_open_at",
      "public_review_close_at",
    ]) {
      expect(fallback.columns, `the fallback rtp_cycles select lost "${column}"`).toContain(column);
    }
  });

  it("gates the metadata read the same way, and asks for the title it puts in the tab", async () => {
    await generateMetadata({ params: Promise.resolve({ shareToken: SHARE_TOKEN }) });

    const [read] = readsOf("rtp_cycles");
    expect(filterValue(read, "public_share_token")).toBe(SHARE_TOKEN);
    expect(filterValue(read, "public_share_enabled")).toBe(true);
    // Without this the tab reads "undefined · Draft for public review".
    expect(read.columns).toContain("title");
  });

  it("scopes every child read to THIS plan, never to the table at large", async () => {
    await renderPage();

    for (const table of [
      "rtp_cycle_chapters",
      "project_rtp_cycle_links",
      // The three the shared loader issues. Asserted here too, because what
      // this page controls is the ID it hands the loader — passing the share
      // token, or another cycle's id, is a page-side defect the loader's own
      // tests cannot see.
      "rtp_horizon_bands",
      "rtp_financial_assumptions",
      "rtp_performance_measures",
    ]) {
      const [read] = readsOf(table);
      expect(read, `${table} was never read at all`).toBeTruthy();
      expect(
        filterValue(read, "rtp_cycle_id"),
        `${table} was not scoped to this plan — the service-role client returns every workspace's rows`
      ).toBe(PLAN_ID);
    }
  });
});

// ---------------------------------------------------------------------------
// The gate: 404 vs. could-not-be-read
// ---------------------------------------------------------------------------

describe("public RTP document page — a failed gate read may not 404", () => {
  it("still 404s when the read SUCCEEDED and no such shared plan exists", async () => {
    tableData.rtp_cycles = null;

    await expect(
      PublicRtpDocumentPage({ params: Promise.resolve({ shareToken: SHARE_TOKEN }) })
    ).rejects.toThrow("notFound");
    expect(notFoundMock).toHaveBeenCalled();
  });

  it("404s on a token too short to be one", async () => {
    await expect(
      PublicRtpDocumentPage({ params: Promise.resolve({ shareToken: "abc" }) })
    ).rejects.toThrow("notFound");
  });

  it("does not 404 when the plan lookup failed, and denies the inference instead", async () => {
    tableErrors.rtp_cycles = { message: "permission denied for table rtp_cycles" };

    await renderPage();

    expect(notFoundMock).not.toHaveBeenCalled();
    expect(screen.getByText(/This plan could not be loaded/)).toBeTruthy();
    expect(
      screen.getByText(/does not mean the plan is missing, unpublished, or withdrawn/)
    ).toBeTruthy();
  });

  /**
   * BOTH SIDES OF A DEPLOY/MIGRATE WINDOW MUST DEGRADE. A deployment running the
   * new code against a database without migration 20260805000003 answers the
   * wide projection with "column … does not exist". If the gate took that as a
   * failure, a public review period would run with the draft unreadable — so the
   * page retries on the pre-migration projection and keeps the document.
   */
  it("falls back to the pre-migration projection rather than taking the whole draft down", async () => {
    tableErrors.rtp_cycles = {
      message: "column rtp_cycles.annual_inflation_rate does not exist",
      whenSelectIncludes: "annual_inflation_rate",
    };

    await renderPage();

    expect(screen.queryByText(/This plan could not be loaded/)).toBeNull();
    expect(screen.getByText("Example Region RTP 2050")).toBeTruthy();
    // The review window survives the fallback — it is the reason the fallback
    // exists, since a resident reading a draft during review needs the deadline.
    expect(screen.getByText("Public review is open")).toBeTruthy();
    expect(screen.getByText("Vision, goals, and policy framework")).toBeTruthy();
    // The narrower projection ran, and it does NOT ask for the new columns.
    const projections = selectCalls["rtp_cycles"] ?? [];
    expect(projections.length).toBe(2);
    expect(projections[1]).not.toContain("annual_inflation_rate");
    expect(projections[1]).toContain("public_review_close_at");
  });

  it("does NOT retry — and discloses — when the failure is a permission refusal", async () => {
    // A retry on a permission failure would paper over a security-relevant
    // outcome. `looksLikePendingSchema` deliberately does not match one.
    tableErrors.rtp_cycles = { message: "permission denied for table rtp_cycles" };

    await renderPage();

    expect((selectCalls["rtp_cycles"] ?? []).length).toBe(1);
    expect(screen.getByText(/This plan could not be loaded/)).toBeTruthy();
  });

  it("never shows the database's own message on the failure shell", async () => {
    tableErrors.rtp_cycles = { message: "permission denied for table rtp_cycles" };

    await renderPage();

    expect(screen.queryByText(/permission denied/)).toBeNull();
    expect(screen.queryByText(/rtp_cycles/)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Metadata — the share token is the credential
// ---------------------------------------------------------------------------

describe("public RTP document page — the share token is never handed to a crawler", () => {
  it("sets robots noindex/nofollow on the FOUND branch", async () => {
    const metadata = await generateMetadata({ params: Promise.resolve({ shareToken: SHARE_TOKEN }) });

    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(String(metadata.title)).toContain("Example Region RTP 2050");
  });

  it("sets robots noindex/nofollow on the NOT-FOUND branch", async () => {
    tableData.rtp_cycles = null;

    const metadata = await generateMetadata({ params: Promise.resolve({ shareToken: SHARE_TOKEN }) });

    expect(metadata.robots).toEqual({ index: false, follow: false });
    // And it must not leak a title it never read.
    expect(String(metadata.title)).not.toContain("Example Region");
  });

  it("sets robots noindex/nofollow when the metadata read FAILED, and on a short token", async () => {
    tableErrors.rtp_cycles = { message: "permission denied" };
    const failed = await generateMetadata({ params: Promise.resolve({ shareToken: SHARE_TOKEN }) });
    expect(failed.robots).toEqual({ index: false, follow: false });

    const short = await generateMetadata({ params: Promise.resolve({ shareToken: "abc" }) });
    expect(short.robots).toEqual({ index: false, follow: false });
  });
});

// ---------------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------------

describe("public RTP document page — the chapters are the document", () => {
  it("renders chapter markdown as sanitised HTML, in reading order", async () => {
    const { container } = await renderPage();

    expect(screen.getByText("Vision, goals, and policy framework")).toBeTruthy();
    // The markdown was rendered, not printed: `## Our goals` became a heading.
    const heading = container.querySelector(".chapter-markdown h2");
    expect(heading?.textContent).toBe("Our goals");
    expect(screen.getByText(/Safer streets and fewer miles driven/)).toBeTruthy();
    expect(screen.queryByText(/## Our goals/)).toBeNull();
  });

  it("says a chapter has no draft text rather than leaving a silent gap", async () => {
    await renderPage();

    expect(screen.getByText("Financial element and fiscal constraint")).toBeTruthy();
    expect(screen.getByText(/No draft text has been published for this chapter yet/)).toBeTruthy();
  });

  it("discloses a failed chapter read instead of publishing an empty document", async () => {
    tableErrors.rtp_cycle_chapters = { message: "column content_markdown does not exist" };

    await renderPage();

    expect(screen.getByText(/The chapters of this plan could not be read/)).toBeTruthy();
    expect(screen.getByText(/not because the plan has none/)).toBeTruthy();
    // The claim a reader would otherwise be left with.
    expect(screen.queryByText(/No chapters have been published for this plan yet/)).toBeNull();
    // The rest of the page still loaded, and still renders.
    expect(screen.getByText("Main Street complete street")).toBeTruthy();
    // And the database's own words never reach the reader.
    expect(screen.queryByText(/content_markdown does not exist/)).toBeNull();
  });

  it("says so plainly when the plan genuinely has no chapters", async () => {
    tableData.rtp_cycle_chapters = [];

    await renderPage();

    expect(screen.getByText(/No chapters have been published for this plan yet/)).toBeTruthy();
    expect(screen.queryByText(/The chapters of this plan could not be read/)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The review window
// ---------------------------------------------------------------------------

describe("public RTP document page — a resident is never left guessing whether a comment counts", () => {
  it("says review is OPEN when now is inside the window", async () => {
    await renderPage();

    expect(screen.getByText("Public review is open")).toBeTruthy();
    expect(screen.getByText(/Comments opened .* and close /)).toBeTruthy();
  });

  it("says review has NOT OPENED YET when the window is in the future", async () => {
    (tableData.rtp_cycles as Record<string, unknown>).public_review_open_at = NEXT_MONTH;
    (tableData.rtp_cycles as Record<string, unknown>).public_review_close_at = NEXT_YEAR;

    await renderPage();

    expect(screen.getByText("Public review has not opened yet")).toBeTruthy();
    expect(screen.getByText(/may not be counted/)).toBeTruthy();
  });

  it("says review has CLOSED — and still renders the whole draft", async () => {
    (tableData.rtp_cycles as Record<string, unknown>).public_review_open_at = LAST_MONTH;
    (tableData.rtp_cycles as Record<string, unknown>).public_review_close_at = YESTERDAY;

    await renderPage();

    expect(screen.getByText("Public review has closed")).toBeTruthy();
    // THE DOCUMENT IS NOT WITHHELD. A closed review is a reason to say so, not
    // a reason to hide the plan from the people it is about.
    expect(screen.getByText("Vision, goals, and policy framework")).toBeTruthy();
    expect(screen.getByText("Main Street complete street")).toBeTruthy();
  });

  it("says NO DATES ARE PUBLISHED rather than guessing that review is closed", async () => {
    (tableData.rtp_cycles as Record<string, unknown>).public_review_open_at = null;
    (tableData.rtp_cycles as Record<string, unknown>).public_review_close_at = null;

    await renderPage();

    expect(screen.getByText(/No public review dates have been published for this plan/)).toBeTruthy();
    expect(screen.queryByText("Public review has closed")).toBeNull();
    expect(screen.queryByText("Public review is open")).toBeNull();
  });

  it("names the contradiction when the recorded status and the recorded dates disagree", async () => {
    // Adopted, yet the dates on record say comments are still open.
    (tableData.rtp_cycles as Record<string, unknown>).status = "adopted";

    await renderPage();

    expect(screen.getByText(/The recorded status and the recorded dates disagree/)).toBeTruthy();
    expect(screen.getByText(/contact the agency before relying on either/)).toBeTruthy();
  });

  it("raises no contradiction when status and dates agree", async () => {
    await renderPage();

    expect(screen.queryByText(/The recorded status and the recorded dates disagree/)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The financial element
// ---------------------------------------------------------------------------

describe("public RTP document page — the fiscal verdict is never computed from a failed read", () => {
  it("reports the verdict and the dollar basis when everything loaded", async () => {
    await renderPage();

    // The verdict rides on the summary AND on each period's row, so more than
    // one match is expected — a single-match query here would start failing the
    // day a second period was added, which is not a defect.
    expect(screen.getAllByText("Fiscally constrained").length).toBeGreaterThan(0);
    // The engine's own sentence, which carries the basis with the number.
    expect(screen.getByText(/in constant 2026 dollars/)).toBeTruthy();
    expect(screen.getByText(/not year-of-expenditure figures/)).toBeTruthy();
  });

  it("computes NOTHING when the project links failed — the verdict would be a lie", async () => {
    tableErrors.project_rtp_cycle_links = { message: "permission denied for table projects" };

    await renderPage();

    // Without the guard the engine sees zero constrained projects against
    // $1,000,000 of revenue and publishes "Fiscally constrained" on a public
    // page, on the strength of a broken query.
    expect(screen.queryAllByText("Fiscally constrained")).toEqual([]);
    expect(screen.getByText(/The financial summary could not be assembled/)).toBeTruthy();
    expect(screen.getByText(/could report this plan as affordable when it is not/)).toBeTruthy();
    // And the project list says the same thing in its own terms.
    expect(screen.getByText(/The project lists could not be read/)).toBeTruthy();
    expect(screen.queryByText(/No projects have been published for this plan yet/)).toBeNull();
  });

  it("computes nothing when the ledger read failed", async () => {
    tableErrors.rtp_financial_assumptions = { message: "permission denied" };

    await renderPage();

    expect(screen.queryAllByText("Fiscally constrained")).toEqual([]);
    expect(screen.getByText(/The financial summary could not be assembled/)).toBeTruthy();
  });

  it("computes nothing when the horizon bands failed", async () => {
    tableErrors.rtp_horizon_bands = { message: "permission denied" };

    await renderPage();

    expect(screen.queryAllByText("Fiscally constrained")).toEqual([]);
    expect(screen.getByText(/The financial summary could not be assembled/)).toBeTruthy();
  });

  /**
   * A FAILED BAND READ MUST NOT BE REPORTED AS A PROPERTY OF THE PROJECTS.
   * Grouping against an empty band list resolves every project to "No period
   * assigned" — a specific claim about the plan, made about projects whose
   * period is recorded perfectly well, on the strength of a failed query.
   */
  it("does not label every project 'No period assigned' when the periods could not be read", async () => {
    tableErrors.rtp_horizon_bands = { message: "permission denied" };

    await renderPage();

    expect(screen.queryByText("No period assigned")).toBeNull();
    // The projects are still shown — one failed read does not blank the list.
    expect(screen.getByText("Main Street complete street")).toBeTruthy();
    expect(screen.getByText("Regional trail extension")).toBeTruthy();
    expect(
      screen.getByText(/listed without the period that pays for them. This does not mean they have no period/)
    ).toBeTruthy();
  });

  it("still labels a genuinely unassigned project as having no period", async () => {
    (tableData.project_rtp_cycle_links as Array<Record<string, unknown>>)[1].horizon_band_id = null;

    await renderPage();

    expect(screen.getByText("No period assigned")).toBeTruthy();
  });

  it("reports NOT DETERMINED — never a total — when a constrained project has no cost", async () => {
    (tableData.project_rtp_cycle_links as Array<Record<string, unknown>>)[0].estimated_cost = null;

    await renderPage();

    expect(screen.getAllByText("Not determined").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/has no cost recorded/).length).toBeGreaterThan(0);
    expect(screen.queryAllByText("Fiscally constrained")).toEqual([]);
  });

  it("shows an unpriced project as unpriced, never as $0", async () => {
    await renderPage();

    // The illustrative project in the fixture has no cost recorded.
    expect(screen.getByText("No cost recorded")).toBeTruthy();
    expect(screen.queryByText("$0")).toBeNull();
  });

  it("renders a measured zero as zero and a negative target as negative, never as absent", async () => {
    await renderPage();

    // Zero deaths is a target, not a missing target.
    expect(screen.getByText("Traffic deaths per year")).toBeTruthy();
    expect(screen.getByText(/Target: 0 deaths \(2050\)/)).toBeTruthy();
    // And a measure is NOT money: a negative is the whole point of a
    // reduction target, so the money parser's "negative means data-entry
    // error" rule must not be applied to it.
    expect(screen.getByText("Change in miles driven per person")).toBeTruthy();
    expect(screen.getByText(/Baseline: 0 percent \(2024\) · Target: -12 percent \(2050\)/)).toBeTruthy();
    expect(screen.queryAllByText(/Not recorded/)).toEqual([]);
  });

  it("discloses a failed performance-measure read rather than reporting none", async () => {
    tableErrors.rtp_performance_measures = { message: "relation does not exist" };

    await renderPage();

    expect(screen.getByText(/The performance measures could not be read/)).toBeTruthy();
    expect(screen.queryByText(/No performance measures have been published/)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Read-failure discipline as a whole
// ---------------------------------------------------------------------------

describe("public RTP document page — a failed read is disclosed, never rendered as absence", () => {
  it("discloses the failure at the top of the page, in the reader's terms", async () => {
    tableErrors.rtp_cycle_chapters = { message: "permission denied for table" };

    await renderPage();

    expect(screen.getByText(/Part of this plan could not be loaded/)).toBeTruthy();
    expect(screen.getByText(/could not read the chapters of this plan/)).toBeTruthy();
    expect(screen.getByText(/would not mean the records are absent/)).toBeTruthy();
  });

  it("never shows the database's own message to the public, whichever read failed", async () => {
    tableErrors.rtp_horizon_bands = { message: "permission denied for relation rtp_horizon_bands" };
    tableErrors.rtp_performance_measures = { message: "column sort_order does not exist" };

    await renderPage();

    expect(screen.queryByText(/permission denied/)).toBeNull();
    expect(screen.queryByText(/column sort_order does not exist/)).toBeNull();
  });

  it("stays silent when every read succeeded", async () => {
    await renderPage();

    expect(screen.queryByText(/Part of this plan could not be loaded/)).toBeNull();
    expect(screen.queryByText(/could not be read/)).toBeNull();
    expect(screen.queryByText(/could not be assembled/)).toBeNull();
  });
});

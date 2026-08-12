import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * PROVENANCE ON THE PUBLIC PLAN PAGE — Nathaniel's Q2 decision, 2026-08-11:
 * a transcribed figure names its source document and page WHEREVER IT APPEARS,
 * including the page a resident reads.
 *
 * THE CHIP IS A DISCLOSURE, which is why it belongs on a public surface at all.
 * `public-page-claims-guardrails.test.ts` forbids the marketing pages from
 * overclaiming; this file guards the opposite direction on the plan page — that
 * a figure copied out of a document SAYS SO, and that a figure a person typed
 * says nothing.
 *
 * THE TWO ASSERTIONS THAT MATTER, and they are a pair:
 *
 *   1. A TRANSCRIBED FIGURE renders its document, its page, and the document's
 *      own sentence. A resident cannot open the source file, so the quote on
 *      the page IS the check available to them.
 *   2. A HAND-TYPED FIGURE renders NOTHING. `extraction_candidate_id IS NULL`
 *      means a person entered it, permanently — there is no backfill anywhere
 *      in this feature, and a chip on a typed figure would be an invented
 *      citation, which is worse than none.
 *
 * And one more, because it is the case that turns a citation into a lie: a
 * figure the agency CHANGED after copying it says so rather than going on
 * citing a page that no longer matches it.
 *
 * MUTATION RESULTS are recorded at the bottom of this file.
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

import PublicRtpDocumentPage from "@/app/(public)/plan/[shareToken]/document/page";

const SHARE_TOKEN = "public-share-token-1";
const PLAN_ID = "cycle-1";
const DAY = 24 * 60 * 60 * 1000;

/**
 * A published plan with TWO performance measures: one copied out of the adopted
 * document, one a planner typed. The pair is the point — an assertion that a
 * chip renders proves nothing on its own if a chip renders everywhere.
 */
function seed() {
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
      public_review_open_at: new Date(Date.now() - 30 * DAY).toISOString(),
      public_review_close_at: new Date(Date.now() + 30 * DAY).toISOString(),
      financial_basis_year: 2026,
      annual_inflation_rate: null,
    },
    rtp_cycle_chapters: [],
    project_rtp_cycle_links: [
      {
        id: "link-1",
        portfolio_role: "constrained",
        priority_rationale: null,
        horizon_band_id: "band-near",
        estimated_cost: "12400000",
        cost_basis_year: 2023,
        projects: { id: "project-1", name: "Main Street Complete Street", status: null, summary: null },
      },
    ],
    rtp_horizon_bands: [
      {
        id: "band-near",
        label: "Near-term",
        start_year: 2026,
        end_year: 2035,
        escalation_target_year: null,
        cost_estimate_basis: "itemized",
        sort_order: 0,
      },
    ],
    rtp_financial_assumptions: [
      {
        id: "line-1",
        horizon_band_id: "band-near",
        entry_kind: "revenue",
        source_name: "Federal STBG",
        amount: "412000000.00",
        amount_basis_year: 2026,
        notes: null,
      },
    ],
    rtp_performance_measures: [
      {
        id: "measure-transcribed",
        measure_key: "fatalities",
        label: "Fatalities and serious injuries",
        unit: "people",
        baseline_value: "48",
        baseline_year: 2024,
        target_value: "24",
        target_year: 2035,
        data_source: "State crash records",
        notes: null,
        sort_order: 0,
      },
      {
        id: "measure-typed",
        measure_key: "mode_share",
        label: "Walking and cycling mode share",
        unit: "percent",
        baseline_value: "6",
        baseline_year: 2024,
        target_value: "10",
        target_year: 2035,
        data_source: "Agency travel survey",
        notes: null,
        sort_order: 1,
      },
    ],
    // Only ONE of the two measures came out of a document.
    rtp_extraction_candidates: [
      {
        id: "candidate-1",
        run_id: "run-1",
        target_kind: "performance_measure",
        proposed_json: {
          label: "Fatalities and serious injuries",
          baselineValue: 48,
          baselineYear: 2024,
          targetValue: 24,
          targetYear: 2035,
        },
        source_page: 112,
        source_quote:
          "There were 48 fatalities and serious injuries in 2024; the plan targets 24 by 2035.",
        accepted_row_id: "measure-transcribed",
        status: "accepted",
      },
    ],
    rtp_extraction_runs: [
      {
        id: "run-1",
        kb_document_id: "document-1",
        kb_documents: { id: "document-1", title: "Example Region RTP 2050 (adopted)" },
      },
    ],
  };
}

async function renderPage() {
  const ui = await PublicRtpDocumentPage({ params: Promise.resolve({ shareToken: SHARE_TOKEN }) });
  return render(ui);
}

beforeEach(() => {
  seed();
  notFoundMock.mockClear();
});

describe("a figure copied out of the plan document", () => {
  it("names the document and the page on the public page", async () => {
    await renderPage();
    expect(
      screen.getByText("Copied from “Example Region RTP 2050 (adopted)”, page 112")
    ).toBeTruthy();
  });

  it("prints the document's own sentence, because a resident cannot open the file", async () => {
    await renderPage();
    expect(
      screen.getByText(
        "There were 48 fatalities and serious injuries in 2024; the plan targets 24 by 2035."
      )
    ).toBeTruthy();
  });

  it("offers no link into a members-only document route", async () => {
    const { container } = await renderPage();
    expect(container.innerHTML).not.toContain("/api/knowledge-base/documents/");
  });

  it("is written for a resident, not an operator", async () => {
    const { container } = await renderPage();
    const text = container.textContent ?? "";
    for (const word of ["candidate", "extraction", "verifier", "workspace", "migration"]) {
      expect(text.toLowerCase()).not.toContain(word);
    }
    expect(text).not.toMatch(/confidence|certainty|likelihood/i);
  });
});

describe("a figure a person typed", () => {
  it("renders NO citation at all", async () => {
    await renderPage();

    // The typed measure is on the page…
    const typed = screen.getByText("Walking and cycling mode share").closest("li");
    expect(typed).toBeTruthy();
    // …and carries nothing claiming a document behind it.
    expect(typed?.textContent ?? "").not.toMatch(/copied from/i);
    expect(typed?.textContent ?? "").not.toMatch(/page \d+/i);
  });

  it("shows exactly one citation on the whole page", async () => {
    await renderPage();
    expect(screen.getAllByText(/^Copied from/).length).toBe(1);
  });
});

describe("a figure the agency changed after copying it", () => {
  it("says it was revised rather than citing a page that no longer matches", async () => {
    // The plan now records a baseline of 51; the document says 48.
    (tableData.rtp_performance_measures as Array<Record<string, unknown>>)[0].baseline_value = "51";
    await renderPage();

    expect(
      screen.getByText("Copied from “Example Region RTP 2050 (adopted)”, page 112, and revised since")
    ).toBeTruthy();
    expect(screen.getByText(/changed this figure after copying it from the document/i)).toBeTruthy();
  });
});

describe("a citation read that failed", () => {
  it("is disclosed, because a missing chip looks exactly like a typed figure", async () => {
    tableErrors.rtp_extraction_candidates = { message: "permission denied" };
    await renderPage();

    expect(screen.getByText(/Part of this plan could not be loaded/i)).toBeTruthy();
    expect(screen.getByText(/the pages this plan's figures were copied from/i)).toBeTruthy();
    // And no citation is invented in its place.
    expect(screen.queryByText(/^Copied from/)).toBeNull();
  });

  it("never renders the database's own message to a resident", async () => {
    tableErrors.rtp_extraction_candidates = { message: "permission denied for table" };
    const { container } = await renderPage();
    expect(container.textContent ?? "").not.toContain("permission denied");
  });
});

describe("a transcribed programmed cost", () => {
  it("cites its page beside the cost in the project list", async () => {
    (tableData.rtp_extraction_candidates as Array<Record<string, unknown>>).push({
      id: "candidate-2",
      run_id: "run-1",
      target_kind: "programmed_project",
      proposed_json: {
        projectName: "Main Street Complete Street",
        estimatedCost: 12400000,
        costBasisYear: 2023,
      },
      source_page: 44,
      source_quote: "Main Street Complete Street — Constrained — 2023–2032 — $12.4M",
      accepted_row_id: "link-1",
      status: "accepted",
    });

    await renderPage();
    expect(
      screen.getByText("Copied from “Example Region RTP 2050 (adopted)”, page 44")
    ).toBeTruthy();
    expect(
      screen.getByText("Main Street Complete Street — Constrained — 2023–2032 — $12.4M")
    ).toBeTruthy();
  });
});

/*
  MUTATION RESULTS, 2026-08-11. Each applied, this file RUN, then restored:

    - `ExtractionProvenanceCitation` given `record={someRecord}` unconditionally
      instead of `citationByRowId.get(measure.id)` → 5 failures, including
      "renders NO citation at all" and "shows exactly one citation on the whole
      page". This is the chip-on-a-hand-typed-row mutation the lane brief asks
      for, and it is the one that would put an invented citation under a figure
      a planner typed.
    - the citation element deleted from the measures list → 4 failures, led by
      "names the document and the page on the public page".
    - `indexTranscriptions` ignoring divergence (returning `divergentFields: []`
      always) → "says it was revised rather than citing a page that no longer
      matches" fails, and the page cites page 112 for a baseline of 51 that page
      112 does not contain.
    - the two `reads.check` calls on the provenance results deleted → "is
      disclosed, because a missing chip looks exactly like a typed figure"
      fails: the page loses its citations silently.
*/

import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * THE REVIEW SCREEN, driven as the real page — never a stub of its loaders.
 *
 * What this file is here to catch, in order of how badly each would hurt:
 *
 *   1. A CONFLICT PRESENTED AS SOMETHING NEW. The plan records $412M and the
 *      adopted document says $390M: the screen must show BOTH, labelled, or a
 *      planner accepts a second line and the plan carries two contradictory
 *      revenue figures with a page citation on one of them.
 *   2. THE DISCARDED COUNT HIDDEN. A reading that proposed 41 and dropped 6
 *      must say so. Showing 35 and looking clean is the version of this feature
 *      that quietly overstates how well the machine read the document.
 *   3. A FAILED READ RENDERED AS AN EMPTY QUEUE. "Nothing is waiting for
 *      review" is a claim about this plan and a broken query may not make it.
 *
 * THE READS ARE ASSERTED AS STRINGS AND FILTERS. A mocked Supabase client hands
 * back its fixture whatever was asked for and whatever it was filtered on, so
 * every render assertion here is blind to a dropped column or a dropped
 * workspace scope. Both are recorded and asserted directly (CLAUDE.md).
 *
 * MUTATION RESULTS are recorded at the bottom of this file.
 */

const notFoundMock = vi.fn(() => {
  throw new Error("notFound");
});
const redirectMock = vi.fn(() => {
  throw new Error("redirect");
});

vi.mock("next/navigation", () => ({
  notFound: () => notFoundMock(),
  redirect: () => redirectMock(),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

type RecordedRead = {
  table: string;
  columns: string;
  filters: Array<{ column: string; value: unknown }>;
};

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
  createClient: async () => ({
    from: fromMock,
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
  }),
  createServiceRoleClient: () => ({ from: fromMock }),
}));

let membershipRole = "admin";
vi.mock("@/lib/workspaces/current", () => ({
  loadCurrentWorkspaceMembership: async () => ({
    membership: { workspace_id: "workspace-1", role: membershipRole, user_id: "user-1" },
    workspace: { id: "workspace-1", name: "Example Region" },
  }),
}));

import RtpExtractionReviewPage from "@/app/(app)/rtp/[rtpCycleId]/extraction/page";

const CYCLE_ID = "cycle-1";
const BAND_NEAR = "band-near";

function readsOf(table: string): RecordedRead[] {
  return readLog.filter((read) => read.table === table);
}

function filterValue(read: RecordedRead | undefined, column: string): unknown {
  return read?.filters.find((filter) => filter.column === column)?.value;
}

/**
 * A plan that already records a $412M near-term STBG line, and a reading of the
 * adopted document that proposes $390M for the same line plus one measure the
 * plan does not have. Both verdicts are therefore real.
 */
function seed() {
  readLog.length = 0;
  tableErrors = {};
  tableData = {
    rtp_cycles: {
      id: CYCLE_ID,
      workspace_id: "workspace-1",
      title: "Example Region RTP 2050",
      financial_basis_year: 2026,
    },
    rtp_extraction_runs: [
      {
        id: "run-1",
        kb_document_id: "document-1",
        model: "a-model",
        extraction_source: "text_layer",
        status: "succeeded",
        candidate_count: 35,
        discarded_count: 6,
        failure_reason: null,
        created_at: "2026-08-11T10:00:00.000Z",
        kb_documents: { id: "document-1", title: "Example Region RTP 2050 (adopted)" },
      },
    ],
    rtp_extraction_candidates: [
      {
        id: "candidate-conflict",
        run_id: "run-1",
        target_kind: "financial_line",
        proposed_json: {
          entryKind: "revenue",
          sourceName: "Federal STBG",
          amount: 390000000,
          amountBasisYear: 2026,
          horizonBandId: BAND_NEAR,
        },
        source_page: 112,
        source_quote: "Federal STBG revenue of $390 million is assumed over the near-term period.",
        status: "pending",
        created_at: "2026-08-11T10:00:01.000Z",
      },
      {
        id: "candidate-new",
        run_id: "run-1",
        target_kind: "performance_measure",
        proposed_json: { label: "Transit ridership", baselineValue: 1200000, baselineYear: 2024 },
        source_page: 88,
        source_quote: "Transit ridership was 1,200,000 boardings in 2024.",
        status: "pending",
        created_at: "2026-08-11T10:00:02.000Z",
      },
    ],
    rtp_horizon_bands: [
      {
        id: BAND_NEAR,
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
        horizon_band_id: BAND_NEAR,
        entry_kind: "revenue",
        source_name: "Federal STBG",
        amount: "412000000.00",
        amount_basis_year: 2026,
        notes: null,
      },
    ],
    rtp_performance_measures: [],
    project_rtp_cycle_links: [],
    projects: [{ id: "project-1", name: "Main Street Complete Street" }],
    kb_documents: [
      {
        id: "document-1",
        title: "Example Region RTP 2050 (adopted)",
        status: "ready",
        source_kind: "uploaded_pdf",
        extraction_source: "text_layer",
        extraction_error: null,
      },
      {
        id: "document-2",
        title: "Scanned 2015 plan",
        status: "failed",
        source_kind: "uploaded_pdf",
        extraction_source: null,
        extraction_error: "No extractable text layer was found in this PDF. OCR is not enabled.",
      },
    ],
  };
}

async function renderPage() {
  const ui = await RtpExtractionReviewPage({ params: Promise.resolve({ rtpCycleId: CYCLE_ID }) });
  return render(ui);
}

beforeEach(() => {
  membershipRole = "admin";
  seed();
  notFoundMock.mockClear();
  redirectMock.mockClear();
});

describe("the review screen's header", () => {
  it("rolls the verdicts up, naming the conflicts", async () => {
    await renderPage();
    expect(
      screen.getByRole("heading", { name: "1 new · 1 conflicts with what you have" })
    ).toBeTruthy();
  });

  it("says how many proposals the reading DROPPED and why", async () => {
    await renderPage();
    expect(
      screen.getByText("41 proposed; 6 dropped because their figures were not in the text they cited.")
    ).toBeTruthy();
  });

  it("names the document each reading came from", async () => {
    await renderPage();
    expect(
      screen.getByRole("heading", { name: "Example Region RTP 2050 (adopted)" })
    ).toBeTruthy();
  });
});

describe("a candidate that disagrees with what the plan records", () => {
  it("shows BOTH figures, with the page and the document's own words", async () => {
    await renderPage();

    // The document's sentence, verbatim.
    expect(
      screen.getByText("Federal STBG revenue of $390 million is assumed over the near-term period.")
    ).toBeTruthy();
    // The page, as a link into the source document's download route.
    const pageLink = screen.getByRole("link", { name: "Page 112" });
    expect(pageLink.getAttribute("href")).toBe("/api/knowledge-base/documents/document-1/download");

    // And both figures side by side, labelled by which is which.
    const conflictRow = screen.getByRole("row", { name: /Amount/ });
    expect(within(conflictRow).getByText("$412,000,000")).toBeTruthy();
    expect(within(conflictRow).getByText("$390,000,000")).toBeTruthy();
    expect(screen.getByText("Disagrees with what you have")).toBeTruthy();
  });

  it("does not tell the reviewer which figure is right", async () => {
    await renderPage();
    expect(screen.queryByText(/the document is correct/i)).toBeNull();
    expect(screen.getByText(/decide which one this plan should carry/i)).toBeTruthy();
  });
});

describe("a candidate the plan does not have", () => {
  it("is labelled as new and shows its own quote", async () => {
    await renderPage();
    expect(screen.getByText("Not in this plan yet")).toBeTruthy();
    expect(screen.getByText("Transit ridership was 1,200,000 boardings in 2024.")).toBeTruthy();
  });
});

describe("a candidate this plan already records", () => {
  it("offers setting it aside first, so a duplicate is not the obvious click", async () => {
    // Same name, same figure, same dollar year as the recorded line: accepting
    // would record $412,000,000 twice.
    (tableData.rtp_extraction_candidates as Array<Record<string, unknown>>)[0].proposed_json = {
      entryKind: "revenue",
      sourceName: "Federal STBG",
      amount: 412000000,
      amountBasisYear: 2026,
      horizonBandId: BAND_NEAR,
    };
    const { container } = await renderPage();

    expect(screen.getByText("Already recorded")).toBeTruthy();

    const card = screen.getByText("Already recorded").closest("article");
    expect(card).toBeTruthy();
    const buttons = [...(card?.querySelectorAll("button") ?? [])].map((button) =>
      (button.textContent ?? "").trim()
    );
    expect(buttons[0]).toBe("Set aside");
    // Saving anyway is still possible — the verdict advises, it never decides.
    expect(buttons.some((label) => /Save it anyway/.test(label))).toBe(true);
    expect(container.textContent).toMatch(/record the same thing twice/i);
  });
});

describe("no surface here grades the machine's work", () => {
  it("renders no confidence, certainty or percentage anywhere", async () => {
    const { container } = await renderPage();
    expect(container.textContent ?? "").not.toMatch(/confidence|certainty|likelihood|% sure/i);
  });
});

describe("documents that cannot be transcribed from", () => {
  it("lists them with the reason instead of leaving them out of the picker", async () => {
    await renderPage();
    expect(screen.getByText("Scanned 2015 plan")).toBeTruthy();
    expect(screen.getByText(/looks like a scan/i)).toBeTruthy();
  });
});

describe("failed reads are never rendered as answers", () => {
  it("does not say the queue is empty when the candidates could not be read", async () => {
    tableErrors.rtp_extraction_candidates = { message: "permission denied" };
    await renderPage();

    expect(screen.getByText(/Part of this page could not be read/i)).toBeTruthy();
    expect(screen.getByText(/what was copied out of those documents/i)).toBeTruthy();
    expect(
      screen.getByText(/could not be read, so nothing is listed here/i)
    ).toBeTruthy();
  });

  it("does not 404 when the plan itself could not be read", async () => {
    tableErrors.rtp_cycles = { message: "connection reset" };
    await renderPage();
    expect(notFoundMock).not.toHaveBeenCalled();
    expect(screen.getByText("This plan could not be read")).toBeTruthy();
  });

  it("404s only for a plan that genuinely is not there", async () => {
    tableData.rtp_cycles = null;
    await expect(renderPage()).rejects.toThrow("notFound");
    expect(notFoundMock).toHaveBeenCalled();
  });
});

describe("a reader who cannot change the plan", () => {
  it("sees what was copied and no way to save or set anything aside", async () => {
    membershipRole = "viewer";
    await renderPage();

    expect(screen.queryByRole("button", { name: /Save into the plan/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Set aside/i })).toBeNull();
    expect(screen.getAllByText(/needs permission to change plans/i).length).toBeGreaterThan(0);
    // …but the transcription itself is still readable.
    expect(
      screen.getByText("Federal STBG revenue of $390 million is assumed over the near-term period.")
    ).toBeTruthy();
  });
});

describe("the reads themselves — the part render assertions cannot see", () => {
  it("scopes the plan to the caller's own workspace", async () => {
    await renderPage();
    const cycleRead = readsOf("rtp_cycles")[0];
    expect(filterValue(cycleRead, "workspace_id")).toBe("workspace-1");
    expect(filterValue(cycleRead, "id")).toBe(CYCLE_ID);
  });

  it("scopes runs and candidates to this plan cycle", async () => {
    await renderPage();
    expect(filterValue(readsOf("rtp_extraction_runs")[0], "rtp_cycle_id")).toBe(CYCLE_ID);
    expect(filterValue(readsOf("rtp_extraction_candidates")[0], "rtp_cycle_id")).toBe(CYCLE_ID);
  });

  it("scopes the document library and the project list to the workspace", async () => {
    await renderPage();
    expect(filterValue(readsOf("kb_documents")[0], "workspace_id")).toBe("workspace-1");
    expect(filterValue(readsOf("projects")[0], "workspace_id")).toBe("workspace-1");
  });

  it("asks for every column the screen renders", async () => {
    await renderPage();
    const runColumns = readsOf("rtp_extraction_runs")[0].columns;
    for (const column of ["candidate_count", "discarded_count", "failure_reason", "kb_documents"]) {
      expect(runColumns).toContain(column);
    }
    const candidateColumns = readsOf("rtp_extraction_candidates")[0].columns;
    for (const column of ["proposed_json", "source_page", "source_quote", "target_kind", "status"]) {
      expect(candidateColumns).toContain(column);
    }
  });
});

/*
  MUTATION RESULTS, 2026-08-11. Each applied, this file RUN, then restored:

    - `describeRunOutcome(...)` on the run header replaced with
      `${run.candidate_count} proposals` → "says how many proposals the reading
      DROPPED and why" fails. This is the hidden-discard-count mutation the lane
      brief asks for, and it fails on the real page rather than only in the
      copy unit test.
    - the conflict block deleted from `extraction-candidate-card.tsx` → "shows
      BOTH figures" fails: the recorded $412,000,000 disappears and the card
      shows only the document's figure, which is the mislabel-a-conflict
      failure.
    - `reconcileExtractionCandidate` replaced with a constant `new` verdict →
      4 failures, including the roll-up heading and the conflict table. Note
      the fourth: "is labelled as new and shows its own quote" also fails,
      because the roll-up no longer reads "1 new". A mutation that makes
      everything look new breaks the screen in both directions.
    - `.eq("workspace_id", membership.workspace_id)` removed from the cycle read
      → "scopes the plan to the caller's own workspace" fails while every render
      assertion stays green, which is why the filters are asserted at all.
    - the candidates-failed branch replaced with the ordinary empty sentence →
      "does not say the queue is empty when the candidates could not be read"
      fails.
    - `copy.primaryAction === "dismiss"` forced to `false` in the card, so
      "Save into the plan" leads on every verdict → "offers setting it aside
      first" fails. Without it a duplicate figure is the obvious click.
*/

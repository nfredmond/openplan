import { exactCountResult } from "./helpers/exact-count-result";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { ComponentPropsWithoutRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A READ THAT FAILED MAY NOT BE RENDERED AS AN ANSWER — the RTP module.
 *
 * `const { data } = await supabase…` hands back `null` for both "there is
 * nothing here" and "this query failed". The three RTP pages each turned that
 * into a sentence a planner reads and believes:
 *
 *   - the cycle detail and document pages shared ONE branch for "no row" and
 *     "the query failed", so any database error rendered the 404 page — the app
 *     telling a planner that their RTP cycle does not exist. That is the single
 *     most expensive false sentence in the module: the response to it is to
 *     re-create a plan update that is still there.
 *   - a failed `project_rtp_cycle_links` read rendered "No linked projects yet";
 *     a failed `rtp_cycle_chapters` read rendered a compiled RTP document with
 *     no chapters in it and no indication why.
 *
 * These tests drive the REAL page functions — not a stub of their loaders — with
 * a failing read, and assert three things, because only the three together
 * distinguish disclosure from a page that always shows a warning:
 *
 *   (a) the false-absence sentence is gone,
 *   (b) the disclosure naming what failed is present,
 *   (c) the ORDINARY empty state still appears when the read SUCCEEDS and there
 *       is genuinely nothing.
 */

const notFoundMock = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});
const redirectMock = vi.fn(() => {
  throw new Error("NEXT_REDIRECT");
});

const createClientMock = vi.fn();
const loadCurrentWorkspaceMembershipMock = vi.fn();

type QueryResult = { data: unknown; error: { message: string } | null; count?: number | null | undefined };

/** Per-table results for one render. Anything unset resolves to an empty read. */
let tableResults: Record<string, QueryResult> = {};

const OK: QueryResult = { data: [], error: null };

/**
 * A thenable query builder: every chained method returns itself and awaiting it
 * yields the table's result. Deliberately generic — a per-method mock chain has
 * to be rewritten every time a page adds a `.limit()`, and the thing under test
 * here is what the page renders for each read state. The focused funding cases
 * also assert projections, exact-count requests and linked-project filters.
 */
let selectCalls: Record<string, string[]> = {};
let selectOptions: Record<string, unknown[]> = {};
let inCalls: Record<string, unknown[][]> = {};

function makeQuery(fixture: QueryResult, table?: string) {
  let result = fixture;
  const query: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in", "not", "is", "order", "limit", "gte", "lte", "neq", "filter", "or"]) {
    query[method] = vi.fn((...args: unknown[]) => {
      if (method === "select" && table && typeof args[0] === "string") {
        selectCalls[table] = [...(selectCalls[table] ?? []), args[0]];
        selectOptions[table] = [...(selectOptions[table] ?? []), args[1]];
      }
      if (
        method === "select" &&
        (args[1] as { count?: string } | undefined)?.count === "exact" &&
        !Object.prototype.hasOwnProperty.call(fixture, "count")
      ) {
        result = exactCountResult(fixture);
      }
      if (method === "in" && table) inCalls[table] = [...(inCalls[table] ?? []), args];
      return query;
    });
  }
  query.maybeSingle = vi.fn(async () => result);
  query.single = vi.fn(async () => result);
  query.then = (resolve: (value: QueryResult) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  // A paged read asks for slices until one comes back empty, so a range answers
  // its slice. Handing back the whole result for every range would never end.
  query.range = vi.fn(async (from: number, toInclusive: number): Promise<QueryResult> =>
    result.error || !Array.isArray(result.data)
      ? result
      : { data: result.data.slice(from, toInclusive + 1), error: null }
  );
  return query;
}

const fromMock = vi.fn((table: string) => makeQuery(tableResults[table] ?? OK, table));

const CYCLE_ROW = {
  id: "rtp-1",
  workspace_id: "workspace-1",
  title: "Regional Transportation Plan 2050",
  status: "draft",
  geography_label: "Example Region",
  horizon_start_year: 2025,
  horizon_end_year: 2050,
  adoption_target_date: "2026-10-01",
  public_review_open_at: null,
  public_review_close_at: null,
  summary: "Regional plan update.",
  public_share_token: null,
  public_share_enabled: false,
  created_at: "2026-04-01T18:00:00.000Z",
  updated_at: "2026-04-14T06:30:00.000Z",
};

// Only the open tab is rendered, so each test must open the tab that holds what it checks.
vi.mock("@/components/ui/page-tab-panel", () => import("@/test/helpers/open-tab-only"));

vi.mock("next/navigation", () => ({
  notFound: () => notFoundMock(),
  redirect: () => redirectMock(),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: ComponentPropsWithoutRef<"a"> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

vi.mock("@/lib/workspaces/current", () => ({
  loadCurrentWorkspaceMembership: (...args: unknown[]) => loadCurrentWorkspaceMembershipMock(...args),
}));

vi.mock("@/components/cartographic/cartographic-surface-wide", () => ({
  CartographicSurfaceWide: () => <div data-testid="cartographic-surface" />,
}));

vi.mock("@/components/rtp/rtp-chapter-controls", () => ({
  RtpChapterControls: () => <div data-testid="rtp-chapter-controls" />,
}));
vi.mock("@/components/rtp/rtp-cycle-details-editor", () => ({
  RtpCycleDetailsEditor: () => <div data-testid="rtp-cycle-details-editor" />,
}));
vi.mock("@/components/rtp/rtp-horizon-band-editor", () => ({
  RtpHorizonBandEditor: () => <div data-testid="rtp-horizon-band-editor" />,
}));
vi.mock("@/components/rtp/rtp-financial-ledger-editor", () => ({
  RtpFinancialLedgerEditor: () => <div data-testid="rtp-financial-ledger-editor" />,
}));
vi.mock("@/components/rtp/rtp-performance-measure-editor", () => ({
  RtpPerformanceMeasureEditor: () => <div data-testid="rtp-performance-measure-editor" />,
}));
vi.mock("@/components/rtp/rtp-cycle-project-map", () => ({
  RtpCycleProjectMap: () => <div data-testid="rtp-cycle-project-map" />,
}));
vi.mock("@/components/rtp/rtp-cycle-phase-controls", () => ({
  RtpCyclePhaseControls: () => <div data-testid="rtp-cycle-phase-controls" />,
}));
vi.mock("@/components/rtp/rtp-engagement-campaign-creator", () => ({
  RtpEngagementCampaignCreator: () => <div data-testid="rtp-engagement-campaign-creator" />,
}));
vi.mock("@/components/rtp/rtp-report-creator", () => ({
  RtpReportCreator: () => <div data-testid="rtp-report-creator" />,
}));
vi.mock("@/components/rtp/rtp-public-share-controls", () => ({
  RtpPublicShareControls: () => <div data-testid="rtp-public-share-controls" />,
}));
vi.mock("@/components/rtp/rtp-cycle-creator", () => ({
  RtpCycleCreator: () => <div data-testid="rtp-cycle-creator" />,
}));
vi.mock("@/components/rtp/rtp-registry-packet-bulk-generate-actions", () => ({
  RtpRegistryPacketBulkGenerateActions: () => <div data-testid="rtp-bulk-generate" />,
}));
vi.mock("@/components/rtp/rtp-registry-packet-bulk-refresh-actions", () => ({
  RtpRegistryPacketBulkRefreshActions: () => <div data-testid="rtp-bulk-refresh" />,
}));
vi.mock("@/components/rtp/rtp-registry-packet-bulk-actions", () => ({
  RtpRegistryPacketBulkActions: () => <div data-testid="rtp-bulk-actions" />,
}));
vi.mock("@/components/rtp/rtp-registry-packet-queue-command-board", () => ({
  RtpRegistryPacketQueueCommandBoard: () => <div data-testid="rtp-queue-command-board" />,
}));
vi.mock("@/components/rtp/rtp-registry-next-action-shortcut", () => ({
  RtpRegistryNextActionShortcut: () => <div data-testid="rtp-next-action-shortcut" />,
}));
vi.mock("@/components/rtp/rtp-registry-packet-row-action", () => ({
  RtpRegistryPacketRowAction: () => <div data-testid="rtp-packet-row-action" />,
}));

import RtpCycleDetailPage from "@/app/(app)/rtp/[rtpCycleId]/page";
import RtpCycleDocumentPage from "@/app/(app)/rtp/[rtpCycleId]/document/page";
import RtpRegistryPage from "@/app/(app)/rtp/page";

/**
 * The cycle page is a record hub with URL tabs, and a closed tab is not
 * rendered at all. So every assertion about a panel names the tab that holds
 * it: "overview" (the default), "projects", "financial", "document" or
 * "comments". The header and the "Part of this cycle could not be read" notice
 * sit above the tab strip and render on every tab.
 */
type RtpCycleTabKey = "overview" | "projects" | "financial" | "document" | "comments";
const RTP_CYCLE_TABS: readonly RtpCycleTabKey[] = ["overview", "projects", "financial", "document", "comments"];

async function renderDetail(tab?: RtpCycleTabKey) {
  render(
    await RtpCycleDetailPage({
      params: Promise.resolve({ rtpCycleId: "rtp-1" }),
      searchParams: Promise.resolve(tab ? { tab } : {}),
    }),
  );
}

async function renderDocument() {
  render(await RtpCycleDocumentPage({ params: Promise.resolve({ rtpCycleId: "rtp-1" }) }));
}

async function renderRegistry() {
  render(await RtpRegistryPage({ searchParams: Promise.resolve({}) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  selectCalls = {};
  selectOptions = {};
  inCalls = {};
  tableResults = {
    rtp_cycles: { data: CYCLE_ROW, error: null },
  };

  loadCurrentWorkspaceMembershipMock.mockResolvedValue({
    membership: { workspace_id: "workspace-1", role: "owner" },
    workspace: { id: "workspace-1", name: "Example Agency" },
  });

  createClientMock.mockResolvedValue({
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: "user-1" } } })) },
    from: fromMock,
  });
});

describe("the publish control is reachable for every state of the project list", () => {
  /**
   * A capability nobody can reach is the defect class this repo has shipped
   * twelve times. `RtpPublicShareControls` sat inside the third branch of the
   * portfolio ternary, so it rendered only when the links read SUCCEEDED and
   * returned at least one row. The two states it was missing from are the two
   * that matter most:
   *
   *   - zero linked projects is exactly the cycle a public DRAFT REVIEW needs
   *     (chapters written, portfolio not yet assembled), and it could not be
   *     published at all;
   *   - a failed links read hid the control while the page was already
   *     apologising for the failure, so the planner's response — refresh, or
   *     publish anyway — was unavailable.
   *
   * These assert on the REAL page, driven through the real loaders, because a
   * test that stubs the thing it is named for cannot prove that thing.
   */
  it("renders the publish control when the cycle has no linked projects yet", async () => {
    tableResults.project_rtp_cycle_links = { data: [], error: null };

    // The publish control lives on the Document tab; the project list it was
    // once trapped inside lives on the Projects tab.
    await renderDetail("document");

    expect(screen.getByTestId("rtp-public-share-controls")).toBeInTheDocument();

    cleanup();
    await renderDetail("projects");

    // The ordinary empty state still appears — this must not have been fixed
    // by making the page pretend it has a portfolio.
    expect(screen.getByText("No linked projects yet")).toBeInTheDocument();
  });

  it("renders the publish control when the linked-projects read FAILS", async () => {
    tableResults.project_rtp_cycle_links = { data: null, error: { message: "permission denied" } };

    await renderDetail("document");

    expect(screen.getByTestId("rtp-public-share-controls")).toBeInTheDocument();

    cleanup();
    await renderDetail("projects");

    expect(screen.getByText("Linked projects could not be read")).toBeInTheDocument();
  });

  it("still renders it when there ARE linked projects", async () => {
    tableResults.project_rtp_cycle_links = {
      data: [
        {
          id: "link-1",
          project_id: "project-1",
          portfolio_role: "constrained",
          priority_rationale: null,
          priority_scores: {},
          created_at: "2026-04-01T00:00:00.000Z",
          projects: {
            id: "project-1",
            name: "Corridor upgrade",
            status: "active",
            delivery_phase: "planning",
            summary: null,
            rtp_posture_updated_at: null,
          },
        },
      ],
      error: null,
    };

    await renderDetail("document");

    expect(screen.getByTestId("rtp-public-share-controls")).toBeInTheDocument();
  });
});

describe("a planner can correct a cycle's own details after creating it", () => {
  /**
   * PATCH /api/rtp-cycles/[rtpCycleId] has validated and authorized ten fields
   * since it shipped, but its only caller sent `{ status }`. The other nine
   * were settable once, in the creation form, and uncorrectable forever after
   * — including BOTH public-review-window columns, which is what a public
   * draft review runs on. The route was already built; the control was not.
   */
  it("mounts the details editor on the cycle page", async () => {
    await renderDetail();
    expect(screen.getByTestId("rtp-cycle-details-editor")).toBeInTheDocument();
  });

  it("asks the database for the map-pin columns the editor round-trips", async () => {
    await renderDetail();

    const projection = (selectCalls.rtp_cycles ?? []).join(" ");
    // Without these two the editor would render an empty pin and write null
    // back over a real one on the next save — silently un-pinning the plan.
    expect(projection).toContain("anchor_latitude");
    expect(projection).toContain("anchor_longitude");
    // The window the draft review depends on.
    expect(projection).toContain("public_review_open_at");
    expect(projection).toContain("public_review_close_at");
  });
});

describe("the fiscal-constraint finding is rendered where a planner will see it", () => {
  /**
   * The highest-risk failure for this feature is not a wrong sum — it is a
   * verdict that exists only in a library. This module has shipped a complete,
   * tested, access-gated capability nobody could reach a dozen times, so these
   * drive the REAL page and assert the REAL verdict text, and they assert it
   * CHANGES with the data. A single fixture could not tell a rendered
   * computation from a hardcoded string.
   */
  const BAND = {
    id: "band-1",
    // Covers the fixture cycle's declared horizon (2025–2050) end to end. A
    // narrower period here would make every one of these tests report
    // "not determined — the horizon is not fully covered", which is correct
    // behaviour but not what they are testing.
    label: "Whole plan",
    start_year: 2025,
    end_year: 2050,
    escalation_target_year: 2030,
    cost_estimate_basis: "itemized",
    sort_order: 0,
  };

  function link(id: string, cost: number | null) {
    return {
      id,
      project_id: `project-${id}`,
      portfolio_role: "constrained",
      priority_rationale: null,
      priority_scores: {},
      horizon_band_id: BAND.id,
      estimated_cost: cost,
      cost_basis_year: 2026,
      created_at: "2026-04-01T00:00:00.000Z",
      projects: {
        id: `project-${id}`,
        name: `Project ${id}`,
        status: "active",
        delivery_phase: "planning",
        summary: null,
        rtp_posture_updated_at: null,
      },
    };
  }

  function revenueLine(amount: number) {
    return {
      id: "line-1",
      horizon_band_id: BAND.id,
      entry_kind: "revenue",
      source_name: "Programme revenue",
      amount,
      amount_basis_year: 2026,
      notes: null,
    };
  }

  it("says the plan IS fiscally constrained when revenue covers the priced programme", async () => {
    tableResults.rtp_horizon_bands = { data: [BAND], error: null };
    tableResults.rtp_financial_assumptions = { data: [revenueLine(100_000_000)], error: null };
    tableResults.project_rtp_cycle_links = { data: [link("a", 40_000_000)], error: null };

    await renderDetail("financial");

    expect(screen.getByText("Fiscally constrained")).toBeInTheDocument();
    expect(screen.getByText(/reasonably available revenue/i)).toBeInTheDocument();
  });

  it("says NOT DETERMINED for the same revenue once one project is unpriced", async () => {
    tableResults.rtp_horizon_bands = { data: [BAND], error: null };
    tableResults.rtp_financial_assumptions = { data: [revenueLine(100_000_000)], error: null };
    tableResults.project_rtp_cycle_links = {
      data: [link("a", 40_000_000), link("b", null)],
      error: null,
    };

    await renderDetail("financial");

    // Same revenue, same priced cost, and the arithmetic alone would still say
    // "constrained". The page must not.
    expect(screen.getByText("Not determined")).toBeInTheDocument();
    expect(screen.queryByText("Fiscally constrained")).not.toBeInTheDocument();
    // Appears twice on purpose: in the summary sentence and again on the
    // named project row, so a planner reading either one is told the same thing.
    expect(screen.getAllByText(/no cost recorded/i).length).toBeGreaterThan(0);
    // And it names the project so the planner knows what to go and enter.
    expect(screen.getAllByText(/Project b/).length).toBeGreaterThan(0);
  });

  it("says the costs exceed the revenue when they do", async () => {
    tableResults.rtp_horizon_bands = { data: [BAND], error: null };
    tableResults.rtp_financial_assumptions = { data: [revenueLine(10_000_000)], error: null };
    tableResults.project_rtp_cycle_links = { data: [link("a", 90_000_000)], error: null };

    await renderDetail("financial");

    expect(screen.getByText("Costs exceed revenue")).toBeInTheDocument();
  });

  it("discloses constant dollars rather than presenting them as year-of-expenditure", async () => {
    tableResults.rtp_horizon_bands = { data: [BAND], error: null };
    tableResults.rtp_financial_assumptions = { data: [revenueLine(100_000_000)], error: null };
    tableResults.project_rtp_cycle_links = { data: [link("a", 40_000_000)], error: null };

    await renderDetail("financial");

    // CYCLE_ROW records no inflation rate, so these are constant dollars and
    // the page has to say so — presenting them as YOE is the misstatement.
    expect(screen.getAllByText(/constant dollars/i).length).toBeGreaterThan(0);
  });

  it("will not call a plan constrained when its periods cover only part of its horizon", async () => {
    // The fixture cycle declares 2025–2050. One period covering 2025–2035
    // leaves fifteen years accounted for by nothing, so the money below
    // describes part of a plan and must not be presented as the whole.
    tableResults.rtp_horizon_bands = {
      data: [{ ...BAND, end_year: 2035 }],
      error: null,
    };
    tableResults.rtp_financial_assumptions = { data: [revenueLine(100_000_000)], error: null };
    tableResults.project_rtp_cycle_links = { data: [link("a", 40_000_000)], error: null };

    await renderDetail("financial");

    expect(screen.getByText("Not determined")).toBeInTheDocument();
    expect(screen.queryByText("Fiscally constrained")).toBeNull();
    expect(screen.getByText(/2036–2050 ha[sv]e? no period/)).toBeInTheDocument();
  });

  it("renders the project lists, grouped, where the plan's commitments are read", async () => {
    tableResults.rtp_horizon_bands = { data: [BAND], error: null };
    tableResults.project_rtp_cycle_links = {
      data: [link("a", 40_000_000), link("b", null)],
      error: null,
    };

    await renderDetail("projects");

    expect(screen.getByText("What this plan commits to, and when")).toBeInTheDocument();
    expect(screen.getAllByText(/Whole plan/).length).toBeGreaterThan(0);
    // The partial subtotal reaches the page, not just the component's own test.
    expect(screen.getByText(/1 of 2 projects has no cost recorded/)).toBeInTheDocument();
  });

  it("mounts all three financial editors, so the ledger can actually be filled in", async () => {
    await renderDetail("financial");

    expect(screen.getByTestId("rtp-horizon-band-editor")).toBeInTheDocument();
    expect(screen.getByTestId("rtp-financial-ledger-editor")).toBeInTheDocument();
    expect(screen.getByTestId("rtp-performance-measure-editor")).toBeInTheDocument();
  });

  it("asks the database for the cost columns the finding is computed from", async () => {
    await renderDetail();

    const links = (selectCalls.project_rtp_cycle_links ?? []).join(" ");
    expect(links).toContain("estimated_cost");
    expect(links).toContain("horizon_band_id");
    expect(links).toContain("cost_basis_year");

    const cycle = (selectCalls.rtp_cycles ?? []).join(" ");
    expect(cycle).toContain("financial_basis_year");
    expect(cycle).toContain("annual_inflation_rate");

    expect((selectCalls.rtp_financial_assumptions ?? []).join(" ")).toContain("entry_kind");
  });

  it("does not present a finding when the financial reads FAILED", async () => {
    tableResults.rtp_horizon_bands = { data: null, error: { message: "permission denied" } };

    await renderDetail("financial");

    expect(screen.getByText("The financial element could not be fully read")).toBeInTheDocument();
    expect(screen.queryByText("Fiscally constrained")).not.toBeInTheDocument();
    expect(screen.queryByText("Not determined")).not.toBeInTheDocument();
  });
});

describe("the map and the comment-response record are reachable on the cycle page", () => {
  /**
   * Both shipped complete, tested and unreachable — nothing imported either.
   * These assert the mount, and the comment-response one also asserts the
   * failed-read disclosure, because "nobody commented" and "the comments could
   * not be read" are different facts and the second rendered as the first is an
   * agency claiming a silence it never heard.
   */
  it("mounts the per-cycle project map", async () => {
    await renderDetail("projects");
    expect(screen.getByTestId("rtp-cycle-project-map")).toBeInTheDocument();
  });

  it("renders the comment-response record", async () => {
    await renderDetail("comments");
    expect(screen.getByText("What the public said, and what we said back")).toBeInTheDocument();
  });

  it("does NOT report an empty comment record when the consultations could not be read", async () => {
    tableResults.engagement_campaigns = { data: null, error: { message: "permission denied" } };

    await renderDetail("comments");

    expect(
      screen.getByText("The public engagement on this plan could not be read")
    ).toBeInTheDocument();
    expect(screen.queryByText("No approved public comments yet")).toBeNull();
  });
});

describe("the RTP cycle detail page separates a failed read from an absence", () => {
  it("does not 404 when the cycle read FAILS — that would say the cycle does not exist", async () => {
    tableResults.rtp_cycles = { data: null, error: { message: "permission denied for table rtp_cycles" } };

    await renderDetail();

    expect(notFoundMock).not.toHaveBeenCalled();
    expect(screen.getByText("This RTP cycle could not be read")).toBeInTheDocument();
    expect(screen.getByText(/not the same as the cycle not existing/i)).toBeInTheDocument();
    // Internal page: the operator gets the database's own reason.
    expect(screen.getByText(/permission denied for table rtp_cycles/)).toBeInTheDocument();
  });

  it("still 404s when the cycle genuinely is not there", async () => {
    tableResults.rtp_cycles = { data: null, error: null };

    await expect(renderDetail()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFoundMock).toHaveBeenCalled();
  });

  it("replaces 'No linked projects yet' with a disclosure when that read fails", async () => {
    tableResults.project_rtp_cycle_links = {
      data: null,
      error: { message: "permission denied for table project_rtp_cycle_links" },
    };

    // The project list is on the Projects tab.
    await renderDetail("projects");

    // (a) the false absence is gone
    expect(screen.queryByText("No linked projects yet")).not.toBeInTheDocument();
    // (b) the disclosure is present, and names what failed
    expect(screen.getByText("Linked projects could not be read")).toBeInTheDocument();
    expect(screen.getByText("Part of this cycle could not be read")).toBeInTheDocument();
    expect(
      screen.getByText(/could not read the projects linked to this cycle/i)
    ).toBeInTheDocument();

    // The linked-project count is on the Overview tab's summary.
    cleanup();
    await renderDetail("overview");

    expect(screen.getByText("Part of this cycle could not be read")).toBeInTheDocument();
    // and the count is withheld rather than shown as zero
    expect(screen.getByText(/this is not a count of zero/i)).toBeInTheDocument();
  });

  it("discloses a failed chapter read instead of 'No chapters yet'", async () => {
    tableResults.rtp_cycle_chapters = {
      data: null,
      error: { message: "permission denied for table rtp_cycle_chapters" },
    };

    // The chapter shell is on the Document tab.
    await renderDetail("document");

    expect(screen.queryByText("No chapters yet")).not.toBeInTheDocument();
    expect(screen.getByText("Chapter sections could not be read")).toBeInTheDocument();

    // The adoption-record proof block is on the Comments tab.
    cleanup();
    await renderDetail("comments");

    // The adoption-record proof block is computed from this read, so it must say
    // that a "Needs operator" verdict may only mean OpenPlan could not look.
    expect(screen.getByText(/may\s+only mean OpenPlan could not look/i)).toBeInTheDocument();
  });

  /**
   * The SECOND count grid. The six header cards were gated when this page was
   * first fixed; the four public-review cards below them were not, and they are
   * the ones read at closeout. Worse, the recommendations under them are
   * INSTRUCTIONS built from the same reads — "Create one whole-cycle engagement
   * campaign…" offered because a query failed sends a planner to duplicate a
   * campaign that already exists.
   */
  it("withholds the public-review comment counts when the CAMPAIGN read fails", async () => {
    // The item query is filtered by campaign id, so a failed campaign read
    // leaves it nothing to ask for: it succeeds, answers "none", and the counts
    // would otherwise render an honest zero about a question never asked.
    tableResults.engagement_campaigns = {
      data: null,
      error: { message: "permission denied for table engagement_campaigns" },
    };

    await renderDetail("comments");

    expect(screen.getByText("Pending comments")).toBeInTheDocument();
    expect(
      screen.getByText(/an empty moderation queue here is not a finding that nothing is waiting/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/Public comments could not be read, so this is not a count of zero/i)).toBeInTheDocument();
  });

  it("does not tell a planner to create a packet that a failed read simply could not see", async () => {
    tableResults.reports = {
      data: null,
      error: { message: "permission denied for table reports" },
    };

    await renderDetail("comments");

    expect(
      screen.getByText(/Do not act on a recommendation to create a campaign or a packet from this page/i)
    ).toBeInTheDocument();
    // and the packet count is withheld rather than shown as 0/0
    expect(screen.getByText(/a packet may already be generated/i)).toBeInTheDocument();
  });

  it("(c) still shows the ordinary empty states when every read SUCCEEDS and there is nothing", async () => {
    // Every tab, because the withheld-count sentence this test rules out is
    // printed on more than one of them (the Overview summary and the Comments
    // count grid). A negative checked on one tab says nothing about the others.
    for (const tab of RTP_CYCLE_TABS) {
      await renderDetail(tab);

      expect(screen.queryByText("Part of this cycle could not be read")).not.toBeInTheDocument();
      expect(screen.queryByText(/this is not a count of zero/i)).not.toBeInTheDocument();

      if (tab === "projects") {
        expect(screen.getByText("No linked projects yet")).toBeInTheDocument();
      }

      if (tab === "comments") {
        expect(screen.getByText("No whole-cycle campaigns yet")).toBeInTheDocument();
        // (c) for the public-review block: the real counts and the real
        // recommendations still render when nothing failed.
        expect(screen.queryByText(/Do not act on a recommendation to create a campaign or a packet/i)).not.toBeInTheDocument();
        expect(
          screen.getByText("Current rendered packet artifacts available for review and export.")
        ).toBeInTheDocument();
        expect(
          screen.getByText("Items still waiting for operator review before packet closeout.")
        ).toBeInTheDocument();
      }

      cleanup();
    }
  });
});

describe("the compiled RTP document page separates a failed read from an absence", () => {
  it("does not 404 when the cycle read FAILS", async () => {
    tableResults.rtp_cycles = { data: null, error: { message: "could not connect to server" } };

    await renderDocument();

    expect(notFoundMock).not.toHaveBeenCalled();
    expect(screen.getByText("This RTP cycle could not be read")).toBeInTheDocument();
  });

  it("still 404s when the cycle genuinely is not there", async () => {
    tableResults.rtp_cycles = { data: null, error: null };

    await expect(renderDocument()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFoundMock).toHaveBeenCalled();
  });

  it("says the chapters could not be read rather than compiling a document with none", async () => {
    tableResults.rtp_cycle_chapters = {
      data: null,
      error: { message: "permission denied for table rtp_cycle_chapters" },
    };

    await renderDocument();

    expect(screen.getByText("The chapters of this plan could not be read")).toBeInTheDocument();
    expect(screen.getByText("Part of this document could not be assembled")).toBeInTheDocument();
    // "0 chapters" is an assertion about the plan; it must not be made here.
    expect(screen.queryByText("0 chapters")).not.toBeInTheDocument();
    expect(screen.getByText("Chapters unavailable")).toBeInTheDocument();
  });

  it("replaces the portfolio and engagement empty states when those reads fail", async () => {
    tableResults.project_rtp_cycle_links = { data: null, error: { message: "permission denied" } };
    tableResults.engagement_campaigns = { data: null, error: { message: "permission denied" } };

    await renderDocument();

    expect(screen.queryByText("No projects on this plan yet")).not.toBeInTheDocument();
    expect(screen.queryByText("Nobody has been asked yet")).not.toBeInTheDocument();
    expect(screen.getByText("The list of projects could not be read")).toBeInTheDocument();
    expect(
      screen.getByText("The public engagement on this plan could not be read")
    ).toBeInTheDocument();
  });

  it("(c) still shows the ordinary empty states when every read SUCCEEDS and there is nothing", async () => {
    await renderDocument();

    expect(screen.getByText("No projects on this plan yet")).toBeInTheDocument();
    expect(screen.getByText("Nobody has been asked yet")).toBeInTheDocument();
    expect(screen.getByText("0 chapters")).toBeInTheDocument();
    expect(screen.queryByText("Part of this document could not be assembled")).not.toBeInTheDocument();
  });
});

describe("the RTP registry discloses a failed cycle read", () => {
  it("says the cycle list could not be read rather than letting an empty registry answer", async () => {
    tableResults.rtp_cycles = { data: null, error: { message: "permission denied for table rtp_cycles" } };

    await renderRegistry();

    expect(screen.getByText("The RTP cycle list could not be read")).toBeInTheDocument();
    expect(
      screen.getByText(/No cycle is listed below because the query failed, not because this workspace has none/i)
    ).toBeInTheDocument();
  });

  /**
   * A DISCLOSURE MAY NOT OVER-CLAIM EITHER. The shared `ReadFailureLog.describe()`
   * sentence promises that "anything below that depends on it is shown as
   * unavailable rather than as zero". That is true on the two cycle pages, which
   * render an em dash. It is NOT true here: `RtpRegistryOverview` takes `number`
   * props, so the cards still render "Cycles 0" and "$0 outstanding". Using the
   * shared sentence would make the notice itself the false statement.
   */
  it("does not promise the counts below are withheld, because this page cannot withhold them", async () => {
    tableResults.rtp_cycles = { data: null, error: { message: "permission denied for table rtp_cycles" } };

    await renderRegistry();

    expect(
      screen.getByText(/The summary counts and dollar totals below are computed only from what did load/i)
    ).toBeInTheDocument();
    expect(screen.queryByText(/shown as unavailable rather than as zero/i)).not.toBeInTheDocument();
  });

  it("(c) shows no disclosure when the read SUCCEEDS and the workspace genuinely has no cycles", async () => {
    tableResults.rtp_cycles = { data: [], error: null };

    await renderRegistry();

    expect(screen.queryByText("The RTP cycle list could not be read")).not.toBeInTheDocument();
    expect(screen.queryByText("Part of this registry could not be read")).not.toBeInTheDocument();
    expect(screen.getByText("No plan cycles yet")).toBeInTheDocument();
  });
});

// These drive the actual server pages and their rendered disclosures. Counts
// are supplied only for exact-count selects; an explicit missing/null count is
// retained so the mock cannot turn an incomplete read into a complete one.
const FUNDING_READS = [
  { table: "funding_awards", label: "committed awards for the linked projects" },
  { table: "funding_opportunities", label: "pursued funding for the linked projects" },
  { table: "billing_invoice_records", label: "reimbursement invoices for the linked projects" },
] as const;
const DISCLOSED_FUNDING_READS = [
  ...FUNDING_READS,
  { table: "project_funding_profiles", label: "funding records for the linked projects" },
] as const;
const FUNDING_READERS = [
  { name: "registry", renderPage: renderRegistry, failureTitle: "Part of this registry could not be read" },
  { name: "cycle detail", renderPage: renderDetail, failureTitle: "Part of this cycle could not be read" },
] as const;

function seedLinkedFunding(reader: typeof FUNDING_READERS[number]["name"], populated = true) {
  tableResults.rtp_cycles = { data: reader === "registry" ? [CYCLE_ROW] : CYCLE_ROW, error: null };
  tableResults.project_rtp_cycle_links = {
    data: [{
      id: "link-1", rtp_cycle_id: CYCLE_ROW.id, project_id: "project-1",
      portfolio_role: "constrained", priority_rationale: null, priority_scores: {},
      horizon_band_id: null, estimated_cost: 10, cost_basis_year: 2026,
      created_at: "2026-04-01T00:00:00.000Z",
      projects: { id: "project-1", name: "Corridor upgrade", status: "active",
        delivery_phase: "planning", summary: null, rtp_posture_updated_at: null },
    }],
    error: null,
  };
  tableResults.project_funding_profiles = {
    data: [{ project_id: "project-1", funding_need_amount: 10, local_match_need_amount: 0 }], error: null,
  };
  tableResults.funding_awards = {
    data: populated ? [{ id: "award-1", project_id: "project-1", awarded_amount: 10, match_amount: 0,
      risk_flag: "none", obligation_due_at: null, latest_handoff_revision_id: null,
      current_handoff_revision_id: null, currency_code: "USD", has_source_backed_issuance: false }] : [],
    error: null, count: populated ? 1 : 0,
  };
  tableResults.funding_opportunities = {
    data: populated ? [{ project_id: "project-1", decision_state: "pursue", opportunity_status: "open",
      expected_award_amount: 5, has_source_backed_issuance: false }] : [],
    error: null, count: populated ? 1 : 0,
  };
  tableResults.billing_invoice_records = {
    data: populated ? [{ project_id: "project-1", funding_award_id: "award-1", status: "submitted",
      amount: 2, retention_percent: 0, retention_amount: 0, net_amount: 2, due_date: null,
      award_handoff_revision_id: null, currency_code: "USD", handoff_applicable_revision_id: null }] : [],
    error: null, count: populated ? 1 : 0,
  };
}

function expectFundingCount(reader: typeof FUNDING_READERS[number]["name"], funded: boolean) {
  if (reader === "registry") {
    expect(within(screen.getByLabelText("Regional plan figures")).getByText(
      funded ? "1 funded, 0 likely, 0 with a gap" : "0 funded, 0 likely, 1 with a gap"
    )).toBeInTheDocument();
  } else {
    const card = screen.getByText("Funded projects").parentElement;
    if (!card) throw new Error("Funded projects card is absent");
    expect(within(card).getByText(funded ? "1/1" : "0/1")).toBeInTheDocument();
  }
}

describe.each(FUNDING_READERS)("$name funding read disclosure and completeness", ({ name, renderPage, failureTitle }) => {
  it.each(DISCLOSED_FUNDING_READS)("renders loaded cycle data and the named $table failure without throwing", async ({ table, label }) => {
    seedLinkedFunding(name);
    tableResults[table] = { data: null, error: { message: `permission denied for table ${table}` } };

    await renderPage();

    expect(screen.getAllByText(CYCLE_ROW.title).length).toBeGreaterThan(0);
    expect(screen.getByText(failureTitle)).toBeInTheDocument();
    expect(screen.getAllByText(new RegExp(label)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(new RegExp(`permission denied for table ${table}`)).length).toBeGreaterThan(0);
    expect(screen.queryByText("Funding records are not available yet")).not.toBeInTheDocument();
    if (name === "registry") {
      expect(screen.getByText(/summary counts and dollar totals below are computed only from what did load/)).toBeInTheDocument();
    } else {
      expect(screen.getByText(/Funding posture is unavailable because part of the funding record could not be read/)).toBeInTheDocument();
    }
  });

  it.each(DISCLOSED_FUNDING_READS)("keeps pending-schema $table distinct from failure and successful zero", async ({ table }) => {
    seedLinkedFunding(name);
    tableResults[table] = { data: null, error: { message: `relation "${table}" does not exist` } };

    await renderPage();

    expect(screen.getAllByText(CYCLE_ROW.title).length).toBeGreaterThan(0);
    expect(screen.getByText("Funding records are not available yet")).toBeInTheDocument();
    expect(screen.getByText(/pending a database update/)).toBeInTheDocument();
    expect(screen.queryByText(failureTitle)).not.toBeInTheDocument();
    if (name === "cycle detail") {
      expect(screen.getByText(/Funding posture is unavailable because part of the funding record could not be read/)).toBeInTheDocument();
    }
  });

  it("renders complete nonempty funding data and requests its version/currency projections and exact counts", async () => {
    seedLinkedFunding(name);

    await renderPage();

    expectFundingCount(name, true);
    expect(screen.queryByText(failureTitle)).not.toBeInTheDocument();
    expect(screen.queryByText("Funding records are not available yet")).not.toBeInTheDocument();
    const projections = {
      funding_awards: "project_id, awarded_amount, match_amount, risk_flag, obligation_due_at, id, latest_handoff_revision_id, current_handoff_revision_id, currency_code, has_source_backed_issuance",
      funding_opportunities: "project_id, decision_state, opportunity_status, expected_award_amount, has_source_backed_issuance",
      billing_invoice_records: "project_id, funding_award_id, status, amount, retention_percent, retention_amount, net_amount, due_date, award_handoff_revision_id, currency_code, handoff_applicable_revision_id",
    };
    for (const { table } of FUNDING_READS) {
      expect(selectCalls[table]).toEqual([projections[table]]);
      expect(selectOptions[table]).toEqual([{ count: "exact" }]);
      expect(inCalls[table]).toEqual([["project_id", ["project-1"]]]);
    }
  });

  it("renders successful empty funding sets with exact zero counts as the ordinary empty result", async () => {
    seedLinkedFunding(name, false);

    await renderPage();

    expectFundingCount(name, false);
    expect(screen.queryByText(failureTitle)).not.toBeInTheDocument();
    expect(screen.queryByText("Funding records are not available yet")).not.toBeInTheDocument();
  });

  describe.each(FUNDING_READS)("$table successful-read refusal", ({ table }) => {
    it.each([
      { state: "truncated", count: 2 },
      { state: "missing count", count: undefined },
      { state: "null count", count: null },
    ])("refuses a successful nonempty $state result", async ({ count }) => {
      seedLinkedFunding(name);
      tableResults[table] = { ...tableResults[table], count };

      await expect(renderPage()).rejects.toThrow("No partial financial snapshot is accepted");
      expect(screen.queryByText(CYCLE_ROW.title)).not.toBeInTheDocument();
    });

    it.each([undefined, null])("refuses successful empty data with an absent count (%s)", async (count) => {
      seedLinkedFunding(name, false);
      tableResults[table] = { data: [], error: null, count };

      await expect(renderPage()).rejects.toThrow("No partial financial snapshot is accepted");
    });

    it("refuses null successful data even when the count is zero", async () => {
      seedLinkedFunding(name, false);
      tableResults[table] = { data: null, error: null, count: 0 };

      await expect(renderPage()).rejects.toThrow("No partial financial snapshot is accepted");
    });

    it.each(["permission denied", "schema cache unavailable"])("still refuses a truncated success beside a classified error (%s)", async (message) => {
      seedLinkedFunding(name);
      const other = FUNDING_READS.find((read) => read.table !== table);
      if (!other) throw new Error("A separate funding query is required");
      tableResults[other.table] = { data: null, error: { message } };
      tableResults[table] = { ...tableResults[table], count: 2 };

      await expect(renderPage()).rejects.toThrow("No partial financial snapshot is accepted");
    });
  });
});

// Open Projects explicitly and inspect the real programme list. Overview's
// unavailable state cannot satisfy these assertions through the tab mock.
function seedProjectsFunding(populated = true) {
  seedLinkedFunding("cycle detail", populated);
  const links = tableResults.project_rtp_cycle_links.data as Array<{ priority_scores: Record<string, number> }>;
  links[0].priority_scores = { safety: 3 };
}

function projectsFundingSurfaces() {
  const programme = screen.getByRole("heading", { name: "What this plan commits to, and when" }).closest("article");
  const summary = screen.getByRole("heading", { name: "Cycle-linked projects" }).closest("article");
  if (!programme || !summary) throw new Error("Both Projects funding surfaces must render");
  const project = within(programme).getByRole("link", { name: "Corridor upgrade" });
  const row = project.closest("li");
  if (!row) throw new Error("The real programme project row must render");
  expect(project).toHaveAttribute("href", "/projects/project-1");
  expect(row).toHaveTextContent(/\$10\s*\(2026 dollars\)/);
  expect(within(row).getByText(/Priority \d+\/100/)).toBeInTheDocument();
  expect(within(row).getByText(/improves safety \(high\)/)).toBeInTheDocument();
  return { row, summary };
}

const PROJECTS_FUNDING_METRICS = [
  "Funded", "Likely covered", "Still unfunded", "Paid reimbursements", "Outstanding requests", "Uninvoiced awards",
] as const;
const PROJECT_FUNDING_BADGES = [
  "Funded", "Likely covered", "Gap remains", "Unfunded", "Funding pipeline logged", "Funding pipeline unknown",
  "Pipeline comparison unassessed",
] as const;

function expectProjectsFundingUnavailable() {
  const { row, summary } = projectsFundingSurfaces();
  expect(within(row).getByText("Project funding unavailable")).toBeInTheDocument();
  for (const label of PROJECT_FUNDING_BADGES) {
    expect(within(row).queryByText(label)).not.toBeInTheDocument();
  }
  expect(within(row).queryByText(/Project funding:/)).not.toBeInTheDocument();
  expect(within(row).queryByText(/Recorded award ceilings/)).not.toBeInTheDocument();
  expect(within(summary).getByText("Project funding summary is unavailable")).toBeInTheDocument();
  for (const label of PROJECTS_FUNDING_METRICS) {
    expect(within(summary).queryByText(label)).not.toBeInTheDocument();
  }
  expect(summary.querySelectorAll(".module-metric-card")).toHaveLength(0);
  expect(within(summary).queryByText(/A real gap remains/)).not.toBeInTheDocument();
  expect(within(summary).queryByText(/The invoicing register shows the same invoice records to the cent/)).not.toBeInTheDocument();
  expect(summary).toHaveTextContent("1 project in this plan.");
}

describe("cycle detail Projects withholds unavailable funding without hiding the programme", () => {
  it.each(DISCLOSED_FUNDING_READS)("withholds dependent Projects claims for a generic $table error", async ({ table, label }) => {
    seedProjectsFunding();
    tableResults[table] = { data: null, error: { message: `permission denied for table ${table}` } };

    await renderDetail("projects");

    expect(screen.getAllByText(CYCLE_ROW.title).length).toBeGreaterThan(0);
    expect(screen.getByText("Part of this cycle could not be read")).toBeInTheDocument();
    expect(screen.getAllByText(new RegExp(label)).length).toBeGreaterThan(0);
    expect(screen.queryByText("Funding records are not available yet")).not.toBeInTheDocument();
    expectProjectsFundingUnavailable();
  });

  it.each(DISCLOSED_FUNDING_READS)("withholds dependent Projects claims for pending-schema $table", async ({ table }) => {
    seedProjectsFunding();
    tableResults[table] = { data: null, error: { message: `relation "${table}" does not exist` } };

    await renderDetail("projects");

    expect(screen.getAllByText(CYCLE_ROW.title).length).toBeGreaterThan(0);
    expect(screen.getByText("Funding records are not available yet")).toBeInTheDocument();
    expect(screen.getByText(/pending a database update/)).toBeInTheDocument();
    expect(screen.queryByText("Part of this cycle could not be read")).not.toBeInTheDocument();
    expectProjectsFundingUnavailable();
  });

  it.each([
    { state: "complete nonempty", populated: true, badge: "Funded", funding: "Project funding: $10 committed · $0 still to raise", values: ["1", "0", "0", "$0", "$2", "$8"] },
    { state: "successful exact-zero", populated: false, badge: "Unfunded", funding: "Project funding: $0 committed · $10 still to raise", values: ["0", "0", "1", "$0", "$0", "$0"] },
  ])("retains ordinary Projects funding for $state reads", async ({ populated, badge, funding, values }) => {
    seedProjectsFunding(populated);

    await renderDetail("projects");

    const { row, summary } = projectsFundingSurfaces();
    expect(within(row).getByText(badge)).toBeInTheDocument();
    expect(row).toHaveTextContent(funding);
    for (const [index, label] of PROJECTS_FUNDING_METRICS.entries()) {
      const card = within(summary).getByText(label).parentElement;
      if (!card) throw new Error(`The ${label} metric card must render`);
      expect(within(card).getByText(values[index], { exact: true })).toBeInTheDocument();
    }
    expect(within(summary).getByText(/The invoicing register shows the same invoice records to the cent/)).toBeInTheDocument();
    expect(screen.queryByText("Project funding unavailable")).not.toBeInTheDocument();
    expect(screen.queryByText("Project funding summary is unavailable")).not.toBeInTheDocument();
    expect(screen.queryByText("Part of this cycle could not be read")).not.toBeInTheDocument();
    expect(screen.queryByText("Funding records are not available yet")).not.toBeInTheDocument();
  });
});

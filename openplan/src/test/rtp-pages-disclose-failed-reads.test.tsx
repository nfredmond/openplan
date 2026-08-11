import { render, screen } from "@testing-library/react";
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

type QueryResult = { data: unknown; error: { message: string } | null };

/** Per-table results for one render. Anything unset resolves to an empty read. */
let tableResults: Record<string, QueryResult> = {};

const OK: QueryResult = { data: [], error: null };

/**
 * A thenable query builder: every chained method returns itself and awaiting it
 * yields the table's result. Deliberately generic — a per-method mock chain has
 * to be rewritten every time a page adds a `.limit()`, and the thing under test
 * here is what the page does with `error`, not the shape of the query.
 */
let selectCalls: Record<string, string[]> = {};

function makeQuery(result: QueryResult, table?: string) {
  const query: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in", "not", "is", "order", "limit", "gte", "lte", "neq", "filter", "or"]) {
    query[method] = vi.fn((...args: unknown[]) => {
      if (method === "select" && table && typeof args[0] === "string") {
        selectCalls[table] = [...(selectCalls[table] ?? []), args[0]];
      }
      return query;
    });
  }
  query.maybeSingle = vi.fn(async () => result);
  query.single = vi.fn(async () => result);
  query.then = (resolve: (value: QueryResult) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
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

async function renderDetail() {
  render(await RtpCycleDetailPage({ params: Promise.resolve({ rtpCycleId: "rtp-1" }) }));
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

    await renderDetail();

    expect(screen.getByTestId("rtp-public-share-controls")).toBeInTheDocument();
    // The ordinary empty state still appears — this must not have been fixed
    // by making the page pretend it has a portfolio.
    expect(screen.getByText("No linked projects yet")).toBeInTheDocument();
  });

  it("renders the publish control when the linked-projects read FAILS", async () => {
    tableResults.project_rtp_cycle_links = { data: null, error: { message: "permission denied" } };

    await renderDetail();

    expect(screen.getByTestId("rtp-public-share-controls")).toBeInTheDocument();
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

    await renderDetail();

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

    await renderDetail();

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

    await renderDetail();

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

    await renderDetail();

    expect(screen.getByText("Costs exceed revenue")).toBeInTheDocument();
  });

  it("discloses constant dollars rather than presenting them as year-of-expenditure", async () => {
    tableResults.rtp_horizon_bands = { data: [BAND], error: null };
    tableResults.rtp_financial_assumptions = { data: [revenueLine(100_000_000)], error: null };
    tableResults.project_rtp_cycle_links = { data: [link("a", 40_000_000)], error: null };

    await renderDetail();

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

    await renderDetail();

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

    await renderDetail();

    expect(screen.getByText("What this plan commits to, and when")).toBeInTheDocument();
    expect(screen.getAllByText(/Whole plan/).length).toBeGreaterThan(0);
    // The partial subtotal reaches the page, not just the component's own test.
    expect(screen.getByText(/1 of 2 projects has no cost recorded/)).toBeInTheDocument();
  });

  it("mounts all three financial editors, so the ledger can actually be filled in", async () => {
    await renderDetail();

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

    await renderDetail();

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
    await renderDetail();
    expect(screen.getByTestId("rtp-cycle-project-map")).toBeInTheDocument();
  });

  it("renders the comment-response record", async () => {
    await renderDetail();
    expect(screen.getByText("What the public said, and what we said back")).toBeInTheDocument();
  });

  it("does NOT report an empty comment record when the consultations could not be read", async () => {
    tableResults.engagement_campaigns = { data: null, error: { message: "permission denied" } };

    await renderDetail();

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

    await renderDetail();

    // (a) the false absence is gone
    expect(screen.queryByText("No linked projects yet")).not.toBeInTheDocument();
    // (b) the disclosure is present, and names what failed
    expect(screen.getByText("Linked projects could not be read")).toBeInTheDocument();
    expect(screen.getByText("Part of this cycle could not be read")).toBeInTheDocument();
    expect(
      screen.getByText(/could not read the projects linked to this cycle/i)
    ).toBeInTheDocument();
    // and the count is withheld rather than shown as zero
    expect(screen.getByText(/this is not a count of zero/i)).toBeInTheDocument();
  });

  it("discloses a failed chapter read instead of 'No chapter shell yet'", async () => {
    tableResults.rtp_cycle_chapters = {
      data: null,
      error: { message: "permission denied for table rtp_cycle_chapters" },
    };

    await renderDetail();

    expect(screen.queryByText("No chapter shell yet")).not.toBeInTheDocument();
    expect(screen.getByText("Chapter sections could not be read")).toBeInTheDocument();
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

    await renderDetail();

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

    await renderDetail();

    expect(
      screen.getByText(/Do not act on a recommendation to create a campaign or a packet from this page/i)
    ).toBeInTheDocument();
    // and the packet count is withheld rather than shown as 0/0
    expect(screen.getByText(/a packet may already be generated/i)).toBeInTheDocument();
  });

  it("(c) still shows the ordinary empty states when every read SUCCEEDS and there is nothing", async () => {
    await renderDetail();

    expect(screen.getByText("No linked projects yet")).toBeInTheDocument();
    expect(screen.getByText("No whole-cycle campaigns yet")).toBeInTheDocument();
    expect(screen.queryByText("Part of this cycle could not be read")).not.toBeInTheDocument();
    expect(screen.queryByText(/this is not a count of zero/i)).not.toBeInTheDocument();
    // (c) for the public-review block: the real counts and the real
    // recommendations still render when nothing failed.
    expect(screen.queryByText(/Do not act on a recommendation to create a campaign or a packet/i)).not.toBeInTheDocument();
    expect(
      screen.getByText("Current rendered packet artifacts available for review and export.")
    ).toBeInTheDocument();
    expect(
      screen.getByText("Items still waiting for operator review before packet closeout.")
    ).toBeInTheDocument();
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

    expect(screen.queryByText("No linked projects yet")).not.toBeInTheDocument();
    expect(screen.queryByText("No engagement targets yet")).not.toBeInTheDocument();
    expect(screen.getByText("The portfolio section could not be assembled")).toBeInTheDocument();
    expect(screen.getByText("The engagement section could not be assembled")).toBeInTheDocument();
  });

  it("(c) still shows the ordinary empty states when every read SUCCEEDS and there is nothing", async () => {
    await renderDocument();

    expect(screen.getByText("No linked projects yet")).toBeInTheDocument();
    expect(screen.getByText("No engagement targets yet")).toBeInTheDocument();
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

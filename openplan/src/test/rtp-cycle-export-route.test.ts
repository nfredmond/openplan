/**
 * The RTP export a planner actually clicks.
 *
 * This route had NO test file at all while the board-packet route had thirty-
 * nine, which is most of why the two documents were allowed to drift: the
 * cheaper, lower-privilege door produced the thinner plan and nothing here
 * would have noticed. These tests assert what the export now carries, what it
 * refuses to state, and the projection it asks the database for — the last
 * because a mocked Supabase client answers whatever columns were requested, so
 * a dropped column leaves every other assertion green while the real page
 * renders `undefined`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";
const CYCLE_ID = "77777777-7777-4777-8777-777777777777";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "aaaaaaaa-1111-4111-8111-111111111111";
const RUN_ID = "cccccccc-3333-4333-8333-333333333333";

type Row = Record<string, unknown>;
type TableError = { message: string; code?: string | null } | null;

let rows: Record<string, Row[]>;
let errors: Record<string, TableError>;
let selects: Record<string, string[]>;

function baseRows(): Record<string, Row[]> {
  return {
    rtp_cycles: [
      {
        id: CYCLE_ID,
        workspace_id: WORKSPACE_ID,
        title: "2027 Regional Transportation Plan",
        status: "public_review",
        geography_label: "Example County",
        horizon_start_year: 2027,
        horizon_end_year: 2050,
        adoption_target_date: "2027-06-01",
        public_review_open_at: "2026-09-01T00:00:00.000Z",
        public_review_close_at: "2026-10-15T00:00:00.000Z",
        summary: "A plan for the region.",
        financial_basis_year: 2026,
        annual_inflation_rate: 0.03,
        updated_at: "2026-04-24T00:00:00.000Z",
      },
    ],
    workspace_members: [{ workspace_id: WORKSPACE_ID, role: "viewer", user_id: USER_ID }],
    workspaces: [{ id: WORKSPACE_ID, name: "Example Regional Agency", home_country_code: "US" }],
    rtp_cycle_chapters: [
      {
        id: "chapter-1",
        title: "Existing conditions",
        section_type: "performance",
        status: "ready_for_review",
        summary: "Model-backed existing conditions.",
        guidance: null,
        content_markdown: "Capacity stress on the north corridor.",
        sort_order: 10,
      },
    ],
    project_rtp_cycle_links: [
      {
        id: "link-1",
        project_id: PROJECT_ID,
        portfolio_role: "constrained",
        priority_rationale: "Closes a network gap.",
        priority_scores: {},
        horizon_band_id: "band-1",
        estimated_cost: "12000000",
        cost_basis_year: 2026,
        projects: {
          id: PROJECT_ID,
          name: "North Corridor Complete Street",
          status: "active",
          delivery_phase: "design",
          summary: "Complete street retrofit.",
          updated_at: "2026-04-01T00:00:00.000Z",
        },
      },
    ],
    engagement_campaigns: [
      {
        id: "campaign-1",
        title: "Draft plan open house",
        status: "open",
        engagement_type: "map_comment",
        summary: "Public comment on the draft.",
        rtp_cycle_chapter_id: null,
        updated_at: "2026-04-10T00:00:00.000Z",
      },
    ],
    engagement_items: [],
    engagement_closeloop_entries: [],
    rtp_horizon_bands: [
      {
        id: "band-1",
        label: "Near term",
        start_year: 2027,
        end_year: 2035,
        escalation_target_year: null,
        cost_estimate_basis: "constant",
        sort_order: 0,
      },
    ],
    rtp_financial_assumptions: [
      {
        id: "line-1",
        horizon_band_id: "band-1",
        entry_kind: "revenue",
        source_name: "Regional sales tax",
        amount: "20000000",
        amount_basis_year: 2026,
        notes: null,
      },
    ],
    rtp_performance_measures: [],
    county_runs: [
      {
        id: RUN_ID,
        workspace_id: WORKSPACE_ID,
        run_name: "Example County screening run",
        geography_label: "Example County",
        stage: "assignment",
        updated_at: "2026-04-05T00:00:00.000Z",
      },
    ],
    modeling_claim_decisions: [],
    modeling_source_manifests: [],
    modeling_validation_results: [],
    project_funding_profiles: [
      {
        project_id: PROJECT_ID,
        funding_need_amount: 12000000,
        local_match_need_amount: 1200000,
        updated_at: "2026-04-03T00:00:00.000Z",
      },
    ],
    funding_awards: [
      {
        project_id: PROJECT_ID,
        awarded_amount: "8000000",
        match_amount: "800000",
        risk_flag: null,
        obligation_due_at: "2027-01-01",
        updated_at: "2026-04-04T00:00:00.000Z",
        created_at: "2026-01-01T00:00:00.000Z",
      },
    ],
    funding_opportunities: [],
    billing_invoice_records: [],
  };
}

function chainable(table: string) {
  const node: Record<string, unknown> = {};
  const self = () => node;
  node.select = (columns: string) => {
    (selects[table] ??= []).push(columns);
    return node;
  };
  for (const method of ["eq", "in", "order", "limit", "not", "is"]) node[method] = self;
  const result = () => ({ data: rows[table] ?? [], error: errors[table] ?? null });
  node.maybeSingle = async () => ({ data: (rows[table] ?? [])[0] ?? null, error: errors[table] ?? null });
  node.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve);
  return node;
}

const auditMock = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const supabaseStub = {
  auth: { getUser: async () => ({ data: { user: { id: USER_ID } } }) },
  from: (table: string) => chainable(table),
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => supabaseStub,
  createServiceRoleClient: () => supabaseStub,
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: () => auditMock,
}));

vi.mock("@/lib/reports/pdf", () => ({
  renderReportPdf: async () => ({ bytes: new Uint8Array([1]), engine: "builtin", pageCount: 1 }),
}));

import { GET } from "@/app/api/rtp-cycles/[rtpCycleId]/export/route";

async function callExport() {
  return GET(new NextRequest("http://localhost/api/rtp-cycles/x/export?format=html"), {
    params: Promise.resolve({ rtpCycleId: CYCLE_ID }),
  });
}

describe("GET /api/rtp-cycles/[rtpCycleId]/export", () => {
  beforeEach(() => {
    rows = baseRows();
    errors = {};
    selects = {};
    vi.clearAllMocks();
  });

  it("carries the funding basis the board packet carries", async () => {
    const response = await callExport();
    expect(response.status).toBe(200);
    const html = await response.text();

    // This section used to be ABSENT from this document while the board packet
    // contained it, and neither document said so.
    expect(html).toContain("Funding source context");
    expect(html).toContain("committed funding captured");
    // And the public-review posture card, which was also packet-only.
    expect(html).toContain("cycle targets");
  });

  /**
   * A PLAN EXPORT MAY NOT CITE MODEL RUNS THAT HAVE NOTHING TO DO WITH THE PLAN.
   *
   * The shared builder used to answer "no run named" by reading the workspace's
   * five most recently updated `county_runs` and printing them under
   * "Assignment modeling claim posture". Nothing in the schema links a
   * `county_run` to an `rtp_cycle`, so those rows were chosen by RECENCY: this
   * fixture's workspace HAS a run, for a different purpose, and the export used
   * to present it as this plan's own modeling evidence.
   *
   * Both halves are asserted, because the first alone passes if the section is
   * simply dropped: the absence is STATED, and the query is never made.
   */
  it("states that no modeling evidence is linked to this plan, and cites no unrelated run", async () => {
    const html = await (await callExport()).text();

    expect(html).toContain("Assignment modeling claim posture");
    expect(html).toContain("makes no assignment-model claim");
    // The workspace's unrelated run is present in the fixture and must not
    // appear anywhere in the document.
    expect(html).not.toContain("Example County screening run");
    expect(selects.county_runs ?? []).toEqual([]);
  });

  /**
   * AND IT MAY NOT CLAIM A BOARD PACKET EXISTS.
   *
   * This route never reads `reports` or `report_artifacts`. It was handed a
   * hardcoded "1 packet record (1 generated)", so a whole-plan export asserted
   * a board packet behind a cycle that may never have had one generated.
   * Passing zero instead would only reverse the falsehood, so both directions
   * are asserted: no packet is claimed, and none is declared missing either.
   */
  it("says packet records were not examined rather than asserting a board packet", async () => {
    const html = await (await callExport()).text();

    expect(html).toContain("did not examine packet records");
    expect(html).not.toContain("packet record (1 generated)");
    expect(html).not.toContain("Public review foundation ready");
    expect(html).not.toContain("Create and generate a current RTP packet");
    expect(selects.reports ?? []).toEqual([]);
    expect(selects.report_artifacts ?? []).toEqual([]);
  });

  it("says it is a whole-plan export rather than leaving a reader to assume", async () => {
    const html = await (await callExport()).text();
    expect(html).toContain("How this document was composed:");
    expect(html).toContain("whole-plan export");
    expect(html).toContain("OpenPlan RTP Export");
    // The other polarity: this document has no report behind it, so it must not
    // claim a report's section selection composed it.
    expect(html).not.toContain("own section selection");
  });

  it("asks the database for the columns the exported plan renders", async () => {
    await callExport();
    const linkProjection = (selects.project_rtp_cycle_links ?? []).join(" ");
    // `project_id` was missing from this route's own projection, so every link
    // reached the fiscal check with `projectId: undefined` while the type said
    // `string`. The clients are untyped, so only this assertion catches it.
    expect(linkProjection).toContain("project_id");
    expect(linkProjection).toContain("estimated_cost");
    expect(linkProjection).toContain("cost_basis_year");
    expect(linkProjection).toContain("horizon_band_id");

    const cycleProjection = (selects.rtp_cycles ?? []).join(" ");
    expect(cycleProjection).toContain("annual_inflation_rate");
    expect(cycleProjection).toContain("financial_basis_year");
  });

  it("refuses when the plan's horizon periods cannot be read, instead of saying none are declared", async () => {
    // Rendering anyway prints "No horizon periods have been declared for this
    // plan" — a statement about the agency's own plan, over a query that never
    // ran, in a document a board reads.
    errors.rtp_horizon_bands = { message: "permission denied for table rtp_horizon_bands", code: "42501" };
    const response = await callExport();
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toContain("horizon periods");
    // THE REFUSAL MUST NOT READ AS A FINDING ABOUT THE PLAN. "Failed to load"
    // plus this hint is the difference between "we could not read this" and
    // "this plan has none" — the second is the falsehood being refused.
    expect(body.error).toContain("Failed to load");
    expect(body.hint).toBe("This is a read failure, not an empty result.");
  });

  it("names the pending migration when the horizon periods are not in this deployment yet", async () => {
    // The behaviour change this refusal introduced: yesterday's migration is
    // effectively required to export (and to generate a packet). An operator
    // who has not applied it must be told that, not handed a 500.
    errors.rtp_horizon_bands = {
      message: 'relation "public.rtp_horizon_bands" does not exist',
      code: "42P01",
    };
    const response = await callExport();
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error).toBe("This plan's horizon periods cannot be read yet");
    expect(body.hint).toContain("Apply the latest Supabase migrations");
    expect(body.hint).toContain("which this deployment never established");
  });

  it("refuses when the revenue ledger cannot be read, instead of reporting no revenue", async () => {
    errors.rtp_financial_assumptions = {
      message: "permission denied for table rtp_financial_assumptions",
      code: "42501",
    };
    const response = await callExport();
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toContain("revenue and cost ledger");
    expect(body.error).toContain("Failed to load");
    expect(body.hint).toBe("This is a read failure, not an empty result.");
  });

  it("refuses a non-member", async () => {
    rows.workspace_members = [];
    const response = await callExport();
    expect(response.status).toBe(403);
  });
});

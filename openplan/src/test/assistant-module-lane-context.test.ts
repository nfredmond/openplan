import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/operations/workspace-summary", () => ({
  loadWorkspaceOperationsSummaryForWorkspace: async () => ({
    posture: "under control",
    headline: "Nothing urgent.",
    nextCommand: null,
    nextActions: [],
    commandQueue: [],
    counts: {
      queueDepth: 0,
      reportRefreshRecommended: 0,
      reportNoPacket: 0,
      rtpFundingReviewPackets: 0,
      projectFundingNeedAnchorProjects: 0,
      projectFundingSourcingProjects: 0,
      projectFundingDecisionProjects: 0,
      projectFundingAwardRecordProjects: 0,
      projectFundingReimbursementStartProjects: 0,
      projectFundingReimbursementActiveProjects: 0,
      projectFundingGapProjects: 0,
    },
  }),
}));

import {
  loadAssistantContext,
  MODULE_LANE_AERIAL_JOB_COLUMNS,
  MODULE_LANE_AERIAL_MISSION_COLUMNS,
  MODULE_LANE_AERIAL_PACKAGE_COLUMNS,
  MODULE_LANE_CLIENT_INVOICE_COLUMNS,
  MODULE_LANE_CONNECTOR_COLUMNS,
  MODULE_LANE_CRASH_INGEST_COLUMNS,
  MODULE_LANE_DATASET_COLUMNS,
  MODULE_LANE_ENGAGEMENT_CAMPAIGN_COLUMNS,
  MODULE_LANE_FUNDING_AWARD_COLUMNS,
  MODULE_LANE_FUNDING_OPPORTUNITY_COLUMNS,
  MODULE_LANE_KB_DOCUMENT_COLUMNS,
  MODULE_LANE_REFRESH_JOB_COLUMNS,
  MODULE_LANE_REIMBURSEMENT_INVOICE_COLUMNS,
  type AssistantModuleLaneKind,
  type WorkspaceAssistantContext,
} from "@/lib/assistant/context";
import { buildAssistantChatContextLines } from "@/lib/assistant/chat-context";

/* ────────────────────────────────────────────────────────────────────────────
 * Recording fake — RLS-shaped assertions need the FILTERS, not just the data.
 * Every query records its table, its select string, and every eq/in filter, so
 * a loader that dropped `.eq("workspace_id", …)` or swapped its projection
 * fails here rather than rendering a stranger's workspace with green tests.
 * ──────────────────────────────────────────────────────────────────────────── */

type RecordedQuery = {
  table: string;
  select: string | null;
  head: boolean;
  filters: Array<[string, unknown]>;
  limitValue: number | null;
};

type QueryResult = { data?: unknown; error?: { message: string } | null; count?: number | null };

type Responder = QueryResult | QueryResult[] | ((query: RecordedQuery) => QueryResult);

function createRecordingSupabase(params: { workspaceId: string; responses?: Record<string, Responder> }) {
  const queries: RecordedQuery[] = [];
  const responses = params.responses ?? {};
  const consumed = new Map<string, number>();

  const resolve = (query: RecordedQuery): QueryResult => {
    if (query.table === "workspace_members") {
      return {
        data: {
          workspace_id: params.workspaceId,
          role: "owner",
          workspaces: { id: params.workspaceId, name: "Module Lane QA" },
        },
        error: null,
      };
    }
    const responder = responses[query.table];
    if (!responder) return { data: [], error: null, count: 0 };
    if (typeof responder === "function") return responder(query);
    if (Array.isArray(responder)) {
      const index = consumed.get(query.table) ?? 0;
      consumed.set(query.table, index + 1);
      return responder[Math.min(index, responder.length - 1)] ?? { data: [], error: null, count: 0 };
    }
    return responder;
  };

  return {
    queries,
    from(table: string) {
      const query: RecordedQuery = { table, select: null, head: false, filters: [], limitValue: null };
      queries.push(query);
      const chain: Record<string, unknown> = {};
      const self = () => chain;
      chain.select = (columns: string, options?: { head?: boolean }) => {
        query.select = columns;
        query.head = Boolean(options?.head);
        return chain;
      };
      chain.eq = (column: string, value: unknown) => {
        query.filters.push([column, value]);
        return chain;
      };
      chain.in = (column: string, values: unknown) => {
        query.filters.push([column, values]);
        return chain;
      };
      chain.not = self;
      chain.neq = self;
      chain.order = self;
      chain.limit = (count: number) => {
        query.limitValue = count;
        return chain;
      };
      chain.maybeSingle = () => Promise.resolve(resolve(query));
      chain.then = (
        onFulfilled: (value: QueryResult) => unknown,
        onRejected?: (reason: unknown) => unknown
      ) => Promise.resolve(resolve(query)).then(onFulfilled, onRejected);
      return chain;
    },
  };
}

function laneTarget(kind: AssistantModuleLaneKind, workspaceId: string) {
  return { kind, id: null, workspaceId, runId: null, baselineRunId: null };
}

async function loadLane(
  kind: AssistantModuleLaneKind,
  supabase: ReturnType<typeof createRecordingSupabase>,
  workspaceId: string
): Promise<WorkspaceAssistantContext> {
  const context = (await loadAssistantContext(
    supabase as never,
    "user-1",
    laneTarget(kind, workspaceId)
  )) as WorkspaceAssistantContext | null;
  expect(context).not.toBeNull();
  return context as WorkspaceAssistantContext;
}

function findQuery(supabase: ReturnType<typeof createRecordingSupabase>, table: string): RecordedQuery {
  const query = supabase.queries.find((entry) => entry.table === table);
  expect(query, `expected a query against ${table}`).toBeDefined();
  return query as RecordedQuery;
}

const iso = (daysFromNow: number) => new Date(Date.now() + daysFromNow * 86400000).toISOString();

/* ────────────────────────────────────────────────────────────────────────────
 * Per-lane happy paths: kind override, discriminant, projections, scoping.
 * ──────────────────────────────────────────────────────────────────────────── */

describe("module lane loaders", () => {
  it("grants: counts decision states, deadlines, and awards from workspace-scoped reads", async () => {
    const supabase = createRecordingSupabase({
      workspaceId: "ws-grants-1",
      responses: {
        funding_opportunities: {
          data: [
            // decision_state is NOT NULL DEFAULT 'monitor' (migration
            // 20260410000042) — a null decision_state is a row the schema
            // cannot produce, and fixtures here must stay representable.
            { id: "opp-1", title: "Closing soon", opportunity_status: "open", decision_state: "monitor", closes_at: iso(5), decision_due_at: null, updated_at: iso(-1) },
            { id: "opp-2", title: "Pursued", opportunity_status: "open", decision_state: "pursue", closes_at: iso(90), decision_due_at: null, updated_at: iso(-2) },
            { id: "opp-3", title: "Overdue decision", opportunity_status: "open", decision_state: "monitor", closes_at: iso(60), decision_due_at: iso(-3), updated_at: iso(-3) },
          ],
          error: null,
        },
        funding_awards: {
          data: [
            { id: "award-1", title: "Award", awarded_amount: 250000, spending_status: "active", risk_flag: "none", updated_at: iso(-1) },
            { id: "award-2", title: "Watched", awarded_amount: 100000, spending_status: "not_started", risk_flag: "watch", updated_at: iso(-2) },
          ],
          error: null,
        },
      },
    });

    const context = await loadLane("grants", supabase, "ws-grants-1");
    expect(context.kind).toBe("grants");
    expect(context.moduleLane?.module).toBe("grants");
    if (context.moduleLane?.module !== "grants") throw new Error("wrong lane");
    expect(context.moduleLane.opportunities).toEqual(
      expect.objectContaining({ total: 3, awaitingDecision: 1, monitor: 2, pursue: 1, closingSoon: 1, overdueDecision: 1 })
    );
    expect(context.moduleLane.opportunities?.lead?.id).toBe("opp-1");
    expect(context.moduleLane.awards).toEqual(
      expect.objectContaining({ total: 2, awardedAmount: 350000, activeSpending: 1, riskFlagged: 1 })
    );

    const opportunityQuery = findQuery(supabase, "funding_opportunities");
    expect(opportunityQuery.select).toBe(MODULE_LANE_FUNDING_OPPORTUNITY_COLUMNS);
    expect(opportunityQuery.filters).toContainEqual(["workspace_id", "ws-grants-1"]);
    const awardQuery = findQuery(supabase, "funding_awards");
    expect(awardQuery.select).toBe(MODULE_LANE_FUNDING_AWARD_COLUMNS);
    expect(awardQuery.filters).toContainEqual(["workspace_id", "ws-grants-1"]);
    expect(context.unreadable ?? []).toEqual([]);
  });

  it("grants: the lane and the workspace summary agree on overdue and closing-soon counts for the same rows", async () => {
    /**
     * THE DIVERGENCE THIS GUARDS: the lane once keyed "undecided"/"overdue"
     * on `!decision_state` — a row the schema cannot produce, the column is
     * TEXT NOT NULL DEFAULT 'monitor' — and used a 30-day closing window
     * while the workspace summary used 'monitor' and 14 days. Both surfaces
     * now import the same predicate (funding-decision-status.ts); this test
     * drives BOTH from one fixture so they can never disagree again.
     * opp-2 closes in 20 days ON PURPOSE: inside the old 30-day window,
     * outside the shared 14-day one, so a drifted horizon fails here.
     */
    const sharedRows = [
      { id: "opp-1", title: "Closing inside the window", opportunity_status: "open", decision_state: "monitor", closes_at: iso(5), decision_due_at: null, program_id: null, updated_at: iso(-1) },
      { id: "opp-2", title: "Closing outside the window", opportunity_status: "open", decision_state: "pursue", closes_at: iso(20), decision_due_at: null, program_id: null, updated_at: iso(-2) },
      { id: "opp-3", title: "Overdue monitored decision", opportunity_status: "open", decision_state: "monitor", closes_at: iso(60), decision_due_at: iso(-3), program_id: null, updated_at: iso(-3) },
      { id: "opp-4", title: "Archived skip", opportunity_status: "archived", decision_state: "skip", closes_at: iso(2), decision_due_at: iso(-30), program_id: null, updated_at: iso(-4) },
    ];

    const supabase = createRecordingSupabase({
      workspaceId: "ws-grants-agree",
      responses: { funding_opportunities: { data: sharedRows, error: null } },
    });
    const context = await loadLane("grants", supabase, "ws-grants-agree");
    if (context.moduleLane?.module !== "grants") throw new Error("wrong lane");
    const lane = context.moduleLane.opportunities;
    expect(lane).not.toBeNull();

    // The REAL summary builder — vi.importActual bypasses this file's module mock.
    const { buildWorkspaceOperationsSummaryFromSourceRows } = await vi.importActual<
      typeof import("@/lib/operations/workspace-summary")
    >("@/lib/operations/workspace-summary");
    const summary = buildWorkspaceOperationsSummaryFromSourceRows({
      projects: [],
      plans: [],
      programs: [],
      reports: [],
      fundingOpportunities: sharedRows,
    });

    expect(lane?.overdueDecision).toBe(summary.counts.overdueDecisionFundingOpportunities);
    expect(lane?.closingSoon).toBe(summary.counts.closingSoonFundingOpportunities);
    // And both surfaces see the real pressure — agreement on zero proves nothing.
    expect(lane?.overdueDecision).toBe(1);
    expect(lane?.closingSoon).toBe(1);
    expect(lane?.awaitingDecision).toBe(1);
  });

  it("invoicing: separates funder reimbursements from client receivables", async () => {
    const supabase = createRecordingSupabase({
      workspaceId: "ws-inv-1",
      responses: {
        billing_invoice_records: {
          data: [
            { id: "inv-1", funding_award_id: "award-1", status: "submitted", amount: 1000, net_amount: 950 },
            { id: "inv-2", funding_award_id: "award-1", status: "paid", amount: 2000, net_amount: 1900 },
            { id: "inv-3", funding_award_id: null, status: "draft", amount: 500, net_amount: 500 },
          ],
          error: null,
        },
        client_invoices: {
          data: [
            { id: "ci-1", status: "sent", total_amount: 12000 },
            { id: "ci-2", status: "paid", total_amount: 8000 },
            { id: "ci-3", status: "void", total_amount: 100 },
          ],
          error: null,
        },
      },
    });

    const context = await loadLane("invoicing", supabase, "ws-inv-1");
    expect(context.kind).toBe("invoicing");
    if (context.moduleLane?.module !== "invoicing") throw new Error("wrong lane");
    expect(context.moduleLane.reimbursements).toEqual(
      expect.objectContaining({
        invoiceCount: 3,
        linkedToAwardCount: 2,
        awardsWithInvoices: 1,
        submitted: 1,
        paid: 1,
        draft: 1,
        outstandingNetAmount: 950,
      })
    );
    expect(context.moduleLane.receivables).toEqual(
      expect.objectContaining({ invoiceCount: 3, sent: 1, paid: 1, voided: 1, outstandingAmount: 12000 })
    );

    const reimbursementQuery = findQuery(supabase, "billing_invoice_records");
    expect(reimbursementQuery.select).toBe(MODULE_LANE_REIMBURSEMENT_INVOICE_COLUMNS);
    expect(reimbursementQuery.filters).toContainEqual(["workspace_id", "ws-inv-1"]);
    const receivableQuery = findQuery(supabase, "client_invoices");
    expect(receivableQuery.select).toBe(MODULE_LANE_CLIENT_INVOICE_COLUMNS);
    expect(receivableQuery.filters).toContainEqual(["workspace_id", "ws-inv-1"]);
  });

  it("engagement: campaign states plus moderation COUNTS scoped to this workspace's campaigns", async () => {
    const supabase = createRecordingSupabase({
      workspaceId: "ws-eng-1",
      responses: {
        engagement_campaigns: {
          data: [
            { id: "camp-1", title: "Live", status: "active", allow_public_submissions: true, submissions_closed_at: null, updated_at: iso(-1) },
            { id: "camp-2", title: "Draft", status: "draft", allow_public_submissions: false, submissions_closed_at: null, updated_at: iso(-2) },
            { id: "camp-3", title: "Closed window", status: "active", allow_public_submissions: true, submissions_closed_at: iso(-1), updated_at: iso(-3) },
          ],
          error: null,
        },
        engagement_items: [
          { data: null, error: null, count: 4 },
          { data: null, error: null, count: 2 },
        ],
      },
    });

    const context = await loadLane("engagement", supabase, "ws-eng-1");
    if (context.moduleLane?.module !== "engagement") throw new Error("wrong lane");
    expect(context.moduleLane.campaigns).toEqual(
      expect.objectContaining({ total: 3, draft: 1, active: 2, publicOpen: 1 })
    );
    expect(context.moduleLane.moderation).toEqual({ pending: 4, flagged: 2 });

    const campaignQuery = findQuery(supabase, "engagement_campaigns");
    expect(campaignQuery.select).toBe(MODULE_LANE_ENGAGEMENT_CAMPAIGN_COLUMNS);
    expect(campaignQuery.filters).toContainEqual(["workspace_id", "ws-eng-1"]);

    const itemQueries = supabase.queries.filter((query) => query.table === "engagement_items");
    expect(itemQueries).toHaveLength(2);
    for (const itemQuery of itemQueries) {
      // Head counts only: the moderation lens must never pull submission BODIES
      // into a prompt context.
      expect(itemQuery.head).toBe(true);
      expect(itemQuery.select).toBe("id");
      expect(itemQuery.filters).toContainEqual(["campaign_id", ["camp-1", "camp-2", "camp-3"]]);
    }
    expect(itemQueries[0].filters).toContainEqual(["status", "pending"]);
    expect(itemQueries[1].filters).toContainEqual(["status", "flagged"]);
  });

  it("safety: latest-import posture plus a severity mix counted by head queries, never crash rows", async () => {
    const supabase = createRecordingSupabase({
      workspaceId: "ws-safe-1",
      responses: {
        safety_crash_ingests: {
          data: [
            {
              id: "ingest-2", project_id: null, source_label: "CCRS", coverage_state: "ccrs_ca_statewide",
              severity_completeness: "kabco_full", status: "ready", crash_count: 17, geocoded_count: 15,
              truncated: false, years_requested: [2021, 2022], fetch_error: null, created_at: iso(-1),
            },
            {
              id: "ingest-1", project_id: null, source_label: "CCRS", coverage_state: "ccrs_ca_statewide",
              severity_completeness: "kabco_full", status: "failed", crash_count: 0, geocoded_count: 0,
              truncated: false, years_requested: [2020], fetch_error: "upstream 503", created_at: iso(-2),
            },
          ],
          error: null,
        },
        safety_crashes: [
          { data: null, error: null, count: 1 },
          { data: null, error: null, count: 3 },
          { data: null, error: null, count: 6 },
          { data: null, error: null, count: 7 },
        ],
      },
    });

    const context = await loadLane("safety", supabase, "ws-safe-1");
    if (context.moduleLane?.module !== "safety") throw new Error("wrong lane");
    expect(context.moduleLane.ingests).toEqual(
      expect.objectContaining({ recentCount: 2, ready: 1, failed: 1 })
    );
    expect(context.moduleLane.ingests?.latest?.crashCount).toBe(17);
    expect(context.moduleLane.severityMix).toEqual({
      ingestId: "ingest-2",
      fatal: 1,
      severeInjury: 3,
      injury: 6,
      pdo: 7,
    });

    const ingestQuery = findQuery(supabase, "safety_crash_ingests");
    expect(ingestQuery.select).toBe(MODULE_LANE_CRASH_INGEST_COLUMNS);
    expect(ingestQuery.filters).toContainEqual(["workspace_id", "ws-safe-1"]);
    expect(ingestQuery.limitValue).toBe(8);

    const crashQueries = supabase.queries.filter((query) => query.table === "safety_crashes");
    expect(crashQueries).toHaveLength(4);
    for (const crashQuery of crashQueries) {
      expect(crashQuery.head).toBe(true);
      expect(crashQuery.filters).toContainEqual(["workspace_id", "ws-safe-1"]);
      expect(crashQuery.filters).toContainEqual(["ingest_id", "ingest-2"]);
    }
    expect(crashQueries.map((query) => query.filters.find(([column]) => column === "severity")?.[1])).toEqual([
      "fatal",
      "severe_injury",
      "injury",
      "pdo",
    ]);
  });

  it("safety: no ready import means no severity mix and no invented count queries", async () => {
    const supabase = createRecordingSupabase({
      workspaceId: "ws-safe-2",
      responses: {
        safety_crash_ingests: {
          data: [
            {
              id: "ingest-1", project_id: null, source_label: "CCRS", coverage_state: "ccrs_ca_statewide",
              severity_completeness: "kabco_full", status: "failed", crash_count: 0, geocoded_count: 0,
              truncated: false, years_requested: [2020], fetch_error: "upstream 503", created_at: iso(-2),
            },
          ],
          error: null,
        },
      },
    });

    const context = await loadLane("safety", supabase, "ws-safe-2");
    if (context.moduleLane?.module !== "safety") throw new Error("wrong lane");
    expect(context.moduleLane.severityMix).toBeNull();
    expect(supabase.queries.filter((query) => query.table === "safety_crashes")).toHaveLength(0);
  });

  it("aerial: missions, processing custody, and package readiness", async () => {
    const supabase = createRecordingSupabase({
      workspaceId: "ws-air-1",
      responses: {
        aerial_missions: {
          data: [
            { id: "m1", status: "planned" },
            { id: "m2", status: "active" },
            { id: "m3", status: "complete" },
          ],
          error: null,
        },
        aerial_processing_jobs: {
          data: [
            { id: "j1", status: "running", artifact_custody_state: "none" },
            { id: "j2", status: "succeeded", artifact_custody_state: "complete" },
            { id: "j3", status: "dispatch_failed", artifact_custody_state: "not_applicable" },
          ],
          error: null,
        },
        aerial_evidence_packages: {
          data: [
            { id: "p1", status: "ready", verification_readiness: "ready" },
            { id: "p2", status: "qa_pending", verification_readiness: "partial" },
          ],
          error: null,
        },
      },
    });

    const context = await loadLane("aerial", supabase, "ws-air-1");
    if (context.moduleLane?.module !== "aerial") throw new Error("wrong lane");
    expect(context.moduleLane.missions).toEqual(
      expect.objectContaining({ total: 3, planned: 1, active: 1, complete: 1, cancelled: 0 })
    );
    expect(context.moduleLane.processing).toEqual(
      expect.objectContaining({ total: 3, active: 1, failed: 1, succeeded: 1, custodyComplete: 1, custodyNone: 1 })
    );
    expect(context.moduleLane.packages).toEqual(
      expect.objectContaining({ total: 2, ready: 1, qaPending: 1, verificationReady: 1 })
    );

    expect(findQuery(supabase, "aerial_missions").select).toBe(MODULE_LANE_AERIAL_MISSION_COLUMNS);
    expect(findQuery(supabase, "aerial_processing_jobs").select).toBe(MODULE_LANE_AERIAL_JOB_COLUMNS);
    expect(findQuery(supabase, "aerial_evidence_packages").select).toBe(MODULE_LANE_AERIAL_PACKAGE_COLUMNS);
    for (const table of ["aerial_missions", "aerial_processing_jobs", "aerial_evidence_packages"]) {
      expect(findQuery(supabase, table).filters).toContainEqual(["workspace_id", "ws-air-1"]);
    }
  });

  it("knowledge base: corpus counts and extraction failures", async () => {
    const supabase = createRecordingSupabase({
      workspaceId: "ws-kb-1",
      responses: {
        kb_documents: {
          data: [
            { id: "d1", project_id: "proj-1", status: "ready" },
            { id: "d2", project_id: "proj-1", status: "failed" },
            { id: "d3", project_id: null, status: "extracting" },
            { id: "d4", project_id: "proj-2", status: "ready" },
          ],
          error: null,
        },
      },
    });

    const context = await loadLane("knowledge_base", supabase, "ws-kb-1");
    if (context.moduleLane?.module !== "knowledge_base") throw new Error("wrong lane");
    expect(context.moduleLane.documents).toEqual(
      expect.objectContaining({
        total: 4,
        ready: 2,
        inFlight: 1,
        extractionFailed: 1,
        linkedToProject: 3,
        projectCount: 2,
      })
    );
    const documentQuery = findQuery(supabase, "kb_documents");
    expect(documentQuery.select).toBe(MODULE_LANE_KB_DOCUMENT_COLUMNS);
    expect(documentQuery.filters).toContainEqual(["workspace_id", "ws-kb-1"]);
  });

  it("data hub: datasets, connectors, and refresh jobs", async () => {
    const supabase = createRecordingSupabase({
      workspaceId: "ws-hub-1",
      responses: {
        data_datasets: {
          data: [
            { id: "ds1", status: "ready" },
            { id: "ds2", status: "error" },
            { id: "ds3", status: "draft" },
          ],
          error: null,
        },
        data_connectors: {
          data: [
            { id: "c1", status: "active", last_error_message: null },
            { id: "c2", status: "degraded", last_error_message: "429 from upstream" },
          ],
          error: null,
        },
        data_refresh_jobs: {
          data: [
            { id: "job-2", status: "failed", job_name: "acs-refresh", error_summary: "timeout" },
            { id: "job-1", status: "succeeded", job_name: "lodes-refresh", error_summary: null },
          ],
          error: null,
        },
      },
    });

    const context = await loadLane("data_hub", supabase, "ws-hub-1");
    if (context.moduleLane?.module !== "data_hub") throw new Error("wrong lane");
    expect(context.moduleLane.datasets).toEqual(
      expect.objectContaining({ total: 3, ready: 1, error: 1, other: 1 })
    );
    expect(context.moduleLane.connectors).toEqual(
      expect.objectContaining({ total: 2, active: 1, degraded: 1, withLastError: 1 })
    );
    expect(context.moduleLane.refreshJobs).toEqual(
      expect.objectContaining({
        recentCount: 2,
        failed: 1,
        latest: { status: "failed", jobName: "acs-refresh", errorSummary: "timeout" },
      })
    );

    expect(findQuery(supabase, "data_datasets").select).toBe(MODULE_LANE_DATASET_COLUMNS);
    expect(findQuery(supabase, "data_connectors").select).toBe(MODULE_LANE_CONNECTOR_COLUMNS);
    const refreshQuery = findQuery(supabase, "data_refresh_jobs");
    expect(refreshQuery.select).toBe(MODULE_LANE_REFRESH_JOB_COLUMNS);
    expect(refreshQuery.limitValue).toBe(8);
    for (const table of ["data_datasets", "data_connectors", "data_refresh_jobs"]) {
      expect(findQuery(supabase, table).filters).toContainEqual(["workspace_id", "ws-hub-1"]);
    }
  });

  it("threads the caller's workspace binding instead of hardcoding one", async () => {
    for (const workspaceId of ["ws-vary-a", "ws-vary-b"]) {
      const supabase = createRecordingSupabase({ workspaceId });
      await loadLane("grants", supabase, workspaceId);
      expect(findQuery(supabase, "funding_opportunities").filters).toContainEqual(["workspace_id", workspaceId]);
      expect(findQuery(supabase, "funding_awards").filters).toContainEqual(["workspace_id", workspaceId]);
    }
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * Failure ≠ empty, per lane. A failed read must go `null` AND be disclosed by
 * name; an empty read must stay zeros with nothing disclosed.
 * ──────────────────────────────────────────────────────────────────────────── */

type LaneSummaryRecord = Record<string, unknown>;

describe("module lane read failures are disclosed, never rendered as empty", () => {
  const failure = { data: null, error: { message: "permission denied for relation module_lane_test" } };

  const specs: Array<{
    kind: AssistantModuleLaneKind;
    table: string;
    subject: string;
    field: string;
  }> = [
    { kind: "grants", table: "funding_opportunities", subject: "funding opportunities", field: "opportunities" },
    { kind: "grants", table: "funding_awards", subject: "funding awards", field: "awards" },
    { kind: "invoicing", table: "billing_invoice_records", subject: "reimbursement invoices", field: "reimbursements" },
    { kind: "invoicing", table: "client_invoices", subject: "client invoices", field: "receivables" },
    { kind: "engagement", table: "engagement_campaigns", subject: "engagement campaigns", field: "campaigns" },
    { kind: "safety", table: "safety_crash_ingests", subject: "this workspace's crash imports", field: "ingests" },
    { kind: "aerial", table: "aerial_missions", subject: "this workspace's aerial missions", field: "missions" },
    { kind: "aerial", table: "aerial_processing_jobs", subject: "this workspace's aerial processing jobs", field: "processing" },
    { kind: "aerial", table: "aerial_evidence_packages", subject: "this workspace's aerial evidence packages", field: "packages" },
    { kind: "knowledge_base", table: "kb_documents", subject: "knowledge base documents", field: "documents" },
    { kind: "data_hub", table: "data_datasets", subject: "data hub datasets", field: "datasets" },
    { kind: "data_hub", table: "data_connectors", subject: "data hub connectors", field: "connectors" },
    { kind: "data_hub", table: "data_refresh_jobs", subject: "data refresh jobs", field: "refreshJobs" },
  ];

  for (const spec of specs) {
    it(`${spec.kind}: a failed ${spec.table} read nulls ${spec.field} and discloses "${spec.subject}"`, async () => {
      const supabase = createRecordingSupabase({
        workspaceId: "ws-fail-1",
        responses: { [spec.table]: failure },
      });
      const context = await loadLane(spec.kind, supabase, "ws-fail-1");
      const lane = context.moduleLane as unknown as LaneSummaryRecord;
      expect(lane[spec.field]).toBeNull();
      expect((context.unreadable ?? []).map((entry) => entry.label)).toContain(spec.subject);
    });

    it(`${spec.kind}: an EMPTY ${spec.table} read stays zeros with nothing disclosed`, async () => {
      const supabase = createRecordingSupabase({ workspaceId: "ws-empty-1" });
      const context = await loadLane(spec.kind, supabase, "ws-empty-1");
      const lane = context.moduleLane as unknown as LaneSummaryRecord;
      expect(lane[spec.field]).not.toBeNull();
      expect((context.unreadable ?? []).map((entry) => entry.label)).not.toContain(spec.subject);
    });
  }

  it("engagement: a failed moderation COUNT nulls the queue rather than reporting zero pending", async () => {
    const supabase = createRecordingSupabase({
      workspaceId: "ws-eng-fail",
      responses: {
        engagement_campaigns: {
          data: [
            { id: "camp-1", title: "Live", status: "active", allow_public_submissions: true, submissions_closed_at: null, updated_at: iso(-1) },
          ],
          error: null,
        },
        engagement_items: failure,
      },
    });
    const context = await loadLane("engagement", supabase, "ws-eng-fail");
    if (context.moduleLane?.module !== "engagement") throw new Error("wrong lane");
    expect(context.moduleLane.campaigns).not.toBeNull();
    expect(context.moduleLane.moderation).toBeNull();
    expect((context.unreadable ?? []).map((entry) => entry.label)).toContain(
      "the moderation queue of this workspace's campaigns"
    );
  });

  it("safety: a failed severity count is disclosed and the mix stays null", async () => {
    const supabase = createRecordingSupabase({
      workspaceId: "ws-safe-fail",
      responses: {
        safety_crash_ingests: {
          data: [
            {
              id: "ingest-9", project_id: null, source_label: "CCRS", coverage_state: "ccrs_ca_statewide",
              severity_completeness: "kabco_full", status: "ready", crash_count: 5, geocoded_count: 5,
              truncated: false, years_requested: [2023], fetch_error: null, created_at: iso(-1),
            },
          ],
          error: null,
        },
        safety_crashes: failure,
      },
    });
    const context = await loadLane("safety", supabase, "ws-safe-fail");
    if (context.moduleLane?.module !== "safety") throw new Error("wrong lane");
    expect(context.moduleLane.severityMix).toBeNull();
    expect((context.unreadable ?? []).map((entry) => entry.label)).toContain(
      "the severity mix of the latest ready crash import"
    );
  });

  it("a pending schema resolves to a truthful empty lane, not a disclosed failure", async () => {
    const supabase = createRecordingSupabase({
      workspaceId: "ws-pending-1",
      responses: {
        aerial_missions: { data: null, error: { message: 'relation "public.aerial_missions" does not exist' } },
      },
    });
    const context = await loadLane("aerial", supabase, "ws-pending-1");
    if (context.moduleLane?.module !== "aerial") throw new Error("wrong lane");
    expect(context.moduleLane.missions).toEqual(
      expect.objectContaining({ total: 0, planned: 0, active: 0, complete: 0, cancelled: 0 })
    );
    expect((context.unreadable ?? []).map((entry) => entry.label)).not.toContain(
      "this workspace's aerial missions"
    );
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * Serialization: the chat prompt speaks lane counts when they loaded and says
 * "missing, not zero" when they did not.
 * ──────────────────────────────────────────────────────────────────────────── */

function baseContext(kind: WorkspaceAssistantContext["kind"]): WorkspaceAssistantContext {
  return {
    kind,
    workspace: { id: "ws-1", name: "Serialization QA", role: "owner" },
    recentProject: null,
    recentRuns: [],
    currentRun: null,
    baselineRun: null,
    operationsSummary: {
      posture: "under control",
      headline: "Nothing urgent.",
      nextCommand: null,
      counts: {
        projects: 0, activeProjects: 0, plans: 0, plansNeedingSetup: 0, programs: 0, activePrograms: 0,
        reports: 0, reportRefreshRecommended: 0, reportNoPacket: 0, fundingOpportunities: 0,
        openFundingOpportunities: 0, closingSoonFundingOpportunities: 0, overdueDecisionFundingOpportunities: 0,
        projectFundingGapProjects: 0, queueDepth: 0, rtpFundingReviewPackets: 0,
      },
    } as unknown as WorkspaceAssistantContext["operationsSummary"],
    transit: { readable: true, feeds: [], staleRefetchableFeed: null },
    unreadable: [],
  };
}

describe("module lane chat serialization", () => {
  it("speaks safety counts, the completeness caveat, and the severity mix", () => {
    const context = baseContext("safety");
    context.moduleLane = {
      module: "safety",
      ingests: {
        recentCount: 2, ready: 1, failed: 1, noCoverage: 0, inFlight: 0,
        latest: {
          sourceLabel: "CCRS", coverageState: "ccrs_ca_statewide", severityCompleteness: "kabco_full",
          status: "ready", crashCount: 17, geocodedCount: 15, truncated: false,
          yearsRequested: [2021, 2022], fetchError: null, createdAt: "2026-08-01T00:00:00.000Z",
        },
      },
      severityMix: { ingestId: "ingest-2", fatal: 1, severeInjury: 3, injury: 6, pdo: 7 },
    };
    const lines = buildAssistantChatContextLines(context).join("\n");
    expect(lines).toContain("Current surface: safety");
    expect(lines).toContain("Crash imports (2 most recent): 1 ready, 1 failed");
    expect(lines).toContain("severity completeness kabco_full");
    expect(lines).toContain("17 crashes (15 geocoded)");
    expect(lines).toContain("years 2021, 2022");
    expect(lines).toContain("1 fatal · 3 severe injury · 6 other injury · 7 property damage only");
  });

  it("says a failed lane is missing, not zero — and never counts it", () => {
    const context = baseContext("safety");
    context.moduleLane = { module: "safety", ingests: null, severityMix: null };
    const lines = buildAssistantChatContextLines(context).join("\n");
    expect(lines).toContain("could not be read");
    expect(lines).toContain("missing, not zero");
    expect(lines).not.toContain("Crash imports (");
    expect(lines).not.toContain("No crash data has been imported");
  });

  it("keeps the moderation line to counts and says so", () => {
    const context = baseContext("engagement");
    context.moduleLane = {
      module: "engagement",
      campaigns: { total: 3, draft: 1, active: 2, closed: 0, archived: 0, publicOpen: 1 },
      moderation: { pending: 4, flagged: 2 },
    };
    const lines = buildAssistantChatContextLines(context).join("\n");
    expect(lines).toContain("Engagement campaigns: 3 total");
    expect(lines).toContain("Moderation queue: 4 pending review · 2 flagged");
    expect(lines).toContain("submission text is not loaded into this context");
  });

  it("serializes every lane it loads: grants, invoicing, aerial, knowledge base, data hub", () => {
    const grants = baseContext("grants");
    grants.moduleLane = {
      module: "grants",
      opportunities: {
        total: 3, awaitingDecision: 1, monitor: 2, pursue: 1, skip: 0, closingSoon: 1, overdueDecision: 1,
        lead: { id: "opp-1", title: "Closing soon", status: "open", decisionState: "monitor", closesAt: "2026-09-01T00:00:00.000Z" },
      },
      awards: { total: 2, awardedAmount: 350000, activeSpending: 1, riskFlagged: 1 },
    };
    const grantsText = buildAssistantChatContextLines(grants).join("\n");
    expect(grantsText).toContain("Funding opportunities: 3 total");
    expect(grantsText).toContain("1 awaiting a decision");
    expect(grantsText).toContain("1 closing within 14 days · 1 overdue decisions");
    expect(grantsText).toContain('"Closing soon"');
    expect(grantsText).toContain("$350,000 awarded");

    const invoicing = baseContext("invoicing");
    invoicing.moduleLane = {
      module: "invoicing",
      reimbursements: {
        invoiceCount: 3, linkedToAwardCount: 2, awardsWithInvoices: 1, draft: 1, internalReview: 0,
        submitted: 1, approvedForPayment: 0, paid: 1, rejected: 0, outstandingNetAmount: 950,
      },
      receivables: { invoiceCount: 3, draft: 0, sent: 1, paid: 1, voided: 1, outstandingAmount: 12000 },
    };
    const invoicingText = buildAssistantChatContextLines(invoicing).join("\n");
    expect(invoicingText).toContain("Funder reimbursements: 3 invoices across 1 funding awards");
    expect(invoicingText).toContain("$950 net outstanding");
    expect(invoicingText).toContain("Client receivables: 3 invoices");
    expect(invoicingText).toContain("$12,000 sent and unpaid");

    const aerial = baseContext("aerial");
    aerial.moduleLane = {
      module: "aerial",
      missions: { total: 3, planned: 1, active: 1, complete: 1, cancelled: 0 },
      processing: { total: 3, active: 1, failed: 1, succeeded: 1, custodyComplete: 1, custodyPartial: 0, custodyNone: 1 },
      packages: { total: 2, processing: 0, qaPending: 1, ready: 1, shared: 0, verificationReady: 1 },
    };
    const aerialText = buildAssistantChatContextLines(aerial).join("\n");
    expect(aerialText).toContain("Aerial missions: 3 total");
    expect(aerialText).toContain("artifact custody complete on 1");
    expect(aerialText).toContain("1 verification-ready");

    const kb = baseContext("knowledge_base");
    kb.moduleLane = {
      module: "knowledge_base",
      documents: { total: 4, ready: 2, inFlight: 1, extractionFailed: 1, archived: 0, linkedToProject: 3, projectCount: 2 },
    };
    const kbText = buildAssistantChatContextLines(kb).join("\n");
    expect(kbText).toContain("Knowledge base: 4 documents");
    expect(kbText).toContain("1 failed extraction");
    expect(kbText).toContain("3 linked across 2 projects");

    const hub = baseContext("data_hub");
    hub.moduleLane = {
      module: "data_hub",
      datasets: { total: 3, ready: 1, stale: 0, error: 1, other: 1 },
      connectors: { total: 2, active: 1, degraded: 1, offline: 0, withLastError: 1 },
      refreshJobs: { recentCount: 2, failed: 1, latest: { status: "failed", jobName: "acs-refresh", errorSummary: "timeout" } },
    };
    const hubText = buildAssistantChatContextLines(hub).join("\n");
    expect(hubText).toContain("Datasets: 3 total");
    expect(hubText).toContain("Connectors: 2 total");
    expect(hubText).toContain("latest acs-refresh is failed (timeout)");
    expect(hubText).toContain("Transit feeds: 0 registered");
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * Projection ↔ serialization coherence: every column a lane's prompt line
 * renders must be asked for. The clients are untyped, so this string is the
 * only place a dropped column would be caught.
 * ──────────────────────────────────────────────────────────────────────────── */

describe("module lane projections carry the columns the prompt renders", () => {
  it("crash ingest projection", () => {
    for (const column of [
      "source_label", "coverage_state", "severity_completeness", "status",
      "crash_count", "geocoded_count", "truncated", "years_requested", "fetch_error",
    ]) {
      expect(MODULE_LANE_CRASH_INGEST_COLUMNS).toContain(column);
    }
  });

  it("grants projections", () => {
    for (const column of ["title", "opportunity_status", "decision_state", "closes_at", "decision_due_at"]) {
      expect(MODULE_LANE_FUNDING_OPPORTUNITY_COLUMNS).toContain(column);
    }
    for (const column of ["awarded_amount", "spending_status", "risk_flag"]) {
      expect(MODULE_LANE_FUNDING_AWARD_COLUMNS).toContain(column);
    }
  });

  it("invoicing projections", () => {
    for (const column of ["funding_award_id", "status", "net_amount"]) {
      expect(MODULE_LANE_REIMBURSEMENT_INVOICE_COLUMNS).toContain(column);
    }
    for (const column of ["status", "total_amount"]) {
      expect(MODULE_LANE_CLIENT_INVOICE_COLUMNS).toContain(column);
    }
  });

  it("engagement, aerial, knowledge base, and data hub projections", () => {
    for (const column of ["status", "allow_public_submissions", "submissions_closed_at"]) {
      expect(MODULE_LANE_ENGAGEMENT_CAMPAIGN_COLUMNS).toContain(column);
    }
    expect(MODULE_LANE_AERIAL_MISSION_COLUMNS).toContain("status");
    expect(MODULE_LANE_AERIAL_JOB_COLUMNS).toContain("artifact_custody_state");
    expect(MODULE_LANE_AERIAL_PACKAGE_COLUMNS).toContain("verification_readiness");
    for (const column of ["project_id", "status"]) {
      expect(MODULE_LANE_KB_DOCUMENT_COLUMNS).toContain(column);
    }
    expect(MODULE_LANE_DATASET_COLUMNS).toContain("status");
    for (const column of ["status", "last_error_message"]) {
      expect(MODULE_LANE_CONNECTOR_COLUMNS).toContain(column);
    }
    for (const column of ["status", "job_name", "error_summary"]) {
      expect(MODULE_LANE_REFRESH_JOB_COLUMNS).toContain(column);
    }
  });
});

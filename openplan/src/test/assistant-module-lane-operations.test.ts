import { describe, expect, it, vi } from "vitest";

/**
 * MODULE-LANE OPERATIONS AND WORKFLOWS — the copilot's quick links and
 * deterministic answers for /grants, /invoicing, /engagement, /safety,
 * /aerial, /knowledge-base and /data-hub.
 *
 * EVERY CONTEXT HERE COMES FROM THE REAL BUILDERS. The stage-gate lesson
 * (CLAUDE.md): a described fixture proves the assertion, only a built one
 * proves the feature — `record_stage_gate_hold` shipped an offer no real board
 * could ever render because its reachability test hand-wrote the context. So
 * these tests drive `loadAssistantContext` against a recording Supabase fake
 * (the real lane loaders compute the moduleLane summaries) and the REAL
 * `buildWorkspaceOperationsSummaryFromSourceRows` (via the loader mock below)
 * computes the operations summary from source rows.
 *
 * THE PHASE GUARD: this change adds READS ONLY. The structural test at the
 * bottom fails if any module-lane quick link ever carries an `executeAction`.
 */

type SummaryBuilderInput = Parameters<
  typeof import("@/lib/operations/workspace-summary").buildWorkspaceOperationsSummaryFromSourceRows
>[0];

let currentSourceRows: SummaryBuilderInput = {
  projects: [],
  plans: [],
  programs: [],
  reports: [],
  fundingOpportunities: [],
};

vi.mock("@/lib/operations/workspace-summary", async () => {
  const actual = await vi.importActual<typeof import("@/lib/operations/workspace-summary")>(
    "@/lib/operations/workspace-summary"
  );
  return {
    ...actual,
    // The REAL builder, fed per-test source rows — never a hand-written summary.
    loadWorkspaceOperationsSummaryForWorkspace: async () =>
      actual.buildWorkspaceOperationsSummaryFromSourceRows(currentSourceRows),
  };
});

import {
  loadAssistantContext,
  type AssistantModuleLaneKind,
  type WorkspaceAssistantContext,
} from "@/lib/assistant/context";
import { buildAssistantOperations } from "@/lib/assistant/operations";
import { buildAssistantResponse } from "@/lib/assistant/respond";
import { getAssistantActions, resolveAssistantWorkflowId, type AssistantQuickLink } from "@/lib/assistant/catalog";
import { buildInvoicingHref } from "@/lib/invoicing/triage-links";

/* ────────────────────────────────────────────────────────────────────────────
 * Recording fake — same harness shape as assistant-module-lane-context.test.ts.
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
    if (query.table === "workspace_members" && !responses[query.table]) {
      return {
        data: {
          workspace_id: params.workspaceId,
          role: "owner",
          workspaces: { id: params.workspaceId, name: "Lane Operations QA" },
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

const iso = (daysFromNow: number) => new Date(Date.now() + daysFromNow * 86400000).toISOString();

const EMPTY_ROWS: SummaryBuilderInput = {
  projects: [],
  plans: [],
  programs: [],
  reports: [],
  fundingOpportunities: [],
};

async function loadLane(
  kind: AssistantModuleLaneKind,
  supabase: ReturnType<typeof createRecordingSupabase>,
  workspaceId: string,
  sourceRows: SummaryBuilderInput = EMPTY_ROWS
): Promise<WorkspaceAssistantContext> {
  currentSourceRows = sourceRows;
  const context = (await loadAssistantContext(supabase as never, "user-1", {
    kind,
    id: null,
    workspaceId,
    runId: null,
    baselineRunId: null,
  })) as WorkspaceAssistantContext | null;
  expect(context).not.toBeNull();
  return context as WorkspaceAssistantContext;
}

function link(links: AssistantQuickLink[], id: string): AssistantQuickLink {
  const found = links.find((entry) => entry.id === id);
  expect(found, `expected quick link "${id}" among [${links.map((entry) => entry.id).join(", ")}]`).toBeDefined();
  return found as AssistantQuickLink;
}

/**
 * Source rows that make the REAL summary builder emit the
 * `start-project-reimbursement-packets` command for `projectId` — committed
 * award, no reimbursement submittal (mirrors workspace-operations-summary.test.ts).
 */
function reimbursementStartRows(projectId: string): SummaryBuilderInput {
  return {
    projects: [
      { id: projectId, name: `Project ${projectId}`, status: "active", delivery_phase: "delivery", updated_at: iso(-1) },
    ],
    plans: [],
    programs: [],
    reports: [],
    fundingOpportunities: [
      {
        id: `opp-${projectId}`,
        title: "Awarded opportunity",
        opportunity_status: "awarded",
        decision_state: "pursue",
        expected_award_amount: 100000,
        closes_at: null,
        decision_due_at: null,
        program_id: null,
        project_id: projectId,
        updated_at: iso(-1),
      },
    ],
    fundingAwards: [
      {
        id: `award-${projectId}`,
        project_id: projectId,
        funding_opportunity_id: `opp-${projectId}`,
        title: "Committed award",
        awarded_amount: 100000,
        updated_at: iso(-1),
      },
    ],
    fundingInvoices: [],
    projectSubmittals: [],
    projectFundingProfiles: [
      { project_id: projectId, funding_need_amount: 500000, local_match_need_amount: 50000 },
    ],
  } as SummaryBuilderInput;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Grants
 * ──────────────────────────────────────────────────────────────────────────── */

describe("grants lane operations", () => {
  const deadlineResponses = {
    funding_opportunities: {
      data: [
        // Schema-representable rows only: decision_state is NOT NULL DEFAULT
        // 'monitor', so a null decision_state cannot exist in production.
        { id: "opp-1", title: "Closing soon program", opportunity_status: "open", decision_state: "monitor", closes_at: iso(5), decision_due_at: null, updated_at: iso(-1) },
        { id: "opp-2", title: "Overdue decision program", opportunity_status: "open", decision_state: "monitor", closes_at: iso(60), decision_due_at: iso(-3), updated_at: iso(-2) },
      ],
      error: null,
    },
  };

  it("renders the closing-windows link and picks the decision-queue workflow under deadline pressure", async () => {
    const supabase = createRecordingSupabase({ workspaceId: "ws-g1", responses: deadlineResponses });
    const context = await loadLane("grants", supabase, "ws-g1");
    const links = buildAssistantOperations(context);

    const deadlines = link(links, "grants-lane-deadlines");
    expect(deadlines.href).toBe("/grants");
    expect(deadlines.reason).toContain("Closing soon program");
    expect(deadlines.executeAction).toBeUndefined();

    const brief = link(links, "grants-lane-brief-agent");
    expect(brief.workflowId).toBe("grants-decision-queue");
    // The id must be one the catalog lists, or /api/assistant silently
    // resolves the click to a different workflow.
    expect(getAssistantActions("grants").map((action) => action.id)).toContain(brief.workflowId);
    expect(resolveAssistantWorkflowId("grants", brief.workflowId, brief.prompt)).toBe("grants-decision-queue");
  });

  it("falls back to the grants brief workflow when nothing is under deadline pressure", async () => {
    const supabase = createRecordingSupabase({ workspaceId: "ws-g2" });
    const context = await loadLane("grants", supabase, "ws-g2");
    const links = buildAssistantOperations(context);
    expect(link(links, "grants-lane-brief-agent").workflowId).toBe("grants-brief");
    expect(links.find((entry) => entry.id === "grants-lane-deadlines")).toBeUndefined();
  });

  it("reuses the workspace queue's uninvoiced-award observation and threads BOTH bindings", async () => {
    for (const [workspaceId, projectId] of [
      ["ws-vary-a", "project-vary-a"],
      ["ws-vary-b", "project-vary-b"],
    ] as const) {
      const supabase = createRecordingSupabase({ workspaceId });
      const context = await loadLane("grants", supabase, workspaceId, reimbursementStartRows(projectId));
      const links = buildAssistantOperations(context);
      const invoicing = link(links, "grants-lane-award-invoicing");
      expect(invoicing.href).toBe(
        buildInvoicingHref({ workspaceId, linkage: "unlinked", overdue: "all", projectId })
      );
      expect(invoicing.href).toContain(`workspaceId=${workspaceId}`);
      expect(invoicing.href).toContain(`projectId=${projectId}`);
      expect(invoicing.executeAction).toBeUndefined();
    }
  });

  it("a failed opportunity read yields silence, never a deadline link", async () => {
    const supabase = createRecordingSupabase({
      workspaceId: "ws-g3",
      responses: { funding_opportunities: { data: null, error: { message: "permission denied" } } },
    });
    const context = await loadLane("grants", supabase, "ws-g3");
    const links = buildAssistantOperations(context);
    expect(links.find((entry) => entry.id === "grants-lane-deadlines")).toBeUndefined();
    // And the workflow that would have keyed on the queue falls back to the brief.
    expect(link(links, "grants-lane-brief-agent").workflowId).toBe("grants-brief");
  });

  it("the decision-queue response speaks the real counts and names the lead deadline", async () => {
    const supabase = createRecordingSupabase({ workspaceId: "ws-g4", responses: deadlineResponses });
    const context = await loadLane("grants", supabase, "ws-g4");
    const response = buildAssistantResponse(context, "grants-decision-queue");
    expect(response.workflowId).toBe("grants-decision-queue");
    const text = [response.summary, ...response.findings].join("\n");
    expect(text).toContain("1 window closes within 14 days");
    expect(text).toContain("1 decision has lapsed");
    expect(text).toContain("Closing soon program");
  });

  it("a failed award read is spoken as unknown, never as zero awards", async () => {
    const supabase = createRecordingSupabase({
      workspaceId: "ws-g5",
      responses: { funding_awards: { data: null, error: { message: "permission denied for relation funding_awards" } } },
    });
    const context = await loadLane("grants", supabase, "ws-g5");
    const response = buildAssistantResponse(context, "grants-awards");
    const text = [response.summary, ...response.findings, ...response.evidence].join("\n");
    expect(text).toContain("unknown");
    expect(text).not.toContain("0 funding awards recorded");
    expect(response.evidence.join("\n")).toContain("Awards: unknown (read failed)");
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * Invoicing
 * ──────────────────────────────────────────────────────────────────────────── */

describe("invoicing lane operations", () => {
  const unlinkedResponses = {
    billing_invoice_records: {
      data: [
        { id: "inv-1", funding_award_id: null, status: "draft", amount: 500, net_amount: 500 },
        { id: "inv-2", funding_award_id: "award-1", status: "submitted", amount: 1000, net_amount: 950 },
        { id: "inv-3", funding_award_id: null, status: "draft", amount: 700, net_amount: 700 },
      ],
      error: null,
    },
  };

  it("renders the unlinked-invoice triage link with the workspace binding varied", async () => {
    for (const workspaceId of ["ws-inv-a", "ws-inv-b"]) {
      const supabase = createRecordingSupabase({ workspaceId, responses: unlinkedResponses });
      const context = await loadLane("invoicing", supabase, workspaceId);
      const links = buildAssistantOperations(context);
      const unlinked = link(links, "invoicing-lane-unlinked");
      expect(unlinked.href).toBe(buildInvoicingHref({ workspaceId, linkage: "unlinked", overdue: "all" }));
      expect(unlinked.href).toContain(`workspaceId=${workspaceId}`);
      expect(unlinked.label).toBe("Open 2 unlinked invoices");
      expect(unlinked.executeAction).toBeUndefined();
    }
  });

  it("a failed reimbursement read yields no unlinked link and an unknown response, never zeros", async () => {
    const supabase = createRecordingSupabase({
      workspaceId: "ws-inv-f",
      responses: { billing_invoice_records: { data: null, error: { message: "permission denied" } } },
    });
    const context = await loadLane("invoicing", supabase, "ws-inv-f");
    const links = buildAssistantOperations(context);
    expect(links.find((entry) => entry.id === "invoicing-lane-unlinked")).toBeUndefined();

    const response = buildAssistantResponse(context, "invoicing-reimbursements");
    const text = [response.summary, ...response.findings].join("\n");
    expect(text).toContain("unknown");
    expect(text).not.toContain("0 reimbursement invoices");
  });

  it("the reimbursements response reports the outstanding net amount", async () => {
    const supabase = createRecordingSupabase({ workspaceId: "ws-inv-r", responses: unlinkedResponses });
    const context = await loadLane("invoicing", supabase, "ws-inv-r");
    const response = buildAssistantResponse(context, "invoicing-reimbursements");
    expect(response.summary).toContain("$950");
    expect(response.findings.join("\n")).toContain("2 invoices carry no funding-award link");
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * Engagement
 * ──────────────────────────────────────────────────────────────────────────── */

describe("engagement lane operations", () => {
  function liveResponses(campaignId: string) {
    return {
      engagement_campaigns: {
        data: [
          { id: campaignId, title: `Campaign ${campaignId}`, status: "active", allow_public_submissions: true, submissions_closed_at: null, updated_at: iso(-1) },
          { id: "camp-draft", title: "Staged campaign", status: "draft", allow_public_submissions: false, submissions_closed_at: null, updated_at: iso(-2) },
        ],
        error: null,
      },
      engagement_items: [
        { data: null, error: null, count: 3 },
        { data: null, error: null, count: 1 },
      ],
    };
  }

  /** The lead-campaign observation, produced by the real summary builder's pass-through. */
  function observationRows(campaignId: string): SummaryBuilderInput {
    return {
      ...EMPTY_ROWS,
      moduleObservations: {
        engagement: {
          campaigns: 2,
          activeCampaigns: 1,
          moderationActionableItems: 4,
          approvedItems: 0,
          leadActiveCampaign: { id: campaignId, title: `Campaign ${campaignId}` },
          leadActiveCampaignLiveSurveyQuestions: 2,
        },
        safety: { crashIngests: null, readyCrashIngests: null, failedCrashIngests: null, uncoveredCrashIngests: null },
        modeling: { modelRuns: null, activeModelRuns: null, failedModelRuns: null, succeededModelRuns: null, scenarioSets: null, activeScenarioSets: null, countyRuns: null, validatedScreeningCountyRuns: null },
        evidence: { datasets: null, datasetsNeedingAttention: null, knowledgeDocuments: null, readyKnowledgeDocuments: null, failedKnowledgeDocuments: null },
        receivables: { clientInvoices: null, draftClientInvoices: null, awaitingPaymentClientInvoices: null },
        unreadable: [],
      },
    } as SummaryBuilderInput;
  }

  it("a live-but-unmoderated campaign renders the console link bound to the lead campaign, binding varied", async () => {
    for (const campaignId of ["camp-live-a", "camp-live-b"]) {
      const supabase = createRecordingSupabase({ workspaceId: "ws-e1", responses: liveResponses(campaignId) });
      const context = await loadLane("engagement", supabase, "ws-e1", observationRows(campaignId));
      const links = buildAssistantOperations(context);
      const moderation = link(links, "engagement-lane-moderation");
      expect(moderation.href).toBe(`/engagement/${campaignId}`);
      expect(moderation.label).toBe("Review 4 waiting submissions");
      expect(moderation.executeAction).toBeUndefined();
      expect(link(links, "engagement-lane-brief-agent").workflowId).toBe("engagement-moderation");
    }
  });

  it("staged drafts render the publish-flow link, and its audit note keeps publishing with a person", async () => {
    const supabase = createRecordingSupabase({ workspaceId: "ws-e2", responses: liveResponses("camp-x") });
    const context = await loadLane("engagement", supabase, "ws-e2");
    const links = buildAssistantOperations(context);
    const drafts = link(links, "engagement-lane-drafts");
    expect(drafts.href).toBe("/engagement");
    expect(drafts.label).toBe("Open 1 staged campaign");
    expect(drafts.auditNote).toContain("never from here");
  });

  it("a failed moderation count yields no moderation link and an unknown response, never a clear queue", async () => {
    const supabase = createRecordingSupabase({
      workspaceId: "ws-e3",
      responses: {
        engagement_campaigns: liveResponses("camp-y").engagement_campaigns,
        engagement_items: { data: null, error: { message: "permission denied" } },
      },
    });
    const context = await loadLane("engagement", supabase, "ws-e3");
    const links = buildAssistantOperations(context);
    expect(links.find((entry) => entry.id === "engagement-lane-moderation")).toBeUndefined();

    const response = buildAssistantResponse(context, "engagement-moderation");
    expect(response.summary).toContain("unknown");
    expect(response.summary).not.toContain("Nothing is waiting");
  });

  it("the publication response counts live and staged campaigns from the real lane summary", async () => {
    const supabase = createRecordingSupabase({ workspaceId: "ws-e4", responses: liveResponses("camp-z") });
    const context = await loadLane("engagement", supabase, "ws-e4");
    const response = buildAssistantResponse(context, "engagement-publication");
    expect(response.summary).toContain("1 campaign is live");
    expect(response.summary).toContain("1 is staged as a draft");
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * Safety, aerial, knowledge base, data hub
 * ──────────────────────────────────────────────────────────────────────────── */

describe("safety lane operations", () => {
  const failedIngestResponses = {
    safety_crash_ingests: {
      data: [
        {
          id: "ingest-1", project_id: null, source_label: "CCRS", coverage_state: "ccrs_ca_statewide",
          severity_completeness: "kabco_full", status: "failed", crash_count: 0, geocoded_count: 0,
          truncated: false, years_requested: [2023], fetch_error: "upstream 503", created_at: iso(-1),
        },
      ],
      error: null,
    },
  };

  it("a failed ingest renders the /safety link quoting the source's own error", async () => {
    const supabase = createRecordingSupabase({ workspaceId: "ws-s1", responses: failedIngestResponses });
    const context = await loadLane("safety", supabase, "ws-s1");
    const links = buildAssistantOperations(context);
    const failures = link(links, "safety-lane-failed-ingests");
    expect(failures.href).toBe("/safety");
    expect(failures.reason).toContain("upstream 503");
    expect(failures.executeAction).toBeUndefined();
  });

  it("the safety brief carries the severity-completeness caveat of the latest import", async () => {
    const supabase = createRecordingSupabase({ workspaceId: "ws-s2", responses: failedIngestResponses });
    const context = await loadLane("safety", supabase, "ws-s2");
    const response = buildAssistantResponse(context, "safety-brief");
    expect(response.caution).toContain('"kabco_full"');
    expect(response.caution).toContain('"ccrs_ca_statewide"');
    expect(response.findings.join("\n")).toContain("upstream 503");
  });

  it("a failed import read is spoken as unknown, never as an import-free workspace", async () => {
    const supabase = createRecordingSupabase({
      workspaceId: "ws-s3",
      responses: { safety_crash_ingests: { data: null, error: { message: "permission denied" } } },
    });
    const context = await loadLane("safety", supabase, "ws-s3");
    const links = buildAssistantOperations(context);
    expect(links.find((entry) => entry.id === "safety-lane-failed-ingests")).toBeUndefined();
    const response = buildAssistantResponse(context, "safety-brief");
    const text = [response.summary, ...response.findings].join("\n");
    expect(text).not.toContain("No crash data has been imported");
    expect(text).toContain("could not be read");
  });
});

describe("aerial lane operations", () => {
  const aerialResponses = {
    aerial_processing_jobs: {
      data: [
        { id: "j1", status: "succeeded", artifact_custody_state: "partial" },
        { id: "j2", status: "succeeded", artifact_custody_state: "complete" },
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
  };

  it("ready packages and pending custody each render their register link", async () => {
    const supabase = createRecordingSupabase({ workspaceId: "ws-a1", responses: aerialResponses });
    const context = await loadLane("aerial", supabase, "ws-a1");
    const links = buildAssistantOperations(context);
    expect(link(links, "aerial-lane-ready-packages").label).toBe("Review 1 ready evidence package");
    const custody = link(links, "aerial-lane-custody");
    expect(custody.label).toBe("Check artifact custody on 1 job");
    expect(custody.statusLabel).toBe("1 partial · 0 none");
    expect(link(links, "aerial-lane-brief-agent").workflowId).toBe("aerial-jobs");
  });

  it("the jobs response reports custody counts from the real lane summary", async () => {
    const supabase = createRecordingSupabase({ workspaceId: "ws-a2", responses: aerialResponses });
    const context = await loadLane("aerial", supabase, "ws-a2");
    const response = buildAssistantResponse(context, "aerial-jobs");
    expect(response.findings.join("\n")).toContain("artifact custody complete on 1, partial on 1, none on 0");
  });
});

describe("knowledge base lane operations", () => {
  const kbResponses = {
    kb_documents: {
      data: [
        { id: "d1", project_id: "proj-1", status: "ready" },
        { id: "d2", project_id: null, status: "failed" },
        { id: "d3", project_id: null, status: "failed" },
      ],
      error: null,
    },
  };

  it("extraction failures render the /knowledge-base link and pick the extraction workflow", async () => {
    const supabase = createRecordingSupabase({ workspaceId: "ws-k1", responses: kbResponses });
    const context = await loadLane("knowledge_base", supabase, "ws-k1");
    const links = buildAssistantOperations(context);
    const failures = link(links, "knowledge-base-lane-extraction-failures");
    expect(failures.href).toBe("/knowledge-base");
    expect(failures.label).toBe("Review 2 failed extractions");
    expect(link(links, "knowledge-base-lane-brief-agent").workflowId).toBe("knowledge-base-extraction");
  });

  it("the extraction response counts the failures and says what they cost", async () => {
    const supabase = createRecordingSupabase({ workspaceId: "ws-k2", responses: kbResponses });
    const context = await loadLane("knowledge_base", supabase, "ws-k2");
    const response = buildAssistantResponse(context, "knowledge-base-extraction");
    expect(response.summary).toContain("2 documents failed extraction");
    expect(response.findings.join("\n")).toContain("invisible to retrieval");
  });
});

describe("data hub lane operations", () => {
  const hubResponses = {
    data_datasets: {
      data: [
        { id: "ds1", status: "stale" },
        { id: "ds2", status: "error" },
        { id: "ds3", status: "ready" },
      ],
      error: null,
    },
    data_refresh_jobs: {
      data: [{ id: "job-1", status: "failed", job_name: "acs-refresh", error_summary: "timeout" }],
      error: null,
    },
  };

  it("stale datasets render the /data-hub link and failed refreshes pick the refresh workflow", async () => {
    const supabase = createRecordingSupabase({ workspaceId: "ws-h1", responses: hubResponses });
    const context = await loadLane("data_hub", supabase, "ws-h1");
    const links = buildAssistantOperations(context);
    const stale = link(links, "data-hub-lane-stale-datasets");
    expect(stale.href).toBe("/data-hub");
    expect(stale.label).toBe("Review 2 datasets needing refresh");
    expect(stale.statusLabel).toBe("1 stale · 1 error");
    expect(link(links, "data-hub-lane-brief-agent").workflowId).toBe("data-hub-refresh");
  });

  it("the refresh response quotes the failed job's own error summary", async () => {
    const supabase = createRecordingSupabase({ workspaceId: "ws-h2", responses: hubResponses });
    const context = await loadLane("data_hub", supabase, "ws-h2");
    const response = buildAssistantResponse(context, "data-hub-refresh");
    expect(response.summary).toContain("timeout");
    expect(response.findings.join("\n")).toContain("acs-refresh");
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * The phase guard, structural: reads only, and every in-panel workflow id is
 * one the catalog lists (so /api/assistant resolves the click to the workflow
 * the label promised).
 * ──────────────────────────────────────────────────────────────────────────── */

describe("module-lane quick links are reads only", () => {
  const laneSetups: Array<{ kind: AssistantModuleLaneKind; responses: Record<string, Responder> }> = [
    {
      kind: "grants",
      responses: {
        funding_opportunities: {
          data: [
            { id: "opp-1", title: "Closing", opportunity_status: "open", decision_state: "monitor", closes_at: iso(3), decision_due_at: iso(-1), updated_at: iso(-1) },
          ],
          error: null,
        },
        funding_awards: { data: [{ id: "aw-1", title: "A", awarded_amount: 1, spending_status: "active", risk_flag: "watch", updated_at: iso(-1) }], error: null },
      },
    },
    {
      kind: "invoicing",
      responses: {
        billing_invoice_records: { data: [{ id: "i1", funding_award_id: null, status: "submitted", amount: 1, net_amount: 1 }], error: null },
      },
    },
    {
      kind: "engagement",
      responses: {
        engagement_campaigns: {
          data: [
            { id: "c1", title: "Live", status: "active", allow_public_submissions: true, submissions_closed_at: null, updated_at: iso(-1) },
            { id: "c2", title: "Draft", status: "draft", allow_public_submissions: false, submissions_closed_at: null, updated_at: iso(-1) },
          ],
          error: null,
        },
        engagement_items: [
          { data: null, error: null, count: 2 },
          { data: null, error: null, count: 1 },
        ],
      },
    },
    {
      kind: "safety",
      responses: {
        safety_crash_ingests: {
          data: [
            { id: "in1", project_id: null, source_label: "CCRS", coverage_state: "x", severity_completeness: "kabco_full", status: "failed", crash_count: 0, geocoded_count: 0, truncated: false, years_requested: [], fetch_error: "boom", created_at: iso(-1) },
          ],
          error: null,
        },
      },
    },
    {
      kind: "aerial",
      responses: {
        aerial_processing_jobs: { data: [{ id: "j1", status: "failed", artifact_custody_state: "none" }], error: null },
        aerial_evidence_packages: { data: [{ id: "p1", status: "ready", verification_readiness: "ready" }], error: null },
      },
    },
    {
      kind: "knowledge_base",
      responses: { kb_documents: { data: [{ id: "d1", project_id: null, status: "failed" }], error: null } },
    },
    {
      kind: "data_hub",
      responses: {
        data_datasets: { data: [{ id: "ds1", status: "stale" }], error: null },
        data_connectors: { data: [{ id: "c1", status: "degraded", last_error_message: "429" }], error: null },
        data_refresh_jobs: { data: [{ id: "j1", status: "failed", job_name: "n", error_summary: "e" }], error: null },
      },
    },
  ];

  it("no module-lane link carries an executeAction, even with every signal firing", async () => {
    for (const setup of laneSetups) {
      const supabase = createRecordingSupabase({ workspaceId: "ws-guard", responses: setup.responses });
      const context = await loadLane(setup.kind, supabase, "ws-guard");
      const links = buildAssistantOperations(context);
      expect(links.length).toBeGreaterThan(0);
      for (const entry of links) {
        expect(
          entry.executeAction,
          `${setup.kind} link "${entry.id}" carries an executeAction — this phase adds reads only`
        ).toBeUndefined();
      }
    }
  });

  it("every in-panel workflow id resolves through the catalog for its own kind", async () => {
    for (const setup of laneSetups) {
      const supabase = createRecordingSupabase({ workspaceId: "ws-guard2", responses: setup.responses });
      const context = await loadLane(setup.kind, supabase, "ws-guard2");
      for (const entry of buildAssistantOperations(context)) {
        if (!entry.workflowId) continue;
        expect(
          resolveAssistantWorkflowId(setup.kind, entry.workflowId, entry.prompt ?? null),
          `${setup.kind} link "${entry.id}" carries workflow "${entry.workflowId}", which the catalog does not resolve`
        ).toBe(entry.workflowId);
      }
    }
  });

  it("every lane response returns quick links, so the panel keeps its operations after an answer", async () => {
    for (const setup of laneSetups) {
      const supabase = createRecordingSupabase({ workspaceId: "ws-guard3", responses: setup.responses });
      const context = await loadLane(setup.kind, supabase, "ws-guard3");
      for (const action of getAssistantActions(setup.kind)) {
        const response = buildAssistantResponse(context, action.id);
        expect(response.workflowId).toBe(action.id);
        expect(response.quickLinks?.length ?? 0).toBeGreaterThan(0);
      }
    }
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * The workspace's first-model pointer.
 * ──────────────────────────────────────────────────────────────────────────── */

describe("workspace first-model-run pointer", () => {
  function modelingObservationRows(modelRuns: number | null): SummaryBuilderInput {
    return {
      ...EMPTY_ROWS,
      moduleObservations: {
        engagement: { campaigns: null, activeCampaigns: null, moderationActionableItems: null, approvedItems: null, leadActiveCampaign: null, leadActiveCampaignLiveSurveyQuestions: null },
        safety: { crashIngests: null, readyCrashIngests: null, failedCrashIngests: null, uncoveredCrashIngests: null },
        modeling: { modelRuns, activeModelRuns: null, failedModelRuns: null, succeededModelRuns: null, scenarioSets: null, activeScenarioSets: null, countyRuns: null, validatedScreeningCountyRuns: null },
        evidence: { datasets: null, datasetsNeedingAttention: null, knowledgeDocuments: null, readyKnowledgeDocuments: null, failedKnowledgeDocuments: null },
        receivables: { clientInvoices: null, draftClientInvoices: null, awaitingPaymentClientInvoices: null },
        unreadable: [],
      },
    } as SummaryBuilderInput;
  }

  async function loadWorkspace(sourceRows: SummaryBuilderInput): Promise<WorkspaceAssistantContext> {
    currentSourceRows = sourceRows;
    const supabase = createRecordingSupabase({ workspaceId: "ws-m0" });
    const context = (await loadAssistantContext(supabase as never, "user-1", {
      kind: "workspace",
      id: null,
      workspaceId: "ws-m0",
      runId: null,
      baselineRunId: null,
    })) as WorkspaceAssistantContext | null;
    expect(context).not.toBeNull();
    return context as WorkspaceAssistantContext;
  }

  it("a workspace measured at zero model runs is pointed at the guided first run", async () => {
    const context = await loadWorkspace(modelingObservationRows(0));
    const links = buildAssistantOperations(context);
    const pointer = link(links, "workspace-first-model-run");
    expect(pointer.href).toBe("/models");
    expect(pointer.executeAction).toBeUndefined();
  });

  it("an UNMEASURED model-run count gets no first-run invitation — null is not zero", async () => {
    const context = await loadWorkspace(modelingObservationRows(null));
    expect(buildAssistantOperations(context).find((entry) => entry.id === "workspace-first-model-run")).toBeUndefined();
  });
});

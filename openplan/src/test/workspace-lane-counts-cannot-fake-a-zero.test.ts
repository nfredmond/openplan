/**
 * The Command Center reads engagement, safety, modeling, evidence supply and
 * client invoicing — and every number it reads can say "not measured".
 *
 * WHAT WENT WRONG BEFORE, AND MUST NOT AGAIN. This module once handed literal
 * zeros into a readiness computation, which made "plans need setup" permanently
 * true for every workspace. The rule that came out of it is the rule these
 * tests hold: this summary counts only what it actually READ, and anything it
 * could not read is indeterminate — never a zero, never a "missing", never a
 * completed check.
 *
 * Widening the summary across more modules multiplies the ways that rule can be
 * broken, so each new lane is tested three ways: it reports what it measured,
 * it reports NOTHING when the read failed, and it reports nothing when the read
 * saw only part of the workspace.
 */

import { describe, expect, it } from "vitest";
import {
  loadWorkspaceOperationsSummaryForWorkspace,
  type WorkspaceOperationsSupabaseLike,
} from "@/lib/operations/workspace-summary";
import {
  buildWorkflowNextActionGroups,
  classifyWorkflowNextAction,
  getCommandCenterRoadmapWorkflowLaneKeys,
  workflowGroupsCoverCommandCenterRoadmapLanes,
} from "@/lib/operations/workflow-next-action-groups";
import type { WorkspaceCommandQueueItem } from "@/lib/operations/workspace-summary";

type StubTable =
  | unknown[]
  | { rows?: unknown[]; count?: number | null; error?: { message: string } };

/**
 * A PostgREST filter builder: chainable in any order, awaitable at any point.
 *
 * It keys staged results by TABLE, which is a real limitation worth naming —
 * `engagement_items` is read twice with different status filters, and this stub
 * answers both reads identically. The tests below therefore assert the queue
 * behaviour those two counts drive rather than pretending to distinguish them.
 */
function createSupabaseStub(dataByTable: Record<string, StubTable>) {
  const buildResult = (table: string) => {
    const entry = dataByTable[table];

    if (entry === undefined || Array.isArray(entry)) {
      const rows = entry ?? [];
      return { data: rows, count: rows.length, error: null };
    }

    if (entry.error) {
      return { data: null, count: null, error: entry.error };
    }

    const rows = entry.rows ?? [];
    return { data: rows, count: entry.count ?? rows.length, error: null };
  };

  const chain = (table: string) => {
    const self = {
      eq: () => self,
      in: () => self,
      order: () => self,
      limit: () => self,
      then: (
        onfulfilled?: ((value: ReturnType<typeof buildResult>) => unknown) | null,
        onrejected?: ((reason: unknown) => unknown) | null
      ) => Promise.resolve(buildResult(table)).then(onfulfilled, onrejected),
    };

    return self;
  };

  return {
    from: (table: string) => ({ select: () => chain(table) }),
  } as unknown as WorkspaceOperationsSupabaseLike;
}

function command(overrides: Partial<WorkspaceCommandQueueItem>): WorkspaceCommandQueueItem {
  return {
    key: "example-command",
    title: "Example command",
    detail: "Example detail.",
    href: "/projects",
    tone: "info",
    priority: 1,
    badges: [],
    ...overrides,
  };
}

describe("workspace lane counts", () => {
  it.each([1, 2])("does not infer absent crash evidence from %i failed acquisitions", async (failed) => {
    const summary = await loadWorkspaceOperationsSummaryForWorkspace(createSupabaseStub({
      safety_crash_ingests: [
        { id: "completed-acquisition", status: "ready" },
        ...Array.from({ length: failed }, (_, index) => ({ id: `failed-${index}`, status: "failed" })),
      ],
    }), "workspace-with-retained-evidence");
    const queue = summary.fullCommandQueue.find(item => item.key === "resolve-safety-crash-data-pulls");
    const readiness = buildWorkflowNextActionGroups(summary).find(group => group.key === "safety")?.readiness;
    expect(summary.moduleObservations?.safety?.readyCrashIngests).toBe(1);
    expect(summary.moduleObservations?.safety?.failedCrashIngests).toBe(failed);
    for (const detail of [queue?.detail, readiness?.detail]) {
      expect(detail).toContain("did not complete");
      expect(detail).toContain("does not establish whether other crash evidence exists for the same area");
      expect(detail).toContain("Review completed acquisitions in Safety");
      expect(detail).not.toContain("no observed crash record");
    }
  });

  it("carries engagement, safety and model-run state from the database into the queue", async () => {
    const supabase = createSupabaseStub({
      engagement_campaigns: [
        { id: "campaign-1", title: "Corridor listening sessions", status: "active", updated_at: "2026-07-20T10:00:00.000Z" },
        { id: "campaign-2", title: "Closed outreach round", status: "closed", updated_at: "2026-07-01T10:00:00.000Z" },
      ],
      engagement_items: { rows: [], count: 3 },
      safety_crash_ingests: [
        { id: "ingest-1", status: "ready" },
        { id: "ingest-2", status: "failed" },
        { id: "ingest-3", status: "no_coverage" },
      ],
      model_runs: [
        { id: "run-1", status: "failed" },
        { id: "run-2", status: "running" },
        { id: "run-3", status: "succeeded" },
      ],
      scenario_sets: [{ id: "set-1", status: "active" }],
      county_runs: [{ id: "county-run-1", stage: "validated-screening" }],
      data_datasets: [{ id: "dataset-1", status: "stale" }],
      kb_documents: [
        { id: "doc-1", status: "ready" },
        { id: "doc-2", status: "failed" },
      ],
      client_invoices: [
        { id: "invoice-1", status: "draft" },
        { id: "invoice-2", status: "sent" },
      ],
    });

    const summary = await loadWorkspaceOperationsSummaryForWorkspace(supabase, "workspace-1");
    const observations = summary.moduleObservations;

    expect(observations?.unreadable).toEqual([]);
    expect(observations?.engagement).toMatchObject({
      campaigns: 2,
      activeCampaigns: 1,
      moderationActionableItems: 3,
      leadActiveCampaign: { id: "campaign-1", title: "Corridor listening sessions" },
    });
    expect(observations?.safety).toEqual({
      crashIngests: 3,
      readyCrashIngests: 1,
      failedCrashIngests: 1,
      uncoveredCrashIngests: 1,
    });
    expect(observations?.modeling).toEqual({
      modelRuns: 3,
      activeModelRuns: 1,
      failedModelRuns: 1,
      succeededModelRuns: 1,
      scenarioSets: 1,
      activeScenarioSets: 1,
      countyRuns: 1,
      validatedScreeningCountyRuns: 1,
    });
    expect(observations?.evidence).toMatchObject({
      datasets: 1,
      datasetsNeedingAttention: 1,
      knowledgeDocuments: 2,
      readyKnowledgeDocuments: 1,
      failedKnowledgeDocuments: 1,
    });
    expect(observations?.receivables).toEqual({
      clientInvoices: 2,
      draftClientInvoices: 1,
      awaitingPaymentClientInvoices: 1,
    });

    const queueKeys = summary.fullCommandQueue.map((item) => item.key);
    expect(queueKeys).toEqual(
      expect.arrayContaining([
        "moderate-engagement-comments",
        "resolve-failed-model-runs",
        "resolve-safety-crash-data-pulls",
        "refresh-attention-datasets",
        "resolve-knowledge-extraction-failures",
        "advance-client-invoice-drafts",
      ])
    );

    const moderationCommand = summary.fullCommandQueue.find(
      (item) => item.key === "moderate-engagement-comments"
    );
    // The lead link lands on the campaign a planner would actually open, not a
    // module index that makes them find it again.
    expect(moderationCommand?.href).toBe("/engagement/campaign-1");
    expect(moderationCommand?.detail).toContain("Corridor listening sessions");

    const safetyCommand = summary.fullCommandQueue.find(
      (item) => item.key === "resolve-safety-crash-data-pulls"
    );
    expect(safetyCommand?.title).toBe("Retry failed crash data pulls");
    expect(safetyCommand?.detail).toMatch(/screening-level safety analysis/i);

    const groups = buildWorkflowNextActionGroups(summary);
    expect(groups.find((group) => group.key === "engagement")?.readiness.label).toBe(
      "Comments waiting on moderation"
    );
    expect(groups.find((group) => group.key === "safety")?.readiness.label).toBe("Crash data pull failed");
    expect(groups.find((group) => group.key === "analysis-modeling")?.readiness.label).toBe(
      "Model run failures"
    );
    expect(groups.find((group) => group.key === "data-evidence")?.readiness.label).toBe(
      "Dataset refresh outstanding"
    );
    expect(groups.find((group) => group.key === "receivables")?.readiness.label).toBe("Drafts not yet sent");
  });

  it("reports a lane it could not read as unmeasured instead of as an empty lane", async () => {
    const supabase = createSupabaseStub({
      engagement_campaigns: { error: { message: "permission denied for table engagement_campaigns" } },
      engagement_items: { error: { message: "permission denied for table engagement_items" } },
      model_runs: { error: { message: 'relation "model_runs" does not exist' } },
    });

    const summary = await loadWorkspaceOperationsSummaryForWorkspace(supabase, "workspace-1");
    const observations = summary.moduleObservations;

    expect(observations?.engagement).toMatchObject({
      campaigns: null,
      activeCampaigns: null,
      moderationActionableItems: null,
      approvedItems: null,
      leadActiveCampaign: null,
    });
    expect(observations?.modeling).toMatchObject({
      modelRuns: null,
      activeModelRuns: null,
      failedModelRuns: null,
      succeededModelRuns: null,
    });

    // Named, so the board can say which lanes to disbelieve.
    expect(observations?.unreadable.map((failure) => failure.label)).toEqual(
      expect.arrayContaining([
        "engagement campaigns",
        "model runs",
        "engagement comments awaiting moderation",
        "approved engagement comments",
      ])
    );
    expect(observations?.unreadable.map((failure) => failure.message)).toContain(
      "permission denied for table engagement_items"
    );

    // The point of the whole exercise: an unreadable lane raises no command. A
    // queue item would assert work exists; its absence must not assert the lane
    // is clear either, which is what `unreadable` above is for.
    const queueKeys = summary.fullCommandQueue.map((item) => item.key);
    expect(queueKeys).not.toContain("moderate-engagement-comments");
    expect(queueKeys).not.toContain("resolve-failed-model-runs");

    const groups = buildWorkflowNextActionGroups(summary);
    expect(groups.find((group) => group.key === "engagement")?.readiness.label).toBe(
      "Moderation queue not readable"
    );
    expect(groups.find((group) => group.key === "engagement")?.readiness.metrics).toContainEqual({
      label: "Awaiting moderation",
      value: "not measured",
    });
  });

  it("keeps the total exact but the breakdown unmeasured when a read saw only part of the workspace", async () => {
    const supabase = createSupabaseStub({
      // Two rows returned, five thousand matched: the failed row below is a fact
      // about the window, not about the workspace.
      model_runs: { rows: [{ id: "run-1", status: "failed" }, { id: "run-2", status: "succeeded" }], count: 5000 },
      kb_documents: { rows: [{ id: "doc-1", status: "failed" }], count: 900 },
    });

    const summary = await loadWorkspaceOperationsSummaryForWorkspace(supabase, "workspace-1");
    const observations = summary.moduleObservations;

    expect(observations?.modeling.modelRuns).toBe(5000);
    expect(observations?.modeling.failedModelRuns).toBeNull();
    expect(observations?.modeling.succeededModelRuns).toBeNull();
    expect(observations?.evidence.knowledgeDocuments).toBe(900);
    expect(observations?.evidence.failedKnowledgeDocuments).toBeNull();

    // A clipped read is not a failed read: nothing is disclosed as unreadable,
    // and no command is raised off a count that only covered a window.
    expect(observations?.unreadable).toEqual([]);
    const queueKeys = summary.fullCommandQueue.map((item) => item.key);
    expect(queueKeys).not.toContain("resolve-failed-model-runs");
    expect(queueKeys).not.toContain("resolve-knowledge-extraction-failures");
  });

  it("will not call the evidence lane empty when only half of it could be read", async () => {
    // The Data Hub and the Knowledge Base are separate tables that fail
    // separately, so the common failure is half a lane, not none of it. With
    // one read failed and the other legitimately empty, the lane must not
    // report the absence of records nobody counted.
    const supabase = createSupabaseStub({
      data_datasets: { error: { message: "permission denied for table data_datasets" } },
      kb_documents: [],
    });

    const summary = await loadWorkspaceOperationsSummaryForWorkspace(supabase, "workspace-1");
    const groups = buildWorkflowNextActionGroups(summary);
    const evidence = groups.find((group) => group.key === "data-evidence");

    expect(evidence?.readiness.label).toBe("Evidence supply partly unreadable");
    expect(evidence?.readiness.detail).not.toMatch(/no dataset or knowledge base document is registered/i);
    expect(evidence?.readiness.metrics).toContainEqual({ label: "Datasets", value: "not measured" });
  });

  it("shows every lane the Command Center claims, in the order the page shows them", () => {
    expect(getCommandCenterRoadmapWorkflowLaneKeys()).toEqual([
      "rtp",
      "grants",
      "engagement",
      "safety",
      "analysis-modeling",
      "data-evidence",
      "receivables",
      "aerial",
    ]);
  });

  it("files a queued command into the lane that owns it", () => {
    expect(
      classifyWorkflowNextAction(
        command({ key: "resolve-safety-crash-data-pulls", detail: "A crash data pull did not complete." })
      )
    ).toContain("safety");

    expect(
      classifyWorkflowNextAction(
        command({
          key: "resolve-knowledge-extraction-failures",
          detail: "An uploaded document is absent from every citation.",
        })
      )
    ).toContain("data-evidence");

    // A client invoice is money owed TO this workspace. Grants tracks the other
    // direction, and both say "invoice" — so the receivable reading has to win,
    // or the Grants lane silently absorbs the receivables lane.
    const receivableGroups = classifyWorkflowNextAction(
      command({
        key: "advance-client-invoice-drafts",
        title: "Advance draft client invoices",
        detail: "1 client invoice is still in draft, so the work behind it is unbilled.",
      })
    );
    expect(receivableGroups).toContain("receivables");
    expect(receivableGroups).not.toContain("grants");

    // …while a grant reimbursement claim still belongs to Grants.
    expect(
      classifyWorkflowNextAction(
        command({
          key: "advance-project-reimbursement-invoicing",
          moduleKey: "grants",
          detail: "Move the reimbursement invoice through billing triage.",
        })
      )
    ).toContain("grants");
  });

  it("says a lane was not read rather than that it is clear when a caller loaded no observations", async () => {
    const supabase = createSupabaseStub({});
    const summary = await loadWorkspaceOperationsSummaryForWorkspace(supabase, "workspace-1");
    const groups = buildWorkflowNextActionGroups({ ...summary, moduleObservations: undefined });

    expect(workflowGroupsCoverCommandCenterRoadmapLanes(groups)).toBe(true);
    expect(groups.find((group) => group.key === "safety")?.readiness).toMatchObject({
      label: "Not read into this board",
      tone: "neutral",
    });
    expect(groups.find((group) => group.key === "safety")?.readiness.detail).toMatch(
      /did not load safety crash data/i
    );
    expect(groups.find((group) => group.key === "receivables")?.readiness.label).toBe(
      "Not read into this board"
    );
  });
});

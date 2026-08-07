import { describe, expect, it } from "vitest";

import { buildAssistantOperations } from "@/lib/assistant/operations";
import {
  loadWorkspaceOperationsSummaryForWorkspace,
  type WorkspaceOperationsSupabaseLike,
} from "@/lib/operations/workspace-summary";
import type { AssistantQuickLink } from "@/lib/assistant/catalog";
import type { WorkspaceAssistantContext } from "@/lib/assistant/context";

/**
 * CAN A PLANNER ACTUALLY REACH `create_survey_question_draft`? — asked of a
 * workspace summary the product really produces, never of a described one.
 *
 * `record_stage_gate_hold` shipped with a call site whose condition NO REAL
 * STATE COULD SATISFY: it required a gate that was `not_started` and also
 * carried `missingArtifacts`, which the summary builder copies off the latest
 * decision row — so `not_started` forces it empty. Its reachability test passed
 * anyway, because the fixture hand-described a board the product cannot emit.
 * The assertion was true and the feature was unreachable by anyone.
 *
 * So the summary here is built by `loadWorkspaceOperationsSummaryForWorkspace`
 * running over stubbed PostgREST results — the same path the dashboard takes —
 * and the quick links are built by `buildAssistantOperations` from what it
 * produced. If the count the offer keys on cannot come out of the real builder,
 * this file fails rather than agreeing with itself.
 */

const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";

type StubTable = unknown[] | { rows?: unknown[]; count?: number | null; error?: { message: string } };

function createSupabaseStub(dataByTable: Record<string, StubTable>) {
  const buildResult = (table: string) => {
    const entry = dataByTable[table];
    if (entry === undefined || Array.isArray(entry)) {
      const rows = entry ?? [];
      return { data: rows, count: rows.length, error: null };
    }
    if (entry.error) return { data: null, count: null, error: entry.error };
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

const ACTIVE_CAMPAIGN = {
  id: "22222222-2222-4222-8222-222222222222",
  title: "Corridor listening sessions",
  status: "active",
  updated_at: "2026-08-01T10:00:00.000Z",
};

async function summaryWith(surveyQuestions: StubTable) {
  return loadWorkspaceOperationsSummaryForWorkspace(
    createSupabaseStub({
      engagement_campaigns: [ACTIVE_CAMPAIGN],
      engagement_survey_questions: surveyQuestions,
    }),
    WORKSPACE_ID
  );
}

/**
 * The rest of a workspace context, held constant. Only the engagement lane
 * varies between cases, so anything that changes here is a change to what the
 * offer depends on — which is what a reader of this file needs to be able to
 * see.
 */
function contextWith(
  operationsSummary: Awaited<ReturnType<typeof loadWorkspaceOperationsSummaryForWorkspace>>
): WorkspaceAssistantContext {
  return {
    kind: "workspace",
    workspace: { id: WORKSPACE_ID, name: "Test RTPA", plan: null },
    counts: {
      projects: 0,
      plans: 0,
      reports: 0,
      runs: 0,
      datasets: 0,
      engagementCampaigns: 1,
    },
    recentProject: null,
    recentReport: null,
    recentRun: null,
    transit: { readable: true, staleRefetchableFeed: null, feeds: [] },
    operationsSummary,
  } as unknown as WorkspaceAssistantContext;
}

function findSurveyDraftLink(links: AssistantQuickLink[]): AssistantQuickLink | undefined {
  return links.find((link) => link.executeAction?.kind === "create_survey_question_draft");
}

describe("the survey-draft offer reaches a planner", () => {
  it("offers to draft a question for an active campaign that asks none", async () => {
    const summary = await summaryWith({ rows: [], count: 0 });

    // The precondition, asserted against the REAL builder's output rather than
    // assumed: if this stops being 0 the offer below is testing nothing.
    expect(summary.moduleObservations?.engagement.leadActiveCampaignLiveSurveyQuestions).toBe(0);

    const link = findSurveyDraftLink(buildAssistantOperations(contextWith(summary)));

    expect(link, "no quick link exposes create_survey_question_draft").toBeDefined();
    expect(link?.href).toBe(`/engagement/${ACTIVE_CAMPAIGN.id}`);
    expect(link?.executeAction).toMatchObject({
      kind: "create_survey_question_draft",
      workspaceId: WORKSPACE_ID,
      campaignId: ACTIVE_CAMPAIGN.id,
    });
    // The approval tier is what puts it in front of a person at all.
    expect(link?.approval).toBe("approval_required");
  });

  it("says what a draft is, where the planner will read the offer", async () => {
    const summary = await summaryWith({ rows: [], count: 0 });
    const link = findSurveyDraftLink(buildAssistantOperations(contextWith(summary)));

    // A planner approving this must be able to tell, from the offer, that
    // nothing becomes public. If that has to be inferred, the separation
    // between approving and publishing is not doing the work it is here for.
    expect(link?.auditNote).toMatch(/unpublished draft/i);
    expect(link?.auditNote).toMatch(/no participant sees it/i);
    expect(link?.reason).toMatch(/publish/i);
  });

  it("does not offer when the campaign already asks something", async () => {
    const summary = await summaryWith({ rows: [], count: 4 });

    expect(summary.moduleObservations?.engagement.leadActiveCampaignLiveSurveyQuestions).toBe(4);
    expect(findSurveyDraftLink(buildAssistantOperations(contextWith(summary)))).toBeUndefined();
  });

  it("does not offer when the count could not be read", async () => {
    // THE CASE THAT MATTERS MOST. An unreadable count is not a zero, and a
    // copilot that offered to write a survey here would be acting on a state it
    // never saw — it might be proposing questions for a campaign that already
    // has twenty.
    const summary = await summaryWith({ error: { message: "permission denied" } });

    expect(summary.moduleObservations?.engagement.leadActiveCampaignLiveSurveyQuestions).toBeNull();
    expect(summary.moduleObservations?.unreadable).toContainEqual(
      expect.objectContaining({ label: "the lead campaign's survey questions" })
    );
    expect(findSurveyDraftLink(buildAssistantOperations(contextWith(summary)))).toBeUndefined();
  });

  it("does not offer when no campaign is collecting input", async () => {
    const summary = await loadWorkspaceOperationsSummaryForWorkspace(
      createSupabaseStub({
        engagement_campaigns: [{ ...ACTIVE_CAMPAIGN, status: "closed" }],
        engagement_survey_questions: { rows: [], count: 0 },
      }),
      WORKSPACE_ID
    );

    expect(summary.moduleObservations?.engagement.leadActiveCampaign).toBeNull();
    // Null, not zero: there was no campaign to count questions for, and the
    // absence of a campaign must not read as a campaign with no questions.
    expect(summary.moduleObservations?.engagement.leadActiveCampaignLiveSurveyQuestions).toBeNull();
    expect(findSurveyDraftLink(buildAssistantOperations(contextWith(summary)))).toBeUndefined();
  });
});

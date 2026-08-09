import {
  createRtpPacketRecord,
  generateReportArtifact,
} from "@/lib/reports/client";
import type { AssistantQuickLinkExecuteAction } from "@/lib/assistant/catalog";
import {
  getActionMetadata,
  type RegroundingMode,
} from "@/lib/runtime/action-metadata";

export type ActionRecord<K extends AssistantQuickLinkExecuteAction["kind"]> = {
  kind: K;
  effect: (
    action: Extract<AssistantQuickLinkExecuteAction, { kind: K }>,
    context: ActionEffectContext
  ) => Promise<void>;
};

export type AssistantActionApprovalEvidence = {
  approvalId?: string | null;
  inputHash: string;
  executionSource: "planner_agent_quick_link";
};

export type ActionEffectContext = {
  approvalEvidence?: AssistantActionApprovalEvidence | null;
};

function approvalHeaders(context: ActionEffectContext): Record<string, string> {
  if (!context.approvalEvidence) return {};
  return {
    "x-openplan-assistant-execution-source": context.approvalEvidence.executionSource,
    "x-openplan-assistant-input-hash": context.approvalEvidence.inputHash,
    ...(context.approvalEvidence.approvalId
      ? { "x-openplan-assistant-approval-id": context.approvalEvidence.approvalId }
      : {}),
  };
}

async function postJson(path: string, body: unknown, errorLabel: string, context: ActionEffectContext): Promise<void> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...approvalHeaders(context) },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? errorLabel);
  }
}

async function patchJson(path: string, body: unknown, errorLabel: string, context: ActionEffectContext): Promise<void> {
  const response = await fetch(path, {
    method: "PATCH",
    headers: { "content-type": "application/json", ...approvalHeaders(context) },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? errorLabel);
  }
}

const GENERATE_REPORT_ARTIFACT: ActionRecord<"generate_report_artifact"> = {
  kind: "generate_report_artifact",
  effect: async (action, context) => {
    await generateReportArtifact(action.reportId, { headers: approvalHeaders(context) });
  },
};

const CREATE_RTP_PACKET_RECORD: ActionRecord<"create_rtp_packet_record"> = {
  kind: "create_rtp_packet_record",
  effect: async (action, context) => {
    await createRtpPacketRecord({
      rtpCycleId: action.rtpCycleId,
      modelingCountyRunId: action.modelingCountyRunId,
      generateAfterCreate: action.generateAfterCreate,
      headers: approvalHeaders(context),
    });
  },
};

const CREATE_FUNDING_OPPORTUNITY: ActionRecord<"create_funding_opportunity"> = {
  kind: "create_funding_opportunity",
  effect: async (action, context) => {
    await postJson(
      "/api/funding-opportunities",
      {
        programId: action.programId,
        projectId: action.projectId,
        title: action.title,
      },
      "Failed to create funding opportunity",
      context
    );
  },
};

const CREATE_PROJECT_FUNDING_PROFILE: ActionRecord<"create_project_funding_profile"> = {
  kind: "create_project_funding_profile",
  effect: async (action, context) => {
    await patchJson(
      `/api/projects/${action.projectId}/funding-profile`,
      {
        fundingNeedAmount: null,
        localMatchNeedAmount: null,
        notes:
          action.notes ??
          "Planner Agent created this funding profile anchor. Add funding need and local match next.",
      },
      "Failed to create project funding profile",
      context
    );
  },
};

const UPDATE_FUNDING_OPPORTUNITY_DECISION: ActionRecord<"update_funding_opportunity_decision"> = {
  kind: "update_funding_opportunity_decision",
  effect: async (action, context) => {
    await patchJson(
      `/api/funding-opportunities/${action.opportunityId}`,
      { decisionState: action.decisionState },
      "Failed to update funding opportunity decision",
      context
    );
  },
};

const LINK_BILLING_INVOICE_FUNDING_AWARD: ActionRecord<"link_billing_invoice_funding_award"> = {
  kind: "link_billing_invoice_funding_award",
  effect: async (action, context) => {
    await patchJson(
      `/api/invoicing/invoices/${action.invoiceId}`,
      {
        workspaceId: action.workspaceId,
        fundingAwardId: action.fundingAwardId,
      },
      "Failed to link billing invoice to funding award",
      context
    );
  },
};

const CREATE_PROJECT_RECORD: ActionRecord<"create_project_record"> = {
  kind: "create_project_record",
  effect: async (action, context) => {
    await postJson(
      `/api/projects/${action.projectId}/records`,
      {
        recordType: action.recordType,
        title: action.title,
        submittalType: action.submittalType,
        status: action.status,
        notes: action.notes,
      },
      "Failed to create project record",
      context
    );
  },
};

const RECORD_STAGE_GATE_HOLD: ActionRecord<"record_stage_gate_hold"> = {
  kind: "record_stage_gate_hold",
  effect: async (action, context) => {
    await postJson(
      "/api/stage-gates/decisions",
      {
        workspaceId: action.workspaceId,
        projectId: action.projectId,
        gateId: action.gateId,
        // Literal, never read off the payload. The payload has no `decision`
        // field to read (see the union variant), and writing the constant here
        // means the ONLY value this effect can transmit is HOLD — including if a
        // future payload gains one.
        decision: "HOLD",
        rationale: action.rationale,
        missingArtifacts: action.missingArtifacts,
        runId: action.runId,
        modelRunId: action.modelRunId,
        countyRunId: action.countyRunId,
      },
      "Failed to record the stage-gate hold",
      context
    );
  },
};

const LAUNCH_MODEL_RUN: ActionRecord<"launch_model_run"> = {
  kind: "launch_model_run",
  effect: async (action, context) => {
    /**
     * The body carries the workspace and NOTHING ELSE, because the route reads
     * nothing else. Study area, engine and zone geography live on the run row a
     * person created; there is no field here to override them with, and adding
     * one would be a change to what an agent may decide about a model — see the
     * union variant in catalog.ts.
     *
     * The path is a TEMPLATE LITERAL on purpose. `action-route-resolution.ts`
     * regexes `effect.toString()` for `/api/…` literals to decide which route
     * this action targets; a path assembled from a variable resolves to zero
     * paths, and both the approval-verification guard and the claim-tier guard
     * would then check nothing while reporting success.
     */
    await postJson(
      `/api/models/${action.modelId}/runs/${action.modelRunId}/launch`,
      { workspaceId: action.workspaceId },
      "Failed to launch the model run",
      context
    );
  },
};

const REFRESH_GTFS_FEED: ActionRecord<"refresh_gtfs_feed"> = {
  kind: "refresh_gtfs_feed",
  effect: async (action, context) => {
    /**
     * The body carries the workspace and NOTHING ELSE.
     *
     * `adoptDespiteCollapse` is absent by construction: it is not on the union
     * variant, so there is no field to read, and it is not written here, so
     * there is no constant to flip. Both halves matter — an effect that read
     * `action.adoptDespiteCollapse` off a widened payload would be one type
     * change away from adopting every withheld refetch.
     *
     * The path is a TEMPLATE LITERAL on purpose. `action-route-resolution.ts`
     * regexes `effect.toString()` for `/api/…` literals to decide which route
     * this action targets; a path assembled from a variable resolves to zero
     * paths, and both the approval-verification guard and the claim-tier guard
     * would then check nothing while reporting success.
     */
    await postJson(
      `/api/gtfs/feeds/${action.gtfsFeedId}/refresh`,
      { workspaceId: action.workspaceId },
      "Failed to refresh the transit feed",
      context
    );
  },
};

const CREATE_SURVEY_QUESTION_DRAFT: ActionRecord<"create_survey_question_draft"> = {
  kind: "create_survey_question_draft",
  effect: async (action, context) => {
    /**
     * THE BODY CARRIES WORDING AND NOTHING ELSE.
     *
     * There is no `status` here, and that is the point: the route writes the
     * draft literal itself, keyed on the agent seam, so this effect has no
     * constant to flip and no field to widen. `required`, `sortOrder`,
     * `categoryId` and `config` are absent for the reasons the union variant
     * gives — each of them decides how a question is ASKED rather than what it
     * says, and each belongs to the person who publishes it.
     *
     * The path is a template literal so `action-route-resolution.ts` can regex
     * it out of `effect.toString()`. A path built from a variable resolves to
     * zero routes, and both the approval-verification guard and the claim-tier
     * guard would then check nothing while reporting success.
     */
    await postJson(
      `/api/engagement/campaigns/${action.campaignId}/survey/questions`,
      {
        questionType: action.questionType,
        prompt: action.prompt,
        ...(action.helpText ? { helpText: action.helpText } : {}),
      },
      "Failed to draft the survey question",
      context
    );
  },
};

type ActionRegistry = {
  [K in AssistantQuickLinkExecuteAction["kind"]]: ActionRecord<K>;
};

export const ACTION_REGISTRY: ActionRegistry = {
  generate_report_artifact: GENERATE_REPORT_ARTIFACT,
  create_rtp_packet_record: CREATE_RTP_PACKET_RECORD,
  create_funding_opportunity: CREATE_FUNDING_OPPORTUNITY,
  create_project_funding_profile: CREATE_PROJECT_FUNDING_PROFILE,
  update_funding_opportunity_decision: UPDATE_FUNDING_OPPORTUNITY_DECISION,
  link_billing_invoice_funding_award: LINK_BILLING_INVOICE_FUNDING_AWARD,
  create_project_record: CREATE_PROJECT_RECORD,
  record_stage_gate_hold: RECORD_STAGE_GATE_HOLD,
  refresh_gtfs_feed: REFRESH_GTFS_FEED,
  launch_model_run: LAUNCH_MODEL_RUN,
  create_survey_question_draft: CREATE_SURVEY_QUESTION_DRAFT,
};

export function getActionRecord<K extends AssistantQuickLinkExecuteAction["kind"]>(
  kind: K
): ActionRecord<K> & ReturnType<typeof getActionMetadata<K>> {
  return { ...getActionMetadata(kind), ...ACTION_REGISTRY[kind] };
}

export const MAX_REGROUNDING_DEPTH = 2;

export type ActionExecutionHost = {
  onCompleted: (context: { regrounding: RegroundingMode }) => void | Promise<void>;
  onRegroundingResult?: (refreshedPreviewQuickLinks: unknown) => void | Promise<void>;
  onPostActionPromptSkipped?: (context: {
    reason: "depth_exceeded";
    depth: number;
    maxDepth: number;
  }) => void | Promise<void>;
  refreshAssistantPreview?: () => Promise<{ quickLinks: unknown } | null | undefined>;
  submitPostActionPrompt?: (args: {
    postActionWorkflowId?: string;
    postActionPrompt?: string;
    postActionPromptLabel?: string;
    refreshedPreviewQuickLinks: unknown;
    regroundingDepth: number;
  }) => Promise<void>;
};

export type ExecuteActionOptions = {
  regroundingDepth?: number;
  approvalEvidence?: AssistantActionApprovalEvidence | null;
};

export async function executeAction<K extends AssistantQuickLinkExecuteAction["kind"]>(
  action: Extract<AssistantQuickLinkExecuteAction, { kind: K }>,
  host: ActionExecutionHost,
  options: ExecuteActionOptions = {}
): Promise<void> {
  const record = getActionRecord<K>(action.kind as K);
  const regroundingDepth = Math.max(0, options.regroundingDepth ?? 0);

  if (record.approval === "approval_required" && !options.approvalEvidence?.approvalId) {
    throw new Error("Approval evidence is required before executing this Planner Agent action.");
  }

  await record.effect(action, { approvalEvidence: options.approvalEvidence });

  await host.onCompleted({ regrounding: record.regrounding });

  let refreshedPreviewQuickLinks: unknown = null;
  if (record.regrounding === "refresh_preview" && host.refreshAssistantPreview) {
    const refreshed = await host.refreshAssistantPreview();
    refreshedPreviewQuickLinks = refreshed?.quickLinks ?? null;
    if (host.onRegroundingResult) {
      await host.onRegroundingResult(refreshedPreviewQuickLinks);
    }
  }

  const hasPostPrompt = Boolean(action.postActionWorkflowId || action.postActionPrompt);
  if (!hasPostPrompt || !host.submitPostActionPrompt) return;

  if (regroundingDepth >= MAX_REGROUNDING_DEPTH) {
    if (host.onPostActionPromptSkipped) {
      await host.onPostActionPromptSkipped({
        reason: "depth_exceeded",
        depth: regroundingDepth,
        maxDepth: MAX_REGROUNDING_DEPTH,
      });
    }
    return;
  }

  await host.submitPostActionPrompt({
    postActionWorkflowId: action.postActionWorkflowId,
    postActionPrompt: action.postActionPrompt,
    postActionPromptLabel: action.postActionPromptLabel,
    refreshedPreviewQuickLinks,
    regroundingDepth: regroundingDepth + 1,
  });
}

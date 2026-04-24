import {
  createRtpPacketRecord,
  generateReportArtifact,
} from "@/lib/reports/client";
import type { AssistantQuickLinkExecuteAction } from "@/lib/assistant/catalog";

export type ActionApproval = "safe" | "review" | "approval_required";
export type RegroundingMode = "refresh_preview" | "none";

export type ActionRecord<K extends AssistantQuickLinkExecuteAction["kind"]> = {
  kind: K;
  approval: ActionApproval;
  auditEvent: string;
  regrounding: RegroundingMode;
  effect: (
    action: Extract<AssistantQuickLinkExecuteAction, { kind: K }>
  ) => Promise<void>;
};

async function postJson(path: string, body: unknown, errorLabel: string): Promise<void> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? errorLabel);
  }
}

async function patchJson(path: string, body: unknown, errorLabel: string): Promise<void> {
  const response = await fetch(path, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? errorLabel);
  }
}

const GENERATE_REPORT_ARTIFACT: ActionRecord<"generate_report_artifact"> = {
  kind: "generate_report_artifact",
  approval: "safe",
  auditEvent: "planner_agent.generate_report_artifact",
  regrounding: "refresh_preview",
  effect: async (action) => {
    await generateReportArtifact(action.reportId);
  },
};

const CREATE_RTP_PACKET_RECORD: ActionRecord<"create_rtp_packet_record"> = {
  kind: "create_rtp_packet_record",
  approval: "safe",
  auditEvent: "planner_agent.create_rtp_packet_record",
  regrounding: "refresh_preview",
  effect: async (action) => {
    await createRtpPacketRecord({
      rtpCycleId: action.rtpCycleId,
      modelingCountyRunId: action.modelingCountyRunId,
      generateAfterCreate: action.generateAfterCreate,
    });
  },
};

const CREATE_FUNDING_OPPORTUNITY: ActionRecord<"create_funding_opportunity"> = {
  kind: "create_funding_opportunity",
  approval: "review",
  auditEvent: "planner_agent.create_funding_opportunity",
  regrounding: "none",
  effect: async (action) => {
    await postJson(
      "/api/funding-opportunities",
      {
        programId: action.programId,
        projectId: action.projectId,
        title: action.title,
      },
      "Failed to create funding opportunity"
    );
  },
};

const CREATE_PROJECT_FUNDING_PROFILE: ActionRecord<"create_project_funding_profile"> = {
  kind: "create_project_funding_profile",
  approval: "review",
  auditEvent: "planner_agent.create_project_funding_profile",
  regrounding: "none",
  effect: async (action) => {
    await patchJson(
      `/api/projects/${action.projectId}/funding-profile`,
      {
        fundingNeedAmount: null,
        localMatchNeedAmount: null,
        notes:
          action.notes ??
          "Planner Agent created this funding profile anchor. Add funding need and local match next.",
      },
      "Failed to create project funding profile"
    );
  },
};

const UPDATE_FUNDING_OPPORTUNITY_DECISION: ActionRecord<"update_funding_opportunity_decision"> = {
  kind: "update_funding_opportunity_decision",
  approval: "review",
  auditEvent: "planner_agent.update_funding_opportunity_decision",
  regrounding: "none",
  effect: async (action) => {
    await patchJson(
      `/api/funding-opportunities/${action.opportunityId}`,
      { decisionState: action.decisionState },
      "Failed to update funding opportunity decision"
    );
  },
};

const LINK_BILLING_INVOICE_FUNDING_AWARD: ActionRecord<"link_billing_invoice_funding_award"> = {
  kind: "link_billing_invoice_funding_award",
  approval: "review",
  auditEvent: "planner_agent.link_billing_invoice_funding_award",
  regrounding: "none",
  effect: async (action) => {
    await patchJson(
      `/api/billing/invoices/${action.invoiceId}`,
      {
        workspaceId: action.workspaceId,
        fundingAwardId: action.fundingAwardId,
      },
      "Failed to link billing invoice to funding award"
    );
  },
};

const CREATE_PROJECT_RECORD: ActionRecord<"create_project_record"> = {
  kind: "create_project_record",
  approval: "review",
  auditEvent: "planner_agent.create_project_record",
  regrounding: "none",
  effect: async (action) => {
    await postJson(
      `/api/projects/${action.projectId}/records`,
      {
        recordType: action.recordType,
        title: action.title,
        submittalType: action.submittalType,
        status: action.status,
        notes: action.notes,
      },
      "Failed to create project record"
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
};

export function getActionRecord<K extends AssistantQuickLinkExecuteAction["kind"]>(
  kind: K
): ActionRecord<K> {
  return ACTION_REGISTRY[kind];
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
};

export async function executeAction<K extends AssistantQuickLinkExecuteAction["kind"]>(
  action: Extract<AssistantQuickLinkExecuteAction, { kind: K }>,
  host: ActionExecutionHost,
  options: ExecuteActionOptions = {}
): Promise<void> {
  const record = getActionRecord<K>(action.kind as K);
  const regroundingDepth = Math.max(0, options.regroundingDepth ?? 0);

  await record.effect(action);

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

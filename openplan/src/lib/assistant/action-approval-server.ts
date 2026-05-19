import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { canonicalizeActionPayload, getActionMetadata } from "@/lib/runtime/action-metadata";

export const ASSISTANT_ACTION_APPROVAL_TTL_MS = 5 * 60 * 1000;
export const ASSISTANT_ACTION_EXECUTION_SOURCE = "planner_agent_quick_link";

export const assistantApprovalActionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("generate_report_artifact"),
    reportId: z.string().min(1),
    postActionWorkflowId: z.string().optional(),
    postActionPrompt: z.string().optional(),
    postActionPromptLabel: z.string().optional(),
  }),
  z.object({
    kind: z.literal("create_rtp_packet_record"),
    rtpCycleId: z.string().min(1),
    modelingCountyRunId: z.string().nullable().optional(),
    generateAfterCreate: z.boolean().optional(),
    postActionWorkflowId: z.string().optional(),
    postActionPrompt: z.string().optional(),
    postActionPromptLabel: z.string().optional(),
  }),
  z.object({
    kind: z.literal("create_funding_opportunity"),
    programId: z.string().optional(),
    projectId: z.string().optional(),
    title: z.string().min(1),
    postActionWorkflowId: z.string().optional(),
    postActionPrompt: z.string().optional(),
    postActionPromptLabel: z.string().optional(),
  }),
  z.object({
    kind: z.literal("create_project_funding_profile"),
    projectId: z.string().min(1),
    notes: z.string().optional(),
    postActionWorkflowId: z.string().optional(),
    postActionPrompt: z.string().optional(),
    postActionPromptLabel: z.string().optional(),
  }),
  z.object({
    kind: z.literal("update_funding_opportunity_decision"),
    opportunityId: z.string().min(1),
    decisionState: z.enum(["monitor", "pursue", "skip"]),
    postActionWorkflowId: z.string().optional(),
    postActionPrompt: z.string().optional(),
    postActionPromptLabel: z.string().optional(),
  }),
  z.object({
    kind: z.literal("create_project_record"),
    projectId: z.string().min(1),
    recordType: z.literal("submittal"),
    title: z.string().min(1),
    submittalType: z
      .enum(["authorization_packet", "invoice_backup", "environmental_package", "hearing_record", "ps_e", "reimbursement", "progress_report", "other"])
      .optional(),
    status: z.enum(["draft", "internal_review", "submitted", "accepted", "revise_and_resubmit"]).optional(),
    notes: z.string().optional(),
    postActionWorkflowId: z.string().optional(),
    postActionPrompt: z.string().optional(),
    postActionPromptLabel: z.string().optional(),
  }),
  z.object({
    kind: z.literal("link_billing_invoice_funding_award"),
    workspaceId: z.string().min(1),
    invoiceId: z.string().min(1),
    fundingAwardId: z.string().min(1),
    postActionWorkflowId: z.string().optional(),
    postActionPrompt: z.string().optional(),
    postActionPromptLabel: z.string().optional(),
  }),
]);

export type AssistantApprovalAction = z.infer<typeof assistantApprovalActionSchema>;

export function hashAssistantActionPayload(action: unknown): string {
  return createHash("sha256").update(canonicalizeActionPayload(action)).digest("hex");
}

export function readAssistantExecutionSource(request: NextRequest): "manual" | "planner_agent_quick_link" {
  return request.headers.get("x-openplan-assistant-execution-source") === ASSISTANT_ACTION_EXECUTION_SOURCE
    ? ASSISTANT_ACTION_EXECUTION_SOURCE
    : "manual";
}

export type AssistantApprovalVerification = {
  approvalId: string | null;
  inputHash: string | null;
  executionSource: "manual" | "planner_agent_quick_link";
};

export async function verifyAssistantActionApproval(params: {
  request: NextRequest;
  serviceSupabase: Pick<SupabaseClient, "from">;
  userId: string;
  workspaceId: string | null;
  action: AssistantApprovalAction;
}): Promise<AssistantApprovalVerification> {
  const executionSource = readAssistantExecutionSource(params.request);
  const inputHash = hashAssistantActionPayload(params.action);

  if (executionSource !== ASSISTANT_ACTION_EXECUTION_SOURCE) {
    return { approvalId: null, inputHash: null, executionSource };
  }

  const metadata = getActionMetadata(params.action.kind);
  const headerHash = params.request.headers.get("x-openplan-assistant-input-hash")?.trim() ?? null;
  if (metadata.approval !== "approval_required") {
    return { approvalId: null, inputHash: headerHash ?? inputHash, executionSource };
  }

  if (headerHash !== inputHash) {
    throw new Error("Planner Agent approval hash mismatch.");
  }

  const approvalId = params.request.headers.get("x-openplan-assistant-approval-id")?.trim() ?? null;
  if (!approvalId) {
    throw new Error("Planner Agent approval evidence is missing.");
  }

  const { data, error } = await params.serviceSupabase
    .from("assistant_action_approvals")
    .select("id, workspace_id, user_id, action_kind, input_hash, expires_at, consumed_at")
    .eq("id", approvalId)
    .maybeSingle();

  if (error || !data) {
    throw new Error("Planner Agent approval evidence was not found.");
  }

  if (
    data.user_id !== params.userId ||
    data.workspace_id !== params.workspaceId ||
    data.action_kind !== params.action.kind ||
    data.input_hash !== inputHash ||
    data.consumed_at ||
    Date.parse(data.expires_at) <= Date.now()
  ) {
    throw new Error("Planner Agent approval evidence is invalid or expired.");
  }

  const { error: consumeError } = await params.serviceSupabase
    .from("assistant_action_approvals")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", approvalId)
    .is("consumed_at", null);

  if (consumeError) {
    throw new Error("Planner Agent approval evidence could not be consumed.");
  }

  return { approvalId, inputHash, executionSource };
}

export function newAssistantApprovalId(): string {
  return randomUUID();
}

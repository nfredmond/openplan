import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { NextRequest } from "next/server";
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

type AssistantActionApprovalRow = {
  id: string;
  workspace_id: string | null;
  user_id: string;
  action_kind: string;
  input_hash: string;
  expires_at: string;
  consumed_at: string | null;
};

type AssistantApprovalSupabaseLike = {
  from(table: "assistant_action_approvals" | string): unknown;
};

export async function verifyAssistantActionApproval(params: {
  request: NextRequest;
  serviceSupabase: AssistantApprovalSupabaseLike;
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
    // Always record the server-computed hash — the client header is unverified
    // and must not be able to write a spoofed hash into the audit row.
    return { approvalId: null, inputHash, executionSource };
  }

  if (headerHash !== inputHash) {
    throw new Error("Planner Agent approval hash mismatch.");
  }

  const approvalId = params.request.headers.get("x-openplan-assistant-approval-id")?.trim() ?? null;
  if (!approvalId) {
    throw new Error("Planner Agent approval evidence is missing.");
  }

  const approvalTable = params.serviceSupabase.from("assistant_action_approvals") as {
    select(columns: string): {
      eq(column: string, value: unknown): {
        maybeSingle(): PromiseLike<{
          data: AssistantActionApprovalRow | null;
          error: { message?: string } | null;
        }>;
      };
    };
    update(values: Record<string, unknown>): {
      eq(column: string, value: unknown): {
        is(column: string, value: unknown): {
          select(columns: string): PromiseLike<{
            data: Array<{ id: string }> | null;
            error: { message?: string } | null;
          }>;
        };
      };
    };
  };

  const { data, error } = await approvalTable
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

  // Single-use consume. `UPDATE ... WHERE consumed_at IS NULL` is atomic — only the
  // request that actually flips the row from null gets a row back. We MUST check
  // rows-affected: PostgREST returns no error for a zero-row update, so without this a
  // request that lost the race (its earlier read still saw consumed_at = null) would
  // return success and double-spend the approval on a consequential action.
  const { data: consumedRows, error: consumeError } = await approvalTable
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", approvalId)
    .is("consumed_at", null)
    .select("id");

  if (consumeError) {
    throw new Error("Planner Agent approval evidence could not be consumed.");
  }

  if (!consumedRows || consumedRows.length !== 1) {
    throw new Error("Planner Agent approval evidence was already consumed.");
  }

  return { approvalId, inputHash, executionSource };
}

export function newAssistantApprovalId(): string {
  return randomUUID();
}

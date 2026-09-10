import type { SupabaseClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { canonicalizeActionPayload } from "@/lib/runtime/action-metadata";
import { executedActionPayload, hashAssistantActionPayload, type AssistantApprovalAction } from "./action-approval-server";
import { HoldReceiptError as ActionReceiptError } from "./stage-gate-hold-receipt";

export type ProjectSubmittalAction = Extract<AssistantApprovalAction, { kind: "create_project_record" }>;
const executableSchema = z.object({
  kind: z.literal("create_project_record"), projectId: z.string().uuid(), recordType: z.literal("submittal"),
  title: z.string().trim().min(1).max(160), notes: z.string().trim().max(4000).optional(),
  submittalType: z.enum(["authorization_packet", "invoice_backup", "environmental_package", "hearing_record", "ps_e", "reimbursement", "progress_report", "other"]).optional(),
  status: z.enum(["draft", "internal_review", "submitted", "accepted", "revise_and_resubmit"]).optional(),
}).strict();
export const SUBMITTAL_PROJECT_COLUMNS = "id, workspace_id, name";
const receiptSchema = z.object({
  schemaVersion: z.literal(1), recordType: z.literal("submittal"),
  record: z.object({
    id: z.string().uuid(), project_id: z.string().uuid(), title: z.string(), submittal_type: z.string(), status: z.string(),
    notes: z.string().nullable(), created_by: z.string().uuid(), created_at: z.string(),
    agency_label: z.null(), assignee_user_id: z.null(), reference_number: z.null(), due_date: z.null(), submitted_at: z.null(), review_cycle: z.literal(1),
  }).passthrough(),
});
export type SubmittalReceipt = z.infer<typeof receiptSchema>;

/** Normalize only what the existing submittal effect writes; refuse unexecutable consent before minting it. */
export function executableProjectSubmittalAction(action: ProjectSubmittalAction) {
  const parsed = executableSchema.safeParse(executedActionPayload(action));
  if (!parsed.success) throw new ActionReceiptError("Invalid approved project submittal request.", 400);
  return parsed.data;
}

/** Capture the named project and original scope; a later rename does not re-author the approval. */
export async function prepareSubmittalExecutionContext(supabase: Pick<SupabaseClient, "from">, workspaceId: string | null, rawAction: ProjectSubmittalAction) {
  if (!workspaceId) throw new ActionReceiptError("A project submittal requires a workspace.", 403);
  const action = executableProjectSubmittalAction(rawAction);
  const { data, error } = await supabase.from("projects").select(SUBMITTAL_PROJECT_COLUMNS)
    .eq("id", action.projectId).eq("workspace_id", workspaceId).maybeSingle();
  if (error) throw new ActionReceiptError("The submittal project could not be read.", 503);
  if (!data) throw new ActionReceiptError("The project is not in this workspace.", 404);
  const project = z.object({ id: z.string().uuid(), workspace_id: z.string().uuid(), name: z.string().min(1) }).safeParse(data);
  if (!project.success || project.data.id !== action.projectId || project.data.workspace_id !== workspaceId) {
    throw new ActionReceiptError("The submittal project could not be verified.", 503);
  }
  return { version: 1, action, project: { id: project.data.id, workspaceId, name: project.data.name } };
}

/** Rebuild the action from parsed route fields before accepting any approval header. */
export function submittalApprovalHeaders(request: NextRequest, action: ProjectSubmittalAction) {
  const inputHash = hashAssistantActionPayload(executableProjectSubmittalAction(action));
  const approvalId = request.headers.get("x-openplan-assistant-approval-id")?.trim();
  if (!approvalId || !z.string().uuid().safeParse(approvalId).success || request.headers.get("x-openplan-assistant-input-hash")?.trim() !== inputHash) {
    throw new ActionReceiptError("Planner Agent approval evidence does not match this request.", 403);
  }
  return { approvalId, inputHash };
}

function databaseFailure(error: { code?: string; message: string }): never {
  if (error.code === "42501") throw new ActionReceiptError(error.message, 403);
  if (error.code === "PT409") throw new ActionReceiptError(error.message, 409);
  if (error.code === "22023") throw new ActionReceiptError(error.message, 400);
  if (error.code === "PGRST202" || error.code === "42883") throw new ActionReceiptError("Apply the pending database upgrade before running this approved action.", 503);
  throw new ActionReceiptError("The saved submittal could not be confirmed. Check its receipt before trying again.", 503);
}

function validateReceipt(data: unknown, rawAction: ProjectSubmittalAction, userId: string): SubmittalReceipt {
  const action = executableProjectSubmittalAction(rawAction), parsed = receiptSchema.safeParse(data);
  if (!parsed.success || parsed.data.record.project_id !== action.projectId || parsed.data.record.created_by !== userId
    || parsed.data.record.title !== action.title || parsed.data.record.notes !== (action.notes ?? null)
    || parsed.data.record.status !== (action.status ?? "draft") || parsed.data.record.submittal_type !== (action.submittalType ?? "other")) {
    throw new ActionReceiptError("The submittal returned no verified original result.", 503);
  }
  return parsed.data;
}

type ReceiptParams = { supabase: Pick<SupabaseClient, "rpc">; userId: string; approvalId: string; inputHash: string; action: ProjectSubmittalAction };

/** Read the original approval scope under current membership, even when the project has since moved. */
export async function readSubmittalReceipt(params: ReceiptParams) {
  const action = executableProjectSubmittalAction(params.action);
  if (hashAssistantActionPayload(action) !== params.inputHash) throw new ActionReceiptError("Approved submittal hash does not match.", 403);
  const { data, error } = await params.supabase.rpc("read_assistant_action_receipt", {
    p_approval_id: params.approvalId, p_user_id: params.userId, p_input_hash: params.inputHash, p_action_kind: "create_project_record",
  });
  if (error) databaseFailure(error);
  const envelope = z.object({ workspaceId: z.string().uuid(), receipt: z.unknown() }).safeParse(data);
  if (!envelope.success) throw new ActionReceiptError("The submittal approval scope could not be verified.", 503);
  return { workspaceId: envelope.data.workspaceId, receipt: envelope.data.receipt === null ? null : validateReceipt(envelope.data.receipt, action, params.userId) };
}

/** Commit the submittal, original receipt and consumption together; no separate fallback insert is safe. */
export async function recordSubmittalWithReceipt(params: ReceiptParams & { workspaceId: string }) {
  const action = executableProjectSubmittalAction(params.action);
  if (hashAssistantActionPayload(action) !== params.inputHash) throw new ActionReceiptError("Approved submittal hash does not match.", 403);
  const { data, error } = await params.supabase.rpc("record_assistant_project_submittal", {
    p_approval_id: params.approvalId, p_user_id: params.userId, p_workspace_id: params.workspaceId,
    p_action_canonical: canonicalizeActionPayload(action),
  });
  if (error) databaseFailure(error);
  const envelope = z.object({ workspaceId: z.literal(params.workspaceId), receipt: z.unknown(), replayed: z.boolean() }).safeParse(data);
  if (!envelope.success) throw new ActionReceiptError("The saved submittal returned no verified receipt.", 503);
  return { receipt: validateReceipt(envelope.data.receipt, action, params.userId), replayed: envelope.data.replayed };
}

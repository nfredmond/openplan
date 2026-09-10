import type { SupabaseClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { canonicalizeActionPayload } from "@/lib/runtime/action-metadata";
import { lookupStageGateInTemplate } from "@/lib/stage-gates/gate-vocabulary";
import { resolveWorkspaceStageGateBinding, type StageGateTemplateBinding } from "@/lib/stage-gates/template-loader";
import { executedActionPayload, hashAssistantActionPayload, type AssistantApprovalAction } from "./action-approval-server";

export type StageGateHoldAction = Extract<AssistantApprovalAction, { kind: "record_stage_gate_hold" }>;
export const HOLD_WORKSPACE_COLUMNS = "id, stage_gate_template_id, stage_gate_template_selection, home_geography_source, home_geography_kind, home_geography_ref, home_country_code, home_subdivision_code";

export class HoldReceiptError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

/** Bind consent to the registered gate and the selection the workspace actually made. */
export function holdBindingSnapshot(binding: StageGateTemplateBinding, gateId: string) {
  const lookup = lookupStageGateInTemplate(binding.templateId, gateId);
  if (lookup.kind !== "gate") throw new HoldReceiptError("This stage gate is not registered for the workspace.", 409);
  return {
    templateId: lookup.templateId,
    templateVersion: lookup.templateVersion,
    templateSelection: binding.templateSelection,
    gateId: lookup.gate.gate_id,
    gateName: lookup.gate.name,
    gateSequence: lookup.gate.sequence,
  };
}

/** Capture current context when consent is prepared; execution compares it again under database locks. */
export async function prepareHoldExecutionContext(supabase: Pick<SupabaseClient, "from">, workspaceId: string | null, action: StageGateHoldAction) {
  if (!workspaceId || action.workspaceId !== workspaceId) throw new HoldReceiptError("Approval workspace does not match the stage-gate action.", 403);
  const { data: workspace, error: workspaceError } = await supabase.from("workspaces").select(HOLD_WORKSPACE_COLUMNS).eq("id", workspaceId).maybeSingle();
  if (workspaceError || !workspace) throw new HoldReceiptError("Cannot read the current workspace gate setup.", 503);
  const resolution = resolveWorkspaceStageGateBinding(workspace);
  if (resolution.kind !== "resolved") throw new HoldReceiptError("This workspace has no resolvable stage-gate template.", 409);
  const binding = holdBindingSnapshot(resolution.binding, action.gateId);
  const { data: project, error: projectError } = await supabase.from("projects").select("id, workspace_id").eq("id", action.projectId).eq("workspace_id", workspaceId).maybeSingle();
  if (projectError) throw new HoldReceiptError("Cannot read the stage-gate project.", 503);
  if (!project) throw new HoldReceiptError("The project is not in this workspace.", 404);
  const { data: prior, error: priorError } = await supabase.from("stage_gate_decisions").select("id")
    .eq("workspace_id", workspaceId).eq("project_id", action.projectId).eq("gate_id", action.gateId).eq("template_id", binding.templateId)
    .order("decided_at", { ascending: false }).order("id", { ascending: false }).limit(1).maybeSingle();
  if (priorError) throw new HoldReceiptError("Cannot read the current stage-gate decision.", 503);
  return { version: 1, workspace, binding, priorDecisionId: prior?.id ?? null };
}

const receiptSchema = z.object({
  schemaVersion: z.literal(1),
  decision: z.object({
    id: z.string().uuid(), workspace_id: z.string().uuid(), project_id: z.string().uuid(),
    gate_id: z.string().min(1), decision: z.literal("HOLD"), rationale: z.string().min(1),
    decided_by: z.string().uuid(), decided_at: z.string(),
    missing_artifacts: z.array(z.string()), run_id: z.string().uuid().nullable(),
    model_run_id: z.string().uuid().nullable(), county_run_id: z.string().uuid().nullable(),
  }).passthrough(),
});
export type HoldReceipt = z.infer<typeof receiptSchema>;

/** A route must rebuild the action from its parsed body before checking these headers. */
export function holdApprovalHeaders(request: NextRequest, action: StageGateHoldAction) {
  const inputHash = hashAssistantActionPayload(action);
  const approvalId = request.headers.get("x-openplan-assistant-approval-id")?.trim();
  if (!approvalId || !z.string().uuid().safeParse(approvalId).success || request.headers.get("x-openplan-assistant-input-hash")?.trim() !== inputHash) {
    throw new HoldReceiptError("Planner Agent approval evidence does not match this request.", 403);
  }
  return { approvalId, inputHash };
}

function databaseFailure(error: { code?: string; message: string }): never {
  if (error.code === "42501") throw new HoldReceiptError(error.message, 403);
  if (error.code === "PT409") throw new HoldReceiptError(error.message, 409);
  if (error.code === "PGRST202" || error.code === "42883") throw new HoldReceiptError("Apply the pending database upgrade before running this approved action.", 503);
  throw new HoldReceiptError("The saved action could not be confirmed. Check its receipt before trying again.", 503);
}

function validateReceipt(data: unknown, action: StageGateHoldAction, userId: string): HoldReceipt {
  const parsed = receiptSchema.safeParse(data);
  if (!parsed.success || parsed.data.decision.workspace_id !== action.workspaceId || parsed.data.decision.project_id !== action.projectId || parsed.data.decision.gate_id !== action.gateId || parsed.data.decision.rationale !== action.rationale || parsed.data.decision.decided_by !== userId ||
    canonicalizeActionPayload(parsed.data.decision.missing_artifacts) !== canonicalizeActionPayload(action.missingArtifacts ?? []) ||
    parsed.data.decision.run_id !== (action.runId ?? null) || parsed.data.decision.model_run_id !== (action.modelRunId ?? null) || parsed.data.decision.county_run_id !== (action.countyRunId ?? null)) {
    throw new HoldReceiptError("The saved action receipt could not be verified.", 503);
  }
  return parsed.data;
}

/** Read a retained result without spending approval or checking whether old context still permits new work. */
export async function readHoldReceipt(params: {
  supabase: Pick<SupabaseClient, "rpc">; approvalId: string; inputHash: string; userId: string; action: StageGateHoldAction;
}): Promise<HoldReceipt | null> {
  const { data, error } = await params.supabase.rpc("read_assistant_hold_receipt", {
    p_approval_id: params.approvalId, p_user_id: params.userId, p_workspace_id: params.action.workspaceId, p_input_hash: params.inputHash,
  });
  if (error) databaseFailure(error);
  return data === null ? null : validateReceipt(data, params.action, params.userId);
}

/** Commit one HOLD, its audit receipt and approval consumption in the same transaction. */
export async function recordHoldWithReceipt(params: {
  supabase: Pick<SupabaseClient, "rpc">; approvalId: string; userId: string; action: StageGateHoldAction;
  binding: ReturnType<typeof holdBindingSnapshot>;
}): Promise<{ receipt: HoldReceipt; replayed: boolean }> {
  const { data, error } = await params.supabase.rpc("record_assistant_stage_gate_hold", {
    p_approval_id: params.approvalId, p_user_id: params.userId, p_workspace_id: params.action.workspaceId,
    p_action_canonical: canonicalizeActionPayload(executedActionPayload(params.action)), p_binding: params.binding,
  });
  if (error) databaseFailure(error);
  const envelope = z.object({ receipt: z.unknown(), replayed: z.boolean() }).safeParse(data);
  if (!envelope.success) throw new HoldReceiptError("The saved action returned no verified receipt.", 503);
  return { receipt: validateReceipt(envelope.data.receipt, params.action, params.userId), replayed: envelope.data.replayed };
}

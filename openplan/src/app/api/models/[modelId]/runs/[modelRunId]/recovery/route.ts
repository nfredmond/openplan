import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { loadModelAccess } from "@/lib/models/api";
import { isWorkerExecutedRunMode } from "@/lib/models/run-modes";
import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { recoveryIdentitySchema, recoveryDecisionSchema, recoveryInspectionSchema, recoveryRpcArguments, matchesRecoveryReceipt } from "@/lib/models/recovery-decision";

const paramsSchema = z.object({ modelId: recoveryIdentitySchema, modelRunId: recoveryIdentitySchema });
type Context = { params: Promise<{ modelId: string; modelRunId: string }> };
const response = (error: string, status: number) => NextResponse.json({ error }, { status });

async function authorize(context: Context) {
  const params = paramsSchema.safeParse(await context.params);
  if (!params.success) return { response: response("Invalid model run route params", 400) };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { response: response("Unauthorized", 401) };
  const access = await loadModelAccess(supabase, params.data.modelId, user.id, "models.write");
  if (access.error) return { response: response("Model access could not be confirmed", 503) };
  if (!access.model) return { response: response("Model not found", 404) };
  if (!access.allowed || !access.membership || !["owner", "admin"].includes(access.membership.role)
      || access.membership.workspace_id !== access.model.workspace_id) {
    return { response: response("Recovery requires a workspace owner or administrator", 403) };
  }
  const { data: run, error } = await supabase.from("model_runs")
    .select("id, model_id, workspace_id, engine_key")
    .eq("id", params.data.modelRunId).eq("model_id", params.data.modelId).eq("workspace_id", access.model.workspace_id).maybeSingle();
  if (error) return { response: response("Model run access could not be confirmed", 503) };
  if (!run || run.id !== params.data.modelRunId || run.model_id !== params.data.modelId || run.workspace_id !== access.model.workspace_id) {
    return { response: response("Model run not found", 404) };
  }
  if (!isWorkerExecutedRunMode(run.engine_key)) return { response: response("This recovery command only applies to worker executions", 409) };
  return { runId: run.id as string, modelId: params.data.modelId, workspaceId: access.model.workspace_id, actorId: user.id };
}

export async function GET(request: NextRequest, context: Context) {
  const audit = createApiAuditLogger("model_runs.recovery.inspect", request);
  try {
    const access = await authorize(context);
    if (access.response) return access.response;
    const { data, error } = await createServiceRoleClient().rpc("inspect_model_run_recovery", {
      p_workspace_id: access.workspaceId, p_run_id: access.runId, p_actor_id: access.actorId,
    });
    const parsed = recoveryInspectionSchema.safeParse(data);
    if (error || !parsed.success || parsed.data.expected_state.workspace_id !== access.workspaceId
        || parsed.data.expected_state.run_id !== access.runId || parsed.data.expected_state.model_id !== access.modelId) {
      return response("Recovery inspection is unavailable", 503);
    }
    return NextResponse.json(parsed.data, { headers: { "Cache-Control": "no-store" } });
  } catch {
    audit.error("recovery_inspection_unavailable");
    return response("Recovery inspection is unavailable", 503);
  }
}

export async function POST(request: NextRequest, context: Context) {
  const audit = createApiAuditLogger("model_runs.recovery.decide", request);
  // No registered agent action covers this consequential decision yet. Refuse
  // explicit agent/approval headers instead of borrowing launch approval.
  for (const name of ["x-openplan-assistant-execution-source", "x-openplan-assistant-approval-id", "x-openplan-assistant-input-hash"]) {
    if (request.headers.has(name)) {
      audit.warn("recovery_agent_action_refused");
      return response("Planner Agent recovery decisions are not supported. An authorized operator must review this decision directly.", 403);
    }
  }
  try {
    const access = await authorize(context);
    if (access.response) return access.response;
    const body = await readJsonOrNullWithLimit(request, BODY_LIMITS.normalJson);
    if (!body.ok) return body.response;
    const parsed = recoveryDecisionSchema.safeParse(body.data);
    if (!parsed.success) return response("Invalid recovery decision", 400);
    const decision = parsed.data;
    if (decision.expectedState.workspace_id !== access.workspaceId || decision.expectedState.run_id !== access.runId
        || decision.expectedState.model_id !== access.modelId) return response("Recovery observation belongs to another model run", 409);
    const args = recoveryRpcArguments(decision, access.workspaceId, access.runId, access.actorId);
    const { data, error } = await createServiceRoleClient().rpc("abandon_model_run_execution", args);
    if (error?.code === "42501") return response("Recovery authority changed. Review workspace access.", 403);
    if (error?.message === "Model recovery state changed" || error?.message === "Model recovery requires nonterminal work") {
      return response("Execution state changed. Review it before making another decision.", 409);
    }
    if (error?.message === "Model recovery request identity reused with different payload") return response("This request identity belongs to a different decision", 409);
    if (error || !matchesRecoveryReceipt(data, args)) {
      audit.warn("recovery_decision_unconfirmed", { requestId: decision.requestId, runId: access.runId });
      return NextResponse.json({ error: "Recovery decision is unconfirmed. Retry the same saved request.", outcome: "recovery_unconfirmed", requestId: decision.requestId }, { status: 503 });
    }
    audit.info("recovery_decision_receipt", { requestId: decision.requestId, runId: access.runId, workspaceId: access.workspaceId, actorId: access.actorId });
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch {
    audit.error("recovery_decision_unconfirmed");
    return NextResponse.json({ error: "Recovery decision is unconfirmed. Retry the same saved request.", outcome: "recovery_unconfirmed" }, { status: 503 });
  }
}

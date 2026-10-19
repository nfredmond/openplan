import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireProviderBrowserOrigin } from "@/lib/assistant/provider-server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { loadModelAccess } from "@/lib/models/api";
import { isWorkerExecutedRunMode } from "@/lib/models/run-modes";
import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { replacementRpcArguments, replacementReceipt, type PopulationReplacementDecision } from '@/lib/models/recovery-decision';
import { replacementPreflight, dispatchPopulationReplacement } from '@/lib/models/population-replacement-server';
import { recoveryIdentitySchema, recoveryRequestSchema, recoveryInspectionSchema, recoveryRpcArguments, matchesRecoveryReceipt, historicalDecisionRpcArguments, matchesHistoricalDecisionReceipt, type HistoricalRunDecision } from "@/lib/models/recovery-decision";

const paramsSchema = z.object({ modelId: recoveryIdentitySchema, modelRunId: recoveryIdentitySchema });
type Context = { params: Promise<{ modelId: string; modelRunId: string }> };
const response = (error: string, status: number) => NextResponse.json({ error }, { status });

async function authorize(request: NextRequest, context: Context) {
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
  if (request.headers.get("x-openplan-expected-user") !== user.id || request.headers.get("x-openplan-expected-workspace") !== access.model.workspace_id) {
    return { response: response("The signed-in account or workspace changed. Reopen recovery from the current session.", 403) };
  }
  const { data: run, error } = await supabase.from("model_runs")
    .select("id, model_id, workspace_id, engine_key")
    .eq("id", params.data.modelRunId).eq("model_id", params.data.modelId).eq("workspace_id", access.model.workspace_id).maybeSingle();
  if (error) return { response: response("Model run access could not be confirmed", 503) };
  if (!run || run.id !== params.data.modelRunId || run.model_id !== params.data.modelId || run.workspace_id !== access.model.workspace_id) {
    return { response: response("Model run not found", 404) };
  }
  if (!isWorkerExecutedRunMode(run.engine_key)) return { response: response("This recovery command only applies to worker executions", 409) };
  return { runId: run.id as string, modelId: params.data.modelId, workspaceId: access.model.workspace_id, actorId: user.id, engineKey: run.engine_key as string };
}

export async function GET(request: NextRequest, context: Context) {
  const audit = createApiAuditLogger("model_runs.recovery.inspect", request);
  try {
    const access = await authorize(request, context);
    if (access.response) return access.response;
    const { data, error } = await createServiceRoleClient().rpc("inspect_model_run_recovery", {
      p_workspace_id: access.workspaceId, p_run_id: access.runId, p_actor_id: access.actorId,
    });
    const parsed = recoveryInspectionSchema.safeParse(data);
    if (error || !parsed.success || parsed.data.expected_state.workspace_id !== access.workspaceId
        || parsed.data.expected_state.run_id !== access.runId || parsed.data.expected_state.model_id !== access.modelId) {
      return response("Recovery inspection is unavailable", 503);
    }
    if (['failed', 'cancelled'].includes(parsed.data.expected_state.status)) {
      const inspected = await createServiceRoleClient().rpc('inspect_model_population_replacement', {
        p_workspace_id: access.workspaceId, p_run_id: access.runId, p_actor_id: access.actorId,
      });
      const candidate = recoveryInspectionSchema.safeParse({ ...parsed.data, replacement: inspected.error
        ? { state: 'unavailable', reason: 'Population checkpoint registration is unavailable on this installation.' } : inspected.data });
      if (!candidate.success) return response('Population recovery inspection is unavailable', 503);
      return NextResponse.json(candidate.data, { headers: { 'Cache-Control': 'no-store' } });
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
  try { requireProviderBrowserOrigin(request); } catch { return response("Recovery writes require the same browser origin", 403); }
  try {
    const access = await authorize(request, context);
    if (access.response) return access.response;
    const body = await readJsonOrNullWithLimit(request, BODY_LIMITS.normalJson);
    if (!body.ok) return body.response;
    const parsed = recoveryRequestSchema.safeParse(body.data);
    if (!parsed.success) return response("Invalid recovery decision", 400);
    const decision = parsed.data;
    if (decision.expectedState.workspace_id !== access.workspaceId || decision.expectedState.run_id !== access.runId
        || decision.expectedState.model_id !== access.modelId) return response("Recovery observation belongs to another model run", 409);
    if (decision.decision === 'create_population_replacement') return await createReplacement(decision, access);
    if (decision.decision !== "abandon_execution") return await decideHistoricalRun(decision, access, audit);
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

type Authorized = { runId: string; modelId: string; workspaceId: string; actorId: string };

async function createReplacement(decision: PopulationReplacementDecision, access: Authorized & { engineKey: string }) {
  const args = replacementRpcArguments(decision, access.workspaceId, access.runId, access.actorId);
  // Receipt lookup precedes current capacity gates: a lost create reply must remain recoverable.
  const service = createServiceRoleClient();
  const saved = await service.rpc('read_model_population_replacement_receipt', {
    p_request_id: decision.requestId, p_workspace_id: access.workspaceId, p_run_id: access.runId, p_actor_id: access.actorId,
  });
  if (saved.error) return response('Replacement receipt lookup is unavailable. Retry the saved request.', 503);
  let receipt = saved.data === null ? null : replacementReceipt(saved.data, args);
  if (saved.data !== null && !receipt) return response('This request identity has a different payload', 409);
  if (!receipt) {
    const blocked = await replacementPreflight(access.engineKey, access.workspaceId);
    if (blocked) return response(blocked.message, blocked.status);
    const result = await service.rpc('create_model_population_replacement', args);
    if (result.error?.code === '0A000') return response('Managed population replacement is unsupported on this installation. It remains a full-v1 obligation.', 501);
    if (result.error?.code === '42501') return response('Source access changed. Review workspace access.', 403);
    if (result.error?.code === '40001' || result.error?.code === '23514' || result.error?.code === '23505') return response('Source state or checkpoint changed. Review recovery again.', 409);
    receipt = replacementReceipt(result.data, args);
    if (result.error || !receipt) return response('Replacement creation is unconfirmed. Retry the saved request.', 503);
  }
  // Dispatch uncertainty cannot hide a confirmed creation receipt or mint another run.
  try { await dispatchPopulationReplacement(decision.requestId, receipt.replacement_run_id, receipt.engine_key); } catch { /* Polling remains the ordinary execution path. */ }
  return NextResponse.json(receipt, { headers: { 'Cache-Control': 'no-store' } });
}

/** Records keep or close for a historical run. The run, its stages and outputs stay as saved. */
async function decideHistoricalRun(decision: HistoricalRunDecision, access: Authorized, audit: ReturnType<typeof createApiAuditLogger>) {
  const args = historicalDecisionRpcArguments(decision, access.workspaceId, access.runId, access.actorId);
  const { data, error } = await createServiceRoleClient().rpc("record_historical_model_run_decision", args);
  if (error?.code === "42501") return response("Recovery authority changed. Review workspace access.", 403);
  if (error?.message === "Model recovery state changed") return response("This run changed. Reload the page before deciding.", 409);
  if (error?.message === "Historical model run decision already recorded") return response("A decision for this run is already recorded. Reload the page.", 409);
  if (error?.message === "Historical model run decision requires historical enrollment") return response("This run was not recorded before recovery tracking.", 409);
  if (error?.message === "Model recovery request identity reused with different payload") return response("This request identity belongs to a different decision", 409);
  if (error || !matchesHistoricalDecisionReceipt(data, args)) {
    audit.warn("historical_run_decision_unconfirmed", { requestId: decision.requestId, runId: access.runId });
    return NextResponse.json({ error: "The decision is unconfirmed. Retry the same request.", outcome: "recovery_unconfirmed", requestId: decision.requestId }, { status: 503 });
  }
  audit.info("historical_run_decision_receipt", { requestId: decision.requestId, runId: access.runId, workspaceId: access.workspaceId, actorId: access.actorId, outcome: args.p_outcome });
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}

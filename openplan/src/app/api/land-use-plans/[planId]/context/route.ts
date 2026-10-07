import { isDeepStrictEqual } from "node:util";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireProviderBrowserOrigin } from "@/lib/assistant/provider-server";
import { readBytesWithLimitStreaming } from "@/lib/http/body-limit";
import { loadLandUsePlanAccess } from "@/lib/land-use-plans/api";
import { planContextSaveSchema } from "@/lib/land-use-plans/plan-context-command";
import { PlanContextError, readPlanContext, savePlanContext } from "@/lib/land-use-plans/plan-context-store";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { createServiceRoleClient } from "@/lib/supabase/server";

const paramsSchema = z.object({ planId: z.string().uuid() }).strict();
const headers = { "Cache-Control": "private, no-store" };
const messages = {
  invalid: "Review the plan context fields before saving. Keep your draft.",
  forbidden: "Current staff access in the same account and workspace is required. Plan authority assessments need a human decision.",
  missing: "This plan is no longer available in the selected workspace.",
  conflict: "The plan or saved request changed. Keep your draft and compare the current plan context.",
  unavailable: "OpenPlan could not confirm the plan context. Keep the exact request and check again before starting another save.",
};
type Context = { params: Promise<{ planId: string }> };
function failure(error: unknown) {
  const failed = error instanceof PlanContextError ? error : error instanceof z.ZodError || error instanceof SyntaxError
    ? new PlanContextError("invalid", 400) : new PlanContextError("unavailable", 503);
  return NextResponse.json({ kind: failed.kind, error: messages[failed.kind] }, { status: failed.status, headers });
}
function privateResponse(response: NextResponse) {
  response.headers.set("Cache-Control", headers["Cache-Control"]);
  return response;
}

export async function GET(request: NextRequest, context: Context) {
  const audit = createApiAuditLogger("land-use-plans.context.read", request);
  try {
    const { planId } = paramsSchema.parse(await context.params);
    const loaded = await loadLandUsePlanAccess(planId);
    if (!loaded.ok) return privateResponse(loaded.response);
    const { access } = loaded;
    const result = await readPlanContext(access.supabase, { planId, workspaceId: access.plan.workspace_id, actorId: access.userId });
    audit.info("plan_context_read", { planId, state: result.contextState.status });
    return NextResponse.json({ ...result, canWrite: access.canWrite }, { headers });
  } catch (error) {
    audit.warn("plan_context_read_unavailable");
    return failure(error);
  }
}

export async function POST(request: NextRequest, context: Context) {
  const audit = createApiAuditLogger("land-use-plans.context.write", request);
  try {
    const { planId } = paramsSchema.parse(await context.params);
    if (["x-openplan-assistant-execution-source", "x-openplan-assistant-input-hash", "x-openplan-assistant-approval-id"].some(key => request.headers.has(key))) {
      throw new PlanContextError("forbidden", 403);
    }
    try { requireProviderBrowserOrigin(request); } catch { throw new PlanContextError("forbidden", 403); }
    const loaded = await loadLandUsePlanAccess(planId, { write: true });
    if (!loaded.ok) return privateResponse(loaded.response);
    const { access } = loaded;
    if (request.headers.get("x-openplan-expected-user") !== access.userId
      || request.headers.get("x-openplan-expected-workspace") !== access.plan.workspace_id) throw new PlanContextError("forbidden", 403);
    const body = await readBytesWithLimitStreaming(request, 2_000_000);
    if (!body.ok) return privateResponse(body.response);
    let raw: unknown;
    let text: string;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(body.bytes); raw = JSON.parse(text); }
    catch { throw new PlanContextError("invalid", 400); }
    const command = planContextSaveSchema.parse(raw);
    // The form serializer normalizes before it retains and sends the command.
    // Refuse unnormalized values instead of silently changing retained bytes.
    if (!isDeepStrictEqual(command, raw)) throw new PlanContextError("invalid", 400);
    const result = await savePlanContext(createServiceRoleClient(), { planId, workspaceId: access.plan.workspace_id, actorId: access.userId }, command, text);
    audit.info("plan_context_command_retained", { planId, commandId: command.commandId, versionId: command.versionId, replayed: result.replayed });
    return NextResponse.json(result, { status: result.replayed ? 200 : 201, headers });
  } catch (error) {
    audit.warn("plan_context_save_unconfirmed");
    return failure(error);
  }
}

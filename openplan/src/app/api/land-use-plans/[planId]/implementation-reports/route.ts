import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { readBytesWithLimitStreaming } from "@/lib/http/body-limit";
import { requireProviderBrowserOrigin } from "@/lib/assistant/provider-server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { loadLandUsePlanAccess } from "@/lib/land-use-plans/api";
import { IMPLEMENTATION_REPORT_COMMAND_LIMIT, implementationReportCommandSchema } from "@/lib/land-use-plans/implementation-report-command";
import { executeImplementationReport, ImplementationReportError } from "@/lib/land-use-plans/implementation-report-store";
import { createApiAuditLogger } from "@/lib/observability/audit";

const paramsSchema = z.object({ planId: z.string().uuid() }).strict();
const headers = { "Cache-Control": "private, no-store" };
type Context = { params: Promise<{ planId: string }> };

export async function POST(request: NextRequest, context: Context) {
  const audit = createApiAuditLogger("land-use-plans.implementation-reports", request);
  audit.info("land_use_plan_implementation_report_requested");
  try {
    const { planId } = paramsSchema.parse(await context.params);
    if (["x-openplan-assistant-execution-source", "x-openplan-assistant-input-hash", "x-openplan-assistant-approval-id"].some(key => request.headers.has(key))) {
      throw new ImplementationReportError("forbidden");
    }
    try { requireProviderBrowserOrigin(request); } catch { throw new ImplementationReportError("forbidden"); }
    const loaded = await loadLandUsePlanAccess(planId, { write: true });
    if (!loaded.ok) { loaded.response.headers.set("Cache-Control", headers["Cache-Control"]); return loaded.response; }
    const { access } = loaded;
    if (request.headers.get("x-openplan-expected-user") !== access.userId
      || request.headers.get("x-openplan-expected-workspace") !== access.plan.workspace_id) throw new ImplementationReportError("forbidden");
    const body = await readBytesWithLimitStreaming(request, IMPLEMENTATION_REPORT_COMMAND_LIMIT);
    if (!body.ok) { body.response.headers.set("Cache-Control", headers["Cache-Control"]); return body.response; }
    let commandText: string;
    try { commandText = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(body.bytes); }
    catch { throw new ImplementationReportError("invalid"); }
    const command = implementationReportCommandSchema.parse(JSON.parse(commandText));
    const scope = { planId, workspaceId: access.plan.workspace_id, actorId: access.userId };
    const result = await executeImplementationReport(createServiceRoleClient(), scope, commandText);
    audit.info("land_use_plan_implementation_report_retained", { planId, commandId: command.commandId, reportId: result.reportId, replayed: result.replayed });
    return NextResponse.json(result, { status: result.replayed ? 200 : 201, headers });
  } catch (error) {
    const failed = error instanceof ImplementationReportError ? error : error instanceof z.ZodError || error instanceof SyntaxError
      ? new ImplementationReportError("invalid") : new ImplementationReportError("unavailable");
    audit.warn("land_use_plan_implementation_report_unconfirmed", { kind: failed.kind });
    const messages = {
      invalid: "The saved report request is invalid. Keep a copy before reviewing the plan.",
      forbidden: "Current staff access in the same account and workspace is required. Report generation is not available to agents.",
      missing: "This plan is no longer available in the selected workspace.",
      conflict: "The adopted plan changed or this request conflicts with an earlier command. Keep the request and review the plan before generating another report.",
      unavailable: "OpenPlan could not confirm the report. Keep this exact request and check again before generating another report.",
    };
    return NextResponse.json({ kind: failed.kind, error: messages[failed.kind] }, { status: failed.status, headers });
  }
}

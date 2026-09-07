import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { readJsonOrNullWithLimit } from "@/lib/http/body-limit";
import { authorizeWorkProgram } from "@/lib/programs/work-program/server";
import { reconcileWorkProgram, type WorkProgramDraft } from "@/lib/programs/work-program/schema";
import { workProgramDifferences, workflowCommandSchema } from "@/lib/programs/work-program/workflow";
import { loadWorkProgramWorkflow } from "@/lib/programs/work-program/workflow-server";
type Context = { params: Promise<{ programId: string }> };
export async function GET(request: NextRequest, context: Context) {
  const { programId } = await context.params;
  const access = await authorizeWorkProgram(request, programId, false);
  if (access.response) return access.response;
  try {
    const data = await loadWorkProgramWorkflow(access.supabase, programId, access.program.workspace_id, access.user.id);
    if (data.state.effective_revision_id) {
      const effective = await access.supabase.from("program_work_program_revisions").select("revision, content_json").eq("program_id", programId).eq("id", data.state.effective_revision_id).single();
      if (effective.error) throw new Error("Effective baseline unavailable");
      const draft = effective.data.content_json as WorkProgramDraft;
      const totals = reconcileWorkProgram(draft);
      data.effective = { revision: effective.data.revision, revenue: totals.revenue, cost: totals.cost, currency: draft.currency };
    }
    const selectedId = request.nextUrl.searchParams.get("revisionId");
    if (selectedId) {
      const selected = await access.supabase.from("program_work_program_revisions").select("id, content_json, amendment_baseline_id").eq("program_id", programId).eq("id", selectedId).single();
      if (selected.error) throw new Error("Selected revision unavailable");
      if (selected.data.amendment_baseline_id) {
        const baseline = await access.supabase.from("program_work_program_revisions").select("revision, content_json").eq("program_id", programId).eq("id", selected.data.amendment_baseline_id).single();
        if (baseline.error) throw new Error("Amendment baseline unavailable");
        data.comparison = { baselineRevision: baseline.data.revision, changes: workProgramDifferences(baseline.data.content_json, selected.data.content_json) };
      }
    }
    return NextResponse.json(data, { headers: { "Cache-Control": "private, no-store" } });
  }
  catch { return NextResponse.json({ error: "Review history could not be read. Retry when the connection recovers." }, { status: 503 }); }
}
export async function POST(request: NextRequest, context: Context) {
  const audit = createApiAuditLogger("programs.workProgram.workflow", request);
  const { programId } = await context.params;
  const access = await authorizeWorkProgram(request, programId, true);
  if (access.response) return access.response;
  const body = await readJsonOrNullWithLimit(request, 100_000);
  if (!body.ok) return body.response;
  const parsed = workflowCommandSchema.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: "Enter a complete review record with valid dates and revision identity." }, { status: 400 });
  try {
    const result = await createServiceRoleClient().rpc("record_work_program_event", { p_program_id: programId, p_actor_id: access.user.id, p_command: parsed.data });
    if (result.error) {
      audit.warn("workflow_refused", { programId, code: result.error.code });
      const status = result.error.code === "PT409" ? 409 : result.error.code === "42501" ? 403 : result.error.code === "22023" ? 400 : 503;
      return NextResponse.json({ error: status === 503 ? "The record could not be confirmed. Retry the same request to recover it." : result.error.message }, { status });
    }
    audit.info("workflow_recorded", { programId, eventId: result.data.id, kind: parsed.data.kind, userId: access.user.id });
    return NextResponse.json({ event: result.data }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "The record could not be confirmed. Retry the same request to recover it." }, { status: 503 });
  }
}

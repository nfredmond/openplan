import { createApiAuditLogger } from "@/lib/observability/audit";
import { NextRequest, NextResponse } from "next/server";
import { authorizeWorkProgram } from "@/lib/programs/work-program/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { readJsonOrNullWithLimit } from "@/lib/http/body-limit";
import { readAssistantExecutionSource } from "@/lib/assistant/action-approval-server";
import { managementCommandSchema } from "@/lib/programs/work-program/reporting";
import { loadActualVersions, reportingRows, reportingError, saveWorkProgramActual } from "@/lib/programs/work-program/reporting-server";
type Context = { params: Promise<{ programId: string }> };
export async function GET(request: NextRequest, context: Context) {
 const audit = createApiAuditLogger("programs.workProgram.reporting", request);
 const { programId } = await context.params;
 audit.info("reporting_requested", { programId, method: request.method });
 const access = await authorizeWorkProgram(request, programId, false);
 if (access.response) return access.response;
 try {
  const membership = await access.supabase.from("workspace_members").select("role").eq("workspace_id", access.program.workspace_id).eq("user_id", access.user.id).single();
  if (membership.error) throw new Error("Membership unavailable");
  const canManage = ["owner", "admin"].includes(membership.data.role);
  const cutoff = new Date().toISOString();
  const staff = await reportingRows(access.supabase, "invoicing_staff", "id, name, user_id, active", ["workspace_id", access.program.workspace_id]);
  const revisions = (await reportingRows(access.supabase, "program_work_program_revisions", "id, revision, content_json, content_sha256, source_ids, created_at", ["program_id", programId], cutoff)).sort((a, b) => Number(a.revision) - Number(b.revision));
  if (!canManage) {
   const ownIds = staff.filter(s => s.user_id === access.user.id).map(s => s.id);
   const raw = await reportingRows(createServiceRoleClient(), "work_program_actual_versions", "id, entry_id, version, staff_id, status, created_by, detail", ["program_id", programId]);
   const current = [...new Map(raw.sort((a, b) => Number(a.version) - Number(b.version)).map(v => [v.entry_id, v])).values()];
   const own = current.filter(v => ownIds.includes(v.staff_id) && v.created_by === access.user.id && v.status === "draft").map(v => {
    const d = v.detail as Record<string, unknown>;
    return { entryId: v.entry_id, version: v.version, entryDate: d.entryDate, hours: d.hours, billable: d.billable === true, description: d.description, sourceKey: d.sourceKey, sourceReference: d.sourceReference, staffId: v.staff_id, revisionId: d.revisionId, projectId: d.projectId, contractId: d.contractId, allocations: d.allocations };
   });
   return NextResponse.json({ canManage, staff, revisions, ownTime: own }, { headers: { "Cache-Control": "private, no-store" } });
  }
  const [actuals, rates, periods, reports, events, contracts, deliverables, timeSources, spendSources] = await Promise.all([
   loadActualVersions(access.supabase, programId, cutoff),
   reportingRows(access.supabase, "work_program_cost_rates", "id, staff_id, starts_on, ends_on, hourly_cost, source_reference", ["workspace_id", access.program.workspace_id]),
   reportingRows(access.supabase, "work_program_reporting_periods", "id, name, starts_on, ends_on, baseline_id, source_cutoff, version, state, progress, note, review_snapshot", ["program_id", programId]),
   reportingRows(access.supabase, "work_program_period_reports", "id, period_id, version, snapshot, snapshot_hash, issued_by, issued_at, corrects_report_id", ["program_id", programId]),
   reportingRows(access.supabase, "program_work_program_events", "id, revision_id, kind, payload", ["program_id", programId]),
   reportingRows(access.supabase, "invoicing_engagements", "id, title, project_id", ["workspace_id", access.program.workspace_id]),
   reportingRows(access.supabase, "project_deliverables", "id, title, project_id, projects!inner(workspace_id)", ["projects.workspace_id", access.program.workspace_id]),
   reportingRows(access.supabase, "invoicing_time_entries", "id, staff_id, engagement_id, entry_date, hours, notes, billable, work_program_id", ["workspace_id", access.program.workspace_id]),
   reportingRows(access.supabase, "project_spend_entries", "id, project_id, entry_date, amount, description, work_program_id, projects!inner(workspace_id)", ["projects.workspace_id", access.program.workspace_id]),
  ]);
  return NextResponse.json({ canManage, cutoff, staff, revisions, actuals, rates, periods, reports, events, contracts, deliverables, timeSources: timeSources.filter(t => !t.work_program_id), spendSources: spendSources.filter(t => !t.work_program_id) }, { headers: { "Cache-Control": "private, no-store" } });
 } catch { return NextResponse.json({ error: "Reporting records could not be read. Retry when the connection recovers." }, { status: 503 }); }
}
export async function POST(request: NextRequest, context: Context) {
 const audit = createApiAuditLogger("programs.workProgram.reporting", request);
 const { programId } = await context.params;
 audit.info("reporting_requested", { programId, method: request.method });
 const body = await readJsonOrNullWithLimit(request, 500_000);
 if (!body.ok) return body.response;
 const input = body.data as Record<string, unknown> | null;
 if (input && "entryId" in input) return saveWorkProgramActual(request, programId, input);
 const access = await authorizeWorkProgram(request, programId, false);
 if (access.response) return access.response;
 if (readAssistantExecutionSource(request) !== "manual") return NextResponse.json({ error: "Management reporting is not a registered agent action." }, { status: 403 });
 const command = managementCommandSchema.safeParse(input);
 if (!command.success) return NextResponse.json({ error: "Complete the reporting command and valid dates.", issues: command.error.issues }, { status: 400 });
 const result = await createServiceRoleClient().rpc("work_program_management_command", { p_program_id: programId, p_actor_id: access.user.id, p_command: command.data });
 if (result.error) audit.warn("management_refused", { programId, code: result.error.code });
 else audit.info("management_saved", { programId, kind: command.data.kind });
 return result.error ? reportingError(result.error) : NextResponse.json(result.data, { headers: { "Cache-Control": "private, no-store" } });
}

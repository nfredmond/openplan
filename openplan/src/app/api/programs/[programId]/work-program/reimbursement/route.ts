import { NextRequest, NextResponse } from "next/server";
import { authorizeWorkProgram } from "@/lib/programs/work-program/server";
import { reportingRows, reportingError } from "@/lib/programs/work-program/reporting-server";
import { reimbursementCommandSchema } from "@/lib/programs/work-program/reimbursement";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { readJsonOrNullWithLimit } from "@/lib/http/body-limit";
import { readAssistantExecutionSource } from "@/lib/assistant/action-approval-server";
import { createApiAuditLogger } from "@/lib/observability/audit";
type Context = { params: Promise<{ programId: string }> };
async function accessPacket(request: NextRequest, context: Context) {
 const { programId } = await context.params;
 const access = await authorizeWorkProgram(request, programId, false);
 if (access.response) return { response: access.response, programId };
 const membership = await access.supabase.from("workspace_members").select("role").eq("workspace_id", access.program.workspace_id).eq("user_id", access.user.id).single();
 if (membership.error) return { response: NextResponse.json({ error: "Could not verify reimbursement access" }, { status: 503 }), programId };
 if (!["owner", "admin"].includes(membership.data.role)) return { response: NextResponse.json({ error: "Private reimbursement requires an owner or administrator" }, { status: 403 }), programId };
 return { ...access, programId };
}
export async function GET(request: NextRequest, context: Context) {
 const access = await accessPacket(request, context);
 if (access.response) return access.response;
 try {
  const [claims, events, reports] = await Promise.all([
   reportingRows(access.supabase!, "work_program_reimbursement_claims", "id, version, state, draft, current_report_id", ["program_id", access.programId]),
   reportingRows(access.supabase!, "work_program_reimbursement_events", "id, claim_id, sequence, kind, report_id, note, actor_id, created_at", ["program_id", access.programId]),
   reportingRows(access.supabase!, "work_program_period_reports", "id, period_id, version, snapshot, snapshot_hash, issued_at, corrects_report_id", ["program_id", access.programId]),
  ]);
  return NextResponse.json({ claims, events, reports: reports.filter(r => (r.snapshot as Record<string, unknown>).reimbursement) }, { headers: { "Cache-Control": "private, no-store" } });
 } catch { return NextResponse.json({ error: "Reimbursement history unavailable. Retry to recover the retained records." }, { status: 503 }); }
}
export async function POST(request: NextRequest, context: Context) {
 const audit = createApiAuditLogger("programs.workProgram.reimbursement", request);
 const access = await accessPacket(request, context);
 if (access.response) return access.response;
 if (readAssistantExecutionSource(request) !== "manual") return NextResponse.json({ error: "Reimbursement review and external receipt recording are not registered agent actions." }, { status: 403 });
 const body = await readJsonOrNullWithLimit(request, 500_000);
 if (!body.ok) return body.response;
 const command = reimbursementCommandSchema.safeParse(body.data);
 if (!command.success) return NextResponse.json({ error: "Complete the packet evidence and exact funding shares.", issues: command.error.issues }, { status: 400 });
 const result = await createServiceRoleClient().rpc("work_program_reimbursement_command", { p_program_id: access.programId, p_actor_id: access.user!.id, p_command: command.data });
 if (result.error) audit.warn("reimbursement_refused", { programId: access.programId, code: result.error.code });
 else audit.info("reimbursement_saved", { programId: access.programId, claimId: command.data.claimId, kind: command.data.kind, version: result.data.version });
 return result.error ? reportingError(result.error) : NextResponse.json(result.data, { headers: { "Cache-Control": "private, no-store" } });
}

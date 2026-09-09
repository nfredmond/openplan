import { NextRequest, NextResponse } from "next/server";
import { authorizeWorkProgram } from "@/lib/programs/work-program/server";
import { reportingError } from "@/lib/programs/work-program/reporting-server";
import { closeoutCommandSchema } from "@/lib/programs/work-program/closeout";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { readJsonOrNullWithLimit } from "@/lib/http/body-limit";
import { readAssistantExecutionSource } from "@/lib/assistant/action-approval-server";
import { createApiAuditLogger } from "@/lib/observability/audit";
type Context = { params: Promise<{ programId: string }> };

async function accessCloseout(request: NextRequest, context: Context) {
  const { programId } = await context.params;
  const access = await authorizeWorkProgram(request, programId, false);
  if (access.response) return { response: access.response, programId };
  const membership = await access.supabase.from("workspace_members").select("role").eq("workspace_id", access.program.workspace_id).eq("user_id", access.user.id).single();
  if (membership.error) return { response: NextResponse.json({ error: "Could not verify closeout access" }, { status: 503 }), programId };
  if (!["owner", "admin"].includes(membership.data.role)) return { response: NextResponse.json({ error: "Private closeout requires an owner or administrator" }, { status: 403 }), programId };
  return { ...access, programId };
}

export async function GET(request: NextRequest, context: Context) {
  const access = await accessCloseout(request, context);
  if (access.response) return access.response;
  const reportId = request.nextUrl.searchParams.get("reportId");
  if (!reportId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(reportId)) return NextResponse.json({ error: "Select a retained source report" }, { status: 400 });
  const result = await createServiceRoleClient().rpc("read_work_program_closeout", { p_program_id: access.programId, p_actor_id: access.user!.id, p_report_id: reportId });
  return result.error ? reportingError(result.error) : NextResponse.json(result.data, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: NextRequest, context: Context) {
  const audit = createApiAuditLogger("programs.workProgram.closeout", request);
  const access = await accessCloseout(request, context);
  if (access.response) return access.response;
  if (readAssistantExecutionSource(request) !== "manual") return NextResponse.json({ error: "Closeout reconciliation and carryover approval are not registered agent actions." }, { status: 403 });
  const body = await readJsonOrNullWithLimit(request, 1_000_000);
  if (!body.ok) return body.response;
  const command = closeoutCommandSchema.safeParse(body.data);
  if (!command.success) return NextResponse.json({ error: "Complete the reconciliation fields using whole cents.", issues: command.error.issues }, { status: 400 });
  const result = await createServiceRoleClient().rpc("work_program_closeout_command", { p_program_id: access.programId, p_actor_id: access.user!.id, p_command: command.data });
  if (result.error) audit.warn("closeout_refused", { programId: access.programId, code: result.error.code });
  else audit.info("closeout_saved", { programId: access.programId, kind: command.data.kind, version: result.data.version });
  return result.error ? reportingError(result.error) : NextResponse.json(result.data, { headers: { "Cache-Control": "private, no-store" } });
}

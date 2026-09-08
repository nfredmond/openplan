import { createApiAuditLogger } from "@/lib/observability/audit";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authorizeWorkProgram } from "@/lib/programs/work-program/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { reportingError } from "@/lib/programs/work-program/reporting-server";
import { readAssistantExecutionSource } from "@/lib/assistant/action-approval-server";
const schema = z.object({ reportId: z.string().uuid(), format: z.enum(["pdf", "xlsx"]) });
type Context = { params: Promise<{ programId: string }> };
async function accessReport(request: NextRequest, context: Context) {
 const audit = createApiAuditLogger("programs.workProgram.reporting", request);
 const { programId } = await context.params;
 audit.info("reporting_requested", { programId, method: request.method });
 const access = await authorizeWorkProgram(request, programId, false);
 if (access.response) return { response: access.response };
 const query = schema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
 if (!query.success) return { response: NextResponse.json({ error: "Choose an issued report and format" }, { status: 400 }) };
 const report = await access.supabase.from("work_program_period_reports").select("id").eq("id", query.data.reportId).eq("program_id", programId).maybeSingle();
 if (report.error) return { response: NextResponse.json({ error: "Report access unavailable" }, { status: 503 }) };
 if (!report.data) return { response: NextResponse.json({ error: "Management report unavailable for this role" }, { status: 404 }) };
 return { ...access, query: query.data };
}
export async function POST(request: NextRequest, context: Context) {
 const access = await accessReport(request, context);
 if (access.response) return access.response;
 if (readAssistantExecutionSource(request) !== "manual") return NextResponse.json({ error: "Private management exports are not a registered agent action." }, { status: 403 });
 const result = await createServiceRoleClient().rpc("enqueue_work_program_report", { p_report_id: access.query!.reportId, p_format: access.query!.format, p_actor_id: access.user!.id });
 return result.error ? reportingError(result.error) : NextResponse.json({ job: result.data });
}
export async function GET(request: NextRequest, context: Context) {
 const access = await accessReport(request, context);
 if (access.response) return access.response;
 const document = await access.supabase!.from("kb_documents").select("id, checksum, status").eq("work_program_report_id", access.query!.reportId).eq("work_program_report_format", access.query!.format).maybeSingle();
 if (document.error) return NextResponse.json({ error: "Report document unavailable" }, { status: 503 });
 if (!document.data) return NextResponse.json({ status: "not_prepared" });
 const job = await access.supabase!.from("kb_ocr_jobs").select("status, failure_detail").eq("document_id", document.data.id).eq("job_kind", "work_program_export").order("created_at", { ascending: false }).limit(1).maybeSingle();
 if (job.error) return NextResponse.json({ error: "Report job unavailable" }, { status: 503 });
 return NextResponse.json({ status: job.data?.status ?? "not_prepared", error: job.data?.failure_detail, document: document.data }, { headers: { "Cache-Control": "private, no-store" } });
}

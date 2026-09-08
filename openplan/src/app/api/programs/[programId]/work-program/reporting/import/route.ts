import { createApiAuditLogger } from "@/lib/observability/audit";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authorizeWorkProgram } from "@/lib/programs/work-program/server";
import { reportingRows } from "@/lib/programs/work-program/reporting-server";
import { actualCommandSchema } from "@/lib/programs/work-program/reporting";
import { previewActualCsv, importFields } from "@/lib/programs/work-program/reporting-import";
import { readJsonOrNullWithLimit } from "@/lib/http/body-limit";
const schema = z.object({ csv: z.string().max(2_000_000), filename: z.string().min(1).max(240), mapping: z.partialRecord(z.enum(importFields), z.string()), defaults: actualCommandSchema }).strict();
export async function POST(request: NextRequest, context: { params: Promise<{ programId: string }> }) {
 const audit = createApiAuditLogger("programs.workProgram.reporting", request);
 const { programId } = await context.params;
 audit.info("reporting_requested", { programId, method: request.method });
 const access = await authorizeWorkProgram(request, programId, false);
 if (access.response) return access.response;
 const member = await access.supabase.from("workspace_members").select("role").eq("workspace_id", access.program.workspace_id).eq("user_id", access.user.id).single();
 if (member.error || !["owner", "admin"].includes(member.data?.role)) return NextResponse.json({ error: "Owner or administrator required for cost import" }, { status: 403 });
 const body = await readJsonOrNullWithLimit(request, 2_200_000);
 if (!body.ok) return body.response;
 const parsed = schema.safeParse(body.data);
 if (!parsed.success) return NextResponse.json({ error: "Select a CSV, column mapping and default attribution" }, { status: 400 });
 try {
  const existing = await reportingRows(access.supabase, "work_program_actual_versions", "id, source_key", ["workspace_id", access.program.workspace_id]);
  return NextResponse.json(previewActualCsv(parsed.data.csv, parsed.data.filename, parsed.data.mapping, parsed.data.defaults, existing.map(r => String(r.source_key))), { headers: { "Cache-Control": "private, no-store" } });
 } catch { return NextResponse.json({ error: "CSV could not be read or is too large. Use a header row and at most 2,000 records." }, { status: 400 }); }
}

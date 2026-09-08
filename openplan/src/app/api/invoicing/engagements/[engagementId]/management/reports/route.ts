import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { contractAccess } from "@/lib/invoicing/contracts/server";
import { reportingError } from "@/lib/programs/work-program/reporting-server";
import { readAssistantExecutionSource } from "@/lib/assistant/action-approval-server";
import { createApiAuditLogger } from "@/lib/observability/audit";
const schema = z.object({ reportId: z.string().uuid(), format: z.enum(["pdf","xlsx"]) });
type Context = { params: Promise<{ engagementId: string }> };
async function accessReport(request: NextRequest, context: Context) {
 const { engagementId } = await context.params;
 createApiAuditLogger("invoicing.contract.report",request).info("contract_report_requested",{engagementId,method:request.method});
 const access = await contractAccess(engagementId);
 if (access.response) return access;
 const query = schema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
 if (!query.success) return { response: NextResponse.json({error:"Choose an issued snapshot and format"},{status:400}) };
 const report = await access.client!.from("contract_snapshots").select("id").eq("id",query.data.reportId).eq("engagement_id",engagementId).maybeSingle();
 if (report.error || !report.data) return { response: NextResponse.json({error:"Management snapshot unavailable"},{status:404}) };
 return {...access,query:query.data};
}
export async function POST(request: NextRequest,context:Context) {
 const access=await accessReport(request,context); if(access.response)return access.response;
 if(readAssistantExecutionSource(request)!=="manual")return NextResponse.json({error:"Management export is not a registered agent action"},{status:403});
 const result=await access.service!.rpc("enqueue_contract_snapshot",{p_report_id:access.query!.reportId,p_format:access.query!.format,p_actor_id:access.user!.id});
 return result.error?reportingError(result.error):NextResponse.json({job:result.data});
}
export async function GET(request:NextRequest,context:Context) {
 const access=await accessReport(request,context);if(access.response)return access.response;
 const result=await access.client!.from("kb_documents").select("id,status,checksum").eq("contract_snapshot_id",access.query!.reportId).eq("contract_snapshot_format",access.query!.format).maybeSingle();
 if(result.error)return NextResponse.json({error:"Report status unavailable"},{status:503});
 return NextResponse.json({document:result.data},{headers:{"Cache-Control":"private, no-store"}});
}

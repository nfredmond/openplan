import { createApiAuditLogger } from "@/lib/observability/audit";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { contractAccess } from "@/lib/invoicing/contracts/server";
import { reportingError } from "@/lib/programs/work-program/reporting-server";
export async function GET(request:NextRequest,context:{params:Promise<{engagementId:string}>}) {
 const audit=createApiAuditLogger("invoicing.contract.received-file",request);
 const {engagementId}=await context.params,access=await contractAccess(engagementId);
 if(access.response){audit.warn("access_refused",{engagementId});return access.response;}
 const id=z.string().uuid().safeParse(request.nextUrl.searchParams.get("fileId"));
 if(!id.success)return NextResponse.json({error:"Select a retained invoice file"},{status:400});
 const result=await access.service!.rpc("read_received_invoice_file",{p_engagement_id:engagementId,p_actor_id:access.user!.id,p_file_id:id.data});
 if(result.error)return reportingError(result.error);
 audit.info("retained_source_downloaded",{engagementId,sourceId:id.data});
 return new NextResponse(Buffer.from(result.data.base64,"base64"),{headers:{"Content-Type":result.data.contentType,"Content-Disposition":`attachment; filename="received-invoice-${id.data}.${result.data.contentType==="text/csv"?"csv":"pdf"}"`,"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","X-Source-SHA256":result.data.checksum}});
}

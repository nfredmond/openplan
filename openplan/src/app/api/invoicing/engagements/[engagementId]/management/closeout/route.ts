import { NextRequest,NextResponse } from "next/server";
import { z } from "zod";
import { contractAccess } from "@/lib/invoicing/contracts/server";
import { accountingHandoffCsv,type CloseoutPackage } from "@/lib/invoicing/contracts/closeout-export";
import { createApiAuditLogger } from "@/lib/observability/audit";
const querySchema=z.object({closeoutId:z.string().uuid(),format:z.enum(["json","csv"])});
export async function GET(request:NextRequest,{params}:{params:Promise<{engagementId:string}>}){
 const audit=createApiAuditLogger("invoicing.contract.closeout.download",request),{engagementId}=await params,access=await contractAccess(engagementId);
 if(access.response)return access.response;
 const query=querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));if(!query.success)return NextResponse.json({error:"Choose an issued closeout package and format"},{status:400});
 const read=await access.client!.from("contract_closeouts").select("id,engagement_id,version,state,input_hash,content,content_hash,created_at,created_by,previous_id").eq("id",query.data.closeoutId).eq("engagement_id",engagementId).maybeSingle();
 if(read.error||!read.data||read.data.state!=="closed")return NextResponse.json({error:"Closeout package unavailable"},{status:404});
 const pkg=read.data.content.package as CloseoutPackage;
 if(pkg?.formatVersion!==1&&pkg?.formatVersion!==2)return NextResponse.json({error:"Closeout package format is unsupported"},{status:409});
 const content=query.data.format==="json"?JSON.stringify(read.data,null,2):accountingHandoffCsv(pkg);
 audit.info("closeout_downloaded",{engagementId,closeoutId:read.data.id,format:query.data.format,hash:read.data.content_hash});
 return new NextResponse(content,{headers:{"Content-Type":query.data.format==="json"?"application/json":"text/csv; charset=utf-8","Content-Disposition":`attachment; filename="closeout-${read.data.id}.${query.data.format}"`,"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
}

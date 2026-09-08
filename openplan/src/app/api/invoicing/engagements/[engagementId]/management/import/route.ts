import { NextRequest,NextResponse } from "next/server";
import { z } from "zod";
import { contractAccess } from "@/lib/invoicing/contracts/server";
import { contractActualSchema,type ContractState } from "@/lib/invoicing/contracts/schema";
import { contractImportFields,previewContractCsv } from "@/lib/invoicing/contracts/import";
import { readJsonOrNullWithLimit } from "@/lib/http/body-limit";
import { reportingError } from "@/lib/programs/work-program/reporting-server";
import { readAssistantExecutionSource } from "@/lib/assistant/action-approval-server";
import { createApiAuditLogger } from "@/lib/observability/audit";
const schema=z.object({requestId:z.string().uuid(),csv:z.string().max(2000000),filename:z.string().min(1).max(240),mapping:z.partialRecord(z.enum(contractImportFields),z.string()),defaults:contractActualSchema.extend({sourceKey:z.string(),description:z.string(),sourceReference:z.string()}),commit:z.boolean()}).strict();
export async function POST(request:NextRequest,context:{params:Promise<{engagementId:string}>}) {
 const {engagementId}=await context.params,access=await contractAccess(engagementId);
 const audit=createApiAuditLogger("invoicing.contract.import",request);
 if(access.response)return access.response;
 if(access.state.role==="member"||readAssistantExecutionSource(request)!=="manual")return NextResponse.json({error:"Management imports require a human owner or administrator"},{status:403});
 const body=await readJsonOrNullWithLimit(request,2200000);if(!body.ok)return body.response;
 const parsed=schema.safeParse(body.data);if(!parsed.success)return NextResponse.json({error:"Choose a CSV, mapping and default attribution"},{status:400});
 try{
  const input=parsed.data,state=access.state as ContractState;
  const preview=previewContractCsv(input.csv,input.filename,input.mapping,input.defaults,input.requestId,state.baselines.filter(b=>b.state==="approved").at(-1)?.content.tasks??[],state.staff);
  if(!input.commit)return NextResponse.json(preview,{headers:{"Cache-Control":"private, no-store"}});
  if(preview.rows.some(r=>r.errors.length||!r.command))return NextResponse.json({error:"Resolve every preview error before importing",preview},{status:400});
  const result=await access.service!.rpc("record_contract_import",{p_engagement_id:engagementId,p_actor_id:access.user!.id,p_import:{requestId:input.requestId,csv:input.csv,filename:input.filename,mapping:input.mapping,commands:preview.rows.map(r=>r.command)}});
  audit.info("contract_import_result",{engagementId,count:preview.rows.length,confirmed:!result.error});
  return result.error?reportingError(result.error):NextResponse.json(result.data);
 }catch{return NextResponse.json({error:"CSV could not be read. Use UTF-8, a header row and at most 200 records."},{status:400});}
}

export async function GET(request:NextRequest,context:{params:Promise<{engagementId:string}>}) {
 const {engagementId}=await context.params,access=await contractAccess(engagementId);
 if(access.response)return access.response;
 if(access.state.role==="member")return NextResponse.json({error:"Original cost imports are private management evidence"},{status:403});
 const id=z.string().uuid().safeParse(request.nextUrl.searchParams.get("importId"));
 if(!id.success)return NextResponse.json({error:"Choose a retained import"},{status:400});
 const result=await access.service!.from("contract_imports").select("csv_text,source_hash,filename").eq("id",id.data).eq("engagement_id",engagementId).single();
 if(result.error)return NextResponse.json({error:"Retained import unavailable"},{status:404});
 return new NextResponse(result.data.csv_text,{headers:{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":`attachment; filename="contract-import-${id.data}.csv"`,"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","X-Source-SHA256":result.data.source_hash}});
}

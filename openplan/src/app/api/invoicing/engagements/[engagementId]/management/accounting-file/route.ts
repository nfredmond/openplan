import { NextRequest,NextResponse } from "next/server";
import { z } from "zod";
import { contractAccess } from "@/lib/invoicing/contracts/server";
export async function GET(request:NextRequest,context:{params:Promise<{engagementId:string}>}) {
 const {engagementId}=await context.params,access=await contractAccess(engagementId);
 if(access.response)return access.response;
 if(!["owner","admin","finance"].includes(access.state.role))return NextResponse.json({error:"Original accounting exports require finance access"},{status:403});
 const id=z.string().uuid().safeParse(request.nextUrl.searchParams.get("importId"));if(!id.success)return NextResponse.json({error:"Select a retained accounting file"},{status:400});
 const result=await access.client!.from("contract_accounting_imports").select("csv_text,source_hash").eq("id",id.data).eq("engagement_id",engagementId).single();
 if(result.error)return NextResponse.json({error:"Accounting original unavailable"},{status:404});
 return new NextResponse(result.data.csv_text,{headers:{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":`attachment; filename="accounting-${id.data}.csv"`,"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","X-Source-SHA256":result.data.source_hash}});
}

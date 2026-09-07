import { createApiAuditLogger } from "@/lib/observability/audit";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { downloadEngagementReview } from "@/lib/engagement/review-export-download";
export async function GET(request:NextRequest,context:{params:Promise<{campaignId:string;jobId:string}>}) {
 const audit=createApiAuditLogger("engagement.review_download", request);
 audit.info("request_received");
 const client=await createClient();const {data:{user}}=await client.auth.getUser();if(!user)return NextResponse.json({error:'Unauthorized'},{status:401});
 const params=await context.params;
 return downloadEngagementReview(client,params.jobId,new URL(request.url).searchParams.get('format')||'pdf',{campaignId:params.campaignId});
}

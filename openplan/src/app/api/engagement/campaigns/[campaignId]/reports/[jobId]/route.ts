import { createApiAuditLogger } from "@/lib/observability/audit";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { BODY_LIMITS,readJsonOrNullWithLimit } from "@/lib/http/body-limit";
export async function PATCH(request:NextRequest,context:{params:Promise<{campaignId:string;jobId:string}>}) {
 const audit=createApiAuditLogger("engagement.review_control", request);
 audit.info("request_received");
 const params=await context.params;const body=await readJsonOrNullWithLimit(request,BODY_LIMITS.normalJson);if(!body.ok)return body.response;
 const parsed=z.object({action:z.enum(['cancel','retry'])}).safeParse(body.data);if(!parsed.success)return NextResponse.json({error:'Choose cancel or retry'},{status:400});
 const client=await createClient();const {data:{user}}=await client.auth.getUser();if(!user)return NextResponse.json({error:'Unauthorized'},{status:401});
 const job=await client.from('engagement_report_jobs').select('id').eq('id',params.jobId).eq('campaign_id',params.campaignId).maybeSingle();
 if(job.error||!job.data)return NextResponse.json({error:'Export not found'},{status:404});
 const result=await client.rpc('control_engagement_report',{p_job:job.data.id,p_action:parsed.data.action});
 audit.info(result.error?'change_refused':'change_saved');
 return result.error?NextResponse.json({error:result.error.message},{status:409}):NextResponse.json({success:true});
}

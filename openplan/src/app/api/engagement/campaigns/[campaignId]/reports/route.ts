import { createApiAuditLogger } from "@/lib/observability/audit";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { canAccessWorkspaceAction } from "@/lib/auth/role-matrix";
import { loadCampaignAccess } from "@/lib/engagement/api";
import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";
const schema = z.object({ requestId:z.string().uuid(),scope:z.enum(['public','internal']),filters:z.object({categoryIds:z.array(z.string().uuid()).optional(),status:z.enum(['pending','approved','rejected','flagged']).optional(),from:z.string().datetime({offset:true}).optional(),to:z.string().datetime({offset:true}).optional()}).default({}) });
export async function POST(request: NextRequest, context: {params:Promise<{campaignId:string}>}) {
 const audit=createApiAuditLogger("engagement.review_files", request);
 audit.info("request_received");
 const {campaignId}=await context.params;
 if(!z.string().uuid().safeParse(campaignId).success) return NextResponse.json({error:'Invalid campaign'},{status:400});
 const body=await readJsonOrNullWithLimit(request,BODY_LIMITS.normalJson);if(!body.ok)return body.response;
 const parsed=schema.safeParse(body.data);if(!parsed.success)return NextResponse.json({error:'Invalid report scope or filters'},{status:400});
 const client=await createClient();const {data:{user}}=await client.auth.getUser();if(!user)return NextResponse.json({error:'Unauthorized'},{status:401});
 const result=await client.rpc('queue_engagement_report',{p_campaign:campaignId,p_request:parsed.data.requestId,p_scope:parsed.data.scope,p_filters:parsed.data.filters});
 if(result.error){audit.error('queue_failed',{code:result.error.code});return NextResponse.json({error:'Review files could not be queued; check scope, dates and access.'},{status:400});}
 audit.info('queued',{campaignId});
 return NextResponse.json(result.data,{status:202});
}
export async function GET(request:NextRequest,context:{params:Promise<{campaignId:string}>}) {
 const audit=createApiAuditLogger("engagement.review_files", request);
 audit.info("request_received");
 const {campaignId}=await context.params;
 const client=await createClient();const {data:{user}}=await client.auth.getUser();if(!user)return NextResponse.json({error:'Unauthorized'},{status:401});
 const access=await loadCampaignAccess(client,campaignId,user.id,'engagement.read');if(access.error||!access.allowed)return NextResponse.json({error:'Campaign access unavailable'},{status:403});
 const reportId=new URL(request.url).searchParams.get('reportId');
 if(reportId&&!z.string().uuid().safeParse(reportId).success)return NextResponse.json({error:'Invalid report'},{status:400});
 let query=client.from('engagement_report_jobs').select('id,report_id,scope,filters_json,snapshot_sha256,status,phase,attempts,artifacts_json,failure_detail,created_at').eq('campaign_id',campaignId).order('created_at',{ascending:false}).limit(50);
 if(reportId)query=query.eq('report_id',reportId);
 const jobs=await query;
 if(jobs.error)return NextResponse.json({error:'Saved review files could not be loaded'},{status:503});
 return NextResponse.json({jobs:jobs.data,canWrite:Boolean(access.membership && canAccessWorkspaceAction('engagement.write',access.membership.role)),listing:'Latest 50 export jobs. Earlier files remain in Reports.'},{headers:{'Cache-Control':'private, no-store'}});
}

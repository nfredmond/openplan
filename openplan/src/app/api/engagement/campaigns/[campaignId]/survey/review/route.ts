import { readEveryPage } from "@/lib/supabase/paged-read";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient,createServiceRoleClient } from '@/lib/supabase/server';
import { loadCampaignAccess } from '@/lib/engagement/api';
import { loadSurveyReviewPage } from '@/lib/engagement/survey-responses';
import { BODY_LIMITS,readJsonOrNullWithLimit } from '@/lib/http/body-limit';
async function authorize(campaignId:string) {
 const client=await createClient();const {data:{user}}=await client.auth.getUser();if(!user)return null;
 const access=await loadCampaignAccess(client,campaignId,user.id,'engagement.write');return access.allowed&&!access.error?client:null;
}
export async function GET(request:NextRequest,context:{params:Promise<{campaignId:string}>}) {
 const audit=createApiAuditLogger("engagement.survey_review", request);
 audit.info("request_received");
 const {campaignId}=await context.params;const client=await authorize(campaignId);if(!client)return NextResponse.json({error:'Staff access required'},{status:403});
 const sessionId=new URL(request.url).searchParams.get('sessionId');
 if(sessionId){
  if(!z.string().uuid().safeParse(sessionId).success)return NextResponse.json({error:'Invalid response'},{status:400});
  const history=await readEveryPage((from,to)=>client.from('engagement_survey_review_history').select('id,actor_id,recorded_at,reason,before_json,after_json').eq('campaign_id',campaignId).eq('session_id',sessionId).order('recorded_at').order('id').range(from,to));
  if(!history.complete)return NextResponse.json({error:'History could not be loaded completely'},{status:503});
  return NextResponse.json({history:history.rows},{headers:{'Cache-Control':'private, no-store'}});
 }
 const page=z.coerce.number().int().min(0).safeParse(new URL(request.url).searchParams.get('page')??0);if(!page.success)return NextResponse.json({error:'Invalid page'},{status:400});
 const result=await loadSurveyReviewPage(createServiceRoleClient(),campaignId,page.data);
 return NextResponse.json(result,{status:result.error?503:200,headers:{'Cache-Control':'private, no-store'}});
}
export async function PATCH(request:NextRequest,context:{params:Promise<{campaignId:string}>}) {
 const audit=createApiAuditLogger("engagement.survey_review", request);
 audit.info("request_received");
 const {campaignId}=await context.params;const client=await authorize(campaignId);if(!client)return NextResponse.json({error:'Staff access required'},{status:403});
 const body=await readJsonOrNullWithLimit(request,BODY_LIMITS.normalJson);if(!body.ok)return body.response;
 const parsed=z.object({sessionId:z.string().uuid(),expectedUpdatedAt:z.string().datetime({offset:true}),status:z.enum(['pending','flagged','approved','rejected']),reason:z.string().trim().min(1).max(2000),redactions:z.record(z.string().uuid(),z.string().max(8000)).default({})}).safeParse(body.data);
 if(!parsed.success)return NextResponse.json({error:'A review reason, state and exact response version are required'},{status:400});
 const result=await client.rpc('review_engagement_survey',{p_campaign:campaignId,p_session:parsed.data.sessionId,p_expected:parsed.data.expectedUpdatedAt,p_status:parsed.data.status,p_reason:parsed.data.reason,p_redactions:parsed.data.redactions});
 audit.info(result.error?'change_refused':'change_saved');
 return result.error?NextResponse.json({error:result.error.message},{status:409}):NextResponse.json({success:true});
}

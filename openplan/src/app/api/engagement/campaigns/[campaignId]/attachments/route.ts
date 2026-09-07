import { NextRequest,NextResponse } from 'next/server';
import { loadSurveyAttachmentAnswer } from '@/lib/engagement/survey-responses';
import { z } from 'zod';
import { createClient,createServiceRoleClient } from '@/lib/supabase/server';
import { loadCampaignAccess } from '@/lib/engagement/api';
import { createApiAuditLogger } from '@/lib/observability/audit';
import { ENGAGEMENT_PHOTO_BUCKET,isEngagementPhotoPathForCampaign,sniffEngagementPhotoContentType } from '@/lib/engagement/photo';
const selection=z.object({itemId:z.string().uuid().optional(),answerId:z.string().uuid().optional(),sessionId:z.string().uuid().optional(),historyId:z.string().uuid().optional(),index:z.coerce.number().int().min(0).max(20).default(0)}).refine(value=>Boolean(value.itemId)!==Boolean(value.answerId&&value.sessionId));
/** Staff-only, scoped image reads. No signed URL outlives revocation or redaction. */
export async function GET(request:NextRequest,context:{params:Promise<{campaignId:string}>}) {
 const audit=createApiAuditLogger('engagement.staff_attachment',request);audit.info('request_received');
 const denied=()=>NextResponse.json({error:'Attachment unavailable or staff access revoked'},{status:404,headers:{'Cache-Control':'private, no-store'}});
 const {campaignId}=await context.params,parsed=selection.safeParse(Object.fromEntries(new URL(request.url).searchParams));if(!z.string().uuid().safeParse(campaignId).success||!parsed.success)return denied();
 const caller=await createClient(),user=await caller.auth.getUser();if(!user.data.user)return denied();
 const access=await loadCampaignAccess(caller,campaignId,user.data.user.id,'engagement.write');if(access.error||!access.allowed)return denied();
 const service=createServiceRoleClient(),pick=parsed.data;let photoPath:unknown;
 if(pick.itemId){
  const read=pick.historyId?await caller.from('engagement_item_history').select('record_json').eq('id',pick.historyId).eq('campaign_id',campaignId).eq('item_id',pick.itemId).maybeSingle():await caller.from('engagement_items').select('photo_path').eq('id',pick.itemId).eq('campaign_id',campaignId).maybeSingle();
  if(read.error||!read.data)return denied();photoPath='record_json' in read.data?read.data.record_json?.photo_path:read.data.photo_path;
 }else{
  let value:unknown;
  if(pick.historyId){const read=await caller.from('engagement_survey_review_history').select('before_json').eq('id',pick.historyId).eq('campaign_id',campaignId).eq('session_id',pick.sessionId!).maybeSingle();if(read.error||!read.data)return denied();value=read.data.before_json?.answers?.find((answer:{id:string})=>answer.id===pick.answerId)?.answer_json;}
  else {const read=await loadSurveyAttachmentAnswer(service,campaignId,pick.sessionId!,pick.answerId!);if(read.error||!read.data)return denied();value=read.data.answer_json;}
  const files=z.object({files:z.array(z.object({path:z.string()}))}).safeParse(value);if(!files.success)return denied();photoPath=files.data.files[pick.index]?.path;
 }
 if(typeof photoPath!=='string'||!isEngagementPhotoPathForCampaign(photoPath,campaignId))return denied();
 const stored=await service.storage.from(ENGAGEMENT_PHOTO_BUCKET).download(photoPath);if(stored.error||!stored.data)return denied();
 const bytes=new Uint8Array(await stored.data.arrayBuffer()),type=sniffEngagementPhotoContentType(bytes);if(!type)return denied();
 return new NextResponse(bytes,{headers:{'Content-Type':type,'Content-Disposition':'inline','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
}

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createApiAuditLogger } from '@/lib/observability/audit';
import { BODY_LIMITS, readJsonOrNullWithLimit } from '@/lib/http/body-limit';
export async function POST(request: NextRequest, context: {params: Promise<{campaignId: string}>}) {
 const audit=createApiAuditLogger('engagement.reuse_setup',request);
 const params=z.object({campaignId:z.string().uuid()}).safeParse(await context.params);
 const body=await readJsonOrNullWithLimit(request,BODY_LIMITS.normalJson);if(!body.ok)return body.response;
 const parsed=z.object({configurationVersionId:z.string().uuid(),requestId:z.string().uuid(),title:z.string().trim().min(1).max(200)}).safeParse(body.data);
 if(!params.success||!parsed.success)return NextResponse.json({error:'A title and current configuration are required'},{status:400});
 const client=await createClient();const {data:{user}}=await client.auth.getUser();if(!user)return NextResponse.json({error:'Unauthorized'},{status:401});
 const result=await client.rpc('reuse_engagement_setup',{p_campaign:params.data.campaignId,p_version:parsed.data.configurationVersionId,p_request:parsed.data.requestId,p_title:parsed.data.title,p_project:null});
 if(result.error){audit.warn('reuse_refused',{code:result.error.code});return NextResponse.json({error:'Setup changed or access was revoked. Reload before reusing it.'},{status:409});}
 audit.info('setup_reused',{campaignId:result.data});return NextResponse.json({campaignId:result.data},{status:201});
}

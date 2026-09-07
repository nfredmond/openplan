import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const { rpc, getUser } = vi.hoisted(()=>({rpc:vi.fn(),getUser:vi.fn()}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({rpc,auth:{getUser}})}));
vi.mock('@/lib/observability/audit',()=>({createApiAuditLogger:()=>({info:vi.fn(),error:vi.fn()})}));
import { POST } from '@/app/api/engagement/campaigns/[campaignId]/reports/route';
const campaign='11111111-1111-4111-8111-111111111111',request='22222222-2222-4222-8222-222222222222';
const call=(body:unknown)=>POST(new NextRequest(`http://localhost/api/engagement/campaigns/${campaign}/reports`,{method:'POST',body:JSON.stringify(body)}),{params:Promise.resolve({campaignId:campaign})});
beforeEach(()=>{vi.clearAllMocks();getUser.mockResolvedValue({data:{user:{id:'staff'}}});rpc.mockResolvedValue({data:{jobId:'job',snapshotSha256:'saved'},error:null});});
describe('queue engagement review files through the HTTP route',()=>{
 it('passes the database request parameter by its exact name and returns accepted job custody',async()=>{
  const response=await call({requestId:request,scope:'public',filters:{status:'approved'}});
  expect(response.status).toBe(202);expect(await response.json()).toEqual({jobId:'job',snapshotSha256:'saved'});
  expect(rpc).toHaveBeenCalledWith('queue_engagement_report',{p_campaign:campaign,p_request:request,p_scope:'public',p_filters:{status:'approved'}});
 });
 it('refuses unauthenticated queueing before invoking the database',async()=>{getUser.mockResolvedValue({data:{user:null}});expect((await call({requestId:request,scope:'internal'})).status).toBe(401);expect(rpc).not.toHaveBeenCalled();});
 it('does not claim acceptance when the database refuses the selection',async()=>{rpc.mockResolvedValue({data:null,error:{code:'42501'}});expect((await call({requestId:request,scope:'internal'})).status).toBe(400);});
});

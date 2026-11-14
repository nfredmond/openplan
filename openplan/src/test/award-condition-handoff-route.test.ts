// Prepared, unrun. Mocks cover server dispatch/projections, not SQL or Storage custody.
import {beforeEach,describe,it,expect,vi} from 'vitest';
import {NextRequest,NextResponse} from 'next/server';
import {awardTermsFixture,handoffId as id} from './fixtures/grants/award-handoff';
import {HANDOFF_AWARD_SELECT} from '@/lib/grants/award-handoff';
const mock=vi.hoisted(()=>({client:vi.fn(),service:vi.fn(),access:vi.fn(),rpc:vi.fn(),verify:vi.fn()}));
vi.mock('@/lib/supabase/server',()=>({createClient:mock.client,createServiceRoleClient:mock.service}));
vi.mock('@/lib/programs/api',()=>({loadProjectAccess:mock.access}));
vi.mock('@/lib/grants/award-handoff-server',()=>({verifyHandoffBytes:mock.verify,handoffFailure:(e:{message:string;code?:string})=>NextResponse.json({error:e.message},{status:e.code==='PT409'?409:503})}));
vi.mock('@/lib/observability/audit',()=>({createApiAuditLogger:()=>({info:vi.fn(),warn:vi.fn(),error:vi.fn()})}));
vi.mock('@/lib/assistant/action-approval-server',()=>({readAssistantExecutionSource:(r:NextRequest)=>r.headers.has('x-openplan-assistant-execution-source')?'planner_agent_quick_link':'manual'}));
import {GET,POST} from '@/app/api/funding-awards/[awardId]/handoff/route';
let selected:string[];let prior:unknown=null;let historyCount=0;
const award={id:id(1),workspace_id:id(2),project_id:id(3),funding_opportunity_id:id(4)};
const reviewed={schemaVersion:1,requestKey:id(7),opportunityId:id(4),terms:awardTermsFixture(),state:{awardId:id(1),workspaceId:id(2),sources:[]}};
const context={params:Promise.resolve({awardId:id(1)})};
const request=(body:unknown,agent=false)=>new NextRequest('http://localhost/api/funding-awards/award/handoff',{method:'POST',headers:{'content-type':'application/json',...(agent?{'x-openplan-assistant-execution-source':'planner_agent_quick_link'}:{})},body:JSON.stringify(body)});
beforeEach(()=>{
 vi.clearAllMocks();selected=[];prior=null;historyCount=0;
 mock.client.mockResolvedValue({auth:{getUser:async()=>({data:{user:{id:id(5)}}})},from:(table:string)=>{
  const data=table==='funding_opportunities'?{id:id(4),workspace_id:id(2),project_id:id(3),pursuit_kind:'grant'}:table==='funding_awards'?award:table==='funding_award_handoff_revisions'?prior:[];
  const result={data:table==='funding_award_handoff_revisions'&&!prior?[]:data,error:null,count:table==='funding_award_handoff_revisions'?historyCount:0};
  const chain={select:(projection:string)=>{selected.push(`${table}:${projection}`);return chain;},eq:()=>chain,is:()=>chain,order:()=>chain,maybeSingle:async()=>({data,error:null}),then:(resolve:(v:unknown)=>unknown)=>Promise.resolve(result).then(resolve)};return chain;
 }});
 mock.access.mockResolvedValue({project:{id:id(3),workspace_id:id(2)},membership:{role:'member'},allowed:true,error:null});
 mock.service.mockReturnValue({rpc:mock.rpc});mock.verify.mockResolvedValue([{id:id(9),checksum:'a'.repeat(64)}]);
 mock.rpc.mockResolvedValue({data:{reviewed,reviewHash:'a'.repeat(64)},error:null});
});
describe('manual actor-bound award handoff route',()=>{
 it('refuses agent writes before any client/service/byte call',async()=>{
  expect((await POST(request({operation:'preview'},true),context)).status).toBe(403);
  expect(mock.client).not.toHaveBeenCalled();expect(mock.service).not.toHaveBeenCalled();expect(mock.verify).not.toHaveBeenCalled();
 });
 it('binds the exact award projection and authenticated actor for preview and verifies bytes',async()=>{
  const response=await POST(request({operation:'preview',requestKey:id(7),opportunityId:id(4),terms:awardTermsFixture()}),context);
  expect(response.status).toBe(200);expect(selected).toContain(`funding_awards:${HANDOFF_AWARD_SELECT}`);
  expect(mock.access).toHaveBeenCalledWith(expect.anything(),id(3),id(5),'programs.write');
  expect(mock.rpc).toHaveBeenCalledWith('award_handoff_command',expect.objectContaining({p_actor:id(5),p_award:id(1),p_operation:'preview'}));expect(mock.verify).toHaveBeenCalledWith(reviewed);
 });
 it('retains exact committed replay and rechecks SQL authorization without source-byte writes',async()=>{
  prior={id:id(11)};mock.rpc.mockResolvedValue({data:{revisionId:id(11)},error:null});
  const response=await POST(request({operation:'apply',reviewed,reviewHash:'a'.repeat(64)}),context);
  expect(response.status).toBe(200);expect(mock.verify).not.toHaveBeenCalled();
  expect(mock.rpc).toHaveBeenCalledWith('award_handoff_command',{p_actor:id(5),p_award:id(1),p_operation:'apply',p_payload:reviewed,p_hash:'a'.repeat(64),p_verified:[]});
 });
 it('refuses changed sources before apply and never fetches submitted storage paths',async()=>{
  mock.rpc.mockResolvedValue({data:{reviewed,reviewHash:'b'.repeat(64)},error:null});
  expect((await POST(request({operation:'apply',reviewed,reviewHash:'a'.repeat(64)}),context)).status).toBe(409);
  expect(mock.verify).not.toHaveBeenCalled();expect(mock.rpc).toHaveBeenCalledTimes(1);
 });
 it('refuses denied membership without creating a service client',async()=>{
  mock.access.mockResolvedValue({allowed:false,membership:{role:'viewer'},project:{workspace_id:id(2)},error:null});
  expect((await POST(request({operation:'preview',requestKey:id(7),opportunityId:id(4),terms:awardTermsFixture()}),context)).status).toBe(403);expect(mock.service).not.toHaveBeenCalled();
 });
 it('refuses incomplete history rather than a partial successful read',async()=>{
  historyCount=2;expect((await GET(new NextRequest('http://localhost/history'),context)).status).toBe(503);
 });
 it('refuses a preview whose complete retained apply transport cannot be replayed',async()=>{
  mock.rpc.mockResolvedValue({data:{reviewed:{...reviewed,state:{...reviewed.state,proposal:'é'.repeat(1024*1024)}},reviewHash:'a'.repeat(64)},error:null});
  const response=await POST(request({operation:'preview',requestKey:id(7),opportunityId:id(4),terms:awardTermsFixture()}),context);
  expect(response.status).toBe(422);expect(await response.json()).toMatchObject({error:expect.stringContaining('transport limit')});
  expect(mock.verify).not.toHaveBeenCalled();
 });

});

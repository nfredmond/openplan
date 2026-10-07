import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { connectorCycle } from '../../../../workers/planner_agent_connector/connector-worker.mjs';
import { ConnectorError } from '../../../../workers/planner_agent_connector/connector-client.mjs';
const h = vi.hoisted(() => ({ service: null as unknown }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({}), createServiceRoleClient: () => h.service }));
vi.mock('@/lib/observability/audit', () => ({ createApiAuditLogger: () => ({ info() {}, warn() {}, error() {} }) }));
import { POST } from '@/app/api/assistant/providers/native/route';
const id='11111111-1111-4111-8111-111111111111', workspace='22222222-2222-4222-8222-222222222222', project='33333333-3333-4333-8333-333333333333', requestId='44444444-4444-4444-8444-444444444444', attempt='55555555-5555-4555-8555-555555555555', connection='66666666-6666-4666-8666-666666666666';
const setup={version:1,appUrl:'http://127.0.0.1:3219',connectionId:connection,workspaceId:workspace,projectId:project,expectedAuthMode:'chatgpt',token:`op_pc_${connection}.${'s'.repeat(43)}`};
const packet={ version:1,workspaceId:workspace,project:{id:project,name:'Synthetic project',summary:null,status:'active',planType:'corridor',deliveryPhase:'planning',updatedAt:'2026-09-10T00:00:00Z'},capturedAt:'2026-09-10T01:00:00Z',source:{id:`project:${project}`,label:'Synthetic project',href:`/projects/${project}`} };
const packetCanonical=JSON.stringify(packet);
async function exercise(invalid:boolean) {
  const directory=await mkdtemp(resolve('docs/reviews/2026-10-01-independent-code-review/evidence/providers-native-tmp-'));
  let state='running',claims=0,generates=0,finishes=0;
  const turn=()=>({id,request_id:requestId,workspace_id:workspace,project_id:project,connection_id:connection,provider:'codex',model_id:'fixture-model',auth_mode:'chatgpt',question:'What is known?',packet_canonical:packetCanonical,packet_hash:createHash('sha256').update(packetCanonical).digest('hex'),state,attempt_id:attempt,lease_expires_at:'2099-01-01T00:00:00Z',result:null,provider_receipt:null,failure_code:null,created_at:'2026-09-10T01:00:00Z',started_at:'2026-09-10T01:00:00Z',finished_at:null});
  h.service={from:()=>{const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:turn(),error:null})};return q;},rpc:async(name:string,args:Record<string,unknown>)=>{
    if(name==='claim_assistant_provider_turn'){claims++;return {data:{status:'connected',turn:turn()},error:null};}
    if(name==='read_assistant_provider_turn_status')return {data:{id,state,attemptId:attempt,leaseExpiresAt:'2099-01-01T00:00:00Z'},error:null};
    if(name==='finish_assistant_provider_turn'){finishes++;state='succeeded';return {data:{...turn(),result:args.p_result,provider_receipt:args.p_provider_receipt},error:null};}
    throw new Error(name);
  }};
  const request=async(_setup:unknown,body:unknown)=>{const response=await POST(new NextRequest(`${setup.appUrl}/api/assistant/providers/native`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${setup.token}`},body:JSON.stringify(body)}));if(!response.ok)throw new ConnectorError('connector_request_refused',response.status);return response.json();};
  const options={request,inspect:async()=>({status:'connected',authMode:'chatgpt'}),generate:async()=>{generates++;return {provider:'codex',model:'fixture-model',authMode:'chatgpt',planType:null,threadId:'thread',turnId:'turn',answer:JSON.stringify({answer:invalid?'   ':'The project is retained.',citations:[packet.source.id],submittal:null})};}};
  const config={setup,binaryPath:'/synthetic/bin/codex',providerHome:'/synthetic/profile'};
  try {
    if(!invalid){const result=await connectorCycle(config,directory,options);return {state:result.state,claims,generates,finishes};}
    const statuses:number[]=[];
    for(let cycle=0;cycle<3;cycle++){
      if(cycle===1)state='cancelled';
      try{await connectorCycle(config,directory,options);throw new Error('unexpected success');}catch(error){if(!(error instanceof ConnectorError))throw error;statuses.push(error.status);}
    }
    const pending=JSON.parse(await readFile(join(directory,'pending.json'),'utf8'));
    return {statuses,claims,generates,finishes,phase:pending.phase};
  } finally {await rm(directory,{recursive:true,force:true});}
}
describe('Native invalid result recovery observation',()=>{
  it('control: a valid synthetic answer completes actual connector and route',async()=>{expect(await exercise(false)).toEqual({state:'succeeded',claims:1,generates:1,finishes:1});});
  it('invalid trimmed answer remains a completed local journal after cancellation and repeated recovery',async()=>{expect(await exercise(true)).toEqual({statuses:[400,400,400],claims:1,generates:1,finishes:0,phase:'completed'});});
});

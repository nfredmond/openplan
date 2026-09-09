import { beforeEach,describe,expect,it,vi } from "vitest";
import { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { deliveryFixture } from "./fixtures/contract-delivery";
const mocks=vi.hoisted(()=>({rpc:vi.fn(),getUser:vi.fn()}));
vi.mock("server-only",()=>({}));
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>({auth:{getUser:mocks.getUser}}),createServiceRoleClient:()=>({rpc:mocks.rpc})}));
import { POST } from "@/app/api/invoicing/engagements/[engagementId]/management/route";
import { contractCalculationRequest } from "@/lib/invoicing/contracts/jobs-server";
function req(command:unknown,agent=false){return new NextRequest("http://m11.localhost:3247/api/invoicing/engagements/synthetic/management",{method:"POST",body:JSON.stringify(command),headers:{"Content-Type":"application/json",...(agent?{"x-openplan-assistant-execution-source":"planner_agent_quick_link"}:{})}});}
describe("contract calculation API custody",()=>{
 beforeEach(()=>{vi.clearAllMocks();mocks.getUser.mockResolvedValue({data:{user:{id:"synthetic-actor"}}});mocks.rpc.mockResolvedValue({data:{jobId:randomUUID(),status:"queued"},error:null});});
 function command(){const f=deliveryFixture();return {kind:"forecast",requestId:randomUUID(),expectedInputHash:f.delivery.inputHash,...f.options,coverageEvidence:"Synthetic complete coverage",reviewEvidence:"Synthetic reviewed inputs"};}
 it("queues expensive commands through the existing route without computing or recording them in a request",async()=>{
  const c=command(),id=randomUUID(),response=await POST(req(c),{params:Promise.resolve({engagementId:id})});expect(response.status).toBe(202);expect(mocks.rpc.mock.calls).toEqual([["enqueue_contract_calculation",{p_engagement_id:id,p_actor_id:"synthetic-actor",p_command:c}]]);expect((await response.json()).status).toBe("queued");
 });
 it("denies ungoverned agent requests and caller-supplied calculated results before enqueuing",async()=>{
  for(const agent of [true,false]){mocks.rpc.mockClear();const c=agent?command():{...command(),_result:{finish:"2026-09-08"}},response=await POST(req(c,agent),{params:Promise.resolve({engagementId:randomUUID()})});expect(response.status).toBe(agent?403:400);expect(mocks.rpc).not.toHaveBeenCalled();}
 });
 it("keeps scoped retry failures visible and never reports a stale request as queued",async()=>{
  mocks.rpc.mockResolvedValue({data:null,error:{code:"PT409",message:"Inputs changed since browser review"}});const response=await contractCalculationRequest(req({}),randomUUID(),{kind:"retry_calculation",jobId:randomUUID()});expect(response.status).toBe(409);expect((await response.json()).error).toContain("Inputs changed");expect(mocks.rpc.mock.calls[0][0]).toBe("retry_contract_calculation");
 });
});

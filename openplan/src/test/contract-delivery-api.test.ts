import { beforeEach,describe,expect,it,vi } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { deliveryFixture } from "./fixtures/contract-delivery";
const mocks=vi.hoisted(()=>({rpc:vi.fn(),getUser:vi.fn()}));
vi.mock("server-only",()=>({}));
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>({auth:{getUser:mocks.getUser}}),createServiceRoleClient:()=>({rpc:mocks.rpc})}));
import { saveContractCommand } from "@/lib/invoicing/contracts/server";
function request(agent=false){return new NextRequest("http://m11.localhost:3247/api/invoicing/engagements/synthetic/management",{method:"POST",headers:agent?{"x-openplan-assistant-execution-source":"planner_agent_quick_link"}:{}});}
describe("contract delivery API computation and author control",()=>{
 beforeEach(()=>{vi.clearAllMocks();mocks.getUser.mockResolvedValue({data:{user:{id:randomUUID()}}});});
 function context(){const f=deliveryFixture(),state={...f.state,delivery:f.delivery};mocks.rpc.mockImplementation(async(name:string)=>({data:name==="read_contract_management"?state:name==="read_contract_delivery"?f.delivery:{id:randomUUID()},error:null}));return {...f,state,command:{kind:"forecast",requestId:randomUUID(),...f.options,coverageEvidence:"Synthetic source coverage",reviewEvidence:"Synthetic PM review"}};}
 it("calculates server-side from unchanged input versions and strips private rates from retained inputs",async()=>{
  const f=context();f.state.rates=[{id:randomUUID(),staff_id:f.staff,basis:"cost",starts_on:"2026-09-01",ends_on:"2026-10-01",hourly_rate:"123.45",source_reference:"PRIVATE RATE SOURCE"}];
  const response=await saveContractCommand(request(),f.state.engagement.id,f.command);expect(response.status).toBe(200);
  const calls=mocks.rpc.mock.calls.filter(([name])=>name==="record_contract_command");expect(calls).toHaveLength(1);const command=calls[0][1].p_command;expect(command._inputHash).toBe(f.delivery.inputHash);expect(command._result.finish).toBe("2026-09-13");expect(command._result.remainingCost).toBe("100.01");expect(command._inputs.state.rates).toEqual([]);expect(JSON.stringify(command._inputs)).not.toContain("PRIVATE RATE SOURCE");expect(command._request).toEqual(f.command);
 });
 it("refuses inputs that change while they are being read",async()=>{
  const f=context();let count=0;mocks.rpc.mockImplementation(async(name:string)=>({data:name==="read_contract_management"?f.state:name==="read_contract_delivery"?{...f.delivery,inputHash:++count===1?f.delivery.inputHash:"changed"}:{},error:null}));
  const response=await saveContractCommand(request(),f.state.engagement.id,f.command);expect(response.status).toBe(400);expect((await response.json()).error).toContain("changed during reading");expect(mocks.rpc.mock.calls.some(([name])=>name==="record_contract_command")).toBe(false);
 });
 it("refuses caller-supplied calculations and governed-agent writes without saving",async()=>{
  for(const kind of ["forged","agent"]){const f=context();const response=await saveContractCommand(request(kind==="agent"),f.state.engagement.id,kind==="forged"?{...f.command,_result:{finish:"2026-09-08"}}:f.command);expect(response.status).toBe(kind==="agent"?403:400);expect(mocks.rpc.mock.calls.some(([name])=>name==="record_contract_command")).toBe(false);vi.clearAllMocks();mocks.getUser.mockResolvedValue({data:{user:{id:randomUUID()}}});}
 });
});

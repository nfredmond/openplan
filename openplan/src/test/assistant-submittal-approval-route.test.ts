import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const fixture=vi.hoisted(()=>{
  const rows:Record<string,unknown>={};
  const insert=vi.fn().mockResolvedValue({error:null});
  const from=vi.fn((table:string)=>{const chain={select:vi.fn().mockReturnThis(),eq:vi.fn().mockReturnThis(),order:vi.fn().mockReturnThis(),limit:vi.fn().mockReturnThis(),maybeSingle:vi.fn(async()=>({data:rows[table]??null,error:null}))};return chain});
  return{rows,from,insert};
});
const workspaceId="11111111-1111-4111-8111-111111111111",projectId="22222222-2222-4222-8222-222222222222",userId="33333333-3333-4333-8333-333333333333";
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>({auth:{getUser:async()=>({data:{user:{id:"33333333-3333-4333-8333-333333333333"}}})},from:fixture.from}),createServiceRoleClient:()=>({from:()=>({insert:fixture.insert})})}));
vi.mock("@/lib/observability/audit",()=>({createApiAuditLogger:()=>({info:vi.fn(),warn:vi.fn(),error:vi.fn()})}));
import { POST } from "@/app/api/assistant/actions/approvals/route";
import { hashAssistantActionPayload } from "@/lib/assistant/action-approval-server";
const action={kind:"create_project_record",projectId,recordType:"submittal",title:"Synthetic original submittal"};
function request(body:unknown){return new NextRequest("http://localhost/api/assistant/actions/approvals",{method:"POST",body:JSON.stringify(body)})}
beforeEach(()=>{vi.clearAllMocks();fixture.rows.workspace_members={workspace_id:workspaceId,role:"owner"};fixture.rows.projects={id:projectId,workspace_id:workspaceId,name:"Synthetic original project"};fixture.rows.workspaces={id:workspaceId,stage_gate_template_id:"ca_stage_gates_v0_1",stage_gate_template_selection:"explicitly_requested",home_geography_source:null,home_geography_kind:null,home_geography_ref:null,home_country_code:null,home_subdivision_code:null};fixture.rows.stage_gate_decisions=null;});
describe("Submittal consent captures current context",()=>{
  it("stores the context alongside the exact action hash",async()=>{
    const response=await POST(request({workspaceId,action}));
    expect(response.status).toBe(201);
    expect(fixture.insert).toHaveBeenCalledWith(expect.objectContaining({user_id:userId,workspace_id:workspaceId,input_hash:hashAssistantActionPayload(action),execution_context:{version:1,action,project:{id:projectId,workspaceId,name:"Synthetic original project"}}}));
  });
  it("does not mint consent without original workspace",async()=>{const response=await POST(request({workspaceId:null,action}));expect(response.status).toBe(403);expect(fixture.insert).not.toHaveBeenCalled()});
  it("hashes and retains normalized text and defaults consistently",async()=>{const response=await POST(request({workspaceId,action:{...action,title:` ${action.title} `,status:"draft",submittalType:"other",notes:" "}}));expect(response.status).toBe(201);expect(fixture.insert).toHaveBeenCalledWith(expect.objectContaining({input_hash:hashAssistantActionPayload(action),execution_context:expect.objectContaining({action})}));});
  it("does not mint consent for a missing project",async()=>{fixture.rows.projects=null;const response=await POST(request({workspaceId,action}));expect(response.status).toBe(404);expect(fixture.insert).not.toHaveBeenCalled()});
});

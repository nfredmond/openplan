import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { executableProjectSubmittalAction, prepareSubmittalExecutionContext, readSubmittalReceipt, recordSubmittalWithReceipt, submittalApprovalHeaders, SUBMITTAL_PROJECT_COLUMNS } from "@/lib/assistant/project-submittal-receipt";
import { hashAssistantActionPayload } from "@/lib/assistant/action-approval-server";
import { canonicalizeActionPayload } from "@/lib/runtime/action-metadata";

const workspaceId="11111111-1111-4111-8111-111111111111",projectId="22222222-2222-4222-8222-222222222222",userId="33333333-3333-4333-8333-333333333333",approvalId="44444444-4444-4444-8444-444444444444";
const action={kind:"create_project_record" as const,projectId,recordType:"submittal" as const,title:"Synthetic invoice backup"};
const inputHash=hashAssistantActionPayload(action);
const record={id:"55555555-5555-4555-8555-555555555555",project_id:projectId,title:action.title,submittal_type:"other",status:"draft",notes:null,created_by:userId,created_at:"2026-09-10T10:00:00Z",agency_label:null,assignee_user_id:null,reference_number:null,due_date:null,submitted_at:null,review_cycle:1};
const receipt={schemaVersion:1,recordType:"submittal",record};
const project={id:projectId,workspace_id:workspaceId,name:"Synthetic original project"};
const query={select:vi.fn().mockReturnThis(),eq:vi.fn().mockReturnThis(),maybeSingle:vi.fn()};
const from=vi.fn(()=>query),rpc=vi.fn();
const client={from,rpc} as unknown as Parameters<typeof prepareSubmittalExecutionContext>[0] & Parameters<typeof readSubmittalReceipt>[0]["supabase"];
const params={supabase:client,approvalId,inputHash,userId,action};
beforeEach(()=>{vi.clearAllMocks();query.maybeSingle.mockResolvedValue({data:project,error:null});rpc.mockResolvedValue({data:{workspaceId,receipt},error:null});});

describe("approved submittal context and canonical consent",()=>{
  it("normalizes persisted text and defaults, while retaining changes that alter the effect",()=>{
    const harmless={...action,title:`  ${action.title}  `,notes:"  ",status:"draft" as const,submittalType:"other" as const,postActionPrompt:"Refresh later"};
    expect(executableProjectSubmittalAction(harmless)).toEqual(action);
    expect(hashAssistantActionPayload(harmless)).toBe(inputHash);
    expect(hashAssistantActionPayload({...action,title:"Different"})).not.toBe(inputHash);
    expect(hashAssistantActionPayload({...action,notes:"Evidence"})).not.toBe(inputHash);
    expect(hashAssistantActionPayload({...action,status:"submitted"})).not.toBe(inputHash);
  });
  it.each([{title:" "},{title:"x".repeat(161)},{notes:"x".repeat(4001)},{projectId:"bad"},{status:"complete"},{submittalType:"unknown"}])("refuses unexecutable consent %j",change=>{expect(()=>executableProjectSubmittalAction({...action,...change} as unknown as Parameters<typeof executableProjectSubmittalAction>[0])).toThrow("Invalid approved")});
  it("retains exact project identity and name using an asserted projection and scope",async()=>{
    expect(await prepareSubmittalExecutionContext(client,workspaceId,action)).toEqual({version:1,action,project:{id:projectId,workspaceId,name:project.name}});
    expect(from).toHaveBeenCalledWith("projects");expect(query.select).toHaveBeenCalledWith("id, workspace_id, name");
    expect(SUBMITTAL_PROJECT_COLUMNS.split(", ")).toEqual(Object.keys(project));
    expect(query.eq.mock.calls).toEqual([["id",projectId],["workspace_id",workspaceId]]);
  });
  it("refuses absent workspace before reading",async()=>{await expect(prepareSubmittalExecutionContext(client,null,action)).rejects.toMatchObject({status:403});expect(from).not.toHaveBeenCalled()});
  it.each([{data:null,error:null,status:404},{data:null,error:{message:"failed"},status:503},{data:{...project,workspace_id:userId},error:null,status:503},{data:{id:projectId,workspace_id:workspaceId},error:null,status:503}])("does not invent project context %j",async({status,...result})=>{query.maybeSingle.mockResolvedValue(result);await expect(prepareSubmittalExecutionContext(client,workspaceId,action)).rejects.toMatchObject({status})});
});

describe("submittal receipt dispatch",()=>{
  it("requires exact parsed-action headers",()=>{
    const request=(headers:Record<string,string>)=>new NextRequest("http://localhost",{headers});
    const headers={"x-openplan-assistant-approval-id":approvalId,"x-openplan-assistant-input-hash":inputHash};
    expect(submittalApprovalHeaders(request(headers),action)).toEqual({approvalId,inputHash});
    expect(()=>submittalApprovalHeaders(request({}),action)).toThrow("does not match");
    expect(()=>submittalApprovalHeaders(request(headers),{...action,title:"Changed"})).toThrow("does not match");
  });
  it("reads original scope and receipt and distinguishes explicit absence",async()=>{
    expect(await readSubmittalReceipt(params)).toEqual({workspaceId,receipt});
    expect(rpc).toHaveBeenCalledWith("read_assistant_action_receipt",{p_approval_id:approvalId,p_user_id:userId,p_input_hash:inputHash,p_action_kind:"create_project_record"});
    rpc.mockResolvedValue({data:{workspaceId,receipt:null},error:null});expect(await readSubmittalReceipt(params)).toEqual({workspaceId,receipt:null});
  });
  it("refuses a changed hash before the database call",async()=>{await expect(readSubmittalReceipt({...params,inputHash:"bad"})).rejects.toMatchObject({status:403});expect(rpc).not.toHaveBeenCalled()});
  it.each([{}, {workspaceId}, {workspaceId,receipt:{}}, ...[{project_id:userId},{created_by:projectId},{title:"Changed"},{notes:"Changed"},{status:"submitted"},{submittal_type:"reimbursement"},{assignee_user_id:userId},{review_cycle:2}].map(change=>({workspaceId,receipt:{...receipt,record:{...record,...change}}}))])("refuses missing or mismatched original result %j",async data=>{rpc.mockResolvedValue({data,error:null});await expect(readSubmittalReceipt(params)).rejects.toMatchObject({status:503})});
  it("sends exact canonical consent and expected original workspace to the single transaction",async()=>{
    rpc.mockResolvedValue({data:{workspaceId,receipt,replayed:true},error:null});
    expect(await recordSubmittalWithReceipt({...params,workspaceId})).toEqual({receipt,replayed:true});
    expect(rpc).toHaveBeenCalledWith("record_assistant_project_submittal",{p_approval_id:approvalId,p_user_id:userId,p_workspace_id:workspaceId,p_action_canonical:canonicalizeActionPayload(action)});
    rpc.mockResolvedValue({data:{workspaceId:projectId,receipt,replayed:true},error:null});
    await expect(recordSubmittalWithReceipt({...params,workspaceId})).rejects.toMatchObject({status:503});
  });
  it.each([["42501",403],["PT409",409],["22023",400],["PGRST202",503],["42883",503],["23514",503]])("preserves %s refusal without falling back to a separate insert",async(code,status)=>{rpc.mockResolvedValue({data:null,error:{code,message:"Synthetic refusal"}});await expect(recordSubmittalWithReceipt({...params,workspaceId})).rejects.toMatchObject({status});expect(from).not.toHaveBeenCalled()});
});

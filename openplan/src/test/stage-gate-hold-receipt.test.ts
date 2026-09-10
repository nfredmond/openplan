import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { HOLD_WORKSPACE_COLUMNS, HoldReceiptError, holdApprovalHeaders, prepareHoldExecutionContext, readHoldReceipt, recordHoldWithReceipt } from "@/lib/assistant/stage-gate-hold-receipt";
import { hashAssistantActionPayload } from "@/lib/assistant/action-approval-server";
import { canonicalizeActionPayload } from "@/lib/runtime/action-metadata";

const workspaceId="11111111-1111-4111-8111-111111111111",projectId="22222222-2222-4222-8222-222222222222",userId="33333333-3333-4333-8333-333333333333",approvalId="44444444-4444-4444-8444-444444444444";
const action={kind:"record_stage_gate_hold" as const,workspaceId,projectId,gateId:"G01_INITIATION_AUTHORIZATION",rationale:"Synthetic missing evidence"};
const inputHash=hashAssistantActionPayload(action);
const workspace={id:workspaceId,stage_gate_template_id:"ca_stage_gates_v0_1",stage_gate_template_selection:"explicitly_requested",home_geography_source:null,home_geography_kind:null,home_geography_ref:null,home_country_code:null,home_subdivision_code:null};
const decision={missing_artifacts:[],run_id:null,model_run_id:null,county_run_id:null,id:"55555555-5555-4555-8555-555555555555",workspace_id:workspaceId,project_id:projectId,gate_id:action.gateId,decision:"HOLD",rationale:action.rationale,decided_by:userId,decided_at:"2026-09-10T10:00:00Z"};
const receipt={schemaVersion:1,decision};
const queries:Record<string,ReturnType<typeof query>>={};
function query(data:unknown){return{select:vi.fn().mockReturnThis(),eq:vi.fn().mockReturnThis(),order:vi.fn().mockReturnThis(),limit:vi.fn().mockReturnThis(),maybeSingle:vi.fn().mockResolvedValue({data,error:null})}}
const from=vi.fn((table:string)=>queries[table]);
const rpc=vi.fn();
const database={from,rpc};
const client=database as unknown as Parameters<typeof prepareHoldExecutionContext>[0] & Parameters<typeof readHoldReceipt>[0]["supabase"];
beforeEach(()=>{vi.clearAllMocks();queries.workspaces=query(workspace);queries.projects=query({id:projectId,workspace_id:workspaceId});queries.stage_gate_decisions=query({id:decision.id});rpc.mockResolvedValue({data:receipt,error:null});});

describe("HOLD approval context",()=>{
  it("captures the selected workspace binding and latest scoped decision with explicit projections",async()=>{
    const context=await prepareHoldExecutionContext(client,workspaceId,action);
    expect(context).toMatchObject({version:1,workspace,priorDecisionId:decision.id,binding:{templateId:workspace.stage_gate_template_id,templateSelection:"explicitly_requested",gateId:action.gateId}});
    expect(queries.workspaces.select).toHaveBeenCalledWith(HOLD_WORKSPACE_COLUMNS);
    expect(HOLD_WORKSPACE_COLUMNS.split(', ')).toEqual(Object.keys(workspace));
    expect(queries.projects.select).toHaveBeenCalledWith("id, workspace_id");
    expect(queries.projects.eq.mock.calls).toEqual([["id",projectId],["workspace_id",workspaceId]]);
    expect(queries.stage_gate_decisions.select).toHaveBeenCalledWith("id");
    expect(queries.stage_gate_decisions.eq.mock.calls).toEqual([["workspace_id",workspaceId],["project_id",projectId],["gate_id",action.gateId],["template_id",workspace.stage_gate_template_id]]);
    expect(queries.stage_gate_decisions.order.mock.calls).toEqual([["decided_at",{ascending:false}],["id",{ascending:false}]]);
    expect(queries.stage_gate_decisions.limit).toHaveBeenCalledWith(1);
  });
  it("refuses another workspace before reading",async()=>{await expect(prepareHoldExecutionContext(client,projectId,action)).rejects.toMatchObject({status:403});expect(from).not.toHaveBeenCalled()});
  it.each(["workspaces","projects","stage_gate_decisions"])("refuses a failed %s read instead of inventing empty context",async table=>{queries[table].maybeSingle.mockResolvedValue({data:null,error:{message:"Synthetic read failure"}});await expect(prepareHoldExecutionContext(client,workspaceId,action)).rejects.toBeInstanceOf(HoldReceiptError)});
  it("refuses a missing project and unregistered gate",async()=>{queries.projects.maybeSingle.mockResolvedValue({data:null,error:null});await expect(prepareHoldExecutionContext(client,workspaceId,action)).rejects.toMatchObject({status:404});await expect(prepareHoldExecutionContext(client,workspaceId,{...action,gateId:"not-registered"})).rejects.toMatchObject({status:409})});
});

describe("HOLD receipt dispatch",()=>{
  it("checks exact action headers and refuses absent or changed approval evidence",()=>{
    const request=(headers:Record<string,string>)=>new NextRequest("http://localhost/api/stage-gates/decisions",{headers});
    const headers={"x-openplan-assistant-approval-id":approvalId,"x-openplan-assistant-input-hash":inputHash};
    expect(holdApprovalHeaders(request(headers),action)).toEqual({approvalId,inputHash});
    expect(()=>holdApprovalHeaders(request({}),action)).toThrow(HoldReceiptError);
    expect(()=>holdApprovalHeaders(request(headers),{...action,rationale:"Different"})).toThrow(HoldReceiptError);
  });
  it("reads a scoped receipt and preserves an explicit absent result",async()=>{
    expect(await readHoldReceipt({supabase:client,approvalId,inputHash,userId,action})).toEqual(receipt);
    expect(rpc).toHaveBeenCalledWith("read_assistant_hold_receipt",{p_approval_id:approvalId,p_user_id:userId,p_workspace_id:workspaceId,p_input_hash:inputHash});
    rpc.mockResolvedValue({data:null,error:null});expect(await readHoldReceipt({supabase:client,approvalId,inputHash,userId,action})).toBeNull();
  });
  it.each([{}, {schemaVersion:1,decision:{...decision,missing_artifacts:["changed"]}}, {schemaVersion:1,decision:{...decision,run_id:userId}}, {schemaVersion:1,decision:{...decision,project_id:userId}}, {schemaVersion:1,decision:{...decision,rationale:"Different"}}, {schemaVersion:1,decision:{...decision,decided_by:projectId}}])("refuses a malformed or mismatched receipt %j",async data=>{rpc.mockResolvedValue({data,error:null});await expect(readHoldReceipt({supabase:client,approvalId,inputHash,userId,action})).rejects.toMatchObject({status:503})});
  it("sends canonical executable fields to the transaction, preserving the returned replay status",async()=>{
    const context=await prepareHoldExecutionContext(client,workspaceId,action);
    rpc.mockResolvedValue({data:{receipt,replayed:true},error:null});
    expect(await recordHoldWithReceipt({supabase:client,approvalId,userId,action:{...action,postActionPrompt:"Read context later"},binding:context.binding})).toEqual({receipt,replayed:true});
    expect(rpc).toHaveBeenCalledWith("record_assistant_stage_gate_hold",{p_approval_id:approvalId,p_user_id:userId,p_workspace_id:workspaceId,p_action_canonical:canonicalizeActionPayload(action),p_binding:context.binding});
  });
  it.each([["42501",403],["PT409",409],["42883",503],["PGRST202",503],["23514",503]])("keeps %s errors distinct and refuses unknown writes",async(code,status)=>{
    rpc.mockResolvedValue({data:null,error:{code,message:"Synthetic refusal"}});
    await expect(readHoldReceipt({supabase:client,approvalId,inputHash,userId,action})).rejects.toMatchObject({status});
  });
});

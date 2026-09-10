import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hashAssistantActionPayload } from "@/lib/assistant/action-approval-server";
import { SUBMITTAL_RECOVERY_COLUMNS, loadSubmittalRecoveryPage } from "@/lib/assistant/project-submittal-recovery";

const workspaceId="11111111-1111-4111-8111-111111111111", userId="22222222-2222-4222-8222-222222222222", approvalId="33333333-3333-4333-8333-333333333333", projectId="44444444-4444-4444-8444-444444444444";
const action={kind:"create_project_record" as const,projectId,recordType:"submittal" as const,title:"Synthetic invoice backup"};
const context={version:1,action,project:{id:projectId,workspaceId,name:"Synthetic original project"}};
const row={id:approvalId,workspace_id:workspaceId,user_id:userId,input_hash:hashAssistantActionPayload(action),created_at:"2026-09-10T00:00:00Z",expires_at:"2026-09-10T01:00:00Z",execution_context:context};
let rows: unknown[], error: unknown;
const chain={select:vi.fn().mockReturnThis(),eq:vi.fn().mockReturnThis(),order:vi.fn().mockReturnThis(),range:vi.fn().mockReturnThis(),then: (resolve: (value:unknown)=>unknown)=>Promise.resolve({data:rows,error}).then(resolve)};
const from=vi.fn(()=>chain),rpc=vi.fn();
const db={from,rpc} as unknown as SupabaseClient;
beforeEach(()=>{vi.clearAllMocks();rows=[row];error=null;rpc.mockResolvedValue({data:{workspaceId,receipt:null},error:null});});
describe("server retained submittal recovery",()=>{
  it("reads only this user's workspace approvals with the complete projection and stable page order",async()=>{
    const result=await loadSubmittalRecoveryPage(db,userId,workspaceId,20);
    expect(from).toHaveBeenCalledWith("assistant_action_approvals");
    expect(chain.select).toHaveBeenCalledWith(SUBMITTAL_RECOVERY_COLUMNS);
    expect(SUBMITTAL_RECOVERY_COLUMNS).toBe("id, workspace_id, user_id, input_hash, created_at, expires_at, execution_context");
    expect(chain.eq.mock.calls).toEqual([["workspace_id",workspaceId],["user_id",userId],["action_kind","create_project_record"]]);
    expect(chain.order.mock.calls).toEqual([["created_at",{ascending:false}],["id",{ascending:false}]]);
    expect(chain.range).toHaveBeenCalledWith(20,39);
    expect(result).toMatchObject({items:[{approvalId,action,projectName:"Synthetic original project",receipt:null}],nextOffset:null});
    expect(rpc).toHaveBeenCalledWith("read_assistant_action_receipt",expect.objectContaining({p_approval_id:approvalId,p_user_id:userId,p_action_kind:"create_project_record",p_input_hash:row.input_hash}));
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it("reads an older exact approval without a first-page cutoff",async()=>{
    expect((await loadSubmittalRecoveryPage(db,userId,workspaceId,0,approvalId)).nextOffset).toBeNull();
    expect(chain.eq).toHaveBeenCalledWith("id",approvalId);expect(chain.range).not.toHaveBeenCalled();
  });
  it("offers the next page when the current page is full",async()=>{rows=Array.from({length:20},()=>row);expect((await loadSubmittalRecoveryPage(db,userId,workspaceId,20)).nextOffset).toBe(40);});
  it("retains an explicit legacy gap without executing or inventing the request",async()=>{rows=[{...row,execution_context:{version:1}}];expect((await loadSubmittalRecoveryPage(db,userId,workspaceId,0)).items[0]).toMatchObject({action:null,receipt:null,issue:expect.stringContaining("not retained")});expect(rpc).not.toHaveBeenCalled();});
  it.each([{user_id:projectId},{workspace_id:projectId}])("refuses an out-of-scope returned row %j",async(change)=>{rows=[{...row,...change}];await expect(loadSubmittalRecoveryPage(db,userId,workspaceId,0)).rejects.toThrow("could not be verified");expect(rpc).not.toHaveBeenCalled();});
  it.each([{...action,title:"Changed request"},{...action,projectId:userId}])("refuses changed retained action %j",async(changed)=>{rows=[{...row,execution_context:{...context,action:changed}}];await expect(loadSubmittalRecoveryPage(db,userId,workspaceId,0)).rejects.toThrow("retained scope or hash");expect(rpc).not.toHaveBeenCalled();});
  it.each([{...context.project,id:userId},{...context.project,workspaceId:projectId}])("refuses a relabeled retained project %j",async project=>{rows=[{...row,execution_context:{...context,project}}];await expect(loadSubmittalRecoveryPage(db,userId,workspaceId,0)).rejects.toThrow("retained scope or hash");expect(rpc).not.toHaveBeenCalled()});
  it("does not accept a receipt read from another original workspace",async()=>{rpc.mockResolvedValue({data:{workspaceId:projectId,receipt:null},error:null});await expect(loadSubmittalRecoveryPage(db,userId,workspaceId,0)).rejects.toThrow("original submittal workspace")});
  it("fails closed on approval read failure",async()=>{error={message:"offline"};await expect(loadSubmittalRecoveryPage(db,userId,workspaceId,0)).rejects.toThrow("could not be read");expect(rpc).not.toHaveBeenCalled();});
  it("does not turn a failed receipt read into a pending approval",async()=>{rpc.mockResolvedValue({data:null,error:{code:"XX000",message:"offline"}});await expect(loadSubmittalRecoveryPage(db,userId,workspaceId,0)).rejects.toThrow();});
});

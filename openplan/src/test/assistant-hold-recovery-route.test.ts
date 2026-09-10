import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks=vi.hoisted(()=>({user:vi.fn(),membership:vi.fn(),select:vi.fn(),eq:vi.fn(),service:vi.fn(),load:vi.fn()}));
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>({auth:{getUser:mocks.user},from:()=>({select:mocks.select})}),createServiceRoleClient:mocks.service}));
vi.mock("@/lib/assistant/stage-gate-hold-recovery",()=>({loadHoldRecoveryPage:mocks.load}));
vi.mock("@/lib/observability/audit",()=>({createApiAuditLogger:()=>({error:vi.fn()})}));
import { GET } from "@/app/api/assistant/actions/holds/route";
import { HoldReceiptError } from "@/lib/assistant/stage-gate-hold-receipt";
const workspaceId="11111111-1111-4111-8111-111111111111",userId="22222222-2222-4222-8222-222222222222",approvalId="33333333-3333-4333-8333-333333333333";
function request(query=`workspaceId=${workspaceId}`){return new NextRequest(`http://localhost/api/assistant/actions/holds?${query}`);}
beforeEach(()=>{vi.clearAllMocks();mocks.user.mockResolvedValue({data:{user:{id:userId}}});mocks.membership.mockResolvedValue({data:{workspace_id:workspaceId,role:"viewer"},error:null});const chain={eq:mocks.eq,maybeSingle:mocks.membership};mocks.select.mockReturnValue(chain);mocks.eq.mockReturnValue(chain);mocks.service.mockReturnValue({service:true});mocks.load.mockResolvedValue({items:[],nextOffset:null});});
describe("approved HOLD read access",()=>{
  it("allows current viewers to read their own receipts without granting write access",async()=>{
    const response=await GET(request(`workspaceId=${workspaceId}&offset=20&approvalId=${approvalId}`));
    expect(response.status).toBe(200);expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.select).toHaveBeenCalledWith("workspace_id, role");expect(mocks.eq.mock.calls).toEqual([["workspace_id",workspaceId],["user_id",userId]]);
    expect(mocks.load).toHaveBeenCalledWith({service:true},userId,workspaceId,20,approvalId);
  });
  it("requires authentication before privileged reads",async()=>{mocks.user.mockResolvedValue({data:{user:null}});expect((await GET(request())).status).toBe(401);expect(mocks.service).not.toHaveBeenCalled();});
  it.each([null,{role:"unknown"}])("refuses missing or unsupported membership %j",async(data)=>{mocks.membership.mockResolvedValue({data,error:null});expect((await GET(request())).status).toBe(403);expect(mocks.service).not.toHaveBeenCalled();});
  it("does not infer access from a failed membership read",async()=>{mocks.membership.mockResolvedValue({data:{role:"owner"},error:{message:"offline"}});expect((await GET(request())).status).toBe(503);expect(mocks.service).not.toHaveBeenCalled();});
  it.each(["workspaceId=bad",`workspaceId=${workspaceId}&offset=-1`,`workspaceId=${workspaceId}&approvalId=bad`])("rejects malformed queries %s",async(query)=>{expect((await GET(request(query))).status).toBe(400);expect(mocks.user).not.toHaveBeenCalled();});
  it("preserves access revocation detected during receipt read",async()=>{mocks.load.mockRejectedValue(new HoldReceiptError("Access revoked",403));const response=await GET(request());expect(response.status).toBe(403);expect(await response.json()).toEqual({error:"Access revoked"});});
  it("reports unexpected failures without inventing an empty result",async()=>{mocks.load.mockRejectedValue(new Error("offline"));expect((await GET(request())).status).toBe(503);});
});

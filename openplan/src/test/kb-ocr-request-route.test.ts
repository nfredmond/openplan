import {beforeEach,describe,expect,it,vi} from "vitest";
import {NextRequest} from "next/server";
const mocks=vi.hoisted(()=>({user:vi.fn(),document:vi.fn(),member:vi.fn(),enqueue:vi.fn(),select:vi.fn(),eq:vi.fn()}));
vi.mock("server-only",()=>({}));
vi.mock("@/lib/knowledge-base/extraction-jobs",()=>({enqueueExtraction:mocks.enqueue}));
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>({auth:{getUser:mocks.user},from:(table:string)=>{const q={select:(s:string)=>{mocks.select(table,s);return q;},eq:(k:string,v:unknown)=>{mocks.eq(table,k,v);return q;},maybeSingle:table==="kb_documents"?mocks.document:mocks.member};return q;}}),createServiceRoleClient:vi.fn()}));
import {POST} from "@/app/api/knowledge-base/documents/[documentId]/ocr/route";
const documentId="22222222-2222-4222-8222-222222222222";
const context={params:Promise.resolve({documentId})};
const request=(body:unknown={mode:"text"},headers:Record<string,string>={})=>new NextRequest("http://localhost/api/reading",{method:"POST",headers:{"content-type":"application/json",...headers},body:JSON.stringify(body)});
/** Route checks do not simulate worker liveness. The accepted reference is persisted by the tested SQL RPC. */
describe("retained document reading requests",()=>{
  beforeEach(()=>{vi.clearAllMocks();mocks.user.mockResolvedValue({data:{user:{id:"actor"}}});mocks.document.mockResolvedValue({data:{id:documentId,workspace_id:"workspace",source_kind:"uploaded_pdf",status:"ready"},error:null});mocks.member.mockResolvedValue({data:{role:"member"},error:null});mocks.enqueue.mockResolvedValue({id:"job",request_id:"request",status:"queued"});});
  it("permits rereading a ready original, records the exact request identity and returns an accepted job",async()=>{
    const requestId="33333333-3333-4333-8333-333333333333";
    const response=await POST(request({mode:"text",requestId}),context);expect(response.status).toBe(202);expect((await response.json()).job.id).toBe("job");
    expect(mocks.enqueue).toHaveBeenCalledWith(documentId,"actor","text","http://localhost",requestId);
    expect(mocks.select).toHaveBeenCalledWith("kb_documents","id, workspace_id, source_kind, status, extraction_source, page_count");expect(mocks.eq).toHaveBeenCalledWith("workspace_members","workspace_id","workspace");expect(mocks.eq).toHaveBeenCalledWith("workspace_members","user_id","actor");
  });
  it("refuses viewer, outsider, missing session, role read failure and agent writes before queueing",async()=>{
    mocks.member.mockResolvedValueOnce({data:{role:"viewer"},error:null});expect((await POST(request(),context)).status).toBe(403);
    mocks.document.mockResolvedValueOnce({data:null,error:null});expect((await POST(request(),context)).status).toBe(404);
    mocks.user.mockResolvedValueOnce({data:{user:null}});expect((await POST(request(),context)).status).toBe(401);
    mocks.member.mockResolvedValueOnce({data:null,error:{message:"unavailable"}});expect((await POST(request(),context)).status).toBe(503);
    expect((await POST(request({}, {"x-openplan-assistant-execution-source":"planner_agent_quick_link"}),context)).status).toBe(403);expect(mocks.enqueue).not.toHaveBeenCalled();
  });
  it("rejects non-PDF, invalid commands and unavailable persistence without promising accepted work",async()=>{
    mocks.document.mockResolvedValueOnce({data:{id:documentId,workspace_id:"workspace",source_kind:"uploaded_txt"},error:null});expect((await POST(request(),context)).status).toBe(409);
    expect((await POST(request({mode:"invent"}),context)).status).toBe(400);mocks.enqueue.mockRejectedValueOnce(new Error("persistence failed"));expect((await POST(request(),context)).status).toBe(503);
  });
});

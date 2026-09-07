import {beforeEach,describe,expect,it,vi} from "vitest";
import {NextRequest} from "next/server";
const mocks=vi.hoisted(()=>({rpc:vi.fn(),select:vi.fn(),eq:vi.fn(),job:vi.fn(),service:vi.fn()}));
vi.mock("@/lib/supabase/server",()=>({createServiceRoleClient:mocks.service}));
vi.mock("@/lib/observability/audit",()=>({createApiAuditLogger:()=>({warn:vi.fn(),info:vi.fn(),error:vi.fn()})}));
import {POST} from "@/app/api/knowledge-base/ocr-callback/route";
const payload=()=>({schemaVersion:"openplan-ocr-extraction.v1",requestId:"request-one",callbackId:"callback-one",jobReference:"worker-one",status:"succeeded",occurredAt:"2026-09-06T12:00:00Z",pageCount:2,pages:[{page:1,text:"A source paragraph for extraction."},{page:2,text:""}]});
const request=(body:unknown=payload(),token="synthetic-token")=>new NextRequest("http://localhost/api/knowledge-base/ocr-callback",{method:"POST",headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},body:JSON.stringify(body)});
/** HTTP validation and exact transaction input. Live SQL tests cover atomicity, roles and retry state. */
describe("durable extraction callback",()=>{
  beforeEach(()=>{vi.clearAllMocks();vi.stubEnv("OPENPLAN_KB_OCR_CALLBACK_BEARER_TOKEN","synthetic-token");mocks.job.mockResolvedValue({data:{id:"job",document_id:"doc",workspace_id:"ws"},error:null});mocks.rpc.mockResolvedValue({data:{ok:true},error:null});mocks.select.mockReturnValue({eq:mocks.eq});mocks.eq.mockReturnValue({maybeSingle:mocks.job});mocks.service.mockReturnValue({from:()=>({select:mocks.select}),rpc:mocks.rpc});});
  it("passes every source page including blanks and scoped chunks to one durable transaction",async()=>{
    const response=await POST(request());expect(response.status).toBe(200);
    expect(mocks.select).toHaveBeenCalledWith("id, document_id, workspace_id");expect(mocks.eq).toHaveBeenCalledWith("request_id","request-one");
    const [name,args]=mocks.rpc.mock.calls[0];expect(name).toBe("apply_kb_extraction_callback");expect(args.p_callback.pages).toEqual(payload().pages);
    expect(args.p_chunks).toHaveLength(1);expect(args.p_chunks[0]).toMatchObject({document_id:"doc",workspace_id:"ws",page_from:1,page_to:1,content:"A source paragraph for extraction."});
    expect(args.p_payload_bytes).toBeGreaterThan(0);
  });
  it("refuses missing configuration, wrong bearer and malformed page sequence before database writes",async()=>{
    expect((await POST(request(payload(),"wrong"))).status).toBe(401);
    expect((await POST(request({...payload(),pages:[{page:2,text:"wrong order"}]}))).status).toBe(400);
    vi.stubEnv("OPENPLAN_KB_OCR_CALLBACK_BEARER_TOKEN","");expect((await POST(request())).status).toBe(503);expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("refuses unknown jobs, revoked actors and changed callback identities and leaves database failures retryable",async()=>{
    mocks.job.mockResolvedValueOnce({data:null,error:null});expect((await POST(request())).status).toBe(404);
    for(const [code,status] of [["42501",403],["PT409",409],["XX000",503]] as const){mocks.rpc.mockResolvedValueOnce({error:{code},data:null});expect((await POST(request())).status).toBe(status);}
  });
  it("preserves database deduplication and passes no chunks for progress",async()=>{
    mocks.rpc.mockResolvedValue({data:{ok:true,deduped:true},error:null});expect(await (await POST(request())).json()).toEqual({ok:true,deduped:true});
    await POST(request({...payload(),status:"running",pages:undefined,pageCount:undefined,progress:40}));expect(mocks.rpc.mock.calls.at(-1)?.[1].p_chunks).toEqual([]);
  });
});

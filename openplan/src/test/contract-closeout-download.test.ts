import {beforeEach,it,expect,vi} from "vitest";
import {NextRequest} from "next/server";
import {randomUUID} from "node:crypto";
import {deliveryFixture} from "./fixtures/contract-delivery";
const mocks=vi.hoisted(()=>({access:vi.fn(),select:vi.fn(),eq:vi.fn(),read:vi.fn()}));
vi.mock("@/lib/invoicing/contracts/server",()=>({contractAccess:mocks.access}));
vi.mock("@/lib/observability/audit",()=>({createApiAuditLogger:()=>({info:vi.fn()})}));
import {GET} from "@/app/api/invoicing/engagements/[engagementId]/management/closeout/route";
beforeEach(()=>{vi.clearAllMocks();mocks.access.mockResolvedValue({client:{from:()=>({select:mocks.select})}});mocks.select.mockReturnValue({eq:mocks.eq});mocks.eq.mockReturnValue({eq:mocks.eq,maybeSingle:mocks.read});});
it("downloads retained old and new formats using exact scoped identity and full source projection",async()=>{
 const {state}=deliveryFixture(),closeoutId=randomUUID(),position={invoices:[],incurred:"0.00"};
 for(const formatVersion of [1,2,3]){mocks.read.mockResolvedValue({data:{id:closeoutId,state:"closed",content_hash:"a".repeat(64),content:{package:{formatVersion,state,position,request:{asOf:"2026-09-08"}}}},error:null});const result=await GET(new NextRequest(`http://m11.localhost/management/closeout?closeoutId=${closeoutId}&format=csv`),{params:Promise.resolve({engagementId:state.engagement.id})});expect(result.status).toBe(200);expect(result.headers.get("Cache-Control")).toBe("private, no-store");const csv=await result.text();expect(csv).toContain('"contract_total_incurred"');expect(csv.includes('"handoff_format"')).toBe(formatVersion>=2);}
 expect(mocks.select).toHaveBeenCalledWith("id,engagement_id,version,state,input_hash,content,content_hash,created_at,created_by,previous_id");expect(mocks.eq).toHaveBeenCalledWith("id",closeoutId);expect(mocks.eq).toHaveBeenCalledWith("engagement_id",state.engagement.id);
});
it("refuses unsupported format or a package hidden by database access",async()=>{const closeoutId=randomUUID(),request=new NextRequest(`http://m11.localhost/management/closeout?closeoutId=${closeoutId}&format=json`),params={params:Promise.resolve({engagementId:randomUUID()})};mocks.read.mockResolvedValue({data:{state:"closed",content:{package:{formatVersion:99}}},error:null});expect((await GET(request,params)).status).toBe(409);mocks.read.mockResolvedValue({data:null,error:null});expect((await GET(request,params)).status).toBe(404);});

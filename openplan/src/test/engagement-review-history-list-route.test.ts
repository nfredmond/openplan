import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const m=vi.hoisted(()=>({access:vi.fn(),client:vi.fn(),getUser:vi.fn()}));
vi.mock("@/lib/supabase/server",()=>({createClient:m.client}));
vi.mock("@/lib/engagement/api",()=>({loadCampaignAccess:m.access}));
vi.mock("@/lib/observability/audit",()=>({createApiAuditLogger:()=>({info:vi.fn(),error:vi.fn()})}));
import { GET } from "@/app/api/engagement/campaigns/[campaignId]/reports/route";
let selected:string;
let filters:Array<[string,unknown]>;
let from:ReturnType<typeof vi.fn>;
const campaignId="11111111-1111-4111-8111-111111111111",reportId="22222222-2222-4222-8222-222222222222";
beforeEach(()=>{
 vi.clearAllMocks();selected="";filters=[];m.getUser.mockResolvedValue({data:{user:{id:"staff"}}});m.access.mockResolvedValue({allowed:true,error:null,membership:{role:"member"}});
 const builder={eq:(key:string,value:unknown)=>{filters.push([key,value]);return builder;},order:()=>builder,limit:()=>builder,then:(resolve:(v:unknown)=>unknown)=>Promise.resolve({data:[{id:"job",snapshot_format:1}],error:null}).then(resolve)};
 from=vi.fn(()=>({select:(columns:string)=>{selected=columns;return builder;}}));m.client.mockResolvedValue({from,auth:{getUser:m.getUser}});
});
describe("saved engagement review format listing",()=>{
 it("projects the derived format without fetching raw private snapshot text",async()=>{
  const response=await GET(new NextRequest(`http://localhost/api/engagement/campaigns/${campaignId}/reports?reportId=${reportId}`),{params:Promise.resolve({campaignId})});
  expect(response.status).toBe(200);expect((await response.json()).jobs).toEqual([{id:"job",snapshot_format:1}]);
  expect(selected).toBe("id,report_id,scope,snapshot_format,filters_json,snapshot_sha256,status,phase,attempts,artifacts_json,failure_detail,created_at");
  expect(filters).toEqual([["campaign_id",campaignId],["report_id",reportId]]);
 });
 it("refuses an unreadable membership before reading saved formats",async()=>{
  m.access.mockResolvedValue({allowed:false,error:{message:"unavailable"}});
  expect((await GET(new NextRequest(`http://localhost/api/engagement/campaigns/${campaignId}/reports`),{params:Promise.resolve({campaignId})})).status).toBe(403);
  expect(from).not.toHaveBeenCalled();
 });
});

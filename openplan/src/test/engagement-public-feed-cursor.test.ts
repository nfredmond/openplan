import { loadCampaignAccess } from "@/lib/engagement/api";
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PUBLIC_ITEM_COLUMNS, readPublicApprovedItems } from "@/lib/engagement/public-approved-items";

type Row = { id: string; created_at: string; campaign_id: string; status: string; body: string; moderation_notes: string };
function fixture(cap: number, failPage = -1) {
  const original: Row[] = Array.from({length: 1005}, (_, index) => ({
    id:`00000000-0000-4000-8000-${String(index).padStart(12,"0")}`,
    created_at: `2026-09-${String(20-Math.floor(index/100)).padStart(2,"0")}T00:00:00+00:00`,
    campaign_id:"campaign",status:"approved",body:`Contribution ${index}`,moderation_notes:"private reason",
  }));
  const added: Row = {...original[0],id:"ffffffff-ffff-4fff-8fff-ffffffffffff",created_at:"2026-09-30T00:00:00+00:00",status:"pending"};
  const rows=[...original,added,{...original[0],id:"foreign",campaign_id:"other"}];
  let calls=0;
  const cursors:string[]=[];
  const client={from(table:string){expect(table).toBe("engagement_items");let columns="";const filters:Record<string,string>={};let cursor:string|undefined;const order:string[]=[];
    const query={select(value:string){columns=value;return query;},eq(key:string,value:string){filters[key]=value;return query;},order(key:string,options:{ascending:boolean}){order.push(`${key}:${options.ascending}`);return query;},or(value:string){cursor=value;cursors.push(value);return query;},async range(from:number,to:number){
      expect(columns).toBe(PUBLIC_ITEM_COLUMNS);expect(columns).not.toContain("moderation_notes");
      expect(filters).toEqual({campaign_id:"campaign",status:"approved"});
      expect(order).toEqual(["created_at:false","id:true"]);expect(from).toBe(0);
      calls++;
      if(calls===2){added.status="approved";original[1].status="rejected";}
      if(calls===failPage)return {data:null,error:{message:"second page unavailable"}};
      const match=cursor?.match(/^created_at\.lt\.(.*),and\(created_at\.eq\.(.*),id\.gt\.(.*)\)$/);
      if(cursor)expect(match).not.toBeNull();
      const selected=rows.filter(row=>row.campaign_id===filters.campaign_id&&row.status===filters.status&&(!match||row.created_at<match[1]||(row.created_at===match[2]&&row.id>match[3])))
        .sort((a,b)=>b.created_at.localeCompare(a.created_at)||a.id.localeCompare(b.id)).slice(0,Math.min(cap,to+1));
      return {data:selected.map(row=>Object.fromEntries(columns.split(", ").map(key=>[key,row[key as keyof Row]]))),error:null};
    }};return query;}} as unknown as Pick<SupabaseClient,"from">;
  return {client,original,cursors};
}

describe("public feed advances by received keys while moderation changes eligibility",()=>{
  for(const cap of [500,73])it(`keeps every original record once despite changing offsets and server cap ${cap}`,async()=>{
    const {client,original,cursors}=fixture(cap);const result=await readPublicApprovedItems<Row>(client,"campaign");
    expect(result.error).toBeNull();expect(result.data.map(row=>row.id)).toEqual(original.map(row=>row.id));
    expect(new Set(result.data.map(row=>row.id)).size).toBe(1005);expect(cursors.length).toBeGreaterThan(1);
    expect(JSON.stringify(result.data)).not.toContain("private reason");
  });
  it("discards the partial list when a later page fails",async()=>{
    const {client}=fixture(500,2);const result=await readPublicApprovedItems<Row>(client,"campaign");
    expect(result.data).toEqual([]);expect(result.error?.message).toBe("second page unavailable");
  });
});

it("campaign API reads expose the version a new submission must name",async()=>{
  const client={from(table:string){return {select(columns:string){
    const row:Record<string,unknown>=table==="engagement_campaigns"?{id:"campaign",workspace_id:"workspace",configuration_version_id:"published-version"}:{workspace_id:"workspace",role:"owner"};
    const query={eq:()=>query,maybeSingle:async()=>({data:Object.fromEntries(columns.split(", ").map(key=>[key,row[key]])),error:null})};return query;
  }};}};
  const result=await loadCampaignAccess(client,"campaign","user","engagement.read");
  expect(result.allowed).toBe(true);expect(result.campaign?.configuration_version_id).toBe("published-version");
});

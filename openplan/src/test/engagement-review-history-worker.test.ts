import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import native from "./fixtures/decision-link-native.json";
const m=vi.hoisted(()=>({service:vi.fn(),pdf:vi.fn()}));
vi.mock("@/lib/supabase/server",()=>({createServiceRoleClient:m.service}));
vi.mock("@/lib/reports/pdf",()=>({renderReportPdf:m.pdf}));
import { processNextEngagementReport } from "@/lib/engagement/review-export-worker";
const hash=(s:string|Buffer)=>createHash("sha256").update(s).digest("hex");
let root:string;
let job:{id:string;report_id:string;workspace_id:string;campaign_id:string;scope:string;snapshot_text:string;snapshot_sha256:string};
let updates:Record<string,unknown>[];
let upload:ReturnType<typeof vi.fn>;
let rpc:ReturnType<typeof vi.fn>;
beforeEach(async()=>{
 vi.clearAllMocks();root=await mkdtemp(join(tmpdir(),"openplan-synthetic-history-worker-"));updates=[];
 const snapshot={schema:2,capturedAt:"2026-09-14T12:00:00Z",scope:"internal",filters:{},campaign:{id:native.scope.campaignId,title:"SYNTHETIC worker archive",summary:null,configurationVersionId:null},items:[],sessions:[],answers:[],responses:[],definitions:[],workspaceId:native.scope.workspaceId,decisionLinkHistoryScope:"campaign",decisionLinkCount:2,decisionLinks:native.withdrawn.entries};
 const raw=JSON.stringify(snapshot);job={id:"50000000-0000-4000-8000-000000000005",report_id:"60000000-0000-4000-8000-000000000006",campaign_id:native.scope.campaignId,workspace_id:native.scope.workspaceId,scope:"internal",snapshot_text:raw,snapshot_sha256:hash(raw)};
 upload=vi.fn(async()=>({error:null}));rpc=vi.fn(async(name:string)=>({data:name==="claim_engagement_report"?{...job}:null,error:null}));
 m.pdf.mockResolvedValue({engine:"chrome",bytes:new Uint8Array([37,80,68,70])});
 m.service.mockReturnValue({rpc,storage:{from:()=>({upload})},from:()=>({update:(value:Record<string,unknown>)=>{updates.push(value);const builder={eq:()=>builder,select:()=>builder,maybeSingle:async()=>({data:{id:job.id},error:null})};return builder;}})});
});
afterEach(async()=>{await rm(root,{recursive:true,force:true});});
describe("private decision-history worker recovery",()=>{
 it("reuses a verified cache on an interrupted retry without rendering again",async()=>{
  expect(await processNextEngagementReport(root)).toBe(true);expect(upload).toHaveBeenCalledTimes(3);expect(m.pdf).toHaveBeenCalledOnce();
  const original=await readFile(join(root,"engagement",job.id,"review.zip"));
  expect(await processNextEngagementReport(root)).toBe(true);expect(upload).toHaveBeenCalledTimes(6);expect(m.pdf).toHaveBeenCalledOnce();
  expect(await readFile(join(root,"engagement",job.id,"review.zip"))).toEqual(original);
  expect(rpc.mock.calls.filter(([name])=>name==="finish_engagement_report")).toHaveLength(2);
  expect(updates.some(row=>row.status==="failed")).toBe(false);
 });
 it("validates history and job scope before trusting an existing cache",async()=>{
  await processNextEngagementReport(root);upload.mockClear();rpc.mockClear();
  job.workspace_id="70000000-0000-4000-8000-000000000007";
  expect(await processNextEngagementReport(root)).toBe(true);
  expect(upload).not.toHaveBeenCalled();expect(m.pdf).toHaveBeenCalledOnce();
  expect(updates.at(-1)).toMatchObject({status:"failed",failure_detail:"Private decision history scope differs"});
  expect(rpc.mock.calls.some(([name])=>name==="finish_engagement_report")).toBe(false);
 });
 it("rebuilds a damaged cache from the original retained snapshot",async()=>{
  await processNextEngagementReport(root);
  const pdf=join(root,"engagement",job.id,"review.pdf");const original=await readFile(pdf);
  await writeFile(pdf,"SYNTHETIC corrupted cache");
  expect(await processNextEngagementReport(root)).toBe(true);expect(m.pdf).toHaveBeenCalledTimes(2);
  expect(await readFile(pdf)).toEqual(original);expect(updates.some(row=>row.status==="failed")).toBe(false);
 });
});

import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import native from "./fixtures/decision-link-native.json";
const m = vi.hoisted(() => ({ service: vi.fn(), current: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createServiceRoleClient: m.service }));
vi.mock("@/lib/engagement/survey-responses", () => ({ publicReviewStillCurrent: m.current }));
import { downloadEngagementReview } from "@/lib/engagement/review-export-download";
const hash = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
const bytes = Buffer.from("%PDF-SYNTHETIC-download-control");
const snapshot = () => ({ schema: 2, capturedAt: "2026-09-14T12:00:00Z", scope: "internal", filters: {}, campaign: { id: native.scope.campaignId, title: "SYNTHETIC review", summary: null, configurationVersionId: null }, items: [], sessions: [], answers: [], responses: [], definitions: [], workspaceId: native.scope.workspaceId, decisionLinkHistoryScope: "campaign", decisionLinkCount: 2, decisionLinks: structuredClone(native.withdrawn.entries) });
let raw: string;
let job: { id: string; report_id: string; campaign_id: string; workspace_id: string; scope: string; status: string; snapshot_sha256: string; artifacts_json: {format:string;path:string;checksum:string;contentType:string;byteLength:number}[] };
let projections: Array<[string,string]>;
let download: ReturnType<typeof vi.fn>;
const query = (table: string, data: unknown) => ({ select: (columns: string) => { projections.push([table,columns]); const builder = { eq: () => builder, maybeSingle: async () => ({ data, error: null }) }; return builder; } });
const caller = { from: (table: string) => query(table, job) };
const call = () => downloadEngagementReview(caller as unknown as Parameters<typeof downloadEngagementReview>[0],job.id,"pdf");
beforeEach(() => {
  vi.clearAllMocks(); projections=[]; raw=JSON.stringify(snapshot());
  job={id:"50000000-0000-4000-8000-000000000005",report_id:"60000000-0000-4000-8000-000000000006",campaign_id:native.scope.campaignId,workspace_id:native.scope.workspaceId,scope:"internal",status:"complete",snapshot_sha256:hash(raw),artifacts_json:[]};
  job.artifacts_json=[{format:"pdf",path:`${job.workspace_id}/${job.report_id}/${job.id}/${hash(bytes)}.pdf`,checksum:hash(bytes),contentType:"application/pdf",byteLength:bytes.length}];
  download=vi.fn(async()=>({data:new Blob([bytes]),error:null}));
  m.service.mockReturnValue({from:(table:string)=>query(table,{snapshot_text:raw}),storage:{from:()=>({download})}});
  m.current.mockResolvedValue(true);
});
describe("retained review download checks history before delivering bytes",()=>{
  it("delivers an internal archive with complete history and scoped job projections",async()=>{
    const response=await call();expect(response.status).toBe(200);expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
    expect(projections).toEqual([["engagement_report_jobs","id,workspace_id,campaign_id,report_id,scope,status,artifacts_json,snapshot_sha256"],["engagement_report_jobs","snapshot_text"]]);
    expect(m.current).not.toHaveBeenCalled();
  });
  it("refuses orphan history even when the saved snapshot hash matches",async()=>{
    const value=snapshot();value.decisionLinks.shift();value.decisionLinkCount=1;raw=JSON.stringify(value);job.snapshot_sha256=hash(raw);
    expect((await call()).status).toBe(404);expect(download).not.toHaveBeenCalled();
  });
  it("refuses a private snapshot substituted for a public job",async()=>{
    job.scope="public";expect((await call()).status).toBe(404);expect(download).not.toHaveBeenCalled();expect(m.current).not.toHaveBeenCalled();
  });
  it("refuses a snapshot from another authenticated job workspace",async()=>{
    job.workspace_id="70000000-0000-4000-8000-000000000007";job.artifacts_json[0].path=`${job.workspace_id}/${job.report_id}/${job.id}/${hash(bytes)}.pdf`;
    expect((await call()).status).toBe(404);expect(download).not.toHaveBeenCalled();
  });
  it("keeps legacy internal downloads readable",async()=>{
    const value=snapshot();const {workspaceId:_workspace,decisionLinks:_links,decisionLinkCount:_count,decisionLinkHistoryScope:_scope,...base}=value;raw=JSON.stringify({...base,schema:1});job.snapshot_sha256=hash(raw);
    expect((await call()).status).toBe(200);
  });
});

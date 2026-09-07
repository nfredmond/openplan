import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const mocks = vi.hoisted(() => ({ authorize: vi.fn(), load: vi.fn(), service: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/programs/work-program/server", () => ({ authorizeWorkProgram: mocks.authorize, loadWorkProgramPreparation: mocks.load }));
vi.mock("@/lib/supabase/server", () => ({ createServiceRoleClient: mocks.service }));
vi.mock("@/lib/observability/audit", () => ({ createApiAuditLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));
import { GET as read, POST as save } from "@/app/api/programs/[programId]/work-program/route";
import { POST as attach } from "@/app/api/programs/[programId]/work-program/sources/route";
import { GET as exportRevision } from "@/app/api/programs/[programId]/work-program/export/route";
const programId = "00000000-0000-4000-8000-000000000001";
const context = { params: Promise.resolve({ programId }) };

describe("work-program HTTP authorization handoff", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it.each([
    ["read", read, false], ["save", save, true], ["attach", attach, true], ["export", exportRevision, false],
  ] as const)("%s returns the actual authorization refusal before reading or writing program content", async (_name, handler, write) => {
    for (const status of [401, 403, 404, 503]) {
      const refusal = NextResponse.json({ error: `Exercise refusal ${status}` }, { status });
      mocks.authorize.mockResolvedValueOnce({ response: refusal });
      const request = new NextRequest("http://localhost/api/example", { method: write ? "POST" : "GET", ...(write ? { body: "{}" } : {}) });
      expect(await handler(request, context)).toBe(refusal);
      expect(mocks.authorize).toHaveBeenLastCalledWith(request, programId, write);
    }
    expect(mocks.load).not.toHaveBeenCalled(); expect(mocks.service).not.toHaveBeenCalled();
  });
});

const proposal = {
  schemaVersion: 1, documentKind: "owp", agency: "Synthetic agency", responsibleAuthority: "Exercise only",
  authorityBasis: "", periodStart: "2026-07-01", periodEnd: "2027-06-30", introduction: "", staffing: "", financialNotes: "",
  currency: "USD", priorBalance: null, priorBalanceBasis: "", elements: [],
};


describe("saved work-program HTTP behavior", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it("returns application conflicts promptly and passes the authenticated actor with the exact proposal", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: { code: "PT409" }, data: null });
    mocks.service.mockReturnValue({ rpc });
    mocks.authorize.mockResolvedValue({ supabase: {}, user: { id: "actor" } });
    mocks.load.mockResolvedValue({ sources: [] });
    const requestId = "00000000-0000-4000-8000-000000000002";
    const response = await save(new NextRequest("http://localhost/api/example", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedRevision: 4, requestId, draft: proposal }) }), context);
    expect(response.status).toBe(409);
    expect(rpc).toHaveBeenCalledWith("save_program_work_program_revision", { p_program_id: programId, p_actor_id: "actor", p_expected_revision: 4, p_request_id: requestId, p_content: proposal });
  });
  it("reads the artifact belonging to the requested saved revision and only delivers completed files", async () => {
    const calls: {table:string;projection:string;filters:[string,unknown][]}[]=[];
    let artifact: {id:string;checksum:string|null;status:string}|null=null;
    const client={from:(table:string)=>{
      const call={table,projection:"",filters:[] as [string,unknown][]};calls.push(call);
      const query={select:(value:string)=>{call.projection=value;return query;},eq:(key:string,value:unknown)=>{call.filters.push([key,value]);return query;},order:()=>query,limit:()=>query,maybeSingle:async()=>({error:null,data:table==="program_work_program_revisions"?{id:"revision-one",content_sha256:"b".repeat(64)}:table==="kb_documents"?artifact:{status:"succeeded"}})};return query;
    }};
    mocks.authorize.mockResolvedValue({supabase:client,user:{id:"actor"}});
    const request=()=>new NextRequest("http://localhost/api/example?revision=1&format=pdf&download=1");
    expect(await (await exportRevision(request(),context)).json()).toEqual({status:"not_prepared"});
    artifact={id:"artifact-one",checksum:"c".repeat(64),status:"stored"};
    const delivered=await exportRevision(request(),context);
    expect(delivered.status).toBe(307);
    expect(delivered.headers.get("location")).toBe("/api/knowledge-base/documents/artifact-one/download?delivery=authenticated");
    expect(calls[0]).toEqual({table:"program_work_program_revisions",projection:"id, content_sha256",filters:[["program_id",programId],["revision",1]]});
    expect(calls[1]).toEqual({table:"kb_documents",projection:"id, checksum, status",filters:[["work_program_revision_id","revision-one"],["work_program_export_format","pdf"]]});
    expect(mocks.service).not.toHaveBeenCalled();
  });
});

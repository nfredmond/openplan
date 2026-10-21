/** AUTHORED, UNEXECUTED. Projection doubles cannot prove PostgREST casts, RLS or snapshot completeness. */
import { beforeEach,describe,expect,it,vi } from "vitest";
import { NextRequest } from "next/server";
import { comparisonFixture,comparisonId,comparisonRevision } from "./fixtures/safety/comparison";
const mocks=vi.hoisted(()=>({create:vi.fn(),access:vi.fn(),audit:vi.fn(),info:vi.fn(),warn:vi.fn(),error:vi.fn()}));
vi.mock("@/lib/supabase/server",()=>({createClient:mocks.create}));
vi.mock("@/lib/observability/audit",()=>({createApiAuditLogger:mocks.audit}));
vi.mock("@/lib/reports/api",async original=>({...await original<typeof import("@/lib/reports/api")>(),loadReportAccess:mocks.access}));
import { GET } from "@/app/api/reports/[reportId]/safety-comparison/route";
import { REPORT_ACCESS_COLUMNS } from "@/lib/reports/api";
import { SAFETY_COMPARISON_PROJECT_SELECT,SAFETY_COMPARISON_ACQUISITION_SELECT,SAFETY_COMPARISON_MEMBER_FIELDS } from "@/lib/safety/candidate-comparison";
import { buildSafetyComparisonSnapshot } from "@/lib/reports/safety-comparison-snapshot";
function chain(data:unknown){const reply={data,error:null as {message:string}|null};const q={reply,select:vi.fn(),eq:vi.fn(),not:vi.fn(),in:vi.fn(),lt:vi.fn(),order:vi.fn(),limit:vi.fn(),maybeSingle:vi.fn().mockImplementation(()=>Promise.resolve(reply)),then:(resolve:(value:unknown)=>unknown)=>Promise.resolve(reply).then(resolve)};for(const key of["select","eq","not","in","lt","order","limit"] as const)q[key].mockReturnValue(q);return q;}
let tables:Record<string,ReturnType<typeof chain>>;
beforeEach(()=>{vi.clearAllMocks();mocks.audit.mockReturnValue({info:mocks.info,warn:mocks.warn,error:mocks.error});tables={projects:chain({id:comparisonId(3),workspace_id:comparisonId(2),updated_at:comparisonRevision,estimated_cost_amount:"99999999999999.91",estimated_cost_currency:"USD",estimated_cost_basis_year:null,estimated_cost_source_document_id:null}),safety_crash_ingests:chain([]),report_artifacts:chain([])};mocks.create.mockResolvedValue({auth:{getUser:async()=>({data:{user:{id:comparisonId(1)}}})},from:(table:string)=>{if(!tables[table])throw new Error(`Unexpected ${table}`);return tables[table];}});mocks.access.mockResolvedValue({report:{id:comparisonId(4),workspace_id:comparisonId(2),project_id:comparisonId(3),report_type:"project_status",land_use_plan_id:null,updated_at:comparisonRevision,metadata_json:{}},membership:{role:"viewer"},error:null});});
describe("comparison source context projections",()=>{
 it("keeps the retained crash projection in its exact original order",()=>{
  // Independent of the fixture and reader, which both consume the shared list.
  expect(SAFETY_COMPARISON_MEMBER_FIELDS).toEqual([
   "id","workspace_id","ingest_id","source_id","external_id","collision_date","collision_year",
   "longitude","latitude","severity","pedestrian_involved","bicyclist_involved","motorcyclist_involved",
   "collision_type","lighting","weather",
  ]);
 });
 it("exposes the exact report revision and text money/acquisition revisions, scoped to both workspace and project",async()=>{const response=await GET(new NextRequest("http://localhost/api/source"),{params:Promise.resolve({reportId:comparisonId(4)})});expect(response.status).toBe(200);const data=await response.json();expect(data.report.updated_at).toBe(comparisonRevision);expect(data.project.estimated_cost_amount).toBe("99999999999999.91");expect(data.canWrite).toBe(false);expect(REPORT_ACCESS_COLUMNS.split(", ")).toContain("updated_at");expect(tables.projects.select).toHaveBeenCalledWith(SAFETY_COMPARISON_PROJECT_SELECT);expect(SAFETY_COMPARISON_PROJECT_SELECT).toContain("estimated_cost_amount::text");expect(tables.safety_crash_ingests.select).toHaveBeenCalledWith(SAFETY_COMPARISON_ACQUISITION_SELECT);expect(SAFETY_COMPARISON_ACQUISITION_SELECT).toContain("evidence_revision::text");for(const table of["projects","safety_crash_ingests"])expect(tables[table].eq).toHaveBeenCalledWith("workspace_id",comparisonId(2));expect(tables.safety_crash_ingests.eq).toHaveBeenCalledWith("project_id",comparisonId(3));expect(tables.safety_crash_ingests.limit).toHaveBeenCalledWith(51);});
});

// These doubles prove route outcomes and log content, not deployed log delivery or RLS.
describe("comparison read audit outcomes", () => {
 const read = (query = "", reportId = comparisonId(4)) => GET(new NextRequest(`http://localhost/api/source${query}`), {params:Promise.resolve({reportId})});

 it("calls the route logger and records a completed context read", async () => {
  const response = await read();
  expect(response.status).toBe(200);
  expect(mocks.audit).toHaveBeenCalledWith("reports.safety-comparison.read", expect.any(NextRequest));
  expect(mocks.info).toHaveBeenCalledWith("comparison_context_loaded", {reportId:comparisonId(4),revisionId:null,acquisitionCount:0,fileCount:0});
  expect(mocks.warn).not.toHaveBeenCalled();expect(mocks.error).not.toHaveBeenCalled();
 });

 it.each([
  ["?revisionId=invalid", "invalid_revision"],
  ["?before=invalid", "invalid_acquisition_cursor"],
  ["?artifactBefore=invalid", "invalid_file_cursor"],
  ["?ingestId=invalid", "invalid_acquisition"],
 ] as const)("audits invalid input %s without recording its value", async (query, reason) => {
  const response = await read(query);
  expect(response.status).toBe(400);
  expect(mocks.warn).toHaveBeenCalledWith("comparison_read_refused", {status:400,reason});
  expect(mocks.info).not.toHaveBeenCalled();
 });

 it("records invalid report identifiers before creating a database client", async () => {
  expect((await read("", "invalid")).status).toBe(400);
  expect(mocks.create).not.toHaveBeenCalled();
  expect(mocks.warn).toHaveBeenCalledWith("comparison_read_refused", {status:400,reason:"invalid_report"});
 });

 it("records unauthenticated requests without loading report access", async () => {
  mocks.create.mockResolvedValueOnce({auth:{getUser:async()=>({data:{user:null}})}});
  expect((await read()).status).toBe(401);expect(mocks.access).not.toHaveBeenCalled();
  expect(mocks.warn).toHaveBeenCalledWith("comparison_read_refused", {status:401,reason:"unauthenticated"});
 });

 it.each([
  [null, null, 404, "report_not_found"],
  [{project_id:comparisonId(3)}, null, 403, "workspace_denied"],
  [{project_id:null}, {role:"viewer"}, 422, "incompatible_report"],
 ] as const)("records access refusal %s", async (report, membership, status, reason) => {
  mocks.access.mockResolvedValueOnce({report,membership,error:null});
  expect((await read()).status).toBe(status);
  expect(mocks.warn).toHaveBeenCalledWith("comparison_read_refused", {status,reason});
  expect(mocks.info).not.toHaveBeenCalled();
 });

 it("records source lookup failure without copying private database messages", async () => {
  tables.projects.reply.error={message:"PRIVATE source title and SQL"};
  expect((await read()).status).toBe(503);
  expect(mocks.error).toHaveBeenCalledTimes(1);expect(mocks.error).toHaveBeenCalledWith("comparison_read_failed", {status:503,reason:"sources_unavailable"});
  expect(mocks.info).not.toHaveBeenCalled();
 });

 it("records access lookup errors and unexpected failures with fixed outcome codes", async () => {
  mocks.access.mockResolvedValueOnce({error:{message:"PRIVATE source title"}});
  expect((await read()).status).toBe(500);
  expect(mocks.error).toHaveBeenLastCalledWith("comparison_read_failed", {status:500,reason:"access_read_failed"});
  expect(mocks.error).toHaveBeenCalledTimes(1);
  mocks.create.mockRejectedValueOnce(new Error("PRIVATE source facts"));
  expect((await read()).status).toBe(500);
  expect(mocks.error).toHaveBeenLastCalledWith("comparison_read_failed", {status:500,reason:"unexpected_failure"});
  expect(mocks.error).toHaveBeenCalledTimes(2);
  expect(mocks.info).not.toHaveBeenCalled();
 });

 it("audits CSV refusal and a verified exact-revision export separately", async () => {
  expect((await read("?format=csv")).status).toBe(422);
  expect(mocks.warn).toHaveBeenCalledWith("comparison_read_refused", {status:422,reason:"exact_csv_revision_required"});
  const comparison=comparisonFixture();tables.report_safety_comparison_revisions=chain(comparison);
  const response=await read(`?format=csv&revisionId=${comparison.id}`);
  expect(response.status).toBe(200);expect(response.headers.get("content-type")).toContain("text/csv");
  expect(mocks.info).toHaveBeenCalledTimes(1);expect(mocks.info).toHaveBeenCalledWith("comparison_csv_exported", {reportId:comparisonId(4),revisionId:comparison.id});
 });

 it("records unavailable file receipts while preserving the disclosed limited context response", async () => {
  const comparison=comparisonFixture();
  const snapshot=buildSafetyComparisonSnapshot({comparison,artifactId:comparisonId(7),reportId:comparison.report_id,
   workspaceId:comparison.workspace_id,projectId:comparison.project_id,generatedAt:comparisonRevision,
   reportUpdatedAt:comparisonRevision,projectUpdatedAt:comparisonRevision});
  tables.report_artifacts.reply.data=[{id:snapshot.artifactId,artifact_kind:"html",generated_at:comparisonRevision,metadata_json:{safetyPlanSnapshotV2:snapshot}}];
  tables.report_safety_comparison_generations=chain(null);
  tables.report_safety_comparison_generations.reply.error={message:"PRIVATE receipt details"};
  const response=await read();expect(response.status).toBe(200);
  expect((await response.json()).artifacts[0].freshness).toBe("unavailable_custody");
  expect(tables.report_safety_comparison_generations.select).toHaveBeenCalledWith("artifact_id, receipt");
  expect(tables.report_safety_comparison_generations.eq).toHaveBeenCalledWith("report_id",comparison.report_id);
  expect(tables.report_safety_comparison_generations.eq).toHaveBeenCalledWith("workspace_id",comparison.workspace_id);
  expect(tables.report_safety_comparison_generations.in).toHaveBeenCalledWith("artifact_id",[snapshot.artifactId]);
  expect(mocks.warn).toHaveBeenCalledTimes(1);expect(mocks.warn).toHaveBeenCalledWith("comparison_file_receipts_unavailable", {reportId:comparison.report_id});
  expect(mocks.info).toHaveBeenCalledTimes(1);expect(mocks.info).toHaveBeenCalledWith("comparison_context_loaded", {reportId:comparison.report_id,revisionId:null,acquisitionCount:0,fileCount:1});
 });
});

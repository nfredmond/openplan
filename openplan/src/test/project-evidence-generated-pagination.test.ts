import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/project-evidence-bundles/engagement-export-privacy", () => ({ loadPublishableProjectEngagementGeometry: async () => ({ data: [], error: null }) }));
import { loadProjectEvidenceGeneratedFiles } from "@/lib/project-evidence-bundles/generated-records";

const project = { id: "11111111-1111-4111-8111-111111111111", workspace_id: "22222222-2222-4222-8222-222222222222", name: "Synthetic complete export", status: "active", plan_type: "corridor_plan", delivery_phase: "planning", created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" };
function fixture(failSecondPage: false | string = false) {
 const tables: Record<string, Record<string, unknown>[]> = {};
 for (const table of ["models", "model_runs", "model_run_artifacts", "county_runs", "modeling_source_manifests", "modeling_validation_results", "modeling_claim_decisions", "modeling_validation_assessments", "modeling_validation_structural_diagnoses", "modeling_validation_instrument_v2_custody", "model_attempt_instrument_custody", "modeling_structural_demand_diagnosis_custody", "modeling_distributed_work_loading_custody", "data_dataset_project_links"]) {
  tables[table] = Array.from({ length: 7 }, (_, i) => ({ id: `${table}-${i}`, dataset_id: `dataset-${i}`, workspace_id: project.workspace_id, project_id: project.id, created_at: project.updated_at }));
 }
 const attemptRows = tables.model_attempt_instrument_custody;
 for (const [index, row] of attemptRows.entries()) Object.assign(row, {
  model_run_id: "model_runs-0", stage_id: "stage-0", attempt_id: `attempt-${Math.floor(index / 2)}`,
  demand_method: index % 2 ? "activitysim" : "aequilibrae", scientific_outcome: "inconclusive",
  ...Object.fromEntries(["model_output", "input_bundle", "match_audit", "comparison_basis", "assessment", "diagnosis"].flatMap(role => [
   [`${role}_artifact_id`, `${role}-${index}`], [`${role}_sha256`, String(index + 1).repeat(64)],
  ])),
 });
 const calls: { table: string; orders: string[]; projection?: string; filters: [string, unknown][]; range?: number[] }[] = [];
 const client = { from(table: string) {
  const call = { table, projection: "", filters: [] as [string, unknown][], orders: [] as string[], range: undefined as number[] | undefined }; calls.push(call);
  const query = { select(projection: string) { call.projection = projection; return query; }, eq(column: string, value: string) { call.filters.push([column, value]); return query; }, in(column: string, values: string[]) { call.filters.push([column, values]); return query; }, order(column: string) { call.orders.push(column); return query; }, range(from: number, to: number) { call.range = [from, to]; return query; }, maybeSingle: async () => ({ data: project, error: null }), then(resolve: (value: unknown) => unknown) {
   const start = call.range?.[0] ?? 0;
   const error = table === failSecondPage && start > 0 ? { message: "Synthetic page outage" } : null;
   let data = (tables[table] ?? []).slice(start, start + 3);
   if (table === "model_attempt_instrument_custody") data = data.map(row => Object.fromEntries(call.projection.split(",").map(key => [key.trim(), row[key.trim()]])));
   return Promise.resolve(resolve({ data: error ? null : data, error }));
  } }; return query;
 } };
 return { client, calls, tables };
}
describe("generated project evidence complete reads", () => {
 it("preserves every model, run and custody record under a smaller response cap", async () => {
  const { client, calls } = fixture();
  const result = await loadProjectEvidenceGeneratedFiles(client, project, new Date(project.updated_at));
  const file = result.files.find(file => file.sourceId === "modeling_evidence")!;
  const modeling = JSON.parse(file.bytes.toString("utf8"));
  for (const key of ["models", "modelRuns", "modelArtifacts", "countyRuns", "sourceManifests", "validationResults", "validationAssessments", "structuralDiagnoses", "comparableObservationCustody", "attemptInstrumentCustody", "structuralDemandCustody", "distributedWorkLoadingCustody", "claimDecisions"]) expect(modeling[key], key).toHaveLength(7);
  const linked = JSON.parse(result.files.find(file => file.sourceId === "linked_data")!.bytes.toString("utf8"));
  expect(linked.links).toHaveLength(7);
  for (const call of calls.filter(call => call.table !== "projects")) {
   expect(call.range, call.table).toBeDefined();
   expect(call.orders.at(-1), call.table).toBe(call.table === "data_dataset_project_links" ? "dataset_id" : "id");
  }
  expect(calls.filter(call => call.table === "models").map(call => call.range?.[0])).toEqual([0, 3, 6, 7]);
 });
 it("refuses an artifact when a later page fails", async () => {
  const { client } = fixture("model_runs");
  await expect(loadProjectEvidenceGeneratedFiles(client, project, new Date(project.updated_at))).rejects.toThrow("Project-linked model runs could not be read");
 });
 it("retains both methods and repeated attempts with exact projections and scope", async () => {
  const { client, calls, tables } = fixture();
  const result = await loadProjectEvidenceGeneratedFiles(client, project, new Date(project.updated_at));
  const file = result.files.find(file => file.sourceId === "modeling_evidence")!;
  const records = JSON.parse(file.bytes.toString("utf8")).attemptInstrumentCustody;
  expect(records).toHaveLength(7);
  for (const [index, row] of records.entries()) {
   const expected = tables.model_attempt_instrument_custody[index];
   for (const key of ["id", "workspace_id", "model_run_id", "stage_id", "attempt_id", "demand_method", "scientific_outcome", "created_at"]) expect(row[key], key).toEqual(expected[key]);
   for (const role of ["model_output", "input_bundle", "match_audit", "comparison_basis", "assessment", "diagnosis"]) {
    expect(row[`${role}_artifact_id`]).toEqual(expected[`${role}_artifact_id`]);
    expect(row[`${role}_sha256`]).toEqual(expected[`${role}_sha256`]);
   }
   expect(row.evidenceDescriptor.claimTier).toBeNull();
  }
  const reads = calls.filter(call => call.table === "model_attempt_instrument_custody");
  expect(reads.length).toBeGreaterThan(1);
  for (const read of reads) {
   expect(read.projection?.split(", ").sort()).toEqual([
    "id", "workspace_id", "model_run_id", "stage_id", "attempt_id", "demand_method", "scientific_outcome", "created_at",
    ...["model_output", "input_bundle", "match_audit", "comparison_basis", "assessment", "diagnosis"].flatMap(role => [`${role}_artifact_id`, `${role}_sha256`]),
   ].sort());
   expect(read.filters).toEqual([["workspace_id", project.workspace_id], ["model_run_id", tables.model_runs.map(row => row.id)]]);
  }
  tables.model_attempt_instrument_custody[0].model_output_sha256 = "f".repeat(64);
  const changed = await loadProjectEvidenceGeneratedFiles(client, project, new Date(project.updated_at));
  expect(changed.files.find(file => file.sourceId === "modeling_evidence")!.revisionToken).not.toBe(file.revisionToken);
 });
 it("refuses an export when an attempt custody page is unavailable", async () => {
  const { client } = fixture("model_attempt_instrument_custody");
  await expect(loadProjectEvidenceGeneratedFiles(client, project, new Date(project.updated_at))).rejects.toThrow("Project-linked attempt instrument custody could not be read");
 });

});

import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/project-evidence-bundles/engagement-export-privacy", () => ({ loadPublishableProjectEngagementGeometry: async () => ({ data: [], error: null }) }));
import { loadProjectEvidenceGeneratedFiles } from "@/lib/project-evidence-bundles/generated-records";

const project = { id: "11111111-1111-4111-8111-111111111111", workspace_id: "22222222-2222-4222-8222-222222222222", name: "Synthetic complete export", status: "active", plan_type: "corridor_plan", delivery_phase: "planning", created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" };
function fixture(failSecondPage = false) {
 const tables: Record<string, Record<string, unknown>[]> = {};
 for (const table of ["models", "model_runs", "model_run_artifacts", "county_runs", "modeling_source_manifests", "modeling_validation_results", "modeling_claim_decisions", "modeling_validation_assessments", "modeling_validation_structural_diagnoses", "modeling_validation_instrument_v2_custody", "modeling_structural_demand_diagnosis_custody", "modeling_distributed_work_loading_custody", "data_dataset_project_links"]) {
  tables[table] = Array.from({ length: 7 }, (_, i) => ({ id: `${table}-${i}`, dataset_id: `dataset-${i}`, workspace_id: project.workspace_id, project_id: project.id, created_at: project.updated_at }));
 }
 const calls: { table: string; orders: string[]; range?: number[] }[] = [];
 const client = { from(table: string) {
  const call = { table, orders: [] as string[], range: undefined as number[] | undefined }; calls.push(call);
  const query = { select() { return query; }, eq() { return query; }, in() { return query; }, order(column: string) { call.orders.push(column); return query; }, range(from: number, to: number) { call.range = [from, to]; return query; }, maybeSingle: async () => ({ data: project, error: null }), then(resolve: (value: unknown) => unknown) {
   const start = call.range?.[0] ?? 0;
   const error = failSecondPage && table === "model_runs" && start > 0 ? { message: "Synthetic page outage" } : null;
   return Promise.resolve(resolve({ data: error ? null : (tables[table] ?? []).slice(start, start + 3), error }));
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
  for (const key of ["models", "modelRuns", "modelArtifacts", "countyRuns", "sourceManifests", "validationResults", "validationAssessments", "structuralDiagnoses", "comparableObservationCustody", "structuralDemandCustody", "distributedWorkLoadingCustody", "claimDecisions"]) expect(modeling[key], key).toHaveLength(7);
  const linked = JSON.parse(result.files.find(file => file.sourceId === "linked_data")!.bytes.toString("utf8"));
  expect(linked.links).toHaveLength(7);
  for (const call of calls.filter(call => call.table !== "projects")) {
   expect(call.range, call.table).toBeDefined();
   expect(call.orders.at(-1), call.table).toBe(call.table === "data_dataset_project_links" ? "dataset_id" : "id");
  }
  expect(calls.filter(call => call.table === "models").map(call => call.range?.[0])).toEqual([0, 3, 6, 7]);
 });
 it("refuses an artifact when a later page fails", async () => {
  const { client } = fixture(true);
  await expect(loadProjectEvidenceGeneratedFiles(client, project, new Date(project.updated_at))).rejects.toThrow("Project-linked model runs could not be read");
 });
});

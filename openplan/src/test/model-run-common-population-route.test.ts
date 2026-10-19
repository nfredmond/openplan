import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GUIDED_PROJECT_COMPARISON_VERSION } from "@/lib/models/project-comparison";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(), createServiceRoleClient: vi.fn(), access: vi.fn(), zoneAttributes: vi.fn(),
  dispatch: vi.fn(), outputs: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient, createServiceRoleClient: mocks.createServiceRoleClient }));
vi.mock("@/lib/models/api", () => ({ loadModelAccess: mocks.access }));
vi.mock("@/lib/integrations/workspace-keys", () => ({
  withWorkspaceIntegrationContext: (_workspace: string, action: () => Promise<unknown>) => action(),
}));
vi.mock("@/lib/models/zone-attribute-payload", async (original) => ({
  ...(await original<typeof import("@/lib/models/zone-attribute-payload")>()), prepareWorkerZoneAttributes: mocks.zoneAttributes,
}));
vi.mock("@/lib/models/transit-feed-handoff", async (original) => ({
  ...(await original<typeof import("@/lib/models/transit-feed-handoff")>()),
  prepareTransitFeedHandoff: async () => ({ status: "not_selected", reason: null }),
}));
vi.mock("@/lib/models/worker-health-server", () => ({ loadModelingWorkerHealth: async () => ({}) }));
vi.mock("@/lib/models/worker-health", () => ({ evaluateWorkerHealthLaunchGate: () => ({ blocked: false }) }));
vi.mock("@/lib/models/run-dispatch", async (original) => ({
  ...(await original<typeof import("@/lib/models/run-dispatch")>()),
  checkModelingQueueDepth: async () => ({ state: "allowed" }), dispatchModelRun: mocks.dispatch,
}));

import { POST } from "@/app/api/models/[modelId]/runs/route";

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const geometry = { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] };
const model = { id: id(1), workspace_id: id(2), project_id: id(3), scenario_set_id: id(4), title: "Synthetic comparison",
  config_json: { guidedProjectComparison: GUIDED_PROJECT_COMPARISON_VERSION, method: "aequilibrae",
    runTemplate: { queryText: "Synthetic comparison question", corridorGeojson: geometry } } };
const baseline = { id: id(5), scenario_set_id: id(4), entry_type: "baseline", label: "Baseline", status: "draft", assumptions_json: {} };
const build = { ...baseline, id: id(6), entry_type: "alternative", label: "Build", assumptions_json: {
  guidedProjectChange: { kind: "assigned_auto_trip_change_pct", autoTripChangePct: -10, basis: "Planner sensitivity input" },
} };
const sourceProfile = { adapter: "us_census_acs5_pums", acs_summary_endpoint: "https://api.census.gov/data/2023/acs/acs5",
  pums_endpoint: "https://api.census.gov/data/2023/acs/acs5/pums", sample_years: [2019, 2023], income_dollar_year: 2023,
  puma_fields: { "2020": "PUMA" } };
const generated = { schema: "openplan.common-population-request.v1", mode: "generate", custody: "legacy_stage_snapshot", comparisonPolicy: "fixed_population_auto_trip_change", sourceProfile };
const sourceStamp = { status: "supplied", sourceId: "us_census_acs5", vintage: "2023",
  demographics: { status: "supplied", geographies: 2 }, geographyIndexTruncated: false };
const artifact = { id: id(8), run_id: id(7), stage_id: id(9), attempt_id: null, artifact_type: "common_population",
  file_url: "/owned/common-population.json", file_size_bytes: 456, content_hash: "a".repeat(64) };
const inserts: Array<{ table: string; value: unknown }> = [];
const projections: Array<{ table: string; columns: string }> = [];
let selectedEntry: typeof baseline;
let buildEntry: typeof baseline;
let sourceStatus: string;

function installClient() {
  mocks.createClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: id(30) } } }) },
    rpc: async (name: string) => ({ error: null, data: name === "project_modeling_study_area_readiness" ? [{ state: "ready", tract_count: 2 }] : null }),
    from(table: string) {
      let inserted = false;
      const data = () => {
        if (inserted) return null;
        if (table === "scenario_entries") return [baseline, buildEntry];
        if (table === "scenario_sets") return [{ id: id(4), workspace_id: id(2), project_id: id(3), baseline_entry_id: id(5) }];
        if (table === "models") return [model];
        if (table === "model_runs") return [{ id: id(7), model_id: id(1), workspace_id: id(2), project_id: id(3), scenario_set_id: id(4),
          scenario_entry_id: id(5), engine_key: "aequilibrae", status: sourceStatus, attempt_managed: false,
          corridor_geojson: geometry, input_snapshot_json: { commonPopulation: generated, zoneGeography: "tract", zoneAttributes: sourceStamp } }];
        if (table === "model_run_artifacts") return [artifact];
        if (table === "model_run_stages") return [{ id: id(9), run_id: id(7), stage_name: "AequilibraE Setup", status: "succeeded", attempt_managed: false, active_attempt_id: null }];
        throw new Error(`Unexpected fixture table: ${table}`);
      };
      const query = {
        select(columns: string) { projections.push({ table, columns }); return query; },
        eq() { return query; }, order() { return query; }, limit() { return query; },
        insert(value: unknown) { inserted = true; inserts.push({ table, value }); return query; },
        maybeSingle: async () => ({ data: table === "projects" ? { place_country_code: "US" } : selectedEntry, error: null }),
        then<TResult1 = { data: unknown; error: null }, TResult2 = never>(
          fulfilled?: ((value: { data: unknown; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
          rejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
        ) { return Promise.resolve({ data: data(), error: null }).then(fulfilled, rejected); },
      };
      return query;
    },
  });
}

function request(extra: Record<string, unknown> = {}) {
  return new NextRequest(`http://localhost/api/models/${id(1)}/runs`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ engineKey: "aequilibrae", scenarioEntryId: selectedEntry.id, ...extra }),
  });
}
const context = { params: Promise.resolve({ modelId: id(1) }) };

beforeEach(() => {
  vi.clearAllMocks(); inserts.length = 0; projections.length = 0;
  selectedEntry = baseline; buildEntry = structuredClone(build); sourceStatus = "succeeded";
  mocks.access.mockResolvedValue({ model, membership: { role: "owner" }, allowed: true, error: null });
  mocks.zoneAttributes.mockResolvedValue({ version: "zone-attributes-v1", status: "supplied", storageRef: "storage://run-artifacts/owned/zone-attributes.json",
    sourceId: "us_census_acs5", vintage: "2023", demographics: { status: "supplied", geographies: 2 }, geographyIndexTruncated: false });
  mocks.dispatch.mockResolvedValue({ state: "not_configured" });
  mocks.outputs.mockResolvedValue({ data: { run_id: id(7), run_status: "succeeded", outputs: [{ kind: "artifact", ownership_state: "current_completed", record: artifact }] }, error: null });
  mocks.outputs.mockImplementation(async (name: string, params: Record<string, unknown>) => ({ data: name === "read_common_population_stage_custody" ? {
    schema: "openplan.common-population-stage-custody.v1", custody: "legacy_stage_snapshot", workspace_id: params.p_workspace,
    run_id: params.p_run, stage_id: params.p_stage, artifact_id: params.p_artifact, eligible: true,
  } : null, error: null }));
  mocks.createServiceRoleClient.mockReturnValue({ rpc: mocks.outputs });
  installClient();
});

describe("common-population request at the real model run creation route", () => {
  it("stamps the first new-project baseline while the producer's build assumption is still empty", async () => {
    buildEntry = { ...build, assumptions_json: {} };
    const response = await POST(request(), context);
    expect(response.status).toBe(201);
    expect(inserts.find((write) => write.table === "model_runs")?.value).toMatchObject({
      scenario_entry_id: baseline.id, assumption_snapshot_json: {}, input_snapshot_json: { commonPopulation: generated },
    });
    expect(projections).toContainEqual({ table: "scenario_entries", columns: "id, scenario_set_id, label, entry_type, status, assumptions_json" });
    expect(projections).toContainEqual({ table: "scenario_entries", columns: "id, scenario_set_id, entry_type, assumptions_json" });
    expect(projections.some((read) => read.table === "model_runs")).toBe(false);
    expect(mocks.outputs).not.toHaveBeenCalled();
  });

  it("stamps a server-derived generate request and ignores caller source paths", async () => {
    const response = await POST(request({ commonPopulation: { mode: "reuse", source: { file_url: "/caller/path", artifactId: id(99) } } }), context);
    expect(response.status).toBe(201);
    expect(inserts.find((write) => write.table === "model_runs")?.value).toMatchObject({ input_snapshot_json: { commonPopulation: generated } });
    expect(mocks.outputs).not.toHaveBeenCalled();
    expect(projections).toContainEqual({ table: "scenario_entries", columns: "id, scenario_set_id, label, entry_type, status, assumptions_json" });
  });

  it("stamps exact reuse identity from the scoped baseline and calls only the scoped stage-custody RPC", async () => {
    selectedEntry = build;
    const response = await POST(request(), context);
    expect(response.status).toBe(201);
    expect(inserts.find((write) => write.table === "model_runs")?.value).toMatchObject({ input_snapshot_json: { commonPopulation: {
      schema: generated.schema, custody: "legacy_stage_snapshot", mode: "reuse", comparisonPolicy: generated.comparisonPolicy,
      source: { modelRunId: id(7), artifactId: id(8), stageId: id(9), attemptId: null, sha256: "a".repeat(64), sizeBytes: 456 },
    } } });
    expect(mocks.outputs).toHaveBeenCalledExactlyOnceWith("read_common_population_stage_custody", { p_workspace: id(2), p_run: id(7), p_stage: id(9), p_artifact: id(8) });
  });

  it("names a missing or unsuccessful baseline repair before inserting or dispatching jobs", async () => {
    selectedEntry = build; sourceStatus = "running";
    const response = await POST(request(), context);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ repairState: "common_population_baseline_required" });
    expect(inserts).toEqual([]); expect(mocks.dispatch).not.toHaveBeenCalled(); expect(mocks.outputs).not.toHaveBeenCalled();
  });

  it("refuses unavailable source demographics before creating a baseline job", async () => {
    mocks.zoneAttributes.mockResolvedValue({ status: "unavailable", sourceId: "us_census_acs5", vintage: "2023", demographics: { status: "unavailable", geographies: 0 } });
    const response = await POST(request(), context);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ repairState: "common_population_source_unavailable" });
    expect(inserts).toEqual([]); expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it("keeps standalone snapshots free of a population comparison claim", async () => {
    mocks.access.mockResolvedValue({ model: { ...model, config_json: { runTemplate: model.config_json.runTemplate } }, membership: { role: "owner" }, allowed: true, error: null });
    const response = await POST(request(), context);
    expect(response.status).toBe(201);
    const runWrite = inserts.find((write) => write.table === "model_runs")?.value;
    expect(runWrite).not.toHaveProperty("input_snapshot_json.commonPopulation");
    expect(mocks.outputs).not.toHaveBeenCalled();
  });
});

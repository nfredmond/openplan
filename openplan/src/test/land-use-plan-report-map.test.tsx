import { render, screen } from "@testing-library/react";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/reports/[reportId]/land-use-map/[designationId]/route";
import { LandUsePlanReportPage } from "@/components/reports/land-use-plan-report-page";
import { loadPublicDesignationMap } from "@/lib/land-use-plans/public-map";
import { hashFrozenRecord } from "@/lib/land-use-plans/versioning";
import { WORKSPACE_GIS_BBOX_DRAW_LIMIT } from "@/lib/workspace-gis/coverage";

const mocks = vi.hoisted(() => ({ create: vi.fn(), service: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.create, createServiceRoleClient: mocks.service }));
vi.mock("@/lib/observability/audit", () => ({ createApiAuditLogger: () => ({ info: vi.fn() }) }));
vi.mock("@/components/land-use-plans/public-designation-map", () => ({ PublicDesignationMap: ({ endpoint, bbox, label }: { endpoint: string; bbox: unknown; label: string }) => <div role="img" aria-label={label} data-endpoint={endpoint} data-bbox={JSON.stringify(bbox)} /> }));
const id = (n: number) => `33000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [reportId, planId, versionId, workspaceId, actorId, designationId, gisVersionId, otherId] = Array.from({ length: 8 }, (_, i) => id(i + 1));
const report = { id: reportId, workspace_id: workspaceId, land_use_plan_id: planId, report_type: "land_use_plan_packet", title: "SYNTHETIC report", summary: null, generated_at: "2026-10-07" };
const featureHash = "c".repeat(64);
const bbox = [-122, 38, -121, 39];
let rows: Record<string, Record<string, unknown> | null>;
let errors: Record<string, { message: string } | null>;
let authError: { message: string } | null;
let user: { id: string } | null;
let queries: Array<{ table: string; projection?: string; filters: Array<[string, unknown]> }>;
let frozen: Record<string, unknown>;
let metadata: Record<string, unknown>;
let featureRows: Array<Record<string, unknown>> | null;
let rpcError: { message: string } | null;

beforeEach(() => {
  vi.clearAllMocks();
  frozen = {
    plan: { id: planId, descriptorId: "local-unconfigured", planKindKey: "community", title: "SYNTHETIC saved plan", authorityLabel: "SYNTHETIC authority", geographyLabel: "SYNTHETIC area" },
    version: { id: versionId, versionNumber: 2 }, nodes: [], implementationActions: [], relationships: [],
    designations: [{ id: designationId, layer_version_id: gisVersionId, designation_set_label: "SYNTHETIC retained designations", map_note: "SYNTHETIC map is not zoning", public_field_keys: ["designation"], legend_field: "designation", layer_version_evidence: { feature_hash: featureHash, bbox } }],
  };
  metadata = { landUsePlanId: planId, versionId, contentHash: hashFrozenRecord(frozen), frozenSnapshot: frozen };
  rows = {
    reports: { ...report }, workspace_members: { workspace_id: workspaceId, role: "viewer" },
    land_use_plans: { id: planId, title: "SYNTHETIC later title", authority_label: "Later authority", geography_label: "Later area", current_adopted_version_id: otherId },
    report_artifacts: { id: id(10), generated_at: "2026-10-07", metadata_json: metadata },
    land_use_plan_versions: { id: versionId, workspace_id: workspaceId, plan_id: planId, version_number: 2, state: "superseded", content_hash: metadata.contentHash, published_report_id: reportId },
    workspace_gis_layer_versions: { id: gisVersionId, workspace_id: workspaceId, feature_hash: featureHash, ingest_status: "ready" },
  };
  featureRows = [{ id: id(9), feature_index: 0, geometry_geojson: { type: "Point", coordinates: [-121.5, 38.5] }, properties: { designation: "SYNTHETIC mixed use", owner: "PRIVATE OWNER", sensitive: "PRIVATE LOCATION" }, matched_count: 1 }];
  errors = {}; queries = []; authError = null; rpcError = null; user = { id: actorId };
  mocks.rpc.mockImplementation(async () => ({ data: featureRows, error: rpcError }));
  const client = {
    auth: { getUser: async () => ({ data: { user }, error: authError }) }, rpc: mocks.rpc,
    from(table: string) {
      const query: (typeof queries)[number] = { table, filters: [] }; queries.push(query);
      const chain = {
        select(projection: string) { query.projection = projection; return chain; },
        eq(key: string, value: unknown) { query.filters.push([key, value]); return chain; },
        order() { return chain; }, limit() { return chain; },
        async maybeSingle() { return { data: rows[table] ?? null, error: errors[table] ?? null }; },
      }; return chain;
    },
  };
  mocks.create.mockResolvedValue(client); mocks.service.mockReturnValue(client);
});
const request = (bounds = "-122,38,-121,39", params = { reportId, designationId }) => GET(new NextRequest(`http://localhost/api/reports/${params.reportId}/land-use-map/${params.designationId}?bbox=${bounds}`), { params: Promise.resolve(params) });
const rehash = () => { metadata.contentHash = hashFrozenRecord(frozen); rows.land_use_plan_versions!.content_hash = metadata.contentHash; };

describe("historical report map read", () => {
  it.each(["adopted", "superseded", "repealed"])("reads the %s report edition using current scoped permission", async state => {
    rows.land_use_plan_versions!.state = state;
    const response = await request(); expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ reportId, versionId, contentHash: metadata.contentHash, matchedCount: 1, returnedCount: 1, tooDenseToDraw: false, legendField: "designation", features: [{ id: id(9), geometry: { type: "Point", coordinates: [-121.5, 38.5] }, properties: { attributes: { designation: "SYNTHETIC mixed use" } } }] });
    expect(JSON.stringify(body)).not.toContain("PRIVATE");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.service).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledWith("workspace_gis_features_in_bbox", { p_version_id: gisVersionId, p_west: -122, p_south: 38, p_east: -121, p_north: 39, p_limit: WORKSPACE_GIS_BBOX_DRAW_LIMIT });
    expect(queries.find(q => q.table === "workspace_members")).toEqual({ table: "workspace_members", projection: "workspace_id, role", filters: [["workspace_id", workspaceId], ["user_id", actorId]] });
    expect(queries.find(q => q.table === "land_use_plan_versions")).toEqual({ table: "land_use_plan_versions", projection: "id, workspace_id, plan_id, version_number, state, content_hash, published_report_id", filters: [["id", versionId], ["plan_id", planId], ["workspace_id", workspaceId]] });
    expect(queries.find(q => q.table === "workspace_gis_layer_versions")).toEqual({ table: "workspace_gis_layer_versions", projection: "id, workspace_id, feature_hash, ingest_status", filters: [["id", gisVersionId], ["ingest_status", "ready"], ["workspace_id", workspaceId]] });
    expect(queries.find(q => q.table === "report_artifacts")).toMatchObject({ projection: "metadata_json", filters: [["report_id", reportId]] });
    expect(queries.some(q => q.table === "land_use_plans")).toBe(false);
  });
  it.each([
    ["signed-out account", 401, () => { user = null; }],
    ["failed authentication", 401, () => { authError = { message: "unavailable" }; }],
    ["report read error", 500, () => { errors.reports = { message: "unavailable" }; }],
    ["missing report", 404, () => { rows.reports = null; }],
    ["membership read error", 500, () => { errors.workspace_members = { message: "unavailable" }; }],
    ["missing membership", 403, () => { rows.workspace_members = null; }],
    ["unrecognized role", 403, () => { rows.workspace_members!.role = "outsider"; }],
    ["artifact read error", 503, () => { errors.report_artifacts = { message: "unavailable" }; }],
    ["missing artifact", 503, () => { rows.report_artifacts = null; }],
    ["unrelated report type", 503, () => { rows.reports!.report_type = "project_report"; }],
    ["wrong native workspace", 503, () => { rows.land_use_plan_versions!.workspace_id = otherId; }],
    ["altered saved geometry reference", 503, () => { (frozen.designations as Record<string, unknown>[])[0].layer_version_id = otherId; }],
    ["altered saved disclosure fields", 503, () => { (frozen.designations as Record<string, unknown>[])[0].public_field_keys = ["designation", "owner"]; }],
    ["wrong report pointer", 503, () => { rows.land_use_plan_versions!.published_report_id = otherId; }],
    ["unfrozen version", 503, () => { rows.land_use_plan_versions!.state = "working"; }],
    ["GIS version read error", 503, () => { errors.workspace_gis_layer_versions = { message: "unavailable" }; }],
    ["missing GIS version", 503, () => { rows.workspace_gis_layer_versions = null; }],
    ["wrong GIS version", 503, () => { rows.workspace_gis_layer_versions!.id = otherId; }],
    ["wrong GIS workspace", 503, () => { rows.workspace_gis_layer_versions!.workspace_id = otherId; }],
    ["unfinished GIS ingest", 503, () => { rows.workspace_gis_layer_versions!.ingest_status = "processing"; }],
    ["changed GIS feature hash", 503, () => { rows.workspace_gis_layer_versions!.feature_hash = "d".repeat(64); }],
  ] as const)("refuses %s before reading features", async (_name, status, mutate) => {
    mutate(); const response = await request();
    expect(JSON.stringify(await response.json())).not.toContain("PRIVATE");
    expect(response.status).toBe(status);
    expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.service).not.toHaveBeenCalled();
  });
  it.each(["layer_version_id", "layer_version_evidence"])("refuses a designation missing %s", async field => {
    delete (frozen.designations as Record<string, unknown>[])[0][field]; rehash();
    expect((await request()).status).toBe(503); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("refuses a designation not retained in the report", async () => {
    expect((await request(undefined, { reportId, designationId: otherId })).status).toBe(404);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("refuses invalid identifiers before authentication or data reads", async () => {
    expect((await request(undefined, { reportId: "invalid", designationId })).status).toBe(404);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it.each(["", "10,,12,35", "-181,0,-170,5", "0,0,0,1", "170,-10,-170,10"])("refuses malformed or unsupported viewport %s", async bounds => {
    expect((await request(bounds)).status).toBe(400); expect(mocks.create).not.toHaveBeenCalled();
  });
  it("distinguishes a feature read failure from an empty map", async () => {
    rpcError = { message: "unavailable" }; expect((await request()).status).toBe(503);
  });
  it.each([null, [], [{ id: null, matched_count: null }], [{ id: null, matched_count: "1x" }], [{ id: null, matched_count: -1 }], [{ id: null, matched_count: 1.5 }], [{ id: null, matched_count: "9007199254740992" }]].map(rows => ({ rows })))("refuses unavailable or invalid counts %#", async ({ rows }) => {
    featureRows = rows; expect((await request()).status).toBe(503);
  });
  it("refuses inconsistent counts across returned rows", async () => {
    featureRows!.push({ ...featureRows![0], id: otherId, matched_count: 2 });
    expect((await request()).status).toBe(503);
  });
  it("refuses an incomplete feature list instead of drawing a subset", async () => {
    featureRows![0].matched_count = 2; expect((await request()).status).toBe(503);
  });
  it("accepts the native zero-count sentinel as an empty map", async () => {
    featureRows = [{ id: null, geometry_geojson: null, matched_count: "0" }];
    const response = await request(); expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ matchedCount: 0, returnedCount: 0, features: [], tooDenseToDraw: false });
  });
  it("draws nothing and reports the count when the view is too dense", async () => {
    featureRows = [{ id: null, geometry_geojson: null, matched_count: WORKSPACE_GIS_BBOX_DRAW_LIMIT + 1 }];
    const response = await request(); expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ matchedCount: WORKSPACE_GIS_BBOX_DRAW_LIMIT + 1, returnedCount: 0, features: [], tooDenseToDraw: true, coverageNotes: [expect.stringContaining("Nothing is drawn until you zoom in")] });
  });
  it("retains the public reader's default client and field allowlist", async () => {
    const result = await loadPublicDesignationMap(frozen, designationId, [-122, 38, -121, 39]);
    expect(result.ok).toBe(true); expect(mocks.service).toHaveBeenCalledOnce();
    expect(JSON.stringify(result)).not.toContain("PRIVATE");
  });
});

describe("report designation presentation", () => {
  it("uses the report map endpoint, saved extent, hash and note", async () => {
    render(await LandUsePlanReportPage({ report }));
    expect(screen.getByRole("img", { name: "SYNTHETIC retained designations" })).toHaveAttribute("data-endpoint", `/api/reports/${reportId}/land-use-map/${designationId}`);
    expect(screen.getByRole("img", { name: "SYNTHETIC retained designations" })).toHaveAttribute("data-bbox", JSON.stringify(bbox));
    expect(screen.getByText("SYNTHETIC map is not zoning")).toBeVisible();
    expect(screen.getByText(`Frozen GIS feature hash: ${featureHash}`)).toBeVisible();
  });
  it("discloses no retained designation", async () => {
    frozen.designations = []; rehash(); render(await LandUsePlanReportPage({ report }));
    expect(screen.getByText("No mapped designations were retained with this version.")).toBeVisible();
  });
  it("discloses a missing retained map identifier", async () => {
    delete (frozen.designations as Record<string, unknown>[])[0].id; rehash();
    render(await LandUsePlanReportPage({ report }));
    expect(screen.getByRole("alert")).toHaveTextContent("no retained map identifier");
    expect(screen.queryByRole("img")).toBeNull();
  });
});

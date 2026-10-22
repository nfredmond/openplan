import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { syntheticPlanContext } from "./fixtures/land-use-plans/plan-context";

const mocks = vi.hoisted(() => ({ access: vi.fn(), working: vi.fn() }));
vi.mock("@/lib/land-use-plans/api", () => ({ loadLandUsePlanAccess: mocks.access, loadWorkingVersion: mocks.working }));
vi.mock("@/lib/supabase/server", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/lib/observability/audit", () => ({ createApiAuditLogger: () => ({ info: vi.fn() }) }));
import { PATCH } from "@/app/api/land-use-plans/[planId]/route";

const planId = "70000000-0000-4000-8000-000000000001";
const workspaceId = "70000000-0000-4000-8000-000000000002";
const versionId = "70000000-0000-4000-8000-000000000003";
const actorId = "70000000-0000-4000-8000-000000000004";
const otherId = "70000000-0000-4000-8000-000000000005";
const saved = syntheticPlanContext();
const otherGeometry = { type: "Polygon", coordinates: [[[10, 0], [11, 0], [11, 1], [10, 0]]] };
const conflict = { error: "Use the plan context editor to change the saved study area. Keep your draft and review the current plan context." };
type Query = { table: string; projection: string; filters: [string, unknown][]; payload?: Record<string, unknown> };
let queries: Query[];
let row: Record<string, unknown> | null;
let readError: { message: string } | null;
let writeError: { code: string; message: string } | null;
let plan: { id: string; workspace_id: string; descriptor_id: string; plan_kind_key: string;
  geography_label: string; geography_geojson: unknown; current_working_version_id: string };

function from(table: string) {
  const query: Query = { table, projection: "", filters: [] }; queries.push(query);
  const chain = {
    select(projection: string) { query.projection = projection; return chain; },
    eq(key: string, value: unknown) { query.filters.push([key, value]); return chain; },
    update(payload: Record<string, unknown>) { query.payload = payload; return chain; },
    async maybeSingle() {
      if (query.payload) return { data: writeError ? null : { id: table === "land_use_plans" ? planId : versionId }, error: writeError };
      // The reader receives only its projection, so omitted columns fail closed.
      return { data: row && Object.fromEntries(Object.entries(row).filter(([key]) => query.projection.split(",").includes(key))), error: readError };
    },
  };
  return chain;
}
const writes = () => queries.filter(query => query.payload !== undefined);
const reads = () => queries.filter(query => query.payload === undefined);
async function patch(body: Record<string, unknown>) {
  return PATCH(new NextRequest(`http://localhost/api/land-use-plans/${planId}`, {
    method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }), { params: Promise.resolve({ planId }) });
}

beforeEach(() => {
  vi.clearAllMocks(); queries = []; readError = null; writeError = null;
  plan = { id: planId, workspace_id: workspaceId, descriptor_id: "local-unconfigured", plan_kind_key: "community",
    geography_label: saved.place.label, geography_geojson: structuredClone(saved.place.geometry), current_working_version_id: versionId };
  row = { plan_context: structuredClone(saved), plan_context_hash: "a".repeat(64), descriptor_id: plan.descriptor_id,
    plan_kind_key: plan.plan_kind_key, current_working_version_id: versionId };
  mocks.access.mockResolvedValue({ ok: true, access: { plan, supabase: { from }, userId: actorId, canWrite: true } });
  mocks.working.mockResolvedValue({ id: versionId, applicable_requirement_keys: ["locally_defined"] });
});

describe("PATCH geography agreement with retained plan context", () => {
  it.each([
    { geographyLabel: "SYNTHETIC replacement" }, { geographyGeojson: otherGeometry },
    { geographyLabel: "SYNTHETIC replacement", geographyGeojson: otherGeometry },
  ])("refuses retained-place conflict %j before any identity or applicability write", async geography => {
    const response = await patch({ ...geography, title: "SYNTHETIC title", applicableRequirementKeys: ["locally_defined"] });
    expect(response.status).toBe(409); expect(await response.json()).toEqual(conflict);
    expect(writes()).toEqual([]);
    expect(reads()).toEqual([{ table: "land_use_plans",
      projection: "plan_context,plan_context_hash,descriptor_id,plan_kind_key,current_working_version_id",
      filters: [["id", planId], ["workspace_id", workspaceId]] }]);
    expect(mocks.access).toHaveBeenCalledWith(planId, { write: true });
  });

  it.each(["label", "geometry"])("requires explicit context save for pre-existing %s divergence", async field => {
    if (field === "label") plan.geography_label = "SYNTHETIC divergent label";
    else plan.geography_geojson = otherGeometry;
    const response = await patch({ geographyLabel: saved.place.label, geographyGeojson: saved.place.geometry });
    expect(response.status).toBe(409); expect(await response.json()).toEqual(conflict); expect(writes()).toEqual([]);
  });

  it("permits semantically identical geography and scopes the matched write", async () => {
    const response = await patch({ geographyLabel: saved.place.label,
      geographyGeojson: { coordinates: saved.place.geometry.coordinates, type: saved.place.geometry.type } });
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ updated: true });
    expect(writes()).toEqual([{ table: "land_use_plans", projection: "id", filters: [["id", planId], ["workspace_id", workspaceId]],
      payload: { geography_label: saved.place.label, geography_geojson: saved.place.geometry } }]);
  });

  it("permits legacy geography changes only after a valid explicit-null context read", async () => {
    Object.assign(row!, { plan_context: null, plan_context_hash: null });
    const response = await patch({ geographyLabel: "SYNTHETIC legacy area", geographyGeojson: otherGeometry });
    expect(response.status).toBe(200);
    expect(writes()[0]).toEqual({ table: "land_use_plans", projection: "id", filters: [["id", planId], ["workspace_id", workspaceId]],
      payload: { geography_label: "SYNTHETIC legacy area", geography_geojson: otherGeometry } });
  });

  it.each([
    { title: "SYNTHETIC title" }, { authorityLabel: "SYNTHETIC joint responsible bodies" },
    { applicableRequirementKeys: ["locally_defined"] },
  ])("permits unrelated edits without a context read %j", async payload => {
    row = { plan_context: { historical: "malformed" } }; readError = { message: "Must not read" };
    expect((await patch(payload)).status).toBe(200); expect(reads()).toEqual([]); expect(writes()).toHaveLength(1);
  });

  it.each(["missing-column", "malformed", "normalized", "missing-hash", "null-with-hash", "missing-identity"])("does not treat %s as legacy absence", async fault => {
    if (fault === "missing-column") delete row!.plan_context;
    if (fault === "malformed") row!.plan_context = {};
    if (fault === "normalized") row!.plan_context = { ...saved, place: { ...saved.place, label: ` ${saved.place.label} ` } };
    if (fault === "missing-hash") delete row!.plan_context_hash;
    if (fault === "null-with-hash") row!.plan_context = null;
    if (fault === "missing-identity") delete row!.descriptor_id;
    const response = await patch({ geographyGeojson: otherGeometry });
    expect(response.status).toBe(503); expect(writes()).toEqual([]);
  });

  it.each(["missing", "database"])("fails closed on %s read", async fault => {
    row = null; if (fault === "database") readError = { message: "PRIVATE read diagnostic" };
    const response = await patch({ geographyLabel: "SYNTHETIC change" });
    expect(response.status).toBe(fault === "missing" ? 404 : 503); expect(writes()).toEqual([]);
    expect(JSON.stringify(await response.json())).not.toContain("PRIVATE");
  });

  it.each(["current_working_version_id", "descriptor_id", "plan_kind_key"])("refuses changed context scope %s", async field => {
    row![field] = field === "current_working_version_id" ? otherId : "changed";
    const response = await patch({ geographyLabel: saved.place.label });
    expect(response.status).toBe(409); expect(writes()).toEqual([]);
  });

  it("refuses without a working version before reading context", async () => {
    mocks.working.mockResolvedValue(null);
    expect((await patch({ geographyGeojson: otherGeometry })).status).toBe(409); expect(queries).toEqual([]);
  });

  it("preserves access refusal before context reads or writes", async () => {
    mocks.access.mockResolvedValue({ ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) });
    expect((await patch({ geographyLabel: "SYNTHETIC change" })).status).toBe(403);
    expect(mocks.working).not.toHaveBeenCalled(); expect(queries).toEqual([]);
  });

  it("maps the exact database conflict after a pre-save legacy read and stops applicability", async () => {
    Object.assign(row!, { plan_context: null, plan_context_hash: null });
    writeError = { code: "PT409", message: "Land-use plan geography must match saved context" };
    const response = await patch({ geographyGeojson: otherGeometry, applicableRequirementKeys: ["locally_defined"] });
    expect(response.status).toBe(409); expect(await response.json()).toEqual(conflict);
    expect(writes()).toHaveLength(1); expect(writes()[0].table).toBe("land_use_plans");
  });

  it.each([
    { code: "23514", message: "Land-use plan geography must match saved context" },
    { code: "PT409", message: "Unrelated database conflict" },
    { code: "XX000", message: "PRIVATE database diagnostic" },
  ])("does not relabel unrelated database error %j as geography conflict", async error => {
    writeError = error;
    const response = await patch({ geographyLabel: saved.place.label });
    expect(response.status).toBe(500); expect(await response.json()).toEqual({ error: "Failed to update plan" });
  });
});

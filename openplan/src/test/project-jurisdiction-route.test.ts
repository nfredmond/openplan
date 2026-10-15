import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const user = "22222222-2222-4222-8222-222222222222";
const workspace = "11111111-1111-4111-8111-111111111111";
const id = "33333333-3333-4333-8333-333333333333";
const revision = "2026-10-15T00:00:00.000Z";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), access: vi.fn(), from: vi.fn(), update: vi.fn(), eq: vi.fn(), select: vi.fn(), single: vi.fn(), resolve: vi.fn(), service: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: mocks.auth }, from: mocks.from }), createServiceRoleClient: () => { mocks.service(); return { from: mocks.from }; } }));
vi.mock("@/lib/programs/api", () => ({ loadProjectAccess: mocks.access }));
vi.mock("@/lib/geographies/place-resolver", () => ({ resolvePlaceBoundary: mocks.resolve }));
vi.mock("@/lib/observability/audit", () => ({ createApiAuditLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));
import { GET as getReadiness } from "@/app/api/projects/[projectId]/jurisdiction-readiness/route";
import { PATCH } from "@/app/api/projects/[projectId]/route";
const declaration = { version: 1, state: "declared", entries: [{ mode: "staff", label: "Sovereign context", countryCode: null, subdivisionCode: null, kind: "nation", reference: "nation:staff-reference", scope: "sovereign" }] };
function request(payload: unknown = { expectedRevision: revision, jurisdiction: declaration }, headers: Record<string, string> = {}) {
  return new NextRequest(`http://localhost/api/projects/${id}`, { method: "PATCH", headers: { "content-type": "application/json", origin: "http://localhost", "x-openplan-expected-user": user, "x-openplan-expected-workspace": workspace, ...headers }, body: JSON.stringify(payload) });
}
const params = { params: Promise.resolve({ projectId: id }) };

describe("project jurisdiction human route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ data: { user: { id: user } } });
    mocks.access.mockResolvedValue({ project: { id, workspace_id: workspace, updated_at: revision }, membership: { role: "member" }, allowed: true });
    const chain = { update: mocks.update, eq: mocks.eq, select: mocks.select, maybeSingle: mocks.single, single: mocks.single };
    mocks.from.mockReturnValue(chain); mocks.update.mockReturnValue(chain); mocks.eq.mockReturnValue(chain); mocks.select.mockReturnValue(chain);
    mocks.single.mockResolvedValue({ data: { id, updated_at: "2026-10-15T00:01:00.000Z", jurisdiction_context: {} }, error: null });
    mocks.resolve.mockResolvedValue(null);
  });
  it("writes only jurisdiction with trusted actor and exact workspace revision predicates", async () => {
    const response = await PATCH(request(), params);
    expect(response.status).toBe(200);
    expect(mocks.service).toHaveBeenCalledOnce();
    expect(mocks.update).toHaveBeenCalledWith({ jurisdiction_context: { version: 1, state: "declared", entries: [{ label: "Sovereign context", countryCode: null, subdivisionCode: null, kind: "nation", reference: "nation:staff-reference", scope: "sovereign", identity: "staff_declared" }], recordedBy: user, recordedAt: expect.any(String) } });
    expect(mocks.eq.mock.calls).toEqual([["id", id], ["workspace_id", workspace], ["updated_at", revision]]);
    expect(mocks.select).toHaveBeenCalledWith("id, updated_at, jurisdiction_context");
  });
  it("rejects forged provenance and mixed geometry commands before writing", async () => {
    for (const payload of [{ expectedRevision: revision, jurisdiction: { ...declaration, recordedBy: user } }, { expectedRevision: revision, jurisdiction: declaration, place: null }, { jurisdiction: declaration }, { expectedRevision: revision }]) {
      expect((await PATCH(request(payload), params)).status).toBe(400);
    }
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("refuses assistant execution headers on the actual write path", async () => {
    for (const header of ["x-openplan-assistant-execution-source", "x-openplan-assistant-input-hash", "x-openplan-assistant-approval-id"]) {
      expect((await PATCH(request(undefined, { [header]: "untrusted" }), params)).status).toBe(403);
    }
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("requires matching browser origin account and workspace", async () => {
    for (const headers of ([{ origin: "https://other.invalid" }, { "x-openplan-expected-user": workspace }, { "x-openplan-expected-workspace": user }, { "sec-fetch-site": "cross-site" }] as Record<string, string>[])) {
      expect((await PATCH(request(undefined, headers), params)).status).toBe(403);
    }
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("refuses forbidden roles before the service seam", async () => {
    mocks.access.mockResolvedValue({ project: { id, workspace_id: workspace, updated_at: revision }, membership: { role: "viewer" }, allowed: false });
    expect((await PATCH(request(), params)).status).toBe(403); expect(mocks.service).not.toHaveBeenCalled();
  });
  it("returns 409 on stale or concurrently changed revisions without overwriting", async () => {
    expect((await PATCH(request({ expectedRevision: "2026-10-14T00:00:00.000Z", jurisdiction: declaration }), params)).status).toBe(409);
    expect(mocks.update).not.toHaveBeenCalled();
    mocks.single.mockResolvedValue({ data: null, error: null });
    expect((await PATCH(request(), params)).status).toBe(409);
  });
  it("returns unavailable on failed lookup and writes nothing", async () => {
    const payload = { expectedRevision: revision, jurisdiction: { version: 1, state: "declared", entries: [{ mode: "resolved", kind: "county", geoid: "06045" }] } };
    expect((await PATCH(request(payload), params)).status).toBe(503); expect(mocks.update).not.toHaveBeenCalled();
  });
  it("clears explicitly without changing study geometry and preserves jurisdiction during upload or clear", async () => {
    expect((await PATCH(request({ expectedRevision: revision, jurisdiction: { version: 1, state: "unresolved", entries: [] } }), params)).status).toBe(200);
    expect(Object.keys(mocks.update.mock.calls[0][0])).toEqual(["jurisdiction_context"]);
    expect(mocks.update.mock.calls[0][0].jurisdiction_context.state).toBe("unresolved");
    const geometry = { type: "Polygon", coordinates: [[[-124.12345, 40], [-123.12345, 40], [-123.12345, 41], [-124.12345, 40]]] };
    for (const place of [{ mode: "uploaded", geometry }, null]) {
      mocks.update.mockClear(); mocks.service.mockClear();
      expect((await PATCH(request({ place }), params)).status).toBe(200);
      expect(mocks.service).not.toHaveBeenCalled();
      expect(mocks.update.mock.calls[0][0]).not.toHaveProperty("jurisdiction_context");
      if (place) expect(mocks.update.mock.calls[0][0].place_geometry_geojson).toEqual(geometry);
    }
  });
  it("keeps invalid stored metadata and failed reads distinct from unassessed", async () => {
    for (const result of [{ data: { id, jurisdiction_context: {} }, error: null }, { data: { id }, error: null }, { data: null, error: { message: "read failed" } }]) {
      mocks.single.mockResolvedValue(result);
      const response = await getReadiness(new NextRequest(`http://localhost/api/projects/${id}/jurisdiction-readiness`), params);
      expect(response.status).toBe(500);
      const body = await response.json(); expect(body).toHaveProperty("error"); expect(body).not.toHaveProperty("entries");
    }
  });

});

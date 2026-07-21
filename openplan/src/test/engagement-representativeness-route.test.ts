import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const loadCampaignAccess = vi.fn();
const getUser = vi.fn();
const itemsLimit = vi.fn();
const corridorsLimit = vi.fn();
const updateEq = vi.fn();
const fetchCensusForCorridor = vi.fn();
const fetchTractOverlayFeatures = vi.fn();

const fakeSupabase = {
  auth: { getUser },
  from: vi.fn((table: string) => {
    if (table === "engagement_items") {
      const builder: Record<string, unknown> = {};
      builder.select = () => builder;
      builder.eq = () => builder;
      builder.not = () => builder;
      builder.limit = itemsLimit;
      return builder;
    }
    if (table === "project_corridors") {
      const builder: Record<string, unknown> = {};
      builder.select = () => builder;
      builder.eq = () => builder;
      builder.limit = corridorsLimit;
      return builder;
    }
    if (table === "engagement_campaigns") {
      return { update: () => ({ eq: updateEq }) };
    }
    throw new Error(`unexpected table ${table}`);
  }),
};

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => fakeSupabase) }));
vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));
vi.mock("@/lib/engagement/api", () => ({ loadCampaignAccess: (...a: unknown[]) => loadCampaignAccess(...a) }));
vi.mock("@/lib/data-sources/census", () => ({ fetchCensusForCorridor: (...a: unknown[]) => fetchCensusForCorridor(...a) }));
vi.mock("@/lib/data-sources/census-geometry", () => ({
  fetchTractOverlayFeatures: (...a: unknown[]) => fetchTractOverlayFeatures(...a),
}));

import { POST } from "@/app/api/engagement/campaigns/[campaignId]/representativeness/route";

const CAMPAIGN_ID = "11111111-1111-4111-8111-111111111111";
const ctx = { params: Promise.resolve({ campaignId: CAMPAIGN_ID }) };
const req = () => new NextRequest(`http://localhost/api/engagement/campaigns/${CAMPAIGN_ID}/representativeness`, { method: "POST" });

function censusTract(geoid: string, pctMinority: number) {
  return {
    geoid, state: "06", county: "057", tract: geoid, population: 1000, medianIncome: 60000,
    totalCommuters: 500, transitCommuters: 50, walkCommuters: 0, bikeCommuters: 0, wfhCommuters: 0,
    zeroVehicleHouseholds: 40, totalHouseholds: 400, pctMinority, pctBelowPoverty: 15,
  };
}
// Tract A square around the respondent points; B far away.
const A_SQUARE = { type: "Polygon", coordinates: [[[-121.04, 39.23], [-121.02, 39.23], [-121.02, 39.25], [-121.04, 39.25], [-121.04, 39.23]]] };
const B_SQUARE = { type: "Polygon", coordinates: [[[-120.5, 39.0], [-120.4, 39.0], [-120.4, 39.1], [-120.5, 39.1], [-120.5, 39.0]]] };

beforeEach(() => {
  vi.clearAllMocks();
  getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
  loadCampaignAccess.mockResolvedValue({ campaign: { workspace_id: "ws-1" }, error: null, allowed: true });
  itemsLimit.mockResolvedValue({
    data: [
      { id: "i1", latitude: 39.24, longitude: -121.03 },
      { id: "i2", latitude: 39.241, longitude: -121.031 },
      { id: "i3", latitude: 39.239, longitude: -121.029 },
    ],
    error: null,
  });
  corridorsLimit.mockResolvedValue({ data: [], error: null });
  updateEq.mockResolvedValue({ error: null });
  fetchCensusForCorridor.mockResolvedValue({ tracts: [censusTract("A", 20), censusTract("B", 60)] });
  fetchTractOverlayFeatures.mockResolvedValue([
    { type: "Feature", properties: { geoid: "A" }, geometry: A_SQUARE },
    { type: "Feature", properties: { geoid: "B" }, geometry: B_SQUARE },
  ]);
});

describe("POST /api/engagement/campaigns/[campaignId]/representativeness", () => {
  it("401 unauthenticated", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    expect((await POST(req(), ctx)).status).toBe(401);
  });

  it("404 when the campaign is not found", async () => {
    loadCampaignAccess.mockResolvedValue({ campaign: null, error: null });
    expect((await POST(req(), ctx)).status).toBe(404);
  });

  it("403 when the member lacks engagement.write", async () => {
    loadCampaignAccess.mockResolvedValue({ campaign: { workspace_id: "ws-1" }, error: null, allowed: false });
    expect((await POST(req(), ctx)).status).toBe(403);
  });

  it("422 when there are no located respondents", async () => {
    itemsLimit.mockResolvedValue({ data: [], error: null });
    const res = await POST(req(), ctx);
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("no_located_respondents");
  });

  it("502 when ACS returns no tracts", async () => {
    fetchCensusForCorridor.mockResolvedValue({ tracts: [] });
    const res = await POST(req(), ctx);
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("census_unavailable");
  });

  it("computes, flags under-representation, and caches the result", async () => {
    const res = await POST(req(), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    const rep = body.representativeness;
    expect(rep.respondentCount).toBe(3); // all 3 fell in tract A
    expect(rep.locatedRespondentCount).toBe(3);
    const minority = rep.metrics.find((m: { key: string }) => m.key === "minority");
    expect(minority.baselinePct).toBe(40); // (20+60)/2
    expect(minority.respondentPct).toBe(20); // all from A (20)
    expect(minority.status).toBe("under");
    expect(rep.underRepresented).toContain("minority");
    expect(rep.studyAreaSource).toBe("respondent_extent");
    // cached to the campaign
    expect(updateEq).toHaveBeenCalledWith("id", CAMPAIGN_ID);
    // No project on the campaign → the corridor table is never queried.
    expect(corridorsLimit).not.toHaveBeenCalled();
  });

  it("sources the study area from the project corridor when one exists", async () => {
    loadCampaignAccess.mockResolvedValue({
      campaign: { workspace_id: "ws-1", project_id: "project-1" },
      error: null,
      allowed: true,
    });
    // Corridor well away from the respondent cluster; its bbox must drive the
    // ACS fetch instead of the respondent footprint.
    corridorsLimit.mockResolvedValue({
      data: [
        { geometry_geojson: { type: "LineString", coordinates: [[-121.2, 39.3], [-121.1, 39.35]] } },
        { geometry_geojson: { type: "Polygon", coordinates: [] } }, // invalid → ignored
      ],
      error: null,
    });

    const res = await POST(req(), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.representativeness.studyAreaSource).toBe("project_corridor");

    // The census query polygon covers the buffered corridor bbox, not the
    // (tighter, offset) respondent bbox: ring must span the corridor extent.
    const polygon = fetchCensusForCorridor.mock.calls[0][0] as {
      coordinates: [number, number][][];
    };
    const lngs = polygon.coordinates[0].map(([lng]) => lng);
    const lats = polygon.coordinates[0].map(([, lat]) => lat);
    expect(Math.min(...lngs)).toBeLessThanOrEqual(-121.2);
    expect(Math.max(...lats)).toBeGreaterThanOrEqual(39.35);
  });

  it("falls back to the respondent footprint when the project has no valid corridor", async () => {
    loadCampaignAccess.mockResolvedValue({
      campaign: { workspace_id: "ws-1", project_id: "project-1" },
      error: null,
      allowed: true,
    });
    corridorsLimit.mockResolvedValue({ data: [{ geometry_geojson: null }], error: null });

    const res = await POST(req(), ctx);
    expect(res.status).toBe(200);
    expect((await res.json()).representativeness.studyAreaSource).toBe("respondent_extent");
  });

  it("treats a corridor query error as non-fatal and falls back", async () => {
    loadCampaignAccess.mockResolvedValue({
      campaign: { workspace_id: "ws-1", project_id: "project-1" },
      error: null,
      allowed: true,
    });
    corridorsLimit.mockResolvedValue({ data: null, error: { message: "boom" } });

    const res = await POST(req(), ctx);
    expect(res.status).toBe(200);
    expect((await res.json()).representativeness.studyAreaSource).toBe("respondent_extent");
  });
});

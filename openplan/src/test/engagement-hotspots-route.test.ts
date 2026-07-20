import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const loadCampaignAccess = vi.fn();
const getUser = vi.fn();
const maybeSingle = vi.fn();
const rpc = vi.fn();

const fakeSupabase = {
  auth: { getUser },
  from: vi.fn(() => ({ select: () => ({ eq: () => ({ maybeSingle }) }) })),
  rpc,
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => fakeSupabase),
}));
vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));
vi.mock("@/lib/engagement/api", () => ({
  loadCampaignAccess: (...args: unknown[]) => loadCampaignAccess(...args),
}));

import { GET } from "@/app/api/engagement/campaigns/[campaignId]/hotspots/route";

const CAMPAIGN_ID = "11111111-1111-4111-8111-111111111111";

function makeRequest(query = "") {
  return new NextRequest(`http://localhost/api/engagement/campaigns/${CAMPAIGN_ID}/hotspots${query}`);
}
const ctx = { params: Promise.resolve({ campaignId: CAMPAIGN_ID }) };

const NEGATIVE_SYNTHESIS = {
  themes: [{ label: "Traffic", sentiment: "negative", item_count: 1, fact_ids: ["item_a"], summary: "" }],
};

beforeEach(() => {
  vi.clearAllMocks();
  getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
  loadCampaignAccess.mockResolvedValue({
    campaign: { workspace_id: "ws-1" },
    membership: { workspace_id: "ws-1", role: "editor" },
    error: null,
    allowed: true,
  });
  maybeSingle.mockResolvedValue({ data: { ai_synthesis_json: NEGATIVE_SYNTHESIS }, error: null });
  rpc.mockResolvedValue({
    data: [
      {
        cluster_id: 0,
        n_items: 40,
        n_negative: 30,
        cluster_negative_share: 0.75,
        global_negative_share: 0.4,
        z_score: 4.5,
        centroid_lng: -121.03,
        centroid_lat: 39.24,
        footprint_geojson: '{"type":"Polygon","coordinates":[[[-121.03,39.24],[-121.02,39.24],[-121.02,39.25],[-121.03,39.24]]]}',
        item_ids: ["a", "b"],
      },
    ],
    error: null,
  });
});

describe("GET /api/engagement/campaigns/[campaignId]/hotspots", () => {
  it("401 when unauthenticated", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const res = await GET(makeRequest(), ctx);
    expect(res.status).toBe(401);
  });

  it("404 when the campaign is not found", async () => {
    loadCampaignAccess.mockResolvedValue({ campaign: null, membership: null, error: null });
    const res = await GET(makeRequest(), ctx);
    expect(res.status).toBe(404);
  });

  it("403 when the member lacks engagement.read", async () => {
    loadCampaignAccess.mockResolvedValue({
      campaign: { workspace_id: "ws-1" },
      membership: null,
      error: null,
      allowed: false,
    });
    const res = await GET(makeRequest(), ctx);
    expect(res.status).toBe(403);
  });

  it("returns the classified hotspots and calls the RPC scoped to the campaign", async () => {
    const res = await GET(makeRequest(), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.hotspots.clusterCount).toBe(1);
    expect(body.hotspots.sentimentAvailable).toBe(true);
    expect(body.hotspots.clusters[0].significant).toBe(true);
    expect(rpc).toHaveBeenCalledWith(
      "engagement_sentiment_hotspots",
      expect.objectContaining({
        p_workspace_id: "ws-1",
        p_campaign_id: CAMPAIGN_ID,
        p_negative_item_ids: ["a"],
      })
    );
  });

  it("clamps the eps/minPoints query params", async () => {
    await GET(makeRequest("?eps=99999&minPoints=1"), ctx);
    expect(rpc).toHaveBeenCalledWith(
      "engagement_sentiment_hotspots",
      expect.objectContaining({ p_eps_meters: 2000, p_min_points: 2 })
    );
  });

  it("500 when the RPC errors", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    const res = await GET(makeRequest(), ctx);
    expect(res.status).toBe(500);
  });
});

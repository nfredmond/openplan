import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const authGetUserMock = vi.fn();

const mockAudit = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const campaignMaybeSingleMock = vi.fn();
const campaignEqMock = vi.fn(() => ({ maybeSingle: campaignMaybeSingleMock }));
const campaignSelectMock = vi.fn(() => ({ eq: campaignEqMock }));

const membershipMaybeSingleMock = vi.fn();
const membershipEqUserMock = vi.fn(() => ({ maybeSingle: membershipMaybeSingleMock }));
const membershipEqWorkspaceMock = vi.fn(() => ({ eq: membershipEqUserMock }));
const membershipSelectMock = vi.fn(() => ({ eq: membershipEqWorkspaceMock }));

const categoriesResult = vi.fn();
const categoriesEqMock = vi.fn(() => categoriesResult());
const categoriesSelectMock = vi.fn(() => ({ eq: categoriesEqMock }));

const itemsOrderMock = vi.fn();
const itemsEqStatusMock = vi.fn(() => ({ order: itemsOrderMock }));
const itemsEqCampaignMock = vi.fn(() => ({ order: itemsOrderMock, eq: itemsEqStatusMock }));
const itemsSelectMock = vi.fn(() => ({ eq: itemsEqCampaignMock }));

const fromMock = vi.fn((table: string) => {
  if (table === "engagement_campaigns") {
    return { select: campaignSelectMock };
  }
  if (table === "workspace_members") {
    return { select: membershipSelectMock };
  }
  if (table === "engagement_categories") {
    return { select: categoriesSelectMock };
  }
  if (table === "engagement_items") {
    return { select: itemsSelectMock };
  }
  throw new Error(`Unexpected table: ${table}`);
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: (...args: unknown[]) => createApiAuditLoggerMock(...args),
}));

import { GET } from "@/app/api/engagement/campaigns/[campaignId]/export/route";

const validCampaignId = "11111111-1111-4111-8111-111111111111";

describe("GET /api/engagement/campaigns/[campaignId]/export", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    createApiAuditLoggerMock.mockReturnValue(mockAudit);
    authGetUserMock.mockResolvedValue({
      data: { user: { id: "22222222-2222-4222-8222-222222222222" } },
    });

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    });

    campaignMaybeSingleMock.mockResolvedValue({
      data: {
        id: validCampaignId,
        workspace_id: "44444444-4444-4444-8444-444444444444",
        project_id: null,
        title: "Test Campaign",
        status: "active",
        share_token: "pilot-link-01",
        allow_public_submissions: true,
        submissions_closed_at: null,
      },
      error: null,
    });

    membershipMaybeSingleMock.mockResolvedValue({
      data: {
        workspace_id: "44444444-4444-4444-8444-444444444444",
        role: "member",
      },
      error: null,
    });

    categoriesResult.mockReturnValue({
      data: [
        { id: "55555555-5555-4555-8555-555555555555", label: "Safety", slug: "safety" },
      ],
      error: null,
    });

    itemsOrderMock.mockResolvedValue({
      data: [
        {
          id: "66666666-6666-4666-8666-666666666666",
          campaign_id: validCampaignId,
          category_id: "55555555-5555-4555-8555-555555555555",
          title: "Unsafe crossing",
          body: "Need better crosswalk markings",
          submitted_by: "Jane",
          status: "approved",
          source_type: "public",
          latitude: 39.22,
          longitude: -121.06,
          geometry: null,
          votes_count: 3,
          moderation_notes: null,
          metadata_json: {},
          created_at: "2026-03-20T12:00:00.000Z",
          updated_at: "2026-03-20T12:00:00.000Z",
        },
      ],
      error: null,
    });
  });

  it("returns 401 when unauthenticated", async () => {
    authGetUserMock.mockResolvedValueOnce({ data: { user: null } });

    const response = await GET(
      new NextRequest(`http://localhost/api/engagement/campaigns/${validCampaignId}/export?format=csv`),
      { params: Promise.resolve({ campaignId: validCampaignId }) }
    );

    expect(response.status).toBe(401);
  });

  it("returns CSV export with correct content type", async () => {
    const response = await GET(
      new NextRequest(`http://localhost/api/engagement/campaigns/${validCampaignId}/export?format=csv`),
      { params: Promise.resolve({ campaignId: validCampaignId }) }
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv");

    const csvText = await response.text();
    expect(csvText).toContain("id,title,body");
    expect(csvText).toContain("Unsafe crossing");
    expect(csvText).toContain("Safety");
  });

  it("returns JSON export when format=json", async () => {
    const response = await GET(
      new NextRequest(`http://localhost/api/engagement/campaigns/${validCampaignId}/export?format=json`),
      { params: Promise.resolve({ campaignId: validCampaignId }) }
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");

    const json = JSON.parse(await response.text());
    expect(json.campaign.id).toBe(validCampaignId);
    expect(json.campaign.publicPortal).toMatchObject({
      label: "Live · accepting submissions",
      portalPath: "/engage/pilot-link-01",
      isPubliclyReachable: true,
      isAcceptingSubmissions: true,
    });
    expect(json.items).toHaveLength(1);
    expect(json.items[0].categoryLabel).toBe("Safety");
    // Internal submission tracking (IP fingerprint / user-agent / referer) must
    // not travel into a downloadable export an agency may share onward.
    expect(json.items[0]).not.toHaveProperty("metadata_json");
    expect(json.meta.handoffReadiness).toMatchObject({
      readyForHandoffCount: 1,
      actionableCount: 0,
      uncategorizedItems: 0,
      appendixReadyCount: 1,
      duplicateReviewCount: 0,
      publicApprovedCategorizedCount: 1,
      nonPublicApprovedCategorizedCount: 0,
    });
    expect(json.meta.commentMatrixPreview).toMatchObject({
      caveat: expect.stringMatching(/staff cue only/i),
      counts: {
        includedCount: 1,
        heldDuplicateReviewCount: 0,
        excludedInternalPrivateCount: 0,
        excludedNotReadyCount: 0,
        previewedRowCount: 1,
        totalItemCount: 1,
      },
      rows: [
        expect.objectContaining({
          itemId: "66666666-6666-4666-8666-666666666666",
          posture: "included",
          postureLabel: "Included in matrix preview",
          categoryLabel: "Safety",
        }),
      ],
    });
  });

  it("returns a GeoJSON FeatureCollection (WGS84) that GIS tools import", async () => {
    itemsOrderMock.mockResolvedValueOnce({
      data: [
        // point synthesized from lat/lng (no stored geometry)
        { id: "aaaaaaa1-0000-4000-8000-000000000001", campaign_id: validCampaignId, category_id: "55555555-5555-4555-8555-555555555555", title: "Point item", body: "b1", submitted_by: "Jane", status: "approved", source_type: "public", latitude: 39.22, longitude: -121.06, geometry: null, votes_count: 4, moderation_notes: "internal note", metadata_json: {}, created_at: "2026-03-20T12:00:00.000Z", updated_at: "2026-03-20T12:00:00.000Z" },
        // stored LineString geometry passes through
        { id: "aaaaaaa1-0000-4000-8000-000000000002", campaign_id: validCampaignId, category_id: null, title: "Line item", body: "b2", submitted_by: null, status: "approved", source_type: "public", latitude: 39.2, longitude: -121.05, geometry: { type: "LineString", coordinates: [[-121.06, 39.2], [-121.04, 39.24]] }, votes_count: 0, moderation_notes: null, metadata_json: {}, created_at: "2026-03-20T12:00:00.000Z", updated_at: "2026-03-20T12:00:00.000Z" },
        // no location → skipped, not emitted as a feature
        { id: "aaaaaaa1-0000-4000-8000-000000000003", campaign_id: validCampaignId, category_id: null, title: "No location", body: "b3", submitted_by: null, status: "approved", source_type: "public", latitude: null, longitude: null, geometry: null, votes_count: 1, moderation_notes: null, metadata_json: {}, created_at: "2026-03-20T12:00:00.000Z", updated_at: "2026-03-20T12:00:00.000Z" },
      ],
      error: null,
    });

    const response = await GET(
      new NextRequest(`http://localhost/api/engagement/campaigns/${validCampaignId}/export?format=geojson`),
      { params: Promise.resolve({ campaignId: validCampaignId }) }
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/geo+json");
    expect(response.headers.get("content-disposition")).toContain(".geojson");

    const fc = JSON.parse(await response.text());
    expect(fc.type).toBe("FeatureCollection");
    expect(fc.features).toHaveLength(2); // the no-location item is skipped

    const point = fc.features[0];
    expect(point.geometry).toEqual({ type: "Point", coordinates: [-121.06, 39.22] }); // [lng, lat]
    expect(point.properties).toMatchObject({ id: "aaaaaaa1-0000-4000-8000-000000000001", category_label: "Safety", votes_count: 4 });
    expect(point.properties).not.toHaveProperty("moderation_notes"); // internal note excluded from a portable file

    expect(fc.features[1].geometry.type).toBe("LineString");
  });

  it("rejects unsupported format", async () => {
    const response = await GET(
      new NextRequest(`http://localhost/api/engagement/campaigns/${validCampaignId}/export?format=xml`),
      { params: Promise.resolve({ campaignId: validCampaignId }) }
    );

    expect(response.status).toBe(400);
  });
});

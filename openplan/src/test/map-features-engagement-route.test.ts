import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const loadCurrentWorkspaceMembershipMock = vi.fn();
const authGetUserMock = vi.fn();

const WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const CAMPAIGN_ID = "c0000001-0000-4000-8000-000000000200";
const ITEM_A = "e0000001-0000-4000-8000-000000000101";
const ITEM_B = "e0000001-0000-4000-8000-000000000102";
const ITEM_C = "e0000001-0000-4000-8000-000000000103";

const engagementLimitMock = vi.fn();
const engagementNotLngMock = vi.fn(() => ({ limit: engagementLimitMock }));
const engagementNotLatMock = vi.fn(() => ({ not: engagementNotLngMock }));
const engagementEqStatusMock = vi.fn(() => ({ not: engagementNotLatMock }));
const engagementEqWorkspaceMock = vi.fn(() => ({ eq: engagementEqStatusMock }));
const engagementSelectMock = vi.fn(() => ({ eq: engagementEqWorkspaceMock }));

const mockAudit = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const fromMock = vi.fn((table: string) => {
  if (table === "engagement_items") {
    return { select: engagementSelectMock };
  }
  throw new Error(`Unexpected table: ${table}`);
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: (...args: unknown[]) => createApiAuditLoggerMock(...args),
}));

vi.mock("@/lib/workspaces/current", async () => {
  const actual = await vi.importActual<typeof import("@/lib/workspaces/current")>(
    "@/lib/workspaces/current"
  );
  return {
    ...actual,
    loadCurrentWorkspaceMembership: (...args: unknown[]) =>
      loadCurrentWorkspaceMembershipMock(...args),
  };
});

import { GET as getEngagementItems } from "@/app/api/map-features/engagement/route";

function bareRequest() {
  return new NextRequest("http://localhost/api/map-features/engagement", { method: "GET" });
}

describe("GET /api/map-features/engagement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createApiAuditLoggerMock.mockReturnValue(mockAudit);
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    });
  });

  it("returns 401 when the request is anonymous", async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null } });

    const response = await getEngagementItems(bareRequest());

    expect(response.status).toBe(401);
    expect(loadCurrentWorkspaceMembershipMock).not.toHaveBeenCalled();
  });

  it("returns an empty FeatureCollection when the user has no workspace membership", async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
    loadCurrentWorkspaceMembershipMock.mockResolvedValue({ membership: null, workspace: null });

    const response = await getEngagementItems(bareRequest());

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { type: string; features: unknown[] };
    expect(payload.type).toBe("FeatureCollection");
    expect(payload.features).toEqual([]);
    expect(engagementSelectMock).not.toHaveBeenCalled();
  });

  it("maps approved engagement items to Point features scoped by workspace and status", async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
    loadCurrentWorkspaceMembershipMock.mockResolvedValue({
      membership: { workspace_id: WORKSPACE_ID, role: "editor" },
      workspace: { id: WORKSPACE_ID, name: "NCTC demo" },
    });
    engagementLimitMock.mockResolvedValue({
      data: [
        {
          id: ITEM_A,
          title: "Unsafe crossing at Neal + Mill",
          body: "Kids bike to Magnolia Elementary from here and there's no crosswalk.",
          status: "approved",
          source_type: "public",
          latitude: 39.2203,
          longitude: -121.0608,
          engagement_campaigns: { id: CAMPAIGN_ID, workspace_id: WORKSPACE_ID },
          engagement_categories: { label: "Safety concern" },
        },
        {
          // PostgREST can return DOUBLE PRECISION as strings on some drivers;
          // the route must coerce defensively. Also exercises null category.
          id: ITEM_B,
          title: null,
          body: null,
          status: "approved",
          source_type: "meeting",
          latitude: "39.224",
          longitude: "-121.055",
          engagement_campaigns: [{ id: CAMPAIGN_ID, workspace_id: WORKSPACE_ID }],
          engagement_categories: [{ label: "Transit access" }],
        },
        {
          // Out-of-range: defensive drop despite the row-level CHECK constraint.
          id: ITEM_C,
          title: "Bad anchor",
          body: "Should be dropped",
          status: "approved",
          source_type: "public",
          latitude: 99,
          longitude: -121,
          engagement_campaigns: { id: CAMPAIGN_ID, workspace_id: WORKSPACE_ID },
          engagement_categories: null,
        },
      ],
      error: null,
    });

    const response = await getEngagementItems(bareRequest());

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      type: string;
      features: Array<{
        id: string;
        geometry: { type: string; coordinates: [number, number] };
        properties: Record<string, unknown>;
      }>;
    };
    expect(payload.type).toBe("FeatureCollection");
    expect(payload.features).toHaveLength(2);
    expect(payload.features[0]).toMatchObject({
      id: ITEM_A,
      geometry: { type: "Point", coordinates: [-121.0608, 39.2203] },
      properties: {
        kind: "engagement_item",
        itemId: ITEM_A,
        campaignId: CAMPAIGN_ID,
        title: "Unsafe crossing at Neal + Mill",
        status: "approved",
        sourceType: "public",
        categoryLabel: "Safety concern",
      },
    });
    expect(payload.features[0].properties.excerpt).toContain("Kids bike to Magnolia Elementary");
    expect(payload.features[1]).toMatchObject({
      id: ITEM_B,
      geometry: { type: "Point", coordinates: [-121.055, 39.224] },
        properties: {
          title: null,
          excerpt: "",
          categoryLabel: "Transit access",
          sourceType: "meeting",
        },
    });
    expect(engagementEqWorkspaceMock).toHaveBeenCalledWith(
      "engagement_campaigns.workspace_id",
      WORKSPACE_ID
    );
    expect(engagementEqStatusMock).toHaveBeenCalledWith("status", "approved");
    expect(engagementNotLatMock).toHaveBeenCalledWith("latitude", "is", null);
    expect(engagementNotLngMock).toHaveBeenCalledWith("longitude", "is", null);
    expect(mockAudit.info).toHaveBeenCalledWith(
      "engagement_items_loaded",
      expect.objectContaining({ workspaceId: WORKSPACE_ID, count: 2 })
    );
  });

  it("drops rows whose campaign relation is missing (join miss defensive)", async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
    loadCurrentWorkspaceMembershipMock.mockResolvedValue({
      membership: { workspace_id: WORKSPACE_ID, role: "editor" },
      workspace: { id: WORKSPACE_ID, name: "NCTC demo" },
    });
    engagementLimitMock.mockResolvedValue({
      data: [
        {
          id: ITEM_A,
          title: "Orphaned",
          body: "No campaign attached",
          status: "approved",
          source_type: "public",
          latitude: 39.22,
          longitude: -121.06,
          engagement_campaigns: null,
          engagement_categories: null,
        },
      ],
      error: null,
    });

    const response = await getEngagementItems(bareRequest());
    const payload = (await response.json()) as { features: unknown[] };

    expect(response.status).toBe(200);
    expect(payload.features).toEqual([]);
  });

  it("truncates very long bodies to an excerpt", async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
    loadCurrentWorkspaceMembershipMock.mockResolvedValue({
      membership: { workspace_id: WORKSPACE_ID, role: "editor" },
      workspace: { id: WORKSPACE_ID, name: "NCTC demo" },
    });
    const longBody = "a".repeat(400);
    engagementLimitMock.mockResolvedValue({
      data: [
        {
          id: ITEM_A,
          title: "Long",
          body: longBody,
          status: "approved",
          source_type: "public",
          latitude: 39.22,
          longitude: -121.06,
          engagement_campaigns: { id: CAMPAIGN_ID, workspace_id: WORKSPACE_ID },
          engagement_categories: null,
        },
      ],
      error: null,
    });

    const response = await getEngagementItems(bareRequest());
    const payload = (await response.json()) as {
      features: Array<{ properties: { excerpt: string } }>;
    };

    expect(response.status).toBe(200);
    expect(payload.features[0].properties.excerpt.length).toBeLessThanOrEqual(140);
    expect(payload.features[0].properties.excerpt.endsWith("…")).toBe(true);
  });

  it("returns 500 when the engagement_items lookup fails", async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
    loadCurrentWorkspaceMembershipMock.mockResolvedValue({
      membership: { workspace_id: WORKSPACE_ID, role: "editor" },
      workspace: { id: WORKSPACE_ID, name: "NCTC demo" },
    });
    engagementLimitMock.mockResolvedValue({
      data: null,
      error: { message: "boom", code: "42P01" },
    });

    const response = await getEngagementItems(bareRequest());

    expect(response.status).toBe(500);
    expect(mockAudit.error).toHaveBeenCalledWith(
      "engagement_items_query_failed",
      expect.objectContaining({ workspaceId: WORKSPACE_ID, message: "boom" })
    );
  });
});

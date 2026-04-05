import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const authGetUserMock = vi.fn();

const campaignMaybeSingleMock = vi.fn();
const campaignEqMock = vi.fn(() => ({ maybeSingle: campaignMaybeSingleMock }));
const campaignSelectMock = vi.fn(() => ({ eq: campaignEqMock }));
const campaignUpdateEqMock = vi.fn().mockResolvedValue({ error: null });
const campaignUpdateMock = vi.fn(() => ({ eq: campaignUpdateEqMock }));

const membershipMaybeSingleMock = vi.fn();
const membershipEqUserMock = vi.fn(() => ({ maybeSingle: membershipMaybeSingleMock }));
const membershipEqWorkspaceMock = vi.fn(() => ({ eq: membershipEqUserMock }));
const membershipSelectMock = vi.fn(() => ({ eq: membershipEqWorkspaceMock }));

const projectMaybeSingleMock = vi.fn();
const projectEqMock = vi.fn(() => ({ maybeSingle: projectMaybeSingleMock }));
const projectSelectMock = vi.fn(() => ({ eq: projectEqMock }));

const categoriesOrderCreatedMock = vi.fn();
const categoriesOrderSortMock = vi.fn(() => ({ order: categoriesOrderCreatedMock }));
const categoriesEqCampaignMock = vi.fn(() => ({ order: categoriesOrderSortMock }));

const itemsOrderMock = vi.fn();
const itemsEqCampaignMock = vi.fn(() => ({ order: itemsOrderMock }));
const reportsOrderMock = vi.fn();
const reportsEqProjectMock = vi.fn(() => ({ order: reportsOrderMock }));

const mockAudit = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const fromMock = vi.fn((table: string) => {
  if (table === "engagement_campaigns") {
    return {
      select: campaignSelectMock,
      update: campaignUpdateMock,
    };
  }

  if (table === "workspace_members") {
    return {
      select: membershipSelectMock,
    };
  }

  if (table === "projects") {
    return {
      select: projectSelectMock,
    };
  }

  if (table === "engagement_categories") {
    return {
      select: () => ({ eq: categoriesEqCampaignMock }),
    };
  }

  if (table === "engagement_items") {
    return {
      select: () => ({ eq: itemsEqCampaignMock }),
    };
  }

  if (table === "reports") {
    return {
      select: () => ({ eq: reportsEqProjectMock }),
    };
  }

  throw new Error(`Unexpected table: ${table}`);
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: (...args: unknown[]) => createApiAuditLoggerMock(...args),
}));

import { GET as getCampaignDetail, PATCH as patchCampaignDetail } from "@/app/api/engagement/campaigns/[campaignId]/route";

describe("/api/engagement/campaigns/[campaignId]", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T12:00:00.000Z"));
    vi.clearAllMocks();

    createApiAuditLoggerMock.mockReturnValue(mockAudit);
    authGetUserMock.mockResolvedValue({
      data: {
        user: {
          id: "22222222-2222-4222-8222-222222222222",
        },
      },
    });

    campaignMaybeSingleMock.mockResolvedValue({
      data: {
        id: "11111111-1111-4111-8111-111111111111",
        workspace_id: "33333333-3333-4333-8333-333333333333",
        project_id: "44444444-4444-4444-8444-444444444444",
        title: "Downtown listening campaign",
        status: "draft",
        engagement_type: "comment_collection",
      },
      error: null,
    });

    membershipMaybeSingleMock.mockResolvedValue({
      data: {
        workspace_id: "33333333-3333-4333-8333-333333333333",
        role: "member",
      },
      error: null,
    });

    projectMaybeSingleMock.mockResolvedValue({
      data: {
        id: "44444444-4444-4444-8444-444444444444",
        name: "Downtown safety project",
      },
      error: null,
    });

    categoriesOrderCreatedMock.mockResolvedValue({
      data: [
        {
          id: "55555555-5555-4555-8555-555555555555",
          campaign_id: "11111111-1111-4111-8111-111111111111",
          label: "Safety",
          description: "Crossings and speeding",
        },
      ],
      error: null,
    });

    itemsOrderMock.mockResolvedValue({
      data: [
        {
          id: "66666666-6666-4666-8666-666666666666",
          campaign_id: "11111111-1111-4111-8111-111111111111",
          category_id: "55555555-5555-4555-8555-555555555555",
          title: "Crossing issue",
          body: "Drivers roll the stop line at school pickup.",
          status: "flagged",
          source_type: "meeting",
          latitude: 34.1,
          longitude: -118.3,
          moderation_notes: "Needs follow-up",
          updated_at: "2026-03-14T16:00:00.000Z",
        },
        {
          id: "77777777-7777-4777-8777-777777777777",
          campaign_id: "11111111-1111-4111-8111-111111111111",
          category_id: null,
          title: "Need shade",
          body: "Waiting area is exposed.",
          status: "approved",
          source_type: "public",
          latitude: null,
          longitude: null,
          moderation_notes: null,
          updated_at: "2026-03-01T16:00:00.000Z",
        },
      ],
      error: null,
    });

    reportsOrderMock.mockResolvedValue({
      data: [
        {
          id: "88888888-8888-4888-8888-888888888888",
          project_id: "44444444-4444-4444-8444-444444444444",
          title: "Downtown Safety Packet",
          report_type: "project_status",
          status: "generated",
          generated_at: "2026-03-13T16:00:00.000Z",
          updated_at: "2026-03-13T16:05:00.000Z",
        },
      ],
      error: null,
    });

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("GET returns campaign detail with categories and moderation counts", async () => {
    const response = await getCampaignDetail(new NextRequest("http://localhost/api/engagement/campaigns/1"), {
      params: Promise.resolve({ campaignId: "11111111-1111-4111-8111-111111111111" }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      campaign: {
        id: "11111111-1111-4111-8111-111111111111",
      },
      project: {
        id: "44444444-4444-4444-8444-444444444444",
      },
      categories: expect.arrayContaining([expect.objectContaining({ id: "55555555-5555-4555-8555-555555555555" })]),
      recentItems: expect.arrayContaining([expect.objectContaining({ id: "66666666-6666-4666-8666-666666666666" })]),
      linkedReports: expect.arrayContaining([expect.objectContaining({ id: "88888888-8888-4888-8888-888888888888" })]),
      counts: {
        totalItems: 2,
        geolocatedItems: 1,
        nonGeolocatedItems: 1,
        categorizedItems: 1,
        uncategorizedItems: 1,
        itemsWithModerationNotes: 1,
        sourceSummaries: expect.arrayContaining([
          expect.objectContaining({ sourceType: "meeting", count: 1, geolocatedCount: 1 }),
          expect.objectContaining({ sourceType: "public", count: 1, nonGeolocatedCount: 1 }),
        ]),
        moderationQueue: expect.objectContaining({
          actionableCount: 1,
          flaggedCount: 1,
          readyForHandoffCount: 0,
        }),
        geographyCoverage: expect.objectContaining({
          geolocatedShare: 0.5,
        }),
        recentActivity: expect.objectContaining({
          count: 1,
          byStatus: expect.objectContaining({
            flagged: 1,
          }),
        }),
        statusCounts: expect.objectContaining({
          approved: 1,
          flagged: 1,
        }),
        categoryCounts: expect.arrayContaining([
          expect.objectContaining({ categoryId: "55555555-5555-4555-8555-555555555555", count: 1 }),
          expect.objectContaining({ categoryId: null, count: 1 }),
        ]),
      },
    });
  });

  it("PATCH returns 403 when workspace role is unsupported", async () => {
    membershipMaybeSingleMock.mockResolvedValueOnce({
      data: {
        workspace_id: "33333333-3333-4333-8333-333333333333",
        role: "viewer",
      },
      error: null,
    });

    const response = await patchCampaignDetail(
      new NextRequest("http://localhost/api/engagement/campaigns/1", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Updated campaign" }),
      }),
      {
        params: Promise.resolve({ campaignId: "11111111-1111-4111-8111-111111111111" }),
      }
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "Workspace access denied" });
  });

  it("PATCH updates campaign metadata", async () => {
    const response = await patchCampaignDetail(
      new NextRequest("http://localhost/api/engagement/campaigns/1", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "Updated campaign",
          status: "active",
          engagementType: "map_feedback",
        }),
      }),
      {
        params: Promise.resolve({ campaignId: "11111111-1111-4111-8111-111111111111" }),
      }
    );

    expect(response.status).toBe(200);
    expect(campaignUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Updated campaign",
        status: "active",
        engagement_type: "map_feedback",
      })
    );
  });

  it("PATCH rejects an in-use share token after normalization", async () => {
    campaignMaybeSingleMock
      .mockResolvedValueOnce({
        data: {
          id: "11111111-1111-4111-8111-111111111111",
          workspace_id: "33333333-3333-4333-8333-333333333333",
          project_id: "44444444-4444-4444-8444-444444444444",
          title: "Downtown listening campaign",
          status: "draft",
          engagement_type: "comment_collection",
          share_token: null,
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          id: "99999999-9999-4999-8999-999999999999",
        },
        error: null,
      });

    const response = await patchCampaignDetail(
      new NextRequest("http://localhost/api/engagement/campaigns/1", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          shareToken: " Pilot_Link_01 ",
        }),
      }),
      {
        params: Promise.resolve({ campaignId: "11111111-1111-4111-8111-111111111111" }),
      }
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: "That share token is already in use by another engagement campaign",
    });
  });

  it("PATCH stores a lowercased share token when available", async () => {
    campaignMaybeSingleMock
      .mockResolvedValueOnce({
        data: {
          id: "11111111-1111-4111-8111-111111111111",
          workspace_id: "33333333-3333-4333-8333-333333333333",
          project_id: "44444444-4444-4444-8444-444444444444",
          title: "Downtown listening campaign",
          status: "draft",
          engagement_type: "comment_collection",
          share_token: null,
        },
        error: null,
      })
      .mockResolvedValueOnce({ data: null, error: null });

    const response = await patchCampaignDetail(
      new NextRequest("http://localhost/api/engagement/campaigns/1", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          shareToken: " Pilot_Link_02 ",
        }),
      }),
      {
        params: Promise.resolve({ campaignId: "11111111-1111-4111-8111-111111111111" }),
      }
    );

    expect(response.status).toBe(200);
    expect(campaignUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        share_token: "pilot_link_02",
      })
    );
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const authGetUserMock = vi.fn();

const campaignMaybeSingleMock = vi.fn();
const campaignEqMock = vi.fn(() => ({ maybeSingle: campaignMaybeSingleMock }));
const campaignSelectMock = vi.fn(() => ({ eq: campaignEqMock }));

const membershipMaybeSingleMock = vi.fn();
const membershipEqUserMock = vi.fn(() => ({ maybeSingle: membershipMaybeSingleMock }));
const membershipEqWorkspaceMock = vi.fn(() => ({ eq: membershipEqUserMock }));
const membershipSelectMock = vi.fn(() => ({ eq: membershipEqWorkspaceMock }));

const categoryMaybeSingleMock = vi.fn();
const categoryEqIdMock = vi.fn(() => ({ maybeSingle: categoryMaybeSingleMock }));
const categoryEqCampaignMock = vi.fn(() => ({ eq: categoryEqIdMock }));
const categorySelectMock = vi.fn(() => ({ eq: categoryEqCampaignMock }));
const categorySingleMock = vi.fn();
const categoryInsertSelectMock = vi.fn(() => ({ single: categorySingleMock }));
const categoryInsertMock = vi.fn(() => ({ select: categoryInsertSelectMock }));

const itemMaybeSingleMock = vi.fn();
const itemEqCampaignMock = vi.fn(() => ({ maybeSingle: itemMaybeSingleMock }));
const itemEqIdMock = vi.fn(() => ({ eq: itemEqCampaignMock, maybeSingle: itemMaybeSingleMock }));
const itemSelectMock = vi.fn(() => ({ eq: itemEqIdMock }));
const itemSingleMock = vi.fn();
const itemInsertSelectMock = vi.fn(() => ({ single: itemSingleMock }));
const itemInsertMock = vi.fn(() => ({ select: itemInsertSelectMock }));
const itemUpdateEqMock = vi.fn().mockResolvedValue({ error: null });
const itemUpdateMock = vi.fn(() => ({ eq: itemUpdateEqMock }));

const mockAudit = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const fromMock = vi.fn((table: string) => {
  if (table === "engagement_campaigns") {
    return {
      select: campaignSelectMock,
    };
  }

  if (table === "workspace_members") {
    return {
      select: membershipSelectMock,
    };
  }

  if (table === "engagement_categories") {
    return {
      select: categorySelectMock,
      insert: categoryInsertMock,
    };
  }

  if (table === "engagement_items") {
    return {
      select: itemSelectMock,
      insert: itemInsertMock,
      update: itemUpdateMock,
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

import { POST as postCategory } from "@/app/api/engagement/campaigns/[campaignId]/categories/route";
import { POST as postItem } from "@/app/api/engagement/campaigns/[campaignId]/items/route";
import { PATCH as patchItem } from "@/app/api/engagement/campaigns/[campaignId]/items/[itemId]/route";

describe("engagement category and item routes", () => {
  beforeEach(() => {
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
        project_id: null,
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

    categoryMaybeSingleMock.mockResolvedValue({
      data: {
        id: "55555555-5555-4555-8555-555555555555",
        campaign_id: "11111111-1111-4111-8111-111111111111",
        label: "Safety",
      },
      error: null,
    });

    categorySingleMock.mockResolvedValue({
      data: {
        id: "55555555-5555-4555-8555-555555555555",
        campaign_id: "11111111-1111-4111-8111-111111111111",
        label: "Safety",
        slug: "safety-123abc",
      },
      error: null,
    });

    itemSingleMock.mockResolvedValue({
      data: {
        id: "66666666-6666-4666-8666-666666666666",
        campaign_id: "11111111-1111-4111-8111-111111111111",
        category_id: "55555555-5555-4555-8555-555555555555",
        title: "Crossing issue",
      },
      error: null,
    });

    itemMaybeSingleMock.mockResolvedValue({
      data: {
        id: "66666666-6666-4666-8666-666666666666",
        campaign_id: "11111111-1111-4111-8111-111111111111",
        category_id: "55555555-5555-4555-8555-555555555555",
      },
      error: null,
    });

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    });
  });

  it("creates a category for an accessible campaign", async () => {
    const response = await postCategory(
      new NextRequest("http://localhost/api/engagement/campaigns/1/categories", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label: "Safety", description: "Crossings and speeding" }),
      }),
      {
        params: Promise.resolve({ campaignId: "11111111-1111-4111-8111-111111111111" }),
      }
    );

    expect(response.status).toBe(201);
    expect(categoryInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        campaign_id: "11111111-1111-4111-8111-111111111111",
        label: "Safety",
        created_by: "22222222-2222-4222-8222-222222222222",
      })
    );
  });

  it("POST /items rejects a category that does not belong to the campaign", async () => {
    categoryMaybeSingleMock.mockResolvedValueOnce({ data: null, error: null });

    const response = await postItem(
      new NextRequest("http://localhost/api/engagement/campaigns/1/items", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          categoryId: "99999999-9999-4999-8999-999999999999",
          body: "Drivers roll the stop line.",
        }),
      }),
      {
        params: Promise.resolve({ campaignId: "11111111-1111-4111-8111-111111111111" }),
      }
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "Engagement category not found for this campaign" });
  });

  it("PATCH /items updates moderation fields", async () => {
    const response = await patchItem(
      new NextRequest("http://localhost/api/engagement/campaigns/1/items/1", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "Reclassified crossing issue",
          body: "Drivers roll the stop line and block the school crosswalk.",
          submittedBy: "Workshop attendee",
          status: "approved",
          sourceType: "public",
          categoryId: "55555555-5555-4555-8555-555555555555",
          moderationNotes: "Reviewed against workshop notes.",
          latitude: 34.1234,
          longitude: -118.3333,
        }),
      }),
      {
        params: Promise.resolve({
          campaignId: "11111111-1111-4111-8111-111111111111",
          itemId: "66666666-6666-4666-8666-666666666666",
        }),
      }
    );

    expect(response.status).toBe(200);
    expect(itemUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Reclassified crossing issue",
        body: "Drivers roll the stop line and block the school crosswalk.",
        submitted_by: "Workshop attendee",
        status: "approved",
        source_type: "public",
        category_id: "55555555-5555-4555-8555-555555555555",
        moderation_notes: "Reviewed against workshop notes.",
        latitude: 34.1234,
        longitude: -118.3333,
      })
    );
  });
});

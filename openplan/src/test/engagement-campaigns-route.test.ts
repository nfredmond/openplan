import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const authGetUserMock = vi.fn();
const loadCurrentWorkspaceMembershipMock = vi.fn();

const campaignsOrderMock = vi.fn();
const campaignsEqStatusMock = vi.fn(() => ({ order: campaignsOrderMock }));
const campaignsEqProjectMock = vi.fn(() => ({ eq: campaignsEqStatusMock, order: campaignsOrderMock }));
const campaignsSelectMock = vi.fn(() => ({ eq: campaignsEqProjectMock, order: campaignsOrderMock }));
const campaignsSingleMock = vi.fn();
const campaignsInsertSelectMock = vi.fn(() => ({ single: campaignsSingleMock }));
const campaignsInsertMock = vi.fn(() => ({ select: campaignsInsertSelectMock }));

const itemsInMock = vi.fn();
const itemsSelectMock = vi.fn(() => ({ in: itemsInMock }));

const projectMaybeSingleMock = vi.fn();
const projectEqMock = vi.fn(() => ({ maybeSingle: projectMaybeSingleMock }));
const projectSelectMock = vi.fn(() => ({ eq: projectEqMock }));

const rtpCycleMaybeSingleMock = vi.fn();
const rtpCycleEqMock = vi.fn(() => ({ maybeSingle: rtpCycleMaybeSingleMock }));
const rtpCycleSelectMock = vi.fn(() => ({ eq: rtpCycleEqMock }));

const rtpCycleChapterMaybeSingleMock = vi.fn();
const rtpCycleChapterEqMock = vi.fn(() => ({ maybeSingle: rtpCycleChapterMaybeSingleMock }));
const rtpCycleChapterSelectMock = vi.fn(() => ({ eq: rtpCycleChapterEqMock }));

const membershipMaybeSingleMock = vi.fn();
const membershipLimitMock = vi.fn(() => ({ maybeSingle: membershipMaybeSingleMock }));
const membershipEqUserMock = vi.fn(() => ({ maybeSingle: membershipMaybeSingleMock, limit: membershipLimitMock }));
const membershipEqWorkspaceMock = vi.fn(() => ({ eq: membershipEqUserMock }));
const membershipSelectMock = vi.fn(() => ({ eq: membershipEqWorkspaceMock }));

const mockAudit = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const fromMock = vi.fn((table: string) => {
  if (table === "engagement_campaigns") {
    return {
      select: campaignsSelectMock,
      insert: campaignsInsertMock,
    };
  }

  if (table === "engagement_items") {
    return {
      select: itemsSelectMock,
    };
  }

  if (table === "projects") {
    return {
      select: projectSelectMock,
    };
  }

  if (table === "rtp_cycles") {
    return {
      select: rtpCycleSelectMock,
    };
  }

  if (table === "rtp_cycle_chapters") {
    return {
      select: rtpCycleChapterSelectMock,
    };
  }

  if (table === "workspace_members") {
    return {
      select: membershipSelectMock,
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

vi.mock("@/lib/workspaces/current", async () => {
  const actual = await vi.importActual<typeof import("@/lib/workspaces/current")>("@/lib/workspaces/current");
  return {
    ...actual,
    loadCurrentWorkspaceMembership: (...args: unknown[]) => loadCurrentWorkspaceMembershipMock(...args),
  };
});

import { GET as getCampaigns, POST as postCampaigns } from "@/app/api/engagement/campaigns/route";

function jsonRequest(payload: unknown) {
  return new NextRequest("http://localhost/api/engagement/campaigns", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

describe("/api/engagement/campaigns", () => {
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

    campaignsOrderMock.mockResolvedValue({
      data: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          project_id: "33333333-3333-4333-8333-333333333333",
          title: "Downtown listening campaign",
          status: "active",
          engagement_type: "map_feedback",
        },
      ],
      error: null,
    });

    itemsInMock.mockResolvedValue({
      data: [
        {
          campaign_id: "11111111-1111-4111-8111-111111111111",
          status: "approved",
          latitude: 34.1,
          longitude: -118.3,
        },
        {
          campaign_id: "11111111-1111-4111-8111-111111111111",
          status: "pending",
          latitude: null,
          longitude: null,
        },
      ],
      error: null,
    });

    projectMaybeSingleMock.mockResolvedValue({
      data: {
        id: "33333333-3333-4333-8333-333333333333",
        workspace_id: "44444444-4444-4444-8444-444444444444",
      },
      error: null,
    });

    rtpCycleMaybeSingleMock.mockResolvedValue({
      data: {
        id: "88888888-8888-4888-8888-888888888888",
        workspace_id: "44444444-4444-4444-8444-444444444444",
      },
      error: null,
    });

    rtpCycleChapterMaybeSingleMock.mockResolvedValue({
      data: {
        id: "99999999-9999-4999-8999-999999999999",
        workspace_id: "44444444-4444-4444-8444-444444444444",
        rtp_cycle_id: "88888888-8888-4888-8888-888888888888",
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

    loadCurrentWorkspaceMembershipMock.mockResolvedValue({
      membership: {
        workspace_id: "77777777-7777-4777-8777-777777777777",
        role: "member",
        workspaces: {
          name: "Operator workspace",
          plan: "pilot",
          created_at: "2026-04-12T18:00:00.000Z",
        },
      },
      workspace: {
        name: "Operator workspace",
        plan: "pilot",
        created_at: "2026-04-12T18:00:00.000Z",
      },
    });

    campaignsSingleMock.mockResolvedValue({
      data: {
        id: "55555555-5555-4555-8555-555555555555",
        workspace_id: "44444444-4444-4444-8444-444444444444",
        project_id: "33333333-3333-4333-8333-333333333333",
        title: "Downtown listening campaign",
        status: "draft",
        engagement_type: "comment_collection",
      },
      error: null,
    });

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    });
  });

  it("GET returns 401 when unauthenticated", async () => {
    authGetUserMock.mockResolvedValueOnce({ data: { user: null } });

    const response = await getCampaigns(new NextRequest("http://localhost/api/engagement/campaigns"));

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: "Unauthorized" });
  });

  it("GET returns campaigns with item summary counts", async () => {
    const response = await getCampaigns(new NextRequest("http://localhost/api/engagement/campaigns"));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      campaigns: [
        expect.objectContaining({
          id: "11111111-1111-4111-8111-111111111111",
          counts: expect.objectContaining({
            totalItems: 2,
            geolocatedItems: 1,
            statusCounts: expect.objectContaining({
              approved: 1,
              pending: 1,
            }),
          }),
        }),
      ],
    });
  });

  it("POST creates a campaign for an accessible project", async () => {
    const response = await postCampaigns(
      jsonRequest({
        projectId: "33333333-3333-4333-8333-333333333333",
        title: "Downtown listening campaign",
        summary: "Collect corridor feedback before concept selection.",
        engagementType: "map_feedback",
      })
    );

    expect(response.status).toBe(201);
    expect(campaignsInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace_id: "44444444-4444-4444-8444-444444444444",
        project_id: "33333333-3333-4333-8333-333333333333",
        title: "Downtown listening campaign",
        created_by: "22222222-2222-4222-8222-222222222222",
      })
    );
    expect(loadCurrentWorkspaceMembershipMock).not.toHaveBeenCalled();
  });

  it("POST creates an unlinked campaign in the helper-selected workspace", async () => {
    const response = await postCampaigns(
      jsonRequest({
        title: "Unlinked operator intake",
      })
    );

    expect(response.status).toBe(201);
    expect(loadCurrentWorkspaceMembershipMock).toHaveBeenCalledWith(expect.anything(), "22222222-2222-4222-8222-222222222222");
    expect(campaignsInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace_id: "77777777-7777-4777-8777-777777777777",
        project_id: null,
        title: "Unlinked operator intake",
      })
    );
  });

  it("POST creates a campaign for an anchored RTP cycle without consulting the helper", async () => {
    campaignsSingleMock.mockResolvedValueOnce({
      data: {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        workspace_id: "44444444-4444-4444-8444-444444444444",
        project_id: null,
        rtp_cycle_id: "88888888-8888-4888-8888-888888888888",
        rtp_cycle_chapter_id: null,
        title: "RTP outreach campaign",
        status: "draft",
        engagement_type: "comment_collection",
      },
      error: null,
    });

    const response = await postCampaigns(
      jsonRequest({
        rtpCycleId: "88888888-8888-4888-8888-888888888888",
        title: "RTP outreach campaign",
      })
    );

    expect(response.status).toBe(201);
    expect(campaignsInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace_id: "44444444-4444-4444-8444-444444444444",
        project_id: null,
        rtp_cycle_id: "88888888-8888-4888-8888-888888888888",
        rtp_cycle_chapter_id: null,
        title: "RTP outreach campaign",
      })
    );
    expect(loadCurrentWorkspaceMembershipMock).not.toHaveBeenCalled();
  });

  it("POST creates a campaign for an anchored RTP chapter without consulting the helper", async () => {
    campaignsSingleMock.mockResolvedValueOnce({
      data: {
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        workspace_id: "44444444-4444-4444-8444-444444444444",
        project_id: null,
        rtp_cycle_id: "88888888-8888-4888-8888-888888888888",
        rtp_cycle_chapter_id: "99999999-9999-4999-8999-999999999999",
        title: "Chapter outreach campaign",
        status: "draft",
        engagement_type: "comment_collection",
      },
      error: null,
    });

    const response = await postCampaigns(
      jsonRequest({
        rtpCycleId: "88888888-8888-4888-8888-888888888888",
        rtpCycleChapterId: "99999999-9999-4999-8999-999999999999",
        title: "Chapter outreach campaign",
      })
    );

    expect(response.status).toBe(201);
    expect(campaignsInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace_id: "44444444-4444-4444-8444-444444444444",
        project_id: null,
        rtp_cycle_id: "88888888-8888-4888-8888-888888888888",
        rtp_cycle_chapter_id: "99999999-9999-4999-8999-999999999999",
        title: "Chapter outreach campaign",
      })
    );
    expect(loadCurrentWorkspaceMembershipMock).not.toHaveBeenCalled();
  });

  it("POST returns 403 when helper-selected workspace role is unsupported", async () => {
    
    loadCurrentWorkspaceMembershipMock.mockResolvedValueOnce({
      membership: {
        workspace_id: "77777777-7777-4777-8777-777777777777",
        role: "viewer",
        workspaces: {
          name: "Operator workspace",
          plan: "pilot",
          created_at: "2026-04-12T18:00:00.000Z",
        },
      },
      workspace: {
        name: "Operator workspace",
        plan: "pilot",
        created_at: "2026-04-12T18:00:00.000Z",
      },
    });

    const deniedResponse = await postCampaigns(
      jsonRequest({
        title: "Unlinked operator intake",
      })
    );

    expect(deniedResponse.status).toBe(403);
    expect(await deniedResponse.json()).toMatchObject({ error: "Workspace access denied" });
  });
});

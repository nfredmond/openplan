import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PUBLIC_SHARE_TOKEN_LENGTH } from "@/lib/engagement/public-portal";

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const authGetUserMock = vi.fn();

const campaignMaybeSingleMock = vi.fn();
const campaignEqMock = vi.fn(() => ({ maybeSingle: campaignMaybeSingleMock }));
const campaignSelectMock = vi.fn(() => ({ eq: campaignEqMock }));
const campaignUpdateEqMock = vi.fn();
const campaignUpdateMock = vi.fn((..._args: unknown[]) => ({ eq: campaignUpdateEqMock }));

const membershipMaybeSingleMock = vi.fn();
const membershipEqUserMock = vi.fn(() => ({ maybeSingle: membershipMaybeSingleMock }));
const membershipEqWorkspaceMock = vi.fn(() => ({ eq: membershipEqUserMock }));
const membershipSelectMock = vi.fn(() => ({ eq: membershipEqWorkspaceMock }));

const mockAudit = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

const fromMock = vi.fn((table: string) => {
  if (table === "engagement_campaigns") {
    return { select: campaignSelectMock, update: campaignUpdateMock };
  }
  if (table === "workspace_members") {
    return { select: membershipSelectMock };
  }
  throw new Error(`Unexpected table: ${table}`);
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: (...args: unknown[]) => createApiAuditLoggerMock(...args),
}));

import { POST as regenerateShareToken } from "@/app/api/engagement/campaigns/[campaignId]/share-token/route";

const CAMPAIGN_ID = "11111111-1111-4111-8111-111111111111";
const PREVIOUS_TOKEN = "previous-token-0123456789abcdef";

function request() {
  return new NextRequest(`http://localhost/api/engagement/campaigns/${CAMPAIGN_ID}/share-token`, {
    method: "POST",
  });
}

function routeContext(campaignId: string = CAMPAIGN_ID) {
  return { params: Promise.resolve({ campaignId }) };
}

describe("/api/engagement/campaigns/[campaignId]/share-token", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    createApiAuditLoggerMock.mockReturnValue(mockAudit);
    authGetUserMock.mockResolvedValue({
      data: { user: { id: "22222222-2222-4222-8222-222222222222" } },
    });

    campaignMaybeSingleMock.mockResolvedValue({
      data: {
        id: CAMPAIGN_ID,
        workspace_id: "33333333-3333-4333-8333-333333333333",
        project_id: null,
        title: "Downtown listening campaign",
        status: "draft",
        engagement_type: "comment_collection",
        share_token: PREVIOUS_TOKEN,
        public_description: "Tell us about downtown.",
        allow_public_submissions: true,
        submissions_closed_at: null,
      },
      error: null,
    });

    membershipMaybeSingleMock.mockResolvedValue({
      data: { workspace_id: "33333333-3333-4333-8333-333333333333", role: "member" },
      error: null,
    });

    campaignUpdateEqMock.mockResolvedValue({ error: null });

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    });
  });

  it("returns 401 when unauthenticated", async () => {
    authGetUserMock.mockResolvedValueOnce({ data: { user: null } });

    const response = await regenerateShareToken(request(), routeContext());

    expect(response.status).toBe(401);
    expect(campaignUpdateMock).not.toHaveBeenCalled();
  });

  it("returns 403 when the workspace role cannot manage engagement", async () => {
    membershipMaybeSingleMock.mockResolvedValueOnce({
      data: { workspace_id: "33333333-3333-4333-8333-333333333333", role: "viewer" },
      error: null,
    });

    const response = await regenerateShareToken(request(), routeContext());

    expect(response.status).toBe(403);
    expect(campaignUpdateMock).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown campaign", async () => {
    campaignMaybeSingleMock.mockResolvedValueOnce({ data: null, error: null });

    const response = await regenerateShareToken(request(), routeContext());

    expect(response.status).toBe(404);
    expect(campaignUpdateMock).not.toHaveBeenCalled();
  });

  it("mints a server-side token that actually rotates: crypto-length, url-safe, and different from the old one", async () => {
    const response = await regenerateShareToken(request(), routeContext());

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { shareToken: string; portalPath: string };

    expect(payload.shareToken).toMatch(/^[a-z0-9]+$/);
    expect(payload.shareToken).toHaveLength(PUBLIC_SHARE_TOKEN_LENGTH);
    expect(PUBLIC_SHARE_TOKEN_LENGTH).toBeGreaterThanOrEqual(24);
    expect(payload.shareToken).not.toBe(PREVIOUS_TOKEN);
    expect(payload.portalPath).toBe(`/engage/${payload.shareToken}`);

    expect(campaignUpdateMock).toHaveBeenCalledWith({ share_token: payload.shareToken });
    expect(campaignUpdateEqMock).toHaveBeenCalledWith("id", CAMPAIGN_ID);
  });

  it("touches ONLY share_token — a draft campaign's regenerated link stays staged, never silently live", async () => {
    const response = await regenerateShareToken(request(), routeContext());

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { portal: { isPubliclyReachable: boolean; visibility: string } };

    // The campaign is draft: the response must report a NOT-reachable portal.
    expect(payload.portal.visibility).toBe("staged");
    expect(payload.portal.isPubliclyReachable).toBe(false);

    // And the write must contain no status/submission fields at all.
    expect(campaignUpdateMock).toHaveBeenCalledTimes(1);
    const updatePayload = campaignUpdateMock.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(updatePayload)).toEqual(["share_token"]);
  });

  it("retries with a fresh mint when the unique constraint reports a collision", async () => {
    campaignUpdateEqMock
      .mockResolvedValueOnce({ error: { code: "23505", message: "duplicate key" } })
      .mockResolvedValueOnce({ error: null });

    const response = await regenerateShareToken(request(), routeContext());

    expect(response.status).toBe(200);
    expect(campaignUpdateMock).toHaveBeenCalledTimes(2);
    const firstMint = (campaignUpdateMock.mock.calls[0][0] as { share_token: string }).share_token;
    const secondMint = (campaignUpdateMock.mock.calls[1][0] as { share_token: string }).share_token;
    expect(firstMint).not.toBe(secondMint);

    const payload = (await response.json()) as { shareToken: string };
    expect(payload.shareToken).toBe(secondMint);
  });

  it("fails honestly when the update errors for a non-collision reason", async () => {
    campaignUpdateEqMock.mockResolvedValueOnce({ error: { code: "XX000", message: "boom" } });

    const response = await regenerateShareToken(request(), routeContext());

    expect(response.status).toBe(500);
  });
});

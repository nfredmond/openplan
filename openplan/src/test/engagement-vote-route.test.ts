import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const createServiceRoleClientMock = vi.fn();

const campaignMaybeSingleMock = vi.fn();
const campaignEqStatusMock = vi.fn(() => ({ maybeSingle: campaignMaybeSingleMock }));
const campaignEqTokenMock = vi.fn(() => ({ eq: campaignEqStatusMock }));
const campaignSelectMock = vi.fn(() => ({ eq: campaignEqTokenMock }));

const itemLookupMaybeSingleMock = vi.fn();
const itemLookupEqStatusMock = vi.fn(() => ({ maybeSingle: itemLookupMaybeSingleMock }));
const itemLookupEqCampaignMock = vi.fn(() => ({ eq: itemLookupEqStatusMock }));
const itemLookupEqIdMock = vi.fn(() => ({ eq: itemLookupEqCampaignMock }));

const votesCountMaybeSingleMock = vi.fn();
const votesCountEqMock = vi.fn(() => ({ maybeSingle: votesCountMaybeSingleMock }));

const itemSelectMock = vi.fn((columns: string) => {
  if (columns === "votes_count") {
    return { eq: votesCountEqMock };
  }
  return { eq: itemLookupEqIdMock };
});

const recentVotesGteMock = vi.fn();
const recentVotesEqFingerprintMock = vi.fn(() => ({ gte: recentVotesGteMock }));
const recentVotesEqCampaignMock = vi.fn(() => ({ eq: recentVotesEqFingerprintMock }));
const voteSelectMock = vi.fn(() => ({ eq: recentVotesEqCampaignMock }));

const voteInsertMock = vi.fn();

const voteDeleteSelectMock = vi.fn();
const voteDeleteEqFingerprintMock = vi.fn(() => ({ select: voteDeleteSelectMock }));
const voteDeleteEqItemMock = vi.fn(() => ({ eq: voteDeleteEqFingerprintMock }));
const voteDeleteMock = vi.fn(() => ({ eq: voteDeleteEqItemMock }));

const fromMock = vi.fn((table: string) => {
  if (table === "engagement_campaigns") {
    return { select: campaignSelectMock };
  }
  if (table === "engagement_items") {
    return { select: itemSelectMock };
  }
  if (table === "engagement_item_votes") {
    return { select: voteSelectMock, insert: voteInsertMock, delete: voteDeleteMock };
  }
  throw new Error(`Unexpected table: ${table}`);
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
  createServiceRoleClient: (...args: unknown[]) => createServiceRoleClientMock(...args),
}));

import { DELETE, POST } from "@/app/api/engage/[shareToken]/items/[itemId]/vote/route";
import { PUBLIC_VOTE_MAX_PER_WINDOW } from "@/lib/engagement/votes";

const CAMPAIGN_ID = "11111111-1111-4111-8111-111111111111";
const ITEM_ID = "22222222-2222-4222-8222-222222222222";
const SHARE_TOKEN = "test-share-token-12345";

function voteRequest(method: "POST" | "DELETE" = "POST", body?: BodyInit) {
  return new NextRequest(`http://localhost/api/engage/${SHARE_TOKEN}/items/${ITEM_ID}/vote`, {
    method,
    headers: {
      "user-agent": "Vitest Vote",
      "x-forwarded-for": "203.0.113.10",
    },
    body,
  });
}

function routeContext(itemId = ITEM_ID) {
  return { params: Promise.resolve({ shareToken: SHARE_TOKEN, itemId }) };
}

describe("POST /api/engage/[shareToken]/items/[itemId]/vote", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    createServiceRoleClientMock.mockReturnValue({ from: fromMock });

    campaignMaybeSingleMock.mockResolvedValue({
      data: { id: CAMPAIGN_ID, status: "active" },
      error: null,
    });

    itemLookupMaybeSingleMock.mockResolvedValue({
      data: { id: ITEM_ID, campaign_id: CAMPAIGN_ID, status: "approved" },
      error: null,
    });

    recentVotesGteMock.mockResolvedValue({ count: 0, error: null });
    voteInsertMock.mockResolvedValue({ error: null });
    votesCountMaybeSingleMock.mockResolvedValue({ data: { votes_count: 5 }, error: null });
    voteDeleteSelectMock.mockResolvedValue({ data: [{ id: "vote-1" }], error: null });
  });

  it("records a vote on an approved item", async () => {
    const response = await POST(voteRequest(), routeContext());

    expect(response.status).toBe(201);
    const json = await response.json();
    expect(json.success).toBe(true);
    expect(json.alreadyVoted).toBe(false);
    expect(json.votesCount).toBe(5);

    expect(voteInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        item_id: ITEM_ID,
        campaign_id: CAMPAIGN_ID,
        voter_fingerprint: expect.any(String),
      })
    );
  });

  it("is idempotent: a repeated vote returns 200 with alreadyVoted", async () => {
    voteInsertMock.mockResolvedValueOnce({
      error: { code: "23505", message: "duplicate key value violates unique constraint" },
    });

    const response = await POST(voteRequest(), routeContext());

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.success).toBe(true);
    expect(json.alreadyVoted).toBe(true);
    expect(json.votesCount).toBe(5);
  });

  it("returns 404 for non-approved items without leaking their existence", async () => {
    // The lookup filters status=approved, so a pending item resolves to null.
    itemLookupMaybeSingleMock.mockResolvedValueOnce({ data: null, error: null });

    const response = await POST(voteRequest(), routeContext());

    expect(response.status).toBe(404);
    expect(voteInsertMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the campaign is not active or the token is unknown", async () => {
    campaignMaybeSingleMock.mockResolvedValueOnce({ data: null, error: null });

    const response = await POST(voteRequest(), routeContext());

    expect(response.status).toBe(404);
    expect(voteInsertMock).not.toHaveBeenCalled();
  });

  it("rate limits rapid voting from the same connection", async () => {
    recentVotesGteMock.mockResolvedValueOnce({ count: PUBLIC_VOTE_MAX_PER_WINDOW, error: null });

    const response = await POST(voteRequest(), routeContext());

    expect(response.status).toBe(429);
    expect(voteInsertMock).not.toHaveBeenCalled();
  });

  it("rejects oversized request bodies", async () => {
    const response = await POST(voteRequest("POST", "x".repeat(5 * 1024)), routeContext());

    expect(response.status).toBe(413);
    expect(campaignSelectMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid item id", async () => {
    const response = await POST(voteRequest(), routeContext("not-a-uuid"));

    expect(response.status).toBe(400);
    expect(voteInsertMock).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/engage/[shareToken]/items/[itemId]/vote", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    createServiceRoleClientMock.mockReturnValue({ from: fromMock });

    campaignMaybeSingleMock.mockResolvedValue({
      data: { id: CAMPAIGN_ID, status: "active" },
      error: null,
    });

    itemLookupMaybeSingleMock.mockResolvedValue({
      data: { id: ITEM_ID, campaign_id: CAMPAIGN_ID, status: "approved" },
      error: null,
    });

    votesCountMaybeSingleMock.mockResolvedValue({ data: { votes_count: 4 }, error: null });
    voteDeleteSelectMock.mockResolvedValue({ data: [{ id: "vote-1" }], error: null });
  });

  it("removes an existing vote", async () => {
    const response = await DELETE(voteRequest("DELETE"), routeContext());

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.success).toBe(true);
    expect(json.removed).toBe(true);
    expect(json.votesCount).toBe(4);
    expect(voteDeleteMock).toHaveBeenCalled();
  });

  it("reports removed=false when no vote existed for this fingerprint", async () => {
    voteDeleteSelectMock.mockResolvedValueOnce({ data: [], error: null });

    const response = await DELETE(voteRequest("DELETE"), routeContext());

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.removed).toBe(false);
  });
});

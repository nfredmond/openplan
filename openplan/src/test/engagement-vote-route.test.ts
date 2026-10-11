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

const parentMaybeSingleMock = vi.fn();
const parentChain = { eq: () => ({ eq: () => ({ eq: () => ({ is: () => ({ maybeSingle: parentMaybeSingleMock }) }) }) }) };
const itemSelectMock = vi.fn((columns: string) => {
  if (columns === "id") return parentChain;
  if (columns === "votes_count") {
    return { eq: votesCountEqMock };
  }
  return { eq: itemLookupEqIdMock };
});

// Recent votes: campaign, window, then either this voter (`eq`) or the whole
// connection (`or`). Both counts resolve through `recentVotesGteMock`, which
// records which scope asked.
const recentVotesGteMock = vi.fn();
const recentVotesScopeMock = vi.fn(() => ({
  eq: (column: string, value: string) => recentVotesGteMock("voter", column, value),
  or: (expression: string) => recentVotesGteMock("connection", expression),
}));
const recentVotesEqCampaignMock = vi.fn(() => ({ gte: recentVotesScopeMock }));
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
  if (table === "engagement_public_items") {
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
import { PUBLIC_VOTE_MAX_PER_CONNECTION_WINDOW, PUBLIC_VOTE_MAX_PER_WINDOW } from "@/lib/engagement/votes";
import {
  buildPublicParticipantDeviceFingerprint,
  buildPublicSubmissionClientFingerprint,
} from "@/lib/engagement/public-submit";
import { PARTICIPANT_DEVICE_HEADER } from "@/lib/engagement/participant-device";

const CAMPAIGN_ID = "11111111-1111-4111-8111-111111111111";
const ITEM_ID = "22222222-2222-4222-8222-222222222222";
const SHARE_TOKEN = "test-share-token-12345";

function voteRequest(method: "POST" | "DELETE" = "POST", body?: BodyInit, device?: string) {
  return new NextRequest(`http://localhost/api/engage/${SHARE_TOKEN}/items/${ITEM_ID}/vote`, {
    method,
    headers: {
      "user-agent": "Vitest Vote",
      "x-forwarded-for": "203.0.113.10",
      ...(device ? { [PARTICIPANT_DEVICE_HEADER]: device } : {}),
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

  describe("a meeting room on one Wi-Fi", () => {
    const DEVICE_A = "11111111-2222-4333-8444-555555555555";
    const DEVICE_B = "66666666-7777-4888-9999-aaaaaaaaaaaa";

    it("lets each device on one connection support a comment once", async () => {
      await POST(voteRequest("POST", undefined, DEVICE_A), routeContext());
      await POST(voteRequest("POST", undefined, DEVICE_B), routeContext());

      const connection = buildPublicSubmissionClientFingerprint(voteRequest());
      const voters = voteInsertMock.mock.calls.map(([row]) => (row as { voter_fingerprint: string }).voter_fingerprint);
      expect(voters).toEqual([
        `${connection}:${buildPublicParticipantDeviceFingerprint(voteRequest("POST", undefined, DEVICE_A))}`,
        `${connection}:${buildPublicParticipantDeviceFingerprint(voteRequest("POST", undefined, DEVICE_B))}`,
      ]);
      expect(new Set(voters).size).toBe(2);
    });

    it("counts the whole connection against the room limit, whichever device asks", async () => {
      recentVotesGteMock.mockImplementation(async (scope: string) =>
        scope === "connection" ? { count: PUBLIC_VOTE_MAX_PER_CONNECTION_WINDOW, error: null } : { count: 0, error: null }
      );
      const response = await POST(voteRequest("POST", undefined, DEVICE_A), routeContext());
      expect(response.status).toBe(429);
      expect(voteInsertMock).not.toHaveBeenCalled();

      const connection = buildPublicSubmissionClientFingerprint(voteRequest());
      expect(recentVotesGteMock).toHaveBeenCalledWith(
        "connection",
        `voter_fingerprint.eq.${connection},voter_fingerprint.like.${connection}:*`
      );
    });

    it("refuses a vote when either count could not be read", async () => {
      recentVotesGteMock.mockImplementation(async (scope: string) =>
        scope === "connection" ? { count: null, error: { message: "timeout" } } : { count: 0, error: null }
      );
      const response = await POST(voteRequest("POST", undefined, DEVICE_A), routeContext());
      expect(response.status).toBe(500);
      expect(voteInsertMock).not.toHaveBeenCalled();
    });

    it("removes the support of the device that gave it", async () => {
      await DELETE(voteRequest("DELETE", undefined, DEVICE_A), routeContext());
      const connection = buildPublicSubmissionClientFingerprint(voteRequest());
      expect(voteDeleteEqFingerprintMock).toHaveBeenCalledWith(
        "voter_fingerprint",
        `${connection}:${buildPublicParticipantDeviceFingerprint(voteRequest("DELETE", undefined, DEVICE_A))}`
      );
    });
  });

  it("records a vote on an approved item", async () => {
    const response = await POST(voteRequest(), routeContext());

    expect(response.status).toBe(201);
    const json = await response.json();
    expect(json.success).toBe(true);
    expect(json.alreadyVoted).toBe(false);
    expect(json.votesCount).toBe(5);

    // The fingerprint must be the shared per-client one, not any string: with a
    // constant here, the UNIQUE (item_id, voter_fingerprint) constraint caps
    // every item at one supporter total and tells everyone else "alreadyVoted".
    // expect.any(String) let exactly that mutation survive.
    expect(voteInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        item_id: ITEM_ID,
        campaign_id: CAMPAIGN_ID,
        voter_fingerprint: buildPublicSubmissionClientFingerprint(voteRequest()),
      })
    );
  });

  it("permits a reply vote while its reviewed public parent is still available", async () => {
    itemLookupMaybeSingleMock.mockResolvedValueOnce({ data: { id: ITEM_ID, parent_item_id: "parent" }, error: null });
    parentMaybeSingleMock.mockResolvedValueOnce({ data: { id: "parent" }, error: null });
    expect((await POST(voteRequest(), routeContext())).status).toBe(201);
    expect(parentMaybeSingleMock).toHaveBeenCalled();
  });

  it("refuses a reply vote when its parent was withheld after the item lookup", async () => {
    itemLookupMaybeSingleMock.mockResolvedValueOnce({ data: { id: ITEM_ID, parent_item_id: "parent" }, error: null });
    parentMaybeSingleMock.mockResolvedValueOnce({ data: null, error: null });
    expect((await POST(voteRequest(), routeContext())).status).toBe(404);
    expect(voteInsertMock).not.toHaveBeenCalled();
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

  /**
   * A COUNT THAT WAS NOT READ IS NOT A ZERO.
   *
   * The vote is already in the table when the tally is read, so this failure may
   * not fail the request — but answering `votesCount: 0` would publish a tally
   * nobody read, and would contradict the vote the same response confirms. The
   * field is left out and the omission is disclosed; the portal keeps its own
   * optimistic count when it is absent.
   */
  it("omits the support count it could not read instead of reporting zero", async () => {
    votesCountMaybeSingleMock.mockResolvedValueOnce({
      data: null,
      error: { message: "permission denied for table engagement_public_items" },
    });

    const response = await POST(voteRequest(), routeContext());

    expect(response.status).toBe(201);
    const json = await response.json();
    expect(json.success).toBe(true);
    expect(json.votesCount).toBeUndefined();
    expect(json.votesCount).not.toBe(0);
    expect(json.votesCountUnavailable).toBe(true);
  });

  it("omits the support count on the alreadyVoted replay too", async () => {
    voteInsertMock.mockResolvedValueOnce({
      error: { code: "23505", message: "duplicate key value violates unique constraint" },
    });
    votesCountMaybeSingleMock.mockResolvedValueOnce({
      data: null,
      error: { message: 'relation "public.engagement_public_items" does not exist' },
    });

    const response = await POST(voteRequest(), routeContext());

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.alreadyVoted).toBe(true);
    expect(json.votesCount).toBeUndefined();
    expect(json.votesCountUnavailable).toBe(true);
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

  it("omits the support count it could not read after a removal", async () => {
    votesCountMaybeSingleMock.mockResolvedValueOnce({
      data: null,
      error: { message: "permission denied for table engagement_public_items" },
    });

    const response = await DELETE(voteRequest("DELETE"), routeContext());

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.removed).toBe(true);
    expect(json.votesCount).toBeUndefined();
    expect(json.votesCountUnavailable).toBe(true);
  });
});

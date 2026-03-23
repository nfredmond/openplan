import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const createServiceRoleClientMock = vi.fn();

const campaignMaybeSingleMock = vi.fn();
const campaignEqStatusMock = vi.fn(() => ({ maybeSingle: campaignMaybeSingleMock }));
const campaignEqTokenMock = vi.fn(() => ({ eq: campaignEqStatusMock }));
const campaignSelectMock = vi.fn(() => ({ eq: campaignEqTokenMock }));

const categoryMaybeSingleMock = vi.fn();
const categoryEqCampaignMock = vi.fn(() => ({ maybeSingle: categoryMaybeSingleMock }));
const categoryEqIdMock = vi.fn(() => ({ eq: categoryEqCampaignMock }));
const categorySelectMock = vi.fn(() => ({ eq: categoryEqIdMock }));

const itemSingleMock = vi.fn();
const itemInsertSelectMock = vi.fn(() => ({ single: itemSingleMock }));
const itemInsertMock = vi.fn(() => ({ select: itemInsertSelectMock }));

const fromMock = vi.fn((table: string) => {
  if (table === "engagement_campaigns") {
    return { select: campaignSelectMock };
  }
  if (table === "engagement_categories") {
    return { select: categorySelectMock };
  }
  if (table === "engagement_items") {
    return { insert: itemInsertMock };
  }
  throw new Error(`Unexpected table: ${table}`);
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
  createServiceRoleClient: (...args: unknown[]) => createServiceRoleClientMock(...args),
}));

import { POST } from "@/app/api/engage/[shareToken]/submit/route";

function jsonRequest(shareToken: string, payload: unknown) {
  return new NextRequest(`http://localhost/api/engage/${shareToken}/submit`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

describe("POST /api/engage/[shareToken]/submit", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    createServiceRoleClientMock.mockReturnValue({ from: fromMock });

    campaignMaybeSingleMock.mockResolvedValue({
      data: {
        id: "11111111-1111-4111-8111-111111111111",
        status: "active",
        allow_public_submissions: true,
        submissions_closed_at: null,
      },
      error: null,
    });

    itemSingleMock.mockResolvedValue({
      data: {
        id: "22222222-2222-4222-8222-222222222222",
        created_at: "2026-03-21T12:00:00.000Z",
      },
      error: null,
    });
  });

  it("accepts a valid public submission", async () => {
    const response = await POST(
      jsonRequest("test-share-token-12345", {
        body: "I think the crosswalk near Main Street needs improvement.",
        submittedBy: "Jane Doe",
      }),
      { params: Promise.resolve({ shareToken: "test-share-token-12345" }) }
    );

    expect(response.status).toBe(201);
    const json = await response.json();
    expect(json.success).toBe(true);
    expect(json.submissionId).toBe("22222222-2222-4222-8222-222222222222");
  });

  it("rejects when campaign is not accepting submissions", async () => {
    campaignMaybeSingleMock.mockResolvedValueOnce({
      data: {
        id: "11111111-1111-4111-8111-111111111111",
        status: "active",
        allow_public_submissions: false,
        submissions_closed_at: null,
      },
      error: null,
    });

    const response = await POST(
      jsonRequest("test-share-token-12345", { body: "Some feedback" }),
      { params: Promise.resolve({ shareToken: "test-share-token-12345" }) }
    );

    expect(response.status).toBe(403);
  });

  it("silently accepts honeypot-filled submissions without inserting", async () => {
    const response = await POST(
      jsonRequest("test-share-token-12345", {
        body: "Spam message",
        website: "http://spam.example.com",
      }),
      { params: Promise.resolve({ shareToken: "test-share-token-12345" }) }
    );

    expect(response.status).toBe(201);
    // Should not have called insert
    expect(itemInsertMock).not.toHaveBeenCalled();
  });

  it("returns 404 for unknown share token", async () => {
    campaignMaybeSingleMock.mockResolvedValueOnce({
      data: null,
      error: null,
    });

    const response = await POST(
      jsonRequest("nonexistent-token-00", { body: "Test feedback" }),
      { params: Promise.resolve({ shareToken: "nonexistent-token-00" }) }
    );

    expect(response.status).toBe(404);
  });

  it("returns 400 for invalid body (empty)", async () => {
    const response = await POST(
      jsonRequest("test-share-token-12345", { body: "" }),
      { params: Promise.resolve({ shareToken: "test-share-token-12345" }) }
    );

    expect(response.status).toBe(400);
  });
});

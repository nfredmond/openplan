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

const itemRecentLimitMock = vi.fn();
const itemRecentOrderMock = vi.fn(() => ({ limit: itemRecentLimitMock }));
const itemRecentGteMock = vi.fn(() => ({ order: itemRecentOrderMock }));
const itemRecentEqSourceMock = vi.fn(() => ({ gte: itemRecentGteMock }));
const itemRecentEqCampaignMock = vi.fn(() => ({ eq: itemRecentEqSourceMock }));
const itemSelectMock = vi.fn(() => ({ eq: itemRecentEqCampaignMock }));

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
    return { select: itemSelectMock, insert: itemInsertMock };
  }
  throw new Error(`Unexpected table: ${table}`);
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
  createServiceRoleClient: (...args: unknown[]) => createServiceRoleClientMock(...args),
}));

import { POST } from "@/app/api/engage/[shareToken]/submit/route";
import {
  buildPublicSubmissionBodyFingerprint,
  buildPublicSubmissionClientFingerprint,
} from "@/lib/engagement/public-submit";

function jsonRequest(shareToken: string, payload: unknown, headers?: Record<string, string>) {
  return new NextRequest(`http://localhost/api/engage/${shareToken}/submit`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "Vitest Public Submit",
      "x-forwarded-for": "203.0.113.10",
      ...(headers ?? {}),
    },
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

    itemRecentLimitMock.mockResolvedValue({
      data: [],
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
    expect(json.reviewStatus).toBe("pending");
    expect(itemInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "pending",
        metadata_json: expect.objectContaining({
          submitted_via: "public_portal",
          source_fingerprint: expect.any(String),
          body_fingerprint: expect.any(String),
        }),
      })
    );
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

  it("rate limits repeated recent submissions from the same connection", async () => {
    const request = jsonRequest("test-share-token-12345", { body: "Another note" });
    const sourceFingerprint = buildPublicSubmissionClientFingerprint(request);

    itemRecentLimitMock.mockResolvedValueOnce({
      data: [
        {
          id: "recent-1",
          title: null,
          body: "One",
          created_at: new Date().toISOString(),
          metadata_json: { source_fingerprint: sourceFingerprint },
        },
        {
          id: "recent-2",
          title: null,
          body: "Two",
          created_at: new Date().toISOString(),
          metadata_json: { source_fingerprint: sourceFingerprint },
        },
        {
          id: "recent-3",
          title: null,
          body: "Three",
          created_at: new Date().toISOString(),
          metadata_json: { source_fingerprint: sourceFingerprint },
        },
      ],
      error: null,
    });

    const response = await POST(request, {
      params: Promise.resolve({ shareToken: "test-share-token-12345" }),
    });

    expect(response.status).toBe(429);
    expect(itemInsertMock).not.toHaveBeenCalled();
  });

  it("rejects a recent duplicate submission", async () => {
    const request = jsonRequest("test-share-token-12345", {
      title: "Main Street",
      body: "The crosswalk near Main Street needs improvement.",
    });
    const bodyFingerprint = buildPublicSubmissionBodyFingerprint({
      title: "Main Street",
      body: "The crosswalk near Main Street needs improvement.",
    });

    itemRecentLimitMock.mockResolvedValueOnce({
      data: [
        {
          id: "recent-duplicate",
          title: "Main Street",
          body: "The crosswalk near Main Street needs improvement.",
          created_at: new Date().toISOString(),
          metadata_json: { body_fingerprint: bodyFingerprint },
        },
      ],
      error: null,
    });

    const response = await POST(request, {
      params: Promise.resolve({ shareToken: "test-share-token-12345" }),
    });

    expect(response.status).toBe(409);
    expect(itemInsertMock).not.toHaveBeenCalled();
  });

  it("auto-flags link-heavy submissions for moderation", async () => {
    const response = await POST(
      jsonRequest("test-share-token-12345", {
        body: "Please read https://one.test and https://two.test and https://three.test right now.",
      }),
      { params: Promise.resolve({ shareToken: "test-share-token-12345" }) }
    );

    expect(response.status).toBe(201);
    const json = await response.json();
    expect(json.reviewStatus).toBe("flagged");
    expect(itemInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "flagged",
        moderation_notes: "Auto-flagged for unusually high link count in a public submission.",
      })
    );
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

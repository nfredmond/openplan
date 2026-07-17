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

const storageListMock = vi.fn();
const storageFromMock = vi.fn(() => ({ list: storageListMock }));

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

    createServiceRoleClientMock.mockReturnValue({
      from: fromMock,
      storage: { from: storageFromMock },
    });

    campaignMaybeSingleMock.mockResolvedValue({
      data: {
        id: "11111111-1111-4111-8111-111111111111",
        status: "active",
        allow_public_submissions: true,
        submissions_closed_at: null,
      },
      error: null,
    });

    storageListMock.mockResolvedValue({ data: [], error: null });

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

  it("rejects oversized public submissions before campaign lookup", async () => {
    const response = await POST(
      jsonRequest("test-share-token-12345", { body: "x".repeat(17 * 1024) }),
      { params: Promise.resolve({ shareToken: "test-share-token-12345" }) }
    );

    expect(response.status).toBe(413);
    expect(campaignSelectMock).not.toHaveBeenCalled();
    expect(itemInsertMock).not.toHaveBeenCalled();
  });

  it("stores a LineString geometry with its centroid as the representative lat/lng", async () => {
    const response = await POST(
      jsonRequest("test-share-token-12345", {
        body: "This whole stretch needs a protected bike lane.",
        geometry: {
          type: "LineString",
          coordinates: [
            [-121.06, 39.2],
            [-121.04, 39.24],
          ],
        },
      }),
      { params: Promise.resolve({ shareToken: "test-share-token-12345" }) }
    );

    expect(response.status).toBe(201);
    expect(itemInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        geometry: expect.objectContaining({ type: "LineString" }),
        latitude: expect.closeTo(39.22, 8),
        longitude: expect.closeTo(-121.05, 8),
      })
    );
  });

  it("stores a Polygon geometry and derives its centroid excluding the closing vertex", async () => {
    const response = await POST(
      jsonRequest("test-share-token-12345", {
        body: "This area needs traffic calming.",
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [-121.08, 39.2],
              [-121.04, 39.2],
              [-121.04, 39.24],
              [-121.08, 39.24],
              [-121.08, 39.2],
            ],
          ],
        },
      }),
      { params: Promise.resolve({ shareToken: "test-share-token-12345" }) }
    );

    expect(response.status).toBe(201);
    expect(itemInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        geometry: expect.objectContaining({ type: "Polygon" }),
        latitude: expect.closeTo(39.22, 8),
        longitude: expect.closeTo(-121.06, 8),
      })
    );
  });

  it("rejects an invalid geometry (unclosed polygon ring) with 400", async () => {
    const response = await POST(
      jsonRequest("test-share-token-12345", {
        body: "Broken polygon",
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [-121.08, 39.2],
              [-121.04, 39.2],
              [-121.04, 39.24],
              [-121.08, 39.24],
            ],
          ],
        },
      }),
      { params: Promise.resolve({ shareToken: "test-share-token-12345" }) }
    );

    expect(response.status).toBe(400);
    expect(itemInsertMock).not.toHaveBeenCalled();
  });

  it("rejects a geometry above the vertex cap with 400", async () => {
    const response = await POST(
      jsonRequest("test-share-token-12345", {
        body: "Too many vertices",
        geometry: {
          type: "LineString",
          coordinates: Array.from({ length: 201 }, (_, index) => [-121.06 + index * 0.0001, 39.22]),
        },
      }),
      { params: Promise.resolve({ shareToken: "test-share-token-12345" }) }
    );

    expect(response.status).toBe(400);
    expect(itemInsertMock).not.toHaveBeenCalled();
  });

  it("synthesizes a Point geometry from a legacy lat/lng-only payload", async () => {
    const response = await POST(
      jsonRequest("test-share-token-12345", {
        body: "Legacy pin submission",
        latitude: 39.2178,
        longitude: -121.0614,
      }),
      { params: Promise.resolve({ shareToken: "test-share-token-12345" }) }
    );

    expect(response.status).toBe(201);
    expect(itemInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        geometry: { type: "Point", coordinates: [-121.0614, 39.2178] },
        latitude: 39.2178,
        longitude: -121.0614,
      })
    );
  });

  it("rejects a photo path outside this campaign's prefix", async () => {
    const response = await POST(
      jsonRequest("test-share-token-12345", {
        body: "Photo path smuggling attempt",
        photoPath: "99999999-9999-4999-8999-999999999999/33333333-3333-4333-8333-333333333333.jpg",
      }),
      { params: Promise.resolve({ shareToken: "test-share-token-12345" }) }
    );

    expect(response.status).toBe(400);
    expect(itemInsertMock).not.toHaveBeenCalled();
    // Path validation fails before any storage lookup happens.
    expect(storageListMock).not.toHaveBeenCalled();
  });

  it("rejects malformed photo paths (traversal shapes)", async () => {
    const response = await POST(
      jsonRequest("test-share-token-12345", {
        body: "Traversal attempt",
        photoPath: "../report-artifacts/secret.pdf",
      }),
      { params: Promise.resolve({ shareToken: "test-share-token-12345" }) }
    );

    expect(response.status).toBe(400);
    expect(itemInsertMock).not.toHaveBeenCalled();
  });

  it("rejects a well-formed photo path whose object does not exist", async () => {
    storageListMock.mockResolvedValueOnce({ data: [], error: null });

    const response = await POST(
      jsonRequest("test-share-token-12345", {
        body: "Phantom photo reference",
        photoPath: "11111111-1111-4111-8111-111111111111/33333333-3333-4333-8333-333333333333.jpg",
      }),
      { params: Promise.resolve({ shareToken: "test-share-token-12345" }) }
    );

    expect(response.status).toBe(400);
    expect(itemInsertMock).not.toHaveBeenCalled();
  });

  it("rejects a stale photo upload reference", async () => {
    storageListMock.mockResolvedValueOnce({
      data: [
        {
          name: "33333333-3333-4333-8333-333333333333.jpg",
          created_at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
        },
      ],
      error: null,
    });

    const response = await POST(
      jsonRequest("test-share-token-12345", {
        body: "Stale photo reference",
        photoPath: "11111111-1111-4111-8111-111111111111/33333333-3333-4333-8333-333333333333.jpg",
      }),
      { params: Promise.resolve({ shareToken: "test-share-token-12345" }) }
    );

    expect(response.status).toBe(400);
    expect(itemInsertMock).not.toHaveBeenCalled();
  });

  it("stores a valid, recently uploaded photo path on the item", async () => {
    storageListMock.mockResolvedValueOnce({
      data: [
        {
          name: "33333333-3333-4333-8333-333333333333.jpg",
          created_at: new Date().toISOString(),
        },
      ],
      error: null,
    });

    const response = await POST(
      jsonRequest("test-share-token-12345", {
        body: "Pothole photo attached.",
        photoPath: "11111111-1111-4111-8111-111111111111/33333333-3333-4333-8333-333333333333.jpg",
      }),
      { params: Promise.resolve({ shareToken: "test-share-token-12345" }) }
    );

    expect(response.status).toBe(201);
    expect(storageListMock).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
      expect.objectContaining({ search: "33333333-3333-4333-8333-333333333333.jpg" })
    );
    expect(itemInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        photo_path: "11111111-1111-4111-8111-111111111111/33333333-3333-4333-8333-333333333333.jpg",
      })
    );
  });
});

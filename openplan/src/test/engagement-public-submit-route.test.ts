import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const createServiceRoleClientMock = vi.fn();

const campaignMaybeSingleMock = vi.fn();
const campaignEqStatusMock = vi.fn(() => ({ maybeSingle: campaignMaybeSingleMock }));
const campaignEqTokenMock = vi.fn(() => ({ eq: campaignEqStatusMock }));

/**
 * The route reads the campaign a SECOND time when a submission carries a
 * coordinate: the opt-in location check and this campaign's extent
 * (20260730000002), keyed by id, so a column that does not exist yet can never
 * break the gate query above. Answered here as "not opted in", which is every
 * campaign that existed before that migration — the geofenced cases live in
 * a-pin-outside-the-consultation-area-is-refused.test.ts.
 */
const campaignGeofenceMaybeSingleMock = vi.fn(async () => ({
  data: { submission_geofence_enabled: false },
  error: null,
}));
const campaignSelectMock = vi.fn((columns?: string) =>
  typeof columns === "string" &&
  (columns.includes("submission_geofence_enabled") || columns.trim() === "place_geometry_geojson")
    ? { eq: () => ({ maybeSingle: campaignGeofenceMaybeSingleMock }) }
    : { eq: campaignEqTokenMock }
);

const categoryMaybeSingleMock = vi.fn();
const categoryEqCampaignMock = vi.fn(() => ({ maybeSingle: categoryMaybeSingleMock }));
const categoryEqIdMock = vi.fn(() => ({ eq: categoryEqCampaignMock }));
const categorySelectMock = vi.fn(() => ({ eq: categoryEqIdMock }));

const itemRecentLimitMock = vi.fn();
const itemRecentOrderMock = vi.fn(() => ({ limit: itemRecentLimitMock }));
const itemRecentGteMock = vi.fn(() => ({ order: itemRecentOrderMock }));
const itemRecentEqSourceMock = vi.fn(() => ({ gte: itemRecentGteMock }));
const itemRecentEqCampaignMock = vi.fn(() => ({ eq: itemRecentEqSourceMock }));

// E6 — the reply parent-validation query selects "id, parent_item_id" and chains
// .eq(id).eq(campaign).eq(status).maybeSingle(). Route on the selected columns so
// it never collides with the recent-items query on the same table.
const parentMaybeSingleMock = vi.fn();
const parentChain = { eq: () => ({ eq: () => ({ eq: () => ({ maybeSingle: parentMaybeSingleMock }) }) }) };
const itemSelectMock = vi.fn((columns?: string) =>
  typeof columns === "string" && columns.includes("parent_item_id")
    ? parentChain
    : { eq: itemRecentEqCampaignMock }
);

const itemSingleMock = vi.fn();
const itemInsertSelectMock = vi.fn(() => ({ single: itemSingleMock }));
const itemInsertMock = vi.fn(() => ({ select: itemInsertSelectMock }));

const storageListMock = vi.fn();
const storageFromMock = vi.fn(() => ({ list: storageListMock }));

const demographicsInsertMock = vi.fn();

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
  if (table === "engagement_item_demographics") {
    return { insert: demographicsInsertMock };
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

    demographicsInsertMock.mockResolvedValue({ error: null });
  });

  const demographicsCampaign = {
    id: "11111111-1111-4111-8111-111111111111",
    status: "active",
    allow_public_submissions: true,
    submissions_closed_at: null,
    demographics_enabled: true,
  };

  it("stores optional demographics (ZIP coarsened to ZIP-3) when the campaign opted in", async () => {
    campaignMaybeSingleMock.mockResolvedValueOnce({ data: demographicsCampaign, error: null });

    const response = await POST(
      jsonRequest("test-share-token-12345", {
        body: "The bus stop needs a shelter.",
        demographics: {
          ageBand: "25_34",
          zip5: "95945",
          primaryLanguage: "es",
          raceEthnicity: ["hispanic"],
          householdTenure: "rent",
          consented: true,
        },
      }),
      { params: Promise.resolve({ shareToken: "test-share-token-12345" }) }
    );

    expect(response.status).toBe(201);
    expect(demographicsInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        item_id: "22222222-2222-4222-8222-222222222222",
        campaign_id: "11111111-1111-4111-8111-111111111111",
        age_band: "25_34",
        zip3: "959",
        primary_language: "es",
        race_ethnicity: ["hispanic"],
        household_tenure: "rent",
        consented: true,
      })
    );
  });

  it("ignores demographics when the campaign has not opted in", async () => {
    // default campaign mock has no demographics_enabled → treated as false
    const response = await POST(
      jsonRequest("test-share-token-12345", {
        body: "A comment with demographics that should be dropped.",
        demographics: { ageBand: "25_34", zip5: "95945" },
      }),
      { params: Promise.resolve({ shareToken: "test-share-token-12345" }) }
    );

    expect(response.status).toBe(201);
    expect(demographicsInsertMock).not.toHaveBeenCalled();
  });

  it("saves the comment even when the optional demographics are malformed (non-fatal)", async () => {
    campaignMaybeSingleMock.mockResolvedValueOnce({ data: demographicsCampaign, error: null });

    const response = await POST(
      jsonRequest("test-share-token-12345", {
        body: "Comment with a bad demographics payload.",
        demographics: { ageBand: "not_a_real_band", zip5: "abc" },
      }),
      { params: Promise.resolve({ shareToken: "test-share-token-12345" }) }
    );

    expect(response.status).toBe(201); // comment still accepted
    expect(itemInsertMock).toHaveBeenCalled();
    expect(demographicsInsertMock).not.toHaveBeenCalled(); // invalid → skipped
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

  it("retains honeypot-filled submissions as flagged instead of reporting false success", async () => {
    const response = await POST(
      jsonRequest("test-share-token-12345", {
        body: "Spam message",
        website: "http://spam.example.com",
      }),
      { params: Promise.resolve({ shareToken: "test-share-token-12345" }) }
    );

    expect(response.status).toBe(201);
    const json = await response.json();
    expect(json.submissionId).toBe("22222222-2222-4222-8222-222222222222");
    expect(json.reviewStatus).toBe("flagged");
    expect(itemInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        body: "Spam message",
        status: "flagged",
        moderation_notes: "Auto-flagged because the hidden website field was completed.",
      })
    );
    expect(itemInsertMock.mock.calls[0]?.[0]).not.toHaveProperty("website");
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

  it("fingerprints discriminate: different IPs and different bodies hash differently", () => {
    // The rate-limit and duplicate tests build their fixtures FROM these
    // production functions, so a degenerate hash (constant output) leaves them
    // green while, in production, any one resident's comment would rate-limit
    // and 409 every other resident. This assertion is what kills that mutation.
    const requestA = jsonRequest("test-share-token-12345", { body: "a" });
    const requestB = jsonRequest("test-share-token-12345", { body: "a" }, { "x-forwarded-for": "198.51.100.7" });
    expect(buildPublicSubmissionClientFingerprint(requestA)).not.toBe(
      buildPublicSubmissionClientFingerprint(requestB)
    );

    expect(buildPublicSubmissionBodyFingerprint({ title: null, body: "The crosswalk needs work." })).not.toBe(
      buildPublicSubmissionBodyFingerprint({ title: null, body: "The bus stop needs a shelter." })
    );
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

  /**
   * "INVALID CATEGORY" IS A CLAIM ABOUT WHAT THE RESIDENT SENT.
   *
   * The route used to bind only `{ data: category }`, so a category lookup that
   * FAILED was indistinguishable from one that found nothing, and a resident
   * choosing a perfectly real category was told their submission was malformed —
   * over a fault entirely on this side. Only a successful read that found no row
   * may say that.
   */
  const CATEGORY_ID = "66666666-6666-4666-8666-666666666666";

  it("does not call a resident's category invalid when the category read FAILED", async () => {
    categoryMaybeSingleMock.mockResolvedValueOnce({
      data: null,
      error: { message: "permission denied for table engagement_categories" },
    });

    const response = await POST(
      jsonRequest("test-share-token-12345", {
        body: "The lighting on this path is poor.",
        categoryId: CATEGORY_ID,
      }),
      { params: Promise.resolve({ shareToken: "test-share-token-12345" }) }
    );

    const json = await response.json();
    expect(json.error).not.toMatch(/invalid category/i);
    expect(json.error).toMatch(/could not|couldn't|failed/i);
    expect(response.status).toBe(500);
    expect(itemInsertMock).not.toHaveBeenCalled();
  });

  it("answers 503 when the category read failed because the schema is not applied yet", async () => {
    categoryMaybeSingleMock.mockResolvedValueOnce({
      data: null,
      error: { message: 'relation "public.engagement_categories" does not exist' },
    });

    const response = await POST(
      jsonRequest("test-share-token-12345", {
        body: "A comment filed under a category.",
        categoryId: CATEGORY_ID,
      }),
      { params: Promise.resolve({ shareToken: "test-share-token-12345" }) }
    );

    expect(response.status).toBe(503);
    const json = await response.json();
    expect(json.error).not.toMatch(/invalid category/i);
    expect(itemInsertMock).not.toHaveBeenCalled();
  });

  it("still answers 400 when the category read SUCCEEDED and found no such category", async () => {
    categoryMaybeSingleMock.mockResolvedValueOnce({ data: null, error: null });

    const response = await POST(
      jsonRequest("test-share-token-12345", {
        body: "Filed under a category that is not this campaign's.",
        categoryId: CATEGORY_ID,
      }),
      { params: Promise.resolve({ shareToken: "test-share-token-12345" }) }
    );

    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error).toBe("Invalid category for this campaign");
    expect(itemInsertMock).not.toHaveBeenCalled();
  });

  it("accepts a submission whose category read found the category", async () => {
    categoryMaybeSingleMock.mockResolvedValueOnce({ data: { id: CATEGORY_ID }, error: null });

    const response = await POST(
      jsonRequest("test-share-token-12345", {
        body: "Filed under a real category.",
        categoryId: CATEGORY_ID,
      }),
      { params: Promise.resolve({ shareToken: "test-share-token-12345" }) }
    );

    expect(response.status).toBe(201);
    expect(itemInsertMock).toHaveBeenCalledWith(expect.objectContaining({ category_id: CATEGORY_ID }));
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

  // ── E6 threaded replies ───────────────────────────────────────────────────
  const PARENT_ID = "44444444-4444-4444-8444-444444444444";

  it("accepts a reply to an approved top-level comment and stores parent_item_id", async () => {
    parentMaybeSingleMock.mockResolvedValueOnce({ data: { id: PARENT_ID, parent_item_id: null }, error: null });

    const response = await POST(
      jsonRequest("test-share-token-12345", { body: "I agree — and the signal timing is bad too.", parentItemId: PARENT_ID }),
      { params: Promise.resolve({ shareToken: "test-share-token-12345" }) }
    );

    expect(response.status).toBe(201);
    expect(itemInsertMock).toHaveBeenCalledWith(expect.objectContaining({ parent_item_id: PARENT_ID, status: "pending" }));
  });

  it("stores parent_item_id null for an ordinary top-level submission", async () => {
    const response = await POST(
      jsonRequest("test-share-token-12345", { body: "A standalone top-level comment." }),
      { params: Promise.resolve({ shareToken: "test-share-token-12345" }) }
    );

    expect(response.status).toBe(201);
    expect(parentMaybeSingleMock).not.toHaveBeenCalled(); // no parent lookup without parentItemId
    expect(itemInsertMock).toHaveBeenCalledWith(expect.objectContaining({ parent_item_id: null }));
  });

  it("rejects a reply to an unknown or non-approved parent (400, no insert)", async () => {
    parentMaybeSingleMock.mockResolvedValueOnce({ data: null, error: null }); // filtered by status='approved'

    const response = await POST(
      jsonRequest("test-share-token-12345", { body: "Reply to a pending/hidden comment.", parentItemId: PARENT_ID }),
      { params: Promise.resolve({ shareToken: "test-share-token-12345" }) }
    );

    expect(response.status).toBe(400);
    expect(itemInsertMock).not.toHaveBeenCalled();
  });

  it("rejects a reply to a reply — one level of nesting only (400, no insert)", async () => {
    parentMaybeSingleMock.mockResolvedValueOnce({
      data: { id: PARENT_ID, parent_item_id: "55555555-5555-4555-8555-555555555555" },
      error: null,
    });

    const response = await POST(
      jsonRequest("test-share-token-12345", { body: "Nested reply attempt.", parentItemId: PARENT_ID }),
      { params: Promise.resolve({ shareToken: "test-share-token-12345" }) }
    );

    expect(response.status).toBe(400);
    expect(itemInsertMock).not.toHaveBeenCalled();
  });
});

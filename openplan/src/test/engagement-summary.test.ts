import { describe, expect, it } from "vitest";
import { summarizeEngagementItems } from "@/lib/engagement/summary";

describe("summarizeEngagementItems", () => {
  it("computes source, moderation, geography, and recent activity analytics", () => {
    const summary = summarizeEngagementItems(
      [
        {
          id: "55555555-5555-4555-8555-555555555555",
          label: "Safety",
          description: "Crossings and speed management",
        },
      ],
      [
        {
          id: "66666666-6666-4666-8666-666666666666",
          campaign_id: "11111111-1111-4111-8111-111111111111",
          category_id: "55555555-5555-4555-8555-555555555555",
          status: "approved",
          source_type: "public",
          latitude: 34.12,
          longitude: -118.33,
          moderation_notes: "Reviewed against workshop notes.",
          updated_at: "2026-03-14T18:00:00.000Z",
        },
        {
          id: "77777777-7777-4777-8777-777777777777",
          campaign_id: "11111111-1111-4111-8111-111111111111",
          category_id: null,
          status: "flagged",
          source_type: "email",
          latitude: null,
          longitude: null,
          moderation_notes: null,
          updated_at: "2026-03-12T18:00:00.000Z",
        },
        {
          id: "88888888-8888-4888-8888-888888888888",
          campaign_id: "11111111-1111-4111-8111-111111111111",
          category_id: null,
          status: "pending",
          source_type: "meeting",
          latitude: null,
          longitude: null,
          moderation_notes: "Needs category assignment.",
          updated_at: "2026-02-20T18:00:00.000Z",
        },
      ],
      { now: new Date("2026-03-15T12:00:00.000Z") }
    );

    expect(summary).toMatchObject({
      totalItems: 3,
      geolocatedItems: 1,
      nonGeolocatedItems: 2,
      uncategorizedItems: 2,
      itemsWithModerationNotes: 2,
      moderationQueue: {
        actionableCount: 2,
        pendingCount: 1,
        flaggedCount: 1,
        readyForHandoffCount: 1,
      },
      geographyCoverage: {
        geolocatedShare: 1 / 3,
      },
      exportCoverage: {
        mapReadyItems: 1,
        handoffReadyWithoutLocation: 0,
        mapReadyShare: 1,
      },
      recentActivity: {
        count: 2,
        byStatus: expect.objectContaining({
          approved: 1,
          flagged: 1,
          pending: 0,
        }),
        bySource: expect.objectContaining({
          public: 1,
          email: 1,
          meeting: 0,
        }),
      },
    });

    expect(summary.sourceSummaries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceType: "public",
          count: 1,
          geolocatedCount: 1,
          approvedCount: 1,
        }),
        expect.objectContaining({
          sourceType: "email",
          count: 1,
          nonGeolocatedCount: 1,
          flaggedCount: 1,
        }),
        expect.objectContaining({
          sourceType: "meeting",
          count: 1,
          pendingCount: 1,
        }),
      ])
    );
  });

  it("separates appendix-ready public comments from private notes and duplicate-review holds", () => {
    const summary = summarizeEngagementItems(
      [
        {
          id: "55555555-5555-4555-8555-555555555555",
          label: "Safety",
          description: "Crossings and speed management",
        },
      ],
      [
        {
          id: "11111111-1111-4111-8111-111111111111",
          campaign_id: "99999999-9999-4999-8999-999999999999",
          category_id: "55555555-5555-4555-8555-555555555555",
          title: "Crossing concern",
          body: "Add a crossing near the school.",
          status: "approved",
          source_type: "public",
          metadata_json: { body_fingerprint: "duplicate-crossing", submitted_via: "public_portal" },
          moderation_notes: "Duplicate reviewed - canonical public comment.",
        },
        {
          id: "22222222-2222-4222-8222-222222222222",
          campaign_id: "99999999-9999-4999-8999-999999999999",
          category_id: "55555555-5555-4555-8555-555555555555",
          title: "Crossing concern",
          body: "Add a crossing near the school.",
          status: "approved",
          source_type: "public",
          metadata_json: { body_fingerprint: "duplicate-crossing", submitted_via: "public_portal" },
          moderation_notes: null,
        },
        {
          id: "33333333-3333-4333-8333-333333333333",
          campaign_id: "99999999-9999-4999-8999-999999999999",
          category_id: "55555555-5555-4555-8555-555555555555",
          title: "Lighting",
          body: "Lighting would help people walking after work.",
          status: "approved",
          source_type: "public_comment",
          metadata_json: { body_fingerprint: "lighting" },
        },
        {
          id: "44444444-4444-4444-8444-444444444444",
          campaign_id: "99999999-9999-4999-8999-999999999999",
          category_id: "55555555-5555-4555-8555-555555555555",
          title: "Staff note",
          body: "Use staff note for internal response assignment only.",
          status: "approved",
          source_type: "internal",
          metadata_json: {},
        },
      ]
    );

    expect(summary.moderationQueue.readyForHandoffCount).toBe(4);
    expect(summary.appendixReadiness).toMatchObject({
      appendixReadyCount: 2,
      publicApprovedCategorizedCount: 3,
      nonPublicApprovedCategorizedCount: 1,
      duplicateReviewCount: 1,
      duplicateGroupCount: 1,
      duplicateExcludedCount: 1,
      publicShareOfReadyItems: 3 / 4,
    });
  });
});

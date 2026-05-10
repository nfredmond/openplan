import { describe, expect, it } from "vitest";
import { buildEngagementCommentMatrixPreview } from "@/lib/engagement/comment-matrix";

describe("buildEngagementCommentMatrixPreview", () => {
  it("separates included comments, duplicate holds, and internal/private exclusions", () => {
    const preview = buildEngagementCommentMatrixPreview(
      [{ id: "category-1", label: "Safety" }],
      [
        {
          id: "included-1",
          category_id: "category-1",
          title: "Lighting",
          body: "Add lighting near the trail access.",
          submitted_by: "Resident A",
          status: "approved",
          source_type: "public_comment",
          metadata_json: { body_fingerprint: "lighting" },
          moderation_notes: null,
          updated_at: "2026-05-02T12:00:00.000Z",
        },
        {
          id: "canonical-duplicate",
          category_id: "category-1",
          title: "Crossing",
          body: "Add a safer crossing near the school.",
          submitted_by: "Resident B",
          status: "approved",
          source_type: "public",
          metadata_json: { body_fingerprint: "crossing" },
          moderation_notes: "Duplicate reviewed - canonical public comment.",
          updated_at: "2026-05-03T12:00:00.000Z",
        },
        {
          id: "held-duplicate",
          category_id: "category-1",
          title: "Crossing",
          body: "Add a safer crossing near the school.",
          submitted_by: "Resident C",
          status: "approved",
          source_type: "public",
          metadata_json: { body_fingerprint: "crossing" },
          moderation_notes: null,
          updated_at: "2026-05-04T12:00:00.000Z",
        },
        {
          id: "internal-note",
          category_id: "category-1",
          title: "Staff note",
          body: "Use this only for response assignment.",
          submitted_by: "Planner",
          status: "approved",
          source_type: "internal",
          metadata_json: { visibility: "private" },
          moderation_notes: null,
          updated_at: "2026-05-05T12:00:00.000Z",
        },
        {
          id: "pending-public",
          category_id: "category-1",
          title: "Pending comment",
          body: "Needs moderation first.",
          submitted_by: "Resident D",
          status: "pending",
          source_type: "public",
          metadata_json: {},
          moderation_notes: null,
          updated_at: "2026-05-06T12:00:00.000Z",
        },
      ]
    );

    expect(preview.counts).toMatchObject({
      includedCount: 2,
      heldDuplicateReviewCount: 1,
      excludedInternalPrivateCount: 1,
      excludedNotReadyCount: 1,
      totalItemCount: 5,
    });
    expect(preview.caveat).toMatch(/staff cue only/i);
    expect(preview.rows.map((row) => [row.itemId, row.posture])).toEqual([
      ["canonical-duplicate", "included"],
      ["included-1", "included"],
      ["held-duplicate", "held_duplicate_review"],
      ["internal-note", "excluded_internal_private"],
      ["pending-public", "excluded_not_ready"],
    ]);
    expect(preview.rows.find((row) => row.itemId === "internal-note")?.reason).toMatch(/excluded from the public-comment appendix matrix/i);
  });

  it("honors row limits without changing posture counts", () => {
    const preview = buildEngagementCommentMatrixPreview(
      [{ id: "category-1", label: "Safety" }],
      [
        { id: "one", category_id: "category-1", title: "One", body: "One", status: "approved", source_type: "public" },
        { id: "two", category_id: "category-1", title: "Two", body: "Two", status: "approved", source_type: "public" },
      ],
      { rowLimit: 1 }
    );

    expect(preview.counts).toMatchObject({
      includedCount: 2,
      previewedRowCount: 1,
      totalItemCount: 2,
    });
    expect(preview.rows).toHaveLength(1);
  });
});

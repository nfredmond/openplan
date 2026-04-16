import { describe, expect, it } from "vitest";
import { buildRtpPublicReviewSummary } from "@/lib/rtp/catalog";

describe("buildRtpPublicReviewSummary", () => {
  it("flags missing review foundation pieces", () => {
    const summary = buildRtpPublicReviewSummary({
      status: "draft",
      publicReviewOpenAt: null,
      publicReviewCloseAt: null,
      cycleLevelCampaignCount: 0,
      chapterCampaignCount: 0,
      packetRecordCount: 0,
      generatedPacketCount: 0,
      pendingCommentCount: 0,
      approvedCommentCount: 0,
      readyCommentCount: 0,
    });

    expect(summary.label).toBe("Needs review foundation");
    expect(summary.actionItems).toContain("Set a public review open and close window before calling the cycle review-ready.");
    expect(summary.actionItems).toContain("Create and generate a current RTP packet before board or public review begins.");
  });

  it("marks public review as active when moderation is still open", () => {
    const summary = buildRtpPublicReviewSummary({
      status: "public_review",
      publicReviewOpenAt: "2026-04-20T17:00:00.000Z",
      publicReviewCloseAt: "2026-05-20T17:00:00.000Z",
      cycleLevelCampaignCount: 1,
      chapterCampaignCount: 2,
      packetRecordCount: 1,
      generatedPacketCount: 1,
      pendingCommentCount: 3,
      approvedCommentCount: 4,
      readyCommentCount: 4,
    });

    expect(summary.label).toBe("Public review active");
    expect(summary.tone).toBe("warning");
    expect(summary.detail).toMatch(/3 comments? .*waiting for operator review/i);
  });

  it("recognizes comment-response readiness when packet and approved input are in place", () => {
    const summary = buildRtpPublicReviewSummary({
      status: "public_review",
      publicReviewOpenAt: "2026-04-20T17:00:00.000Z",
      publicReviewCloseAt: "2026-05-20T17:00:00.000Z",
      cycleLevelCampaignCount: 1,
      chapterCampaignCount: 0,
      packetRecordCount: 2,
      generatedPacketCount: 1,
      pendingCommentCount: 0,
      approvedCommentCount: 5,
      readyCommentCount: 5,
    });

    expect(summary.label).toBe("Comment-response foundation ready");
    expect(summary.tone).toBe("success");
    expect(summary.actionItems).toContain("Carry approved comments into the board-ready response summary.");
  });
});

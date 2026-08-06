import { describe, expect, it } from "vitest";
import { buildRtpPublicReviewSummary, buildRtpReleaseReviewSummary } from "@/lib/rtp/catalog";
import { PACKET_FRESHNESS_LABELS } from "@/lib/reports/packet-labels";

describe("buildRtpReleaseReviewSummary", () => {
  it("keeps release review open when moderation is still in progress", () => {
    const summary = buildRtpReleaseReviewSummary({
      packetFreshnessLabel: "Packet current",
      publicReviewSummary: {
        label: "Public review active",
        detail: "1 comment is still waiting for operator review while 2 approved items are already ready for packet handoff.",
        tone: "warning",
        actionItems: ["Resolve pending comments before closeout."],
      },
    });

    expect(summary.label).toBe("Review loop still open");
    expect(summary.tone).toBe("warning");
    expect(summary.nextActionLabel).toBe("Close pending comment review");
    expect(summary.state).toBe("review-loop-open");
  });

  /**
   * THE LABEL IS COPY; THE STATE IS THE CONTRACT.
   *
   * Eight call sites used to branch on this summary's `label` — the dashboard's
   * review-loop count and next command, the reports queue's membership and its
   * per-row action label, and the assistant's offered RTP workflow. Rewording a
   * label a planner reads would have changed all of them at once, silently.
   *
   * Every branch is asserted here so the state and the wording are visibly
   * separate things, and so a new branch that forgets to say which state it is
   * cannot compile.
   */
  it("gives every release-review branch a state that does not depend on its wording", () => {
    const branchOf = (publicReviewLabel: string | null, freshness: string = PACKET_FRESHNESS_LABELS.CURRENT) =>
      buildRtpReleaseReviewSummary({
        packetFreshnessLabel: freshness,
        publicReviewSummary: publicReviewLabel
          ? { label: publicReviewLabel, detail: "Detail.", tone: "neutral", actionItems: [] }
          : null,
      });

    expect(branchOf("Comment-response foundation ready").state).toBe("ready");
    expect(branchOf("Public review active").state).toBe("review-loop-open");
    expect(branchOf("Public review foundation ready").state).toBe("comment-basis-forming");
    // A label this module does not classify is passed through as wording, and
    // is NOT reported as a cleared release review.
    expect(branchOf("Needs review foundation").state).toBe("public-review-unclassified");
    // Even a stored public-review record carrying the exact words the packet's
    // own ready state uses must not promote the packet to ready.
    expect(branchOf("Release review ready").state).toBe("public-review-unclassified");

    // Packet-side branches, keyed off the work status rather than its label.
    expect(branchOf(null).state).toBe("ready");
    expect(branchOf("Public review active", PACKET_FRESHNESS_LABELS.NO_PACKET).state).toBe("packet-not-generated");
    expect(branchOf("Public review active", PACKET_FRESHNESS_LABELS.REFRESH_RECOMMENDED).state).toBe("packet-stale");
  });

  it("treats current packets plus approved comments as release-review ready", () => {
    const summary = buildRtpReleaseReviewSummary({
      packetFreshnessLabel: "Packet current",
      publicReviewSummary: {
        label: "Comment-response foundation ready",
        detail: "5 approved comments are ready for packet handoff and the current RTP packet is in place for review closure.",
        tone: "success",
        actionItems: ["Carry approved comments into the board-ready response summary."],
      },
    });

    expect(summary.label).toBe("Release review ready");
    expect(summary.tone).toBe("success");
    expect(summary.detail).toMatch(/5 approved comments are ready for packet handoff/i);
  });
});

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

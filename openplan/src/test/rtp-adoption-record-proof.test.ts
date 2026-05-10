import { describe, expect, it } from "vitest";
import { buildRtpAdoptionRecordProofSummary } from "@/lib/rtp/catalog";

describe("buildRtpAdoptionRecordProofSummary", () => {
  it("marks the adoption record assembled only when the supervised proof checks are present", () => {
    const summary = buildRtpAdoptionRecordProofSummary({
      status: "public_review",
      adoptionTargetDate: "2026-06-01T00:00:00.000Z",
      publicReviewOpenAt: "2026-04-20T00:00:00.000Z",
      publicReviewCloseAt: "2026-05-20T00:00:00.000Z",
      requiredChapterCount: 7,
      requiredChaptersReadyForReviewCount: 2,
      requiredChaptersCompleteCount: 5,
      packetRecordCount: 1,
      generatedPacketCount: 1,
    });

    expect(summary.ready).toBe(true);
    expect(summary.label).toBe("Record assembly ready");
    expect(summary.tone).toBe("success");
    expect(summary.readyCheckCount).toBe(4);
    expect(summary.detail).toContain("Operator review is still required");
    expect(summary.detail).not.toMatch(/certif|compliance finding/i);
    expect(summary.checks.map((check) => check.key)).toEqual([
      "adoption_target",
      "public_review_window",
      "required_chapters",
      "board_packet_artifact",
    ]);
  });

  it("keeps incomplete records in supervised proofing language without certifying compliance", () => {
    const summary = buildRtpAdoptionRecordProofSummary({
      status: "draft",
      adoptionTargetDate: "2026-06-01T00:00:00.000Z",
      publicReviewOpenAt: "2026-04-20T00:00:00.000Z",
      publicReviewCloseAt: "2026-05-20T00:00:00.000Z",
      requiredChapterCount: 7,
      requiredChaptersReadyForReviewCount: 1,
      requiredChaptersCompleteCount: 2,
      packetRecordCount: 1,
      generatedPacketCount: 0,
    });

    expect(summary.ready).toBe(false);
    expect(summary.label).toBe("Record proofing in progress");
    expect(summary.tone).toBe("warning");
    expect(summary.readyCheckCount).toBe(2);
    expect(summary.actionItems).toHaveLength(2);
    expect(summary.detail).toContain("supervised workbench evidence");
    expect(summary.detail).toContain("not an automated compliance finding");
    expect(summary.checks.find((check) => check.key === "board_packet_artifact")?.detail).toContain(
      "needs a generated artifact"
    );
  });

  it("flags adopted cycles that need proof-field backfill as an operations cue", () => {
    const summary = buildRtpAdoptionRecordProofSummary({
      status: "adopted",
      adoptionTargetDate: "2026-06-01T00:00:00.000Z",
      publicReviewOpenAt: null,
      publicReviewCloseAt: null,
      requiredChapterCount: 7,
      requiredChaptersReadyForReviewCount: 0,
      requiredChaptersCompleteCount: 7,
      packetRecordCount: 0,
      generatedPacketCount: 0,
    });

    expect(summary.ready).toBe(false);
    expect(summary.label).toBe("Adopted record needs backfill");
    expect(summary.detail).toContain("operations cue");
    expect(summary.detail).toContain("not a legal certification");
  });
});

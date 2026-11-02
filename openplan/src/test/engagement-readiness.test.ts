import { describe, expect, it } from "vitest";
import { getEngagementHandoffReadiness, getEngagementPublicReviewCopyGuard } from "@/lib/engagement/readiness";
import { summarizeEngagementItems } from "@/lib/engagement/summary";

describe("getEngagementHandoffReadiness", () => {
  it("marks a fully closed campaign as ready for handoff", () => {
    const readiness = getEngagementHandoffReadiness({
      campaignStatus: "closed",
      projectLinked: true,
      categoryCount: 3,
      counts: {
        totalItems: 8,
        uncategorizedItemsNeedingCategory: 0,
        moderationQueue: {
          actionableCount: 0,
          readyForHandoffCount: 5,
        },
      },
    });

    expect(readiness.label).toBe("Ready for handoff");
    expect(readiness.tone).toBe("success");
    expect(readiness.completeCount).toBe(9);
    expect(readiness.nextAction).toMatch(/credible handoff posture/i);
  });

  it("does not hold handoff for a withheld comment that has no category", () => {
    // Every report leaves withheld comments out, so a rejected, uncategorized
    // comment (spam, off-topic) must not ask staff to categorize it.
    const readiness = getEngagementHandoffReadiness({
      campaignStatus: "closed",
      projectLinked: true,
      categoryCount: 3,
      counts: {
        totalItems: 6,
        uncategorizedItemsNeedingCategory: 0,
        moderationQueue: { actionableCount: 0, readyForHandoffCount: 5 },
      },
    });

    expect(readiness.checks.find((check) => check.id === "categorization")).toMatchObject({ passed: true });
    expect(readiness.nextAction).not.toMatch(/categorize/i);
    expect(readiness.label).toBe("Ready for handoff");
  });

  it("reads a rejected, uncategorized comment from the campaign summary without asking for a category", () => {
    const items = [
      { id: "a", campaign_id: "c", category_id: "cat", status: "approved", source_type: "public", latitude: 48.27, longitude: -116.55 },
      { id: "b", campaign_id: "c", category_id: null, status: "rejected", source_type: "public", body: "My water bill doubled." },
    ];
    const counts = summarizeEngagementItems([{ id: "cat", label: "Crossings" }], items);
    const readiness = getEngagementHandoffReadiness({ campaignStatus: "active", projectLinked: true, categoryCount: 1, counts });
    expect(readiness.checks.find((check) => check.id === "categorization")?.passed).toBe(true);
    expect(readiness.nextAction).not.toMatch(/Categorize the/);

    // The same comment still pending does need a category.
    const pending = summarizeEngagementItems([{ id: "cat", label: "Crossings" }], [items[0], { ...items[1], status: "pending" }]);
    const open = getEngagementHandoffReadiness({ campaignStatus: "active", projectLinked: true, categoryCount: 1, counts: pending });
    expect(open.checks.find((check) => check.id === "categorization")).toMatchObject({ passed: false, detail: "1 item still needs a category before final matrix handoff." });
  });

  it("marks an active but mostly complete campaign as nearly ready", () => {
    const readiness = getEngagementHandoffReadiness({
      campaignStatus: "active",
      projectLinked: true,
      categoryCount: 2,
      counts: {
        totalItems: 6,
        uncategorizedItemsNeedingCategory: 0,
        moderationQueue: {
          actionableCount: 0,
          readyForHandoffCount: 2,
        },
      },
    });

    expect(readiness.label).toBe("Nearly ready");
    expect(readiness.tone).toBe("warning");
    expect(readiness.completeCount).toBe(9);
    expect(readiness.nextAction).toMatch(/close the campaign/i);
  });

  it("marks an under-structured campaign as needing attention", () => {
    const readiness = getEngagementHandoffReadiness({
      campaignStatus: "draft",
      projectLinked: false,
      categoryCount: 0,
      counts: {
        totalItems: 3,
        uncategorizedItemsNeedingCategory: 3,
        moderationQueue: {
          actionableCount: 2,
          readyForHandoffCount: 0,
        },
      },
    });

    expect(readiness.label).toBe("Needs attention");
    expect(readiness.tone).toBe("neutral");
    expect(readiness.completeCount).toBe(1);
    expect(readiness.checks.find((check) => check.id === "project")?.passed).toBe(false);
    expect(readiness.checks.find((check) => check.id === "categorization")?.detail).toMatch(/category before final matrix handoff/i);
    expect(readiness.nextAction).toMatch(/link the campaign to the correct project/i);
  });

  it("blocks final handoff when approved items remain uncategorized", () => {
    const readiness = getEngagementHandoffReadiness({
      campaignStatus: "closed",
      projectLinked: true,
      categoryCount: 2,
      counts: {
        totalItems: 4,
        uncategorizedItemsNeedingCategory: 1,
        moderationQueue: {
          actionableCount: 0,
          readyForHandoffCount: 3,
        },
      },
    });

    expect(readiness.label).toBe("Nearly ready");
    expect(readiness.tone).toBe("warning");
    expect(readiness.checks.find((check) => check.id === "categorization")?.passed).toBe(false);
    expect(readiness.nextAction).toMatch(/categorize the 1 uncategorized item/i);
  });

  it("holds appendix readiness when duplicate-looking public comments need staff review", () => {
    const readiness = getEngagementHandoffReadiness({
      campaignStatus: "closed",
      projectLinked: true,
      categoryCount: 2,
      counts: {
        totalItems: 5,
        uncategorizedItemsNeedingCategory: 0,
        moderationQueue: {
          actionableCount: 0,
          readyForHandoffCount: 4,
        },
        appendixReadiness: {
          appendixReadyCount: 2,
          publicApprovedCategorizedCount: 3,
          nonPublicApprovedCategorizedCount: 1,
          duplicateReviewCount: 1,
          duplicateGroupCount: 1,
          duplicateExcludedCount: 1,
        },
      },
    });

    expect(readiness.label).toBe("Nearly ready");
    expect(readiness.checks.find((check) => check.id === "duplicate_review")?.passed).toBe(false);
    expect(readiness.checks.find((check) => check.id === "report_appendix")?.detail).toMatch(
      /approved public comments are appendix-ready/i
    );
    expect(readiness.nextAction).toMatch(/duplicate-review item/i);
  });

  it("does not treat internal notes as public-comment appendix candidates", () => {
    const readiness = getEngagementHandoffReadiness({
      campaignStatus: "closed",
      projectLinked: true,
      categoryCount: 2,
      counts: {
        totalItems: 2,
        uncategorizedItemsNeedingCategory: 0,
        moderationQueue: {
          actionableCount: 0,
          readyForHandoffCount: 2,
        },
        appendixReadiness: {
          appendixReadyCount: 0,
          publicApprovedCategorizedCount: 0,
          nonPublicApprovedCategorizedCount: 2,
          duplicateReviewCount: 0,
          duplicateGroupCount: 0,
          duplicateExcludedCount: 0,
        },
      },
    });

    expect(readiness.label).toBe("Nearly ready");
    expect(readiness.checks.find((check) => check.id === "source_posture")?.detail).toMatch(
      /0 public comments and 2 internal\/meeting\/email items/i
    );
    expect(readiness.checks.find((check) => check.id === "report_appendix")?.passed).toBe(false);
    expect(readiness.nextAction).toMatch(/public comment/i);
  });
});

describe("getEngagementPublicReviewCopyGuard", () => {
  it("keeps public-review copy in draft posture while public intake remains open", () => {
    const guard = getEngagementPublicReviewCopyGuard({
      campaignStatus: "active",
      allowPublicSubmissions: true,
      shareToken: "public-token",
      submissionsClosedAt: null,
      appendixReadyCount: 3,
      actionableCount: 2,
    });

    expect(guard.label).toBe("Public-review draft");
    expect(guard.tone).toBe("warning");
    expect(guard.summary).toMatch(/working draft for staff review/i);
    expect(guard.nextCopyAction).toMatch(/resolve 2 pending or flagged/i);
    expect(guard.guardrails.join(" ")).toMatch(/noticing sufficiency has been automated/i);
    expect(guard.guardrails.join(" ")).toMatch(/not an official-record certification/i);
  });

  it("allows closeout review language without claiming legal or public-records automation", () => {
    const guard = getEngagementPublicReviewCopyGuard({
      campaignStatus: "closed",
      allowPublicSubmissions: false,
      shareToken: "public-token",
      submissionsClosedAt: "2026-05-10T08:00:00.000Z",
      appendixReadyCount: 4,
      actionableCount: 0,
    });

    expect(guard.label).toBe("Closeout review");
    expect(guard.tone).toBe("info");
    expect(guard.summary).toMatch(/staff still owns final publication, record, and noticing determinations/i);
    expect(guard.nextCopyAction).toMatch(/source split/i);
    expect(guard.guardrails.join(" ")).not.toMatch(/certified public records/i);
    expect(guard.guardrails.join(" ")).not.toMatch(/legal-grade/i);
  });

  it("falls back to staff-only handoff when no public appendix candidate is ready", () => {
    const guard = getEngagementPublicReviewCopyGuard({
      campaignStatus: "draft",
      allowPublicSubmissions: false,
      shareToken: null,
      submissionsClosedAt: null,
      appendixReadyCount: 0,
      actionableCount: 0,
    });

    expect(guard.label).toBe("Staff handoff only");
    expect(guard.tone).toBe("neutral");
    expect(guard.summary).toMatch(/use this campaign internally/i);
    expect(guard.nextCopyAction).toMatch(/approve and categorize public comments/i);
  });
});

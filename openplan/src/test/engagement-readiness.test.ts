import { describe, expect, it } from "vitest";
import { getEngagementHandoffReadiness } from "@/lib/engagement/readiness";

describe("getEngagementHandoffReadiness", () => {
  it("marks a fully closed campaign as ready for handoff", () => {
    const readiness = getEngagementHandoffReadiness({
      campaignStatus: "closed",
      projectLinked: true,
      categoryCount: 3,
      counts: {
        totalItems: 8,
        uncategorizedItems: 0,
        moderationQueue: {
          actionableCount: 0,
          readyForHandoffCount: 5,
        },
      },
    });

    expect(readiness.label).toBe("Ready for handoff");
    expect(readiness.tone).toBe("success");
    expect(readiness.completeCount).toBe(5);
    expect(readiness.nextAction).toMatch(/credible handoff posture/i);
  });

  it("marks an active but mostly complete campaign as nearly ready", () => {
    const readiness = getEngagementHandoffReadiness({
      campaignStatus: "active",
      projectLinked: true,
      categoryCount: 2,
      counts: {
        totalItems: 6,
        uncategorizedItems: 0,
        moderationQueue: {
          actionableCount: 0,
          readyForHandoffCount: 2,
        },
      },
    });

    expect(readiness.label).toBe("Nearly ready");
    expect(readiness.tone).toBe("warning");
    expect(readiness.completeCount).toBe(5);
    expect(readiness.nextAction).toMatch(/close the campaign/i);
  });

  it("marks an under-structured campaign as needing attention", () => {
    const readiness = getEngagementHandoffReadiness({
      campaignStatus: "draft",
      projectLinked: false,
      categoryCount: 0,
      counts: {
        totalItems: 3,
        uncategorizedItems: 3,
        moderationQueue: {
          actionableCount: 2,
          readyForHandoffCount: 0,
        },
      },
    });

    expect(readiness.label).toBe("Needs attention");
    expect(readiness.tone).toBe("neutral");
    expect(readiness.completeCount).toBe(0);
    expect(readiness.checks.find((check) => check.id === "project")?.passed).toBe(false);
    expect(readiness.nextAction).toMatch(/link the campaign to the correct project/i);
  });
});

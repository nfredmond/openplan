import { describe, expect, it } from "vitest";
import { getPublicPortalReadiness, getPublicPortalState, normalizeShareToken } from "@/lib/engagement/public-portal";

describe("engagement public portal helpers", () => {
  it("normalizes configured share tokens", () => {
    expect(normalizeShareToken("  Downtown-Launch_01 ")).toBe("downtown-launch_01");
    expect(normalizeShareToken("   ")).toBeNull();
  });

  it("reports a staged link when a token exists but the campaign is not active", () => {
    expect(
      getPublicPortalState({
        status: "draft",
        share_token: "PilotLink123",
        allow_public_submissions: true,
        submissions_closed_at: null,
      })
    ).toMatchObject({
      visibility: "staged",
      label: "Staged link",
      portalPath: "/engage/pilotlink123",
      isPubliclyReachable: false,
      isAcceptingSubmissions: false,
    });
  });

  it("reports a live accepting portal only when active with submissions enabled", () => {
    expect(
      getPublicPortalState({
        status: "active",
        share_token: "pilotlink123",
        allow_public_submissions: true,
        submissions_closed_at: null,
      })
    ).toMatchObject({
      visibility: "live_open",
      label: "Live · accepting submissions",
      portalPath: "/engage/pilotlink123",
      isPubliclyReachable: true,
      isAcceptingSubmissions: true,
    });
  });

  it("summarizes share readiness before operators copy a public link", () => {
    expect(
      getPublicPortalReadiness({
        status: "active",
        share_token: "pilotlink123",
        public_description: "Review corridor safety concepts and tell us what should change.",
        allow_public_submissions: true,
        submissions_closed_at: null,
      })
    ).toMatchObject({
      label: "Ready to share",
      completeCount: 4,
      totalChecks: 4,
      nextAction: "Portal is ready for public outreach and copy/share handoff.",
    });
  });

  it("flags missing public context and unresolved submission posture", () => {
    const readiness = getPublicPortalReadiness({
      status: "draft",
      share_token: " ",
      public_description: "Too short",
      allow_public_submissions: false,
      submissions_closed_at: null,
    });

    expect(readiness).toMatchObject({
      label: "Needs setup",
      completeCount: 0,
      totalChecks: 4,
      nextAction: "Generate and save a share token before sending public outreach.",
    });
    expect(readiness.checks.map((check) => [check.id, check.passed])).toEqual([
      ["share_token", false],
      ["active_status", false],
      ["public_description", false],
      ["submission_mode", false],
    ]);
  });
});

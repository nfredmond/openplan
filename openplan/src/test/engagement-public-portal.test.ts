import { describe, expect, it } from "vitest";
import { getPublicPortalState, normalizeShareToken } from "@/lib/engagement/public-portal";

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
});

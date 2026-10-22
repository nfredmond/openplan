import { describe, expect, it } from "vitest";
import {
  getPublicPortalReadiness,
  getPublicPortalState,
  normalizeShareToken,
  participationDateClosure,
} from "@/lib/engagement/public-portal";

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

  it("tells staff a closed campaign's link shows only an ended notice, and how to switch it off", () => {
    const state = getPublicPortalState({
      status: "closed",
      share_token: "pilotlink123",
      allow_public_submissions: true,
      submissions_closed_at: null,
    });

    expect(state).toMatchObject({
      visibility: "staged",
      label: "Closed · notice only",
      portalPath: "/engage/pilotlink123",
      // The campaign's page and comments are not reachable. Only a notice is.
      isPubliclyReachable: false,
      isAcceptingSubmissions: false,
    });
    expect(state.detail).toContain("shows only a notice that the comment period has ended");
    expect(state.detail).toContain("no comments or campaign details");
    expect(state.detail).toContain("Archived");
    // The draft sentence would be false here: the link does answer.
    expect(state.detail).not.toContain("only resolves when the campaign status is Active");
  });

  it("keeps the staged wording for a draft and an archived campaign", () => {
    for (const status of ["draft", "archived"]) {
      expect(
        getPublicPortalState({ status, share_token: "pilotlink123", allow_public_submissions: true, submissions_closed_at: null }).detail
      ).toBe("A share link is saved, but the public page only resolves when the campaign status is Active.");
    }
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
      // Five checks since 2026-08-15: "where the resident map opens" joined the
      // list. This caller passes no area state, so it defaults to `unreadable`
      // — an honest "cannot be checked from here" that passes rather than
      // telling somebody to set an area that may already exist.
      label: "Ready to share",
      completeCount: 5,
      totalChecks: 5,
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
      // The map step passes here (area unreadable, not unset), so one of the
      // five is complete while the other four are the real gaps.
      completeCount: 1,
      totalChecks: 5,
      nextAction: "The link stays closed to residents until the last step is done.",
    });
    expect(readiness.checks.map((check) => [check.id, check.passed])).toEqual([
      ["share_token", false],
      ["active_status", false],
      ["public_description", false],
      ["submission_mode", false],
      ["map_opens_somewhere", true],
    ]);
  });
});

/**
 * STAFF COPY FOLLOWS THE PARTICIPATION DATES.
 *
 * The public page, the submit routes and the database triggers refuse comments
 * before the start date and from the end date on. The console read only the
 * staff close switch, so a reopened page whose end date had passed said "Live ·
 * accepting submissions" while residents were refused. The dates are named in
 * the workspace calendar, never the server's UTC day.
 */
describe("staff copy follows the participation dates", () => {
  const NOW = new Date("2026-10-14T18:00:00.000Z");
  // 19:30 on October 10 in Los Angeles; 15:30 on October 11 in Auckland.
  const ENDED = "2026-10-11T02:30:00+00:00";
  const LIVE = {
    status: "active",
    share_token: "pilotlink123",
    allow_public_submissions: true,
    submissions_closed_at: null,
  };

  it("does not say a reopened page accepts comments after its end date", () => {
    const state = getPublicPortalState(
      { ...LIVE, participation_ends_at: ENDED },
      { now: NOW, timeZone: "America/Los_Angeles" }
    );
    expect(state).toMatchObject({
      visibility: "live_closed",
      label: "Live · submissions closed",
      isPubliclyReachable: true,
      isAcceptingSubmissions: false,
    });
    expect(state.detail).toBe(
      "Comments are closed because the participation period ended on October 10, 2026 at 19:30 (America/Los_Angeles)."
    );
  });

  it("names the end date in the workspace calendar, not the server's", () => {
    expect(
      getPublicPortalState({ ...LIVE, participation_ends_at: ENDED }, { now: NOW, timeZone: "Pacific/Auckland" }).detail
    ).toBe("Comments are closed because the participation period ended on October 11, 2026 at 15:30 (Pacific/Auckland).");
    // No zone known: UTC, and the sentence says so.
    expect(getPublicPortalState({ ...LIVE, participation_ends_at: ENDED }, { now: NOW }).detail).toBe(
      "Comments are closed because the participation period ended on October 11, 2026 at 02:30 (UTC)."
    );
  });

  it("names the end date over a staff close, because reopening would not change it", () => {
    expect(
      getPublicPortalState(
        { ...LIVE, submissions_closed_at: "2026-10-01T00:00:00+00:00", participation_ends_at: ENDED },
        { now: NOW, timeZone: "America/Los_Angeles" }
      ).detail
    ).toMatch(/participation period ended on October 10, 2026/);
  });

  it("still accepts comments up to the end instant, and says when a period has not started", () => {
    expect(
      getPublicPortalState({ ...LIVE, participation_ends_at: "2026-10-14T18:00:01+00:00" }, { now: NOW })
    ).toMatchObject({ visibility: "live_open", isAcceptingSubmissions: true });
    // The end instant itself is closed, as the database's `<=` has it.
    expect(
      getPublicPortalState({ ...LIVE, participation_ends_at: "2026-10-14T18:00:00+00:00" }, { now: NOW })
    ).toMatchObject({ visibility: "live_closed", isAcceptingSubmissions: false });
    expect(
      getPublicPortalState(
        { ...LIVE, participation_starts_at: "2026-10-20T16:00:00+00:00" },
        { now: NOW, timeZone: "America/Los_Angeles" }
      )
    ).toMatchObject({
      label: "Live · comments not open yet",
      detail: "Comments open on October 20, 2026 at 09:00 (America/Los_Angeles), when the participation period starts.",
      isAcceptingSubmissions: false,
    });
  });

  it("leaves a page that never took comments as view only", () => {
    expect(
      getPublicPortalState({ ...LIVE, allow_public_submissions: false, participation_ends_at: ENDED }, { now: NOW })
    ).toMatchObject({ label: "Live · view only" });
  });

  it("puts the end date in the comments step of the checklist", () => {
    const check = getPublicPortalReadiness(
      { ...LIVE, public_description: null, participation_ends_at: ENDED },
      "set",
      { now: NOW, timeZone: "America/Los_Angeles" }
    ).checks.find((entry) => entry.id === "submission_mode");
    expect(check?.detail).toBe(
      "Comments are closed because the participation period ended on October 10, 2026 at 19:30 (America/Los_Angeles)."
    );
  });

  it("reads no closure from open or missing dates", () => {
    expect(participationDateClosure({}, { now: NOW })).toBeNull();
    expect(
      participationDateClosure(
        { participation_starts_at: "2026-10-01T00:00:00+00:00", participation_ends_at: "2026-10-30T00:00:00+00:00" },
        { now: NOW }
      )
    ).toBeNull();
  });
});

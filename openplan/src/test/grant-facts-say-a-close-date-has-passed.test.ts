import { describe, expect, it } from "vitest";

import {
  buildOpportunityFactList,
  type OpportunityEvidenceBundle,
} from "@/lib/grants/narrative-evidence";
import { isClosingSoonFundingOpportunity } from "@/lib/operations/funding-decision-status";
import { isDeadlinePast } from "@/lib/work/deadlines";

/**
 * A live grant narrative draft on 2026-10-11 called a funding call that
 * closed on 2026-09-30 "currently open". The record's status still read
 * "open" and neither the close date nor today's date was a citable fact, so
 * the model had nothing else to go on. The fact list now states each recorded
 * deadline and, when the route passes the current time, says in code whether
 * it has passed, by the same calendar-day rule that decides "closing soon".
 * The model cites that fact instead of doing date arithmetic.
 */

function bundle(opportunity: Partial<OpportunityEvidenceBundle["opportunity"]> = {}): OpportunityEvidenceBundle {
  return {
    opportunity: {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      workspace_id: "33333333-3333-4333-8333-333333333333",
      program_id: null,
      project_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      title: "Open call 001128",
      opportunity_status: "open",
      decision_state: "monitor",
      closes_at: "2026-09-30",
      decision_due_at: null,
      ...opportunity,
    },
    projectName: "Corridor study",
    fundingSummary: null,
    modelingEvidence: null,
    modelingHeadline: null,
    modelingReadinessDetail: null,
    bcaScreening: null,
    engagementEvidence: null,
    evidenceReadinessSummary: "Evidence summary.",
    kbExcerpts: [],
    linkedProjectStage: null,
    completedProjects: null,
    rtpProgramming: null,
    readFailures: [],
  };
}

function claims(
  opportunity: Partial<OpportunityEvidenceBundle["opportunity"]>,
  now?: string,
  timeZone?: string
): string[] {
  return buildOpportunityFactList(bundle(opportunity), now ? { now: new Date(now), timeZone } : undefined).map(
    (fact) => fact.claim_text
  );
}

describe("grant facts state whether a recorded deadline has passed", () => {
  it("says a close date before today has passed, and that the open status is stale", () => {
    const facts = claims({}, "2026-10-11T18:00:00Z");
    expect(facts).toContain(
      'The recorded close date for this opportunity is 2026-09-30, before today\'s date (2026-10-11, UTC), so the close date has passed even though its recorded status still reads "open".'
    );
  });

  it("does not call a close date passed when it is still ahead", () => {
    const facts = claims({}, "2026-09-01T18:00:00Z");
    expect(facts).toContain("The recorded close date for this opportunity is 2026-09-30; today's date is 2026-09-01 (UTC).");
    expect(facts.join(" ")).not.toContain("has passed");
  });

  it("says a close date that is today is today, not passed", () => {
    const facts = claims({ closes_at: "2026-09-30" }, "2026-09-30T18:00:00Z");
    expect(facts).toContain("The recorded close date for this opportunity is 2026-09-30, which is today.");
  });

  it("says a close time later today is later today, not passed", () => {
    const facts = claims({ closes_at: "2026-09-30T23:59:00Z" }, "2026-09-30T18:00:00Z");
    expect(facts).toContain("The recorded close time for this opportunity is 2026-09-30 at 23:59 (UTC), later today.");
    expect(facts.join(" ")).not.toContain("has passed");
  });

  it("follows the shared calendar-day rule, so it agrees with closing soon", () => {
    // 05:00 UTC on Oct 1: the UTC date is past Sep 30, but Sep 30 has not
    // ended everywhere. The shared rule says not passed, and the workspace
    // still counts the call as closing soon; the fact must not say "passed".
    const now = "2026-10-01T05:00:00Z";
    expect(isDeadlinePast("2026-09-30", new Date(now))).toBe(false);
    expect(isClosingSoonFundingOpportunity({ opportunityStatus: "open", closesAt: "2026-09-30" }, new Date(now))).toBe(true);
    const facts = claims({}, now);
    expect(facts).toContain(
      "The recorded close date for this opportunity is 2026-09-30, the day before today's date (2026-10-01, UTC); that day has not ended everywhere, so the close date may have passed."
    );
    expect(facts.join(" ")).not.toContain("has passed");
    // In a Pacific workspace it is still Sep 30, so the date is simply today.
    expect(claims({}, now, "America/Los_Angeles")).toContain(
      "The recorded close date for this opportunity is 2026-09-30, which is today."
    );
  });

  it("compares a TIMESTAMPTZ close as an instant: a 09:00 UTC close has passed at 09:30 UTC the same day", () => {
    // The review's case: truncated to a day, this call read as "today" for
    // fifteen more hours after it closed.
    const closed = claims({ closes_at: "2026-10-11T09:00:00+00:00" }, "2026-10-11T09:30:00Z");
    expect(closed).toContain(
      'The recorded close time for this opportunity is 2026-10-11 at 09:00 (UTC); today\'s date is 2026-10-11 (UTC), so the close time has passed even though its recorded status still reads "open".'
    );
    const before = claims({ closes_at: "2026-10-11T09:00:00+00:00" }, "2026-10-11T08:59:00Z");
    expect(before).toContain("The recorded close time for this opportunity is 2026-10-11 at 09:00 (UTC), later today.");
    expect(before.join(" ")).not.toContain("has passed");
  });

  it("states a close time and today's date in the workspace's zone", () => {
    // 06:59 UTC on Oct 1 is 11:59 p.m. Sep 30 in Los Angeles. Sliced, it read Oct 1.
    const facts = claims({ closes_at: "2026-10-01T06:59:00Z" }, "2026-09-30T20:00:00Z", "America/Los_Angeles");
    expect(facts).toContain(
      "The recorded close time for this opportunity is 2026-09-30 at 23:59 (America/Los_Angeles), later today."
    );
    const passed = claims({ closes_at: "2026-10-01T06:59:00Z" }, "2026-10-01T07:30:00Z", "America/Los_Angeles");
    expect(passed).toContain(
      'The recorded close time for this opportunity is 2026-09-30 at 23:59 (America/Los_Angeles); today\'s date is 2026-10-01 (America/Los_Angeles), so the close time has passed even though its recorded status still reads "open".'
    );
  });

  it("states a passed decision due time as an instant", () => {
    const facts = claims({ closes_at: null, decision_due_at: "2026-10-11T09:00:00Z" }, "2026-10-11T12:00:00Z");
    expect(facts).toContain(
      "The workspace decision on this opportunity was due 2026-10-11 at 09:00 (UTC); today's date is 2026-10-11 (UTC), so that due time has passed."
    );
  });

  it("leaves out the stale-status clause when the status is no longer open", () => {
    const facts = claims({ opportunity_status: "closed" }, "2026-10-11T18:00:00Z");
    expect(facts).toContain(
      "The recorded close date for this opportunity is 2026-09-30, before today's date (2026-10-11, UTC), so the close date has passed."
    );
  });

  it("states a passed decision due date", () => {
    const facts = claims({ closes_at: null, decision_due_at: "2026-10-01" }, "2026-10-11T18:00:00Z");
    expect(facts).toContain(
      "The workspace decision on this opportunity was due 2026-10-01, before today's date (2026-10-11, UTC), so that due date has passed."
    );
  });

  it("states the recorded date without judging it when no date is given", () => {
    const facts = claims({});
    expect(facts).toContain("The recorded close date for this opportunity is 2026-09-30.");
    expect(facts.join(" ")).not.toContain("today");
  });

  it("adds no date fact when nothing is recorded", () => {
    const facts = claims({ closes_at: null, decision_due_at: null }, "2026-10-11T18:00:00Z");
    expect(facts.join(" ")).not.toMatch(/close date|decision on this opportunity/);
  });
});

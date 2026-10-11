import { describe, expect, it } from "vitest";

import {
  buildOpportunityFactList,
  type OpportunityEvidenceBundle,
} from "@/lib/grants/narrative-evidence";

/**
 * A live grant narrative draft on 2026-10-11 called a funding call that
 * closed on 2026-09-30 "currently open". The record's status still read
 * "open" and neither the close date nor today's date was a citable fact, so
 * the model had nothing else to go on. The fact list now states each recorded
 * deadline and, when the route passes today's date, says in code whether it
 * has passed. The model cites that fact instead of doing date arithmetic.
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

function claims(opportunity: Partial<OpportunityEvidenceBundle["opportunity"]>, today?: string): string[] {
  return buildOpportunityFactList(bundle(opportunity), today ? { today } : undefined).map((fact) => fact.claim_text);
}

describe("grant facts state whether a recorded deadline has passed", () => {
  it("says a close date before today has passed, and that the open status is stale", () => {
    const facts = claims({}, "2026-10-11");
    expect(facts).toContain(
      'The recorded close date for this opportunity is 2026-09-30, before today\'s date (2026-10-11, UTC), so the close date has passed even though its recorded status still reads "open".'
    );
  });

  it("does not call a close date passed when it is still ahead", () => {
    const facts = claims({}, "2026-09-01");
    expect(facts).toContain("The recorded close date for this opportunity is 2026-09-30; today's date is 2026-09-01 (UTC).");
    expect(facts.join(" ")).not.toContain("has passed");
  });

  it("says a close date that is today is today, not passed", () => {
    const facts = claims({ closes_at: "2026-09-30T23:59:00Z" }, "2026-09-30");
    expect(facts).toContain("The recorded close date for this opportunity is 2026-09-30, which is today (UTC).");
  });

  it("leaves out the stale-status clause when the status is no longer open", () => {
    const facts = claims({ opportunity_status: "closed" }, "2026-10-11");
    expect(facts).toContain(
      "The recorded close date for this opportunity is 2026-09-30, before today's date (2026-10-11, UTC), so the close date has passed."
    );
  });

  it("states a passed decision due date", () => {
    const facts = claims({ closes_at: null, decision_due_at: "2026-10-01" }, "2026-10-11");
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
    const facts = claims({ closes_at: null, decision_due_at: null }, "2026-10-11");
    expect(facts.join(" ")).not.toMatch(/close date|decision on this opportunity/);
  });
});

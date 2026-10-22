import { describe, expect, it } from "vitest";

import { isClosingSoonFundingOpportunity } from "@/lib/operations/funding-decision-status";

/**
 * In a live Planner Agent test on 2026-10-11 the agent reported that the
 * workspace counted "Open call 001128" as closing soon, though its close date
 * had passed on 2026-09-30. The rule checked only that the close date was at
 * most 14 days away, and a date 11 days in the past is "at most 14 days
 * away". A passed deadline is not closing soon. A date-only close date counts
 * as passed only once that calendar day has ended, the same rule My Work and
 * the dashboard use for every other deadline.
 */

const NOW = new Date("2026-10-11T18:00:00Z");
const open = (closesAt: string | null, decisionDueAt: string | null = null) => ({
  opportunityStatus: "open",
  closesAt,
  decisionDueAt,
});

describe("a passed close date is not closing soon", () => {
  it("does not count a close date eleven days past", () => {
    expect(isClosingSoonFundingOpportunity(open("2026-09-30"), NOW)).toBe(false);
    expect(isClosingSoonFundingOpportunity(open("2026-09-30T23:59:00Z"), NOW)).toBe(false);
  });

  it("still counts a close date inside the 14-day window", () => {
    expect(isClosingSoonFundingOpportunity(open("2026-10-16"), NOW)).toBe(true);
  });

  it("counts a date-only close date of today until the day has ended", () => {
    expect(isClosingSoonFundingOpportunity(open("2026-10-11"), NOW)).toBe(true);
  });

  it("does not count a close date outside the window", () => {
    expect(isClosingSoonFundingOpportunity(open("2026-10-31"), NOW)).toBe(false);
  });

  it("does not count a passed decision due date standing in for a missing close date", () => {
    // That is an overdue decision, counted separately, not a closing call.
    expect(isClosingSoonFundingOpportunity(open(null, "2026-10-08"), NOW)).toBe(false);
    expect(isClosingSoonFundingOpportunity(open(null, "2026-10-20"), NOW)).toBe(true);
  });

  it("does not count an opportunity that is not open", () => {
    expect(isClosingSoonFundingOpportunity({ opportunityStatus: "upcoming", closesAt: "2026-10-16" }, NOW)).toBe(false);
  });
});

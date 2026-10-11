import { describe, expect, it } from "vitest";

import { isDeadlinePast } from "@/lib/work/deadlines";

/*
  A DUE DATE IS A CALENDAR DAY.

  Found by the independent review of the October 10, 2026 UI plan: a DATE
  column ("2026-10-14") parsed as midnight UTC, so a deadline of the 14th was
  reported overdue at 5 pm Pacific on the 13th, on My Work and in every
  reminder. With no workspace time zone recorded, the date is past only once
  it has ended everywhere on earth (the end of that day at UTC-12). That can
  be up to a day late; it is never early.
*/
describe("a due date is a calendar day", () => {
  it("is not overdue at any hour of the due date, in any zone", () => {
    // 11:59 pm on the 14th at UTC-12 is noon UTC on the 15th.
    expect(isDeadlinePast("2026-10-14", new Date("2026-10-14T00:00:00Z"))).toBe(false);
    expect(isDeadlinePast("2026-10-14", new Date("2026-10-15T00:30:00Z"))).toBe(false);
    expect(isDeadlinePast("2026-10-14", new Date("2026-10-15T11:59:59Z"))).toBe(false);
  });

  it("was never overdue the evening before (the reported defect)", () => {
    // 5 pm Pacific on the 13th.
    expect(isDeadlinePast("2026-10-14", new Date("2026-10-14T00:00:00-07:00"))).toBe(false);
  });

  it("is overdue once the date has ended everywhere", () => {
    expect(isDeadlinePast("2026-10-14", new Date("2026-10-15T12:00:00Z"))).toBe(true);
    expect(isDeadlinePast("2026-10-14", new Date("2026-11-01T00:00:00Z"))).toBe(true);
  });

  it("still compares a timestamp as an instant", () => {
    expect(isDeadlinePast("2026-10-14T17:00:00Z", new Date("2026-10-14T17:00:01Z"))).toBe(true);
    expect(isDeadlinePast("2026-10-14T17:00:00Z", new Date("2026-10-14T16:59:59Z"))).toBe(false);
  });
});

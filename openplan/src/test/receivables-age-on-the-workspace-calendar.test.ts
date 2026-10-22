import { describe, expect, it } from "vitest";

import {
  buildReceivableAgingSummary,
  isReceivableOverdue,
  summarizeReceivables,
} from "@/lib/invoicing/receivables";

/**
 * A CLIENT INVOICE AGES ON THE WORKSPACE'S CALENDAR.
 *
 * Days past due were `floor((now - due date at midnight UTC) / one day)`.
 * Servers run in UTC, so an invoice due October 13 became "1 day past due"
 * and overdue at 5 p.m. Pacific on October 13, the day it was due. Days past
 * due are now whole calendar days between the due date and today in the
 * workspace's zone, and overdue still begins the day AFTER the due date.
 * With no zone given the arithmetic is the UTC calendar, as before.
 *
 * BLIND CATEGORY: these pass the zone in. Whether a screen loads the
 * workspace's zone and passes it is the lane's own test
 * (`receivables-lane-reads-the-workspace-calendar.test.ts`).
 */

const PACIFIC = "America/Los_Angeles";
const HONOLULU = "Pacific/Honolulu";
const TOKYO = "Asia/Tokyo";

const sent = (dueDate: string | null, amount = 100) => ({ status: "sent", due_date: dueDate, total_amount: amount });

describe("an invoice due today in the workspace's zone is not overdue", () => {
  // 6 p.m. Pacific on October 13, already October 14 in UTC.
  const EVENING_PACIFIC = new Date("2026-10-14T01:00:00Z");

  it("waits for the Pacific day after the due date", () => {
    expect(isReceivableOverdue("sent", "2026-10-13", EVENING_PACIFIC, PACIFIC)).toBe(false);
    expect(isReceivableOverdue("sent", "2026-10-14", EVENING_PACIFIC, PACIFIC)).toBe(false);
    expect(isReceivableOverdue("sent", "2026-10-12", EVENING_PACIFIC, PACIFIC)).toBe(true);
    // Midnight Pacific on the 14th.
    expect(isReceivableOverdue("sent", "2026-10-13", new Date("2026-10-14T07:00:00Z"), PACIFIC)).toBe(true);
  });

  it("ages and counts the same way the flag does", () => {
    const invoices = [sent("2026-10-13", 100), sent("2026-10-12", 200)];

    const aging = buildReceivableAgingSummary(invoices, EVENING_PACIFIC, PACIFIC);
    expect(aging.buckets.current).toEqual({ count: 1, amount: 100 });
    expect(aging.buckets.days_1_30).toEqual({ count: 1, amount: 200 });

    const summary = summarizeReceivables(invoices, EVENING_PACIFIC, PACIFIC);
    expect(summary.overdueCount).toBe(1);
    expect(summary.overdueAmount).toBe(200);
  });

  it("keeps the UTC calendar when no zone is given", () => {
    expect(isReceivableOverdue("sent", "2026-10-13", EVENING_PACIFIC)).toBe(true);
    expect(buildReceivableAgingSummary([sent("2026-10-13")], EVENING_PACIFIC).buckets.days_1_30.count).toBe(1);
    expect(summarizeReceivables([sent("2026-10-13")], EVENING_PACIFIC).overdueCount).toBe(1);
  });
});

describe("zones far from UTC", () => {
  it("waits until midnight in Honolulu, ten hours behind UTC", () => {
    // 11:59 p.m. and midnight in Honolulu.
    expect(isReceivableOverdue("sent", "2026-10-13", new Date("2026-10-14T09:59:00Z"), HONOLULU)).toBe(false);
    expect(isReceivableOverdue("sent", "2026-10-13", new Date("2026-10-14T10:00:00Z"), HONOLULU)).toBe(true);
  });

  it("turns over at midnight in Tokyo, nine hours ahead of UTC", () => {
    // Midnight October 14 in Tokyo is 3 p.m. October 13 in UTC.
    const tokyoMidnight = new Date("2026-10-13T15:00:00Z");
    expect(isReceivableOverdue("sent", "2026-10-13", tokyoMidnight, TOKYO)).toBe(true);
    expect(isReceivableOverdue("sent", "2026-10-13", new Date("2026-10-13T14:59:00Z"), TOKYO)).toBe(false);
    // The UTC calendar has not reached the 14th yet.
    expect(isReceivableOverdue("sent", "2026-10-13", tokyoMidnight)).toBe(false);
  });
});

describe("daylight saving time", () => {
  it("uses standard time after US DST ends on November 1", () => {
    // 11:30 p.m. PST on November 1. At the summer offset it would be November 2.
    expect(isReceivableOverdue("sent", "2026-11-01", new Date("2026-11-02T07:30:00Z"), PACIFIC)).toBe(false);
    expect(isReceivableOverdue("sent", "2026-11-01", new Date("2026-11-02T08:00:00Z"), PACIFIC)).toBe(true);
  });

  it("uses daylight time after US DST starts on March 8", () => {
    // 12:30 a.m. PDT on March 9. At the winter offset it would still be March 8.
    expect(isReceivableOverdue("sent", "2026-03-08", new Date("2026-03-09T07:30:00Z"), PACIFIC)).toBe(true);
    expect(isReceivableOverdue("sent", "2026-03-08", new Date("2026-03-09T06:59:00Z"), PACIFIC)).toBe(false);
  });

  it("counts whole calendar days across the change, so the 60-day bucket ends at Pacific midnight", () => {
    // Due October 1. November 30 is day 60; December 1 is day 61.
    const lastMinuteOfDay60 = new Date("2026-12-01T07:59:00Z");
    const firstMinuteOfDay61 = new Date("2026-12-01T08:00:00Z");

    const before = buildReceivableAgingSummary([sent("2026-10-01")], lastMinuteOfDay60, PACIFIC);
    expect(before.buckets.days_31_60.count).toBe(1);
    expect(before.buckets.days_61_90.count).toBe(0);

    const after = buildReceivableAgingSummary([sent("2026-10-01")], firstMinuteOfDay61, PACIFIC);
    expect(after.buckets.days_61_90.count).toBe(1);
  });
});

describe("a due date stored as an instant", () => {
  it("is aged by the calendar day it falls on in the workspace's zone", () => {
    // 8 p.m. Pacific on October 13 is 3 a.m. October 14 in UTC.
    const due = "2026-10-13T20:00:00-07:00";
    expect(isReceivableOverdue("sent", due, new Date("2026-10-14T06:59:00Z"), PACIFIC)).toBe(false);
    expect(isReceivableOverdue("sent", due, new Date("2026-10-14T07:00:00Z"), PACIFIC)).toBe(true);
  });

  it("leaves an unreadable due date undated rather than guessing a bucket", () => {
    const aging = buildReceivableAgingSummary([sent("not a date")], new Date("2026-10-14T01:00:00Z"), PACIFIC);
    expect(aging.undatedCount).toBe(1);
    expect(isReceivableOverdue("sent", "not a date", new Date("2026-10-14T01:00:00Z"), PACIFIC)).toBe(false);
  });
});

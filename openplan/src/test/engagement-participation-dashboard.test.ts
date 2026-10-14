import { describe, expect, it } from "vitest";

import { buildDailyIntake } from "@/lib/engagement/participation-dashboard";

describe("buildDailyIntake", () => {
  const now = new Date("2026-07-19T12:00:00.000Z");

  it("buckets by UTC day, with no zone given, within the trailing window and keeps empty days", () => {
    const items = [
      { created_at: "2026-07-19T01:00:00Z" },
      { created_at: "2026-07-19T23:00:00Z" },
      { created_at: "2026-07-18T10:00:00Z" },
      { created_at: "2026-07-05T10:00:00Z" }, // still within 21d
    ];
    const trend = buildDailyIntake(items, { days: 21, now });
    expect(trend.windowDays).toBe(21);
    expect(trend.buckets).toHaveLength(21);
    expect(trend.buckets.at(-1)).toEqual({ date: "2026-07-19", count: 2 });
    expect(trend.buckets.at(-2)).toEqual({ date: "2026-07-18", count: 1 });
    expect(trend.total).toBe(4);
    expect(trend.peak).toBe(2);
  });

  it("drops items outside the window and unparseable/absent dates", () => {
    const items = [
      { created_at: "2026-06-01T10:00:00Z" }, // > 21 days ago
      { created_at: "not-a-date" },
      { created_at: null, updated_at: "2026-07-17T10:00:00Z" }, // falls back to updated_at
      {},
    ];
    const trend = buildDailyIntake(items, { days: 21, now });
    expect(trend.total).toBe(1);
    expect(trend.buckets.find((b) => b.date === "2026-07-17")?.count).toBe(1);
  });

  it("handles an empty campaign", () => {
    const trend = buildDailyIntake([], { days: 14, now });
    expect(trend.total).toBe(0);
    expect(trend.peak).toBe(0);
    expect(trend.buckets).toHaveLength(14);
  });

  it("counts a late-evening Pacific comment on that evening's day, not the next UTC day", () => {
    // 01:30 UTC Oct 14 is 6:30 p.m. PDT Oct 13. At 05:00 UTC Oct 14 it is still Oct 13 in Los Angeles.
    const trend = buildDailyIntake([{ created_at: "2026-10-14T01:30:00+00:00" }], {
      days: 3,
      now: new Date("2026-10-14T05:00:00Z"),
      timeZone: "America/Los_Angeles",
    });
    expect(trend.buckets).toEqual([
      { date: "2026-10-11", count: 0 },
      { date: "2026-10-12", count: 0 },
      { date: "2026-10-13", count: 1 },
    ]);
  });

  it("works far from UTC in both directions", () => {
    // 20:00 UTC Oct 13 is 5 a.m. Oct 14 in Tokyo; 08:00 UTC Oct 14 is 10 p.m. Oct 13 in Honolulu.
    const tokyo = buildDailyIntake([{ created_at: "2026-10-13T20:00:00Z" }], {
      days: 2,
      now: new Date("2026-10-13T21:00:00Z"),
      timeZone: "Asia/Tokyo",
    });
    expect(tokyo.buckets).toEqual([
      { date: "2026-10-13", count: 0 },
      { date: "2026-10-14", count: 1 },
    ]);
    const honolulu = buildDailyIntake([{ created_at: "2026-10-14T08:00:00Z" }], {
      days: 2,
      now: new Date("2026-10-14T09:00:00Z"),
      timeZone: "Pacific/Honolulu",
    });
    expect(honolulu.buckets).toEqual([
      { date: "2026-10-12", count: 0 },
      { date: "2026-10-13", count: 1 },
    ]);
  });

  it("keeps whole days across the autumn daylight saving change", () => {
    // Nov 1, 2026 is 25 hours long in Los Angeles. 07:30 UTC Nov 2 is 11:30 p.m. PST Nov 1.
    const trend = buildDailyIntake(
      [{ created_at: "2026-11-01T07:30:00Z" }, { created_at: "2026-11-02T07:30:00Z" }],
      { days: 3, now: new Date("2026-11-02T09:00:00Z"), timeZone: "America/Los_Angeles" }
    );
    expect(trend.buckets).toEqual([
      { date: "2026-10-31", count: 0 },
      { date: "2026-11-01", count: 2 },
      { date: "2026-11-02", count: 0 },
    ]);
  });
});

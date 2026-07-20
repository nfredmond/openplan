import { describe, expect, it } from "vitest";

import { buildDailyIntake } from "@/lib/engagement/participation-dashboard";

describe("buildDailyIntake", () => {
  const now = new Date("2026-07-19T12:00:00.000Z");

  it("buckets by UTC day within the trailing window and keeps empty days", () => {
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
});

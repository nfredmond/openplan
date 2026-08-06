import { describe, expect, it } from "vitest";
import {
  DEFAULT_SERVICE_DAY_GROUPING_PROFILE,
  EVERY_DAY_SEPARATELY,
  MONDAY_TO_FRIDAY_WORKWEEK,
  SERVICE_DAY_GROUPING_PROFILES,
  SUNDAY_TO_THURSDAY_WORKWEEK,
  formatServiceDaySeconds,
  groupServiceDays,
  serviceDayGroupingProfile,
} from "@/lib/gtfs/service-day-groups";
import { GTFS_SERVICE_DAY_NAMES, type GtfsServiceDayName, type GtfsServiceLevel } from "@/lib/gtfs/types";

/**
 * The rollup, which is the seam that keeps "weekday" out of the database.
 *
 * The database stores GTFS's seven day names. If it stored three, no deployment
 * anywhere could ever recover Friday from a Monday-to-Friday average, and a
 * Sunday-to-Thursday workweek would need a migration and a re-ingest of every
 * agency's feed.
 */

const HOUR = 3600;

function level(day: GtfsServiceDayName, overrides: Partial<GtfsServiceLevel> = {}): GtfsServiceLevel {
  return {
    serviceDay: day,
    representativeDate: "2026-08-10",
    tripsPerDay: 40,
    firstDepartureSeconds: 6 * HOUR,
    lastDepartureSeconds: 22 * HOUR,
    spanSeconds: 16 * HOUR,
    peakHour: 7,
    peakHourDepartures: 4,
    peakHeadwayMinutes: 15,
    peakHeadwayIsLowerBound: false,
    medianHeadwayMinutes: 20,
    medianHeadwayBasis: "hourly_average_over_span",
    servedHours: 16,
    spanHours: 17,
    frequentServiceTierMinutes: 15,
    derivationMethod: "scheduled",
    scheduledTripCount: 40,
    frequencyTripCount: 0,
    departuresBeyondBinRange: 0,
    ...overrides,
  };
}

describe("the grouping is a registry, not a constant", () => {
  it("ships more than one profile, so the seam is provably real", () => {
    // A registry with exactly one entry is indistinguishable from a hardcoded
    // value with a nicer name — and this repository has been burned by that.
    expect(SERVICE_DAY_GROUPING_PROFILES.length).toBeGreaterThan(1);
    expect(SERVICE_DAY_GROUPING_PROFILES).toContain(MONDAY_TO_FRIDAY_WORKWEEK);
    expect(SERVICE_DAY_GROUPING_PROFILES).toContain(SUNDAY_TO_THURSDAY_WORKWEEK);
  });

  it("defaults to the Monday-to-Friday workweek, and says that it is a DEFAULT", () => {
    expect(DEFAULT_SERVICE_DAY_GROUPING_PROFILE).toBe(MONDAY_TO_FRIDAY_WORKWEEK);
    expect(serviceDayGroupingProfile(null)).toBe(MONDAY_TO_FRIDAY_WORKWEEK);
    expect(serviceDayGroupingProfile("sunday_thursday_workweek")).toBe(SUNDAY_TO_THURSDAY_WORKWEEK);
    // An unknown key falls back rather than throwing — a stored profile key from
    // a future version must not break a page.
    expect(serviceDayGroupingProfile("no_such_profile")).toBe(MONDAY_TO_FRIDAY_WORKWEEK);
  });

  it("covers all seven days exactly once in every profile", () => {
    for (const profile of SERVICE_DAY_GROUPING_PROFILES) {
      const covered = profile.groups.flatMap((group) => [...group.days]);
      expect([...covered].sort()).toEqual([...GTFS_SERVICE_DAY_NAMES].sort());
    }
  });

  it("puts Sunday in the WORKWEEK for a Sunday-to-Thursday week, and Friday on its own", () => {
    // Applying the US profile to such an agency reports their busiest commute
    // day as "Sunday" and averages their quiet Friday into the weekday number.
    const workweek = SUNDAY_TO_THURSDAY_WORKWEEK.groups.find((group) => group.key === "workweek")!;
    expect(workweek.days).toContain("sunday");
    expect(workweek.days).not.toContain("friday");
    expect(SUNDAY_TO_THURSDAY_WORKWEEK.groups.some((group) => group.key === "friday")).toBe(true);
  });
});

describe("rolling seven days into three", () => {
  it("reports a REPRESENTATIVE day, never the sum of five", () => {
    const rows = (["monday", "tuesday", "wednesday", "thursday", "friday"] as const).map((day) =>
      level(day, { tripsPerDay: 40 }),
    );
    const [weekday] = groupServiceDays(rows);
    // 40, not 200. Summing would report a stop five times as frequent as it is.
    expect(weekday.tripsPerDay).toBe(40);
    expect(weekday.daysPresent).toHaveLength(5);
    expect(weekday.varies).toBe(false);
  });

  it("says so when the days inside a group are NOT alike", () => {
    // 60 trips Monday to Thursday and 8 on Friday is not a 49-trip stop, and a
    // planner scheduling Friday evening outreach needs to see the 8.
    const rows = [
      level("monday", { tripsPerDay: 60 }),
      level("tuesday", { tripsPerDay: 60 }),
      level("wednesday", { tripsPerDay: 60 }),
      level("thursday", { tripsPerDay: 60 }),
      level("friday", { tripsPerDay: 8 }),
    ];
    const [weekday] = groupServiceDays(rows);
    expect(weekday.varies).toBe(true);
    expect(weekday.minTripsPerDay).toBe(8);
    expect(weekday.maxTripsPerDay).toBe(60);
    expect(weekday.tripsPerDay).toBe(60);
  });

  it("names the days a group did not have a row for", () => {
    const rows = [level("monday"), level("wednesday")];
    const [weekday] = groupServiceDays(rows);
    expect(weekday.daysPresent).toEqual(["monday", "wednesday"]);
    expect(weekday.daysMissing).toEqual(["tuesday", "thursday", "friday"]);
  });

  it("takes the earliest first departure and the latest last departure", () => {
    const rows = [
      level("monday", { firstDepartureSeconds: 6 * HOUR, lastDepartureSeconds: 22 * HOUR }),
      level("friday", { firstDepartureSeconds: 5 * HOUR, lastDepartureSeconds: 25 * HOUR }),
    ];
    const [weekday] = groupServiceDays(rows);
    expect(weekday.firstDepartureSeconds).toBe(5 * HOUR);
    expect(weekday.lastDepartureSeconds).toBe(25 * HOUR);
  });

  it("reports the best AND worst frequent-service tier in the group", () => {
    // A stop that is 15-minute on Tuesday and 30-minute on Friday is honestly
    // described by both numbers and dishonestly by either alone.
    const rows = [
      level("monday", { frequentServiceTierMinutes: 15 }),
      level("tuesday", { frequentServiceTierMinutes: 15 }),
      level("wednesday", { frequentServiceTierMinutes: 15 }),
      level("thursday", { frequentServiceTierMinutes: 15 }),
      level("friday", { frequentServiceTierMinutes: 30 }),
    ];
    const [weekday] = groupServiceDays(rows);
    expect(weekday.bestFrequentServiceTierMinutes).toBe(15);
    expect(weekday.worstFrequentServiceTierMinutes).toBe(30);
  });

  it("withholds a worst-case tier when some day in the group meets none", () => {
    const rows = [
      level("monday", { frequentServiceTierMinutes: 15 }),
      level("friday", { frequentServiceTierMinutes: null }),
    ];
    const [weekday] = groupServiceDays(rows);
    expect(weekday.bestFrequentServiceTierMinutes).toBe(15);
    // Not 15: one of the days meets no tier at all, so "every day is at least
    // 15-minute" is false and must not be implied.
    expect(weekday.worstFrequentServiceTierMinutes).toBeNull();
  });

  it("collects the peak hours the days actually had", () => {
    const rows = [
      level("monday", { peakHour: 7 }),
      level("tuesday", { peakHour: 7 }),
      level("friday", { peakHour: 16 }),
    ];
    const [weekday] = groupServiceDays(rows);
    expect(weekday.peakHours).toEqual([7, 16]);
  });

  it("returns empty groups rather than nothing when a stop has no rows", () => {
    const groups = groupServiceDays([]);
    expect(groups).toHaveLength(3);
    for (const group of groups) {
      expect(group.tripsPerDay).toBeNull();
      expect(group.daysPresent).toEqual([]);
      expect(group.varies).toBe(false);
    }
  });

  it("regroups the SAME rows differently under a different profile", () => {
    // The whole point of storing seven: no re-ingest, no migration.
    const rows = GTFS_SERVICE_DAY_NAMES.map((day) =>
      level(day, { tripsPerDay: day === "friday" ? 5 : day === "saturday" ? 10 : 50 }),
    );

    const us = groupServiceDays(rows, MONDAY_TO_FRIDAY_WORKWEEK);
    expect(us[0].group.key).toBe("weekday");
    expect(us[0].tripsPerDay).toBe(50);
    expect(us[0].varies).toBe(true); // Friday's 5 is hidden inside "weekday"

    const gulf = groupServiceDays(rows, SUNDAY_TO_THURSDAY_WORKWEEK);
    expect(gulf[0].group.key).toBe("workweek");
    expect(gulf[0].tripsPerDay).toBe(50);
    expect(gulf[0].varies).toBe(false); // the quiet Friday is its own line
    expect(gulf[1].group.key).toBe("friday");
    expect(gulf[1].tripsPerDay).toBe(5);

    const separate = groupServiceDays(rows, EVERY_DAY_SEPARATELY);
    expect(separate).toHaveLength(7);
    expect(separate.find((group) => group.group.key === "friday")!.tripsPerDay).toBe(5);
  });
});

describe("formatting a service-day time", () => {
  it("keeps an hour past 24 rather than wrapping it", () => {
    expect(formatServiceDaySeconds(5 * HOUR + 300)).toBe("05:05");
    expect(formatServiceDaySeconds(25 * HOUR + 600)).toBe("25:10");
    expect(formatServiceDaySeconds(null)).toBe("—");
  });
});

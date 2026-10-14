import { describe, expect, it, vi } from "vitest";

import {
  calendarDayOf,
  dateTimeInputOf,
  instantFromWallClock,
  isTimestampPast,
  latestTodayAnywhere,
  loadWorkspaceCalendar,
  resolveWorkspaceTimeZone,
  singleTimeZoneForCountry,
  todayIn,
  timeZoneInputLabel,
  todayInWorkspace,
  wallClockTimeOf,
  WORKSPACE_CALENDAR_COLUMNS,
} from "@/lib/time/workspace-calendar";

/**
 * The workspace calendar (KI-2026-10-12-016). Servers run in UTC, and the UTC
 * date turns over at 5 p.m. Pacific in summer and 4 p.m. in winter. Every
 * expected value below was worked out by hand from the zone's offset on that
 * date, not read back from the code.
 */

const LA = "America/Los_Angeles";

describe("todayIn", () => {
  it("turns over at local midnight, not at 5 p.m. Pacific", () => {
    // 00:00 UTC Oct 13 is 5 p.m. PDT Oct 12.
    expect(todayIn(LA, new Date("2026-10-13T00:00:00Z"))).toBe("2026-10-12");
    expect(todayIn("UTC", new Date("2026-10-13T00:00:00Z"))).toBe("2026-10-13");
    // 06:59 UTC is 11:59 p.m. PDT; 07:00 UTC is midnight.
    expect(todayIn(LA, new Date("2026-10-13T06:59:59Z"))).toBe("2026-10-12");
    expect(todayIn(LA, new Date("2026-10-13T07:00:00Z"))).toBe("2026-10-13");
  });

  it("moves local midnight with daylight saving time in spring", () => {
    // Mar 8, 2026: PST (UTC-8) until 2 a.m., then PDT (UTC-7).
    // Midnight before the change is 08:00 UTC; the next midnight is 07:00 UTC.
    expect(todayIn(LA, new Date("2026-03-08T07:59:00Z"))).toBe("2026-03-07");
    expect(todayIn(LA, new Date("2026-03-08T08:00:00Z"))).toBe("2026-03-08");
    // 07:30 UTC Mar 9 is 12:30 a.m. PDT Mar 9. A fixed UTC-8 offset says Mar 8.
    expect(todayIn(LA, new Date("2026-03-09T07:30:00Z"))).toBe("2026-03-09");
  });

  it("moves local midnight with daylight saving time in autumn", () => {
    // Nov 1, 2026: PDT ends at 2 a.m. (09:00 UTC). 07:30 UTC Nov 2 is
    // 11:30 p.m. PST Nov 1. A fixed UTC-7 offset says Nov 2.
    expect(todayIn(LA, new Date("2026-11-02T07:30:00Z"))).toBe("2026-11-01");
    expect(todayIn(LA, new Date("2026-11-02T08:00:00Z"))).toBe("2026-11-02");
  });

  it("follows a southern-hemisphere change in the other direction", () => {
    // Oct 4, 2026: Sydney moves from UTC+10 to UTC+11 at 2 a.m. local.
    // 13:30 UTC Oct 4 is 12:30 a.m. Oct 5 at UTC+11 (11:30 p.m. Oct 4 at +10).
    expect(todayIn("Australia/Sydney", new Date("2026-10-04T13:30:00Z"))).toBe("2026-10-05");
  });

  it("throws on a name that is not a zone rather than guessing one", () => {
    expect(() => todayIn("Not/AZone", new Date("2026-10-13T00:00:00Z"))).toThrow(RangeError);
  });
});

describe("calendarDayOf and wallClockTimeOf", () => {
  it("never shifts a date-only value into a zone", () => {
    // Read as an instant, 2026-10-11 is 5 p.m. Oct 10 in Los Angeles.
    expect(calendarDayOf("2026-10-11", LA)).toBe("2026-10-11");
    expect(wallClockTimeOf("2026-10-11", LA)).toBeNull();
  });

  it("reads an instant on the zone's calendar and clock", () => {
    expect(calendarDayOf("2026-10-01T06:59:00Z", LA)).toBe("2026-09-30");
    expect(wallClockTimeOf("2026-10-01T06:59:00Z", LA)).toBe("23:59");
    expect(calendarDayOf("2026-10-01T06:59:00+00:00", "UTC")).toBe("2026-10-01");
    expect(wallClockTimeOf("2026-10-11T00:00:00-07:00", "UTC")).toBe("07:00");
  });

  it("refuses a timestamp with no offset and an unreadable value", () => {
    expect(calendarDayOf("2026-10-01T06:59:00", LA)).toBeNull();
    expect(calendarDayOf("not a date", LA)).toBeNull();
    expect(calendarDayOf(null, LA)).toBeNull();
  });
});

describe("datetime-local inputs on the workspace's clock", () => {
  it("reads a late-evening Pacific close as that evening, not the next UTC day", () => {
    // 01:00 UTC Oct 21 is 6 p.m. PDT Oct 20. Sliced to 16 characters it read 2026-10-21T01:00.
    expect(dateTimeInputOf("2026-10-21T01:00:00+00:00", LA)).toBe("2026-10-20T18:00");
    expect(instantFromWallClock("2026-10-20T18:00", LA)).toBe("2026-10-21T01:00:00.000Z");
  });

  it("works far from UTC in both directions", () => {
    // Honolulu is UTC-10 all year; Tokyo is UTC+9 all year.
    expect(instantFromWallClock("2026-10-20T20:00", "Pacific/Honolulu")).toBe("2026-10-21T06:00:00.000Z");
    expect(dateTimeInputOf("2026-10-21T06:00:00Z", "Pacific/Honolulu")).toBe("2026-10-20T20:00");
    expect(instantFromWallClock("2026-10-21T08:00", "Asia/Tokyo")).toBe("2026-10-20T23:00:00.000Z");
    expect(dateTimeInputOf("2026-10-20T23:00:00Z", "Asia/Tokyo")).toBe("2026-10-21T08:00");
  });

  it("uses the offset in force on that date, across daylight saving time", () => {
    // Mar 8, 2026: PST (UTC-8) until 2 a.m., PDT (UTC-7) after.
    expect(instantFromWallClock("2026-03-08T01:59", LA)).toBe("2026-03-08T09:59:00.000Z");
    expect(instantFromWallClock("2026-03-08T03:00", LA)).toBe("2026-03-08T10:00:00.000Z");
    // 2:30 a.m. does not exist that night; it moves forward by the gap to 3:30 PDT.
    expect(instantFromWallClock("2026-03-08T02:30", LA)).toBe("2026-03-08T10:30:00.000Z");
    // Nov 1, 2026: 1:30 a.m. happens twice; the earlier (PDT) one is meant.
    expect(instantFromWallClock("2026-11-01T01:30", LA)).toBe("2026-11-01T08:30:00.000Z");
    expect(instantFromWallClock("2026-11-02T01:30", LA)).toBe("2026-11-02T09:30:00.000Z");
    // Sydney springs forward on Oct 4, 2026 (UTC+10 to UTC+11).
    expect(instantFromWallClock("2026-10-03T12:00", "Australia/Sydney")).toBe("2026-10-03T02:00:00.000Z");
    expect(instantFromWallClock("2026-10-05T12:00", "Australia/Sydney")).toBe("2026-10-05T01:00:00.000Z");
  });

  it("is UTC when the zone is UTC", () => {
    expect(instantFromWallClock("2026-10-20T18:00", "UTC")).toBe("2026-10-20T18:00:00.000Z");
    expect(dateTimeInputOf("2026-10-20T18:00:00Z", "UTC")).toBe("2026-10-20T18:00");
  });

  it("refuses what is not a real date and time, and shows nothing for what it cannot read", () => {
    expect(instantFromWallClock("2026-02-30T10:00", LA)).toBeNull();
    expect(instantFromWallClock("2026-10-20T24:00", LA)).toBeNull();
    expect(instantFromWallClock("2026-10-20", LA)).toBeNull();
    expect(instantFromWallClock("", LA)).toBeNull();
    expect(instantFromWallClock("2026-10-20T18:00", "Not/AZone")).toBeNull();
    expect(dateTimeInputOf("2026-10-20", LA)).toBe("");
    expect(dateTimeInputOf("2026-10-20T18:00:00", LA)).toBe("");
    expect(dateTimeInputOf(null, LA)).toBe("");
  });

  it("names the zone, or says UTC out loud when the workspace has none", () => {
    expect(timeZoneInputLabel({ timeZone: LA, source: "workspace_setting" })).toBe(LA);
    expect(timeZoneInputLabel({ timeZone: "Asia/Tokyo", source: "home_country" })).toBe("Asia/Tokyo");
    expect(timeZoneInputLabel({ timeZone: "UTC", source: "utc_fallback" })).toBe("UTC, no workspace time zone set");
    expect(timeZoneInputLabel(undefined)).toBe("UTC, no workspace time zone set");
  });
});

describe("latestTodayAnywhere", () => {
  it("is the date at UTC+14, which turns over at 10:00 UTC", () => {
    expect(latestTodayAnywhere(new Date("2026-10-14T09:59:59Z"))).toBe("2026-10-14");
    expect(latestTodayAnywhere(new Date("2026-10-14T10:00:00Z"))).toBe("2026-10-15");
  });
});

describe("isTimestampPast", () => {
  const CLOSE = "2026-10-11T09:00:00Z";

  it("compares a 09:00 UTC close as an instant", () => {
    expect(isTimestampPast(CLOSE, new Date("2026-10-11T08:59:59Z"))).toBe(false);
    expect(isTimestampPast(CLOSE, new Date("2026-10-11T09:00:00Z"))).toBe(true);
    // Sliced to its day, this call read as open until midnight UTC.
    expect(isTimestampPast(CLOSE, new Date("2026-10-11T09:30:00Z"))).toBe(true);
    expect(isTimestampPast("2026-10-11T09:00:00+00:00", new Date("2026-10-11T09:30:00Z"))).toBe(true);
    expect(isTimestampPast("2026-10-11T02:00:00-07:00", new Date("2026-10-11T08:59:00Z"))).toBe(false);
  });

  it("keeps the end-everywhere rule for a date-only deadline", () => {
    // Oct 11 ends everywhere at 12:00 UTC Oct 12 (the end of the day at UTC-12).
    expect(isTimestampPast("2026-10-11", new Date("2026-10-12T11:59:00Z"))).toBe(false);
    expect(isTimestampPast("2026-10-11", new Date("2026-10-12T12:00:00Z"))).toBe(true);
  });

  it("does not call a missing, unreadable or offset-less value past", () => {
    const later = new Date("2030-01-01T00:00:00Z");
    expect(isTimestampPast(null, later)).toBe(false);
    expect(isTimestampPast("", later)).toBe(false);
    expect(isTimestampPast("closing soon", later)).toBe(false);
    expect(isTimestampPast("2026-10-11T09:00:00", later)).toBe(false);
  });
});

describe("resolveWorkspaceTimeZone", () => {
  it("uses the saved setting first", () => {
    expect(resolveWorkspaceTimeZone({ time_zone: LA, home_country_code: "JP" })).toEqual({
      timeZone: LA,
      source: "workspace_setting",
    });
  });

  it("ignores a saved value Intl rejects", () => {
    expect(resolveWorkspaceTimeZone({ time_zone: "Mars/Olympus_Mons", home_country_code: null })).toEqual({
      timeZone: "UTC",
      source: "utc_fallback",
    });
  });

  it("never derives a zone for a country with several", () => {
    expect(singleTimeZoneForCountry("US")).toBeNull();
    expect(resolveWorkspaceTimeZone({ time_zone: null, home_country_code: "US" })).toEqual({
      timeZone: "UTC",
      source: "utc_fallback",
    });
  });

  it("uses the one CLDR zone of a single-zone country when the runtime lists it", () => {
    const supported = typeof (new Intl.Locale("und-JP") as Intl.Locale & { getTimeZones?: unknown }).getTimeZones === "function";
    const expected = supported
      ? { timeZone: "Asia/Tokyo", source: "home_country" }
      : { timeZone: "UTC", source: "utc_fallback" };
    expect(resolveWorkspaceTimeZone({ time_zone: null, home_country_code: "JP" })).toEqual(expected);
  });

  it("answers UTC, labelled, for an empty row", () => {
    expect(resolveWorkspaceTimeZone(null)).toEqual({ timeZone: "UTC", source: "utc_fallback" });
    expect(singleTimeZoneForCountry("not a code")).toBeNull();
  });
});

describe("loadWorkspaceCalendar", () => {
  function reader(result: { data: unknown; error: { message: string } | null } | Error) {
    const maybeSingle = vi.fn(async () => {
      if (result instanceof Error) throw result;
      return result;
    });
    const eq = vi.fn((column: string, value: string) => {
      void column;
      void value;
      return { maybeSingle };
    });
    const select = vi.fn((columns: string) => {
      void columns;
      return { eq };
    });
    const from = vi.fn((table: string) => {
      void table;
      return { select };
    });
    return { client: { from }, from, select, eq };
  }

  it("asks for the calendar columns of the one workspace", async () => {
    const fake = reader({ data: { time_zone: LA, home_country_code: "US" }, error: null });
    const calendar = await loadWorkspaceCalendar(fake.client, "workspace-1");
    expect(fake.from).toHaveBeenCalledWith("workspaces");
    expect(fake.select).toHaveBeenCalledWith(WORKSPACE_CALENDAR_COLUMNS);
    expect(WORKSPACE_CALENDAR_COLUMNS).toBe("time_zone, home_country_code");
    expect(fake.eq).toHaveBeenCalledWith("id", "workspace-1");
    expect(calendar).toEqual({
      timeZone: LA,
      source: "workspace_setting",
      setting: LA,
      fallback: { timeZone: "UTC", source: "utc_fallback" },
      readError: null,
    });
  });

  it("answers UTC with the reason when the column does not exist yet", async () => {
    const fake = reader({ data: null, error: { message: "column workspaces.time_zone does not exist" } });
    const calendar = await loadWorkspaceCalendar(fake.client, "workspace-1");
    expect(calendar.timeZone).toBe("UTC");
    expect(calendar.source).toBe("utc_fallback");
    expect(calendar.readError).toContain("does not exist");
  });

  it("answers UTC when the client throws", async () => {
    const fake = reader(new Error("network down"));
    const calendar = await loadWorkspaceCalendar(fake.client, "workspace-1");
    expect(calendar).toMatchObject({ timeZone: "UTC", source: "utc_fallback", readError: "network down" });
  });

  it("dates today in the workspace's zone", async () => {
    const fake = reader({ data: { time_zone: LA, home_country_code: null }, error: null });
    const result = await todayInWorkspace(fake.client, "workspace-1", new Date("2026-10-13T01:00:00Z"));
    expect(result.today).toBe("2026-10-12");
  });
});

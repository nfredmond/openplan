/**
 * THE WORKSPACE CALENDAR: which calendar day it is for a workspace, and
 * whether a recorded close time has passed.
 *
 * Servers run in UTC. `new Date().toISOString().slice(0, 10)` is the UTC date,
 * which turns over at 5 p.m. Pacific, so a claim submitted that evening was
 * stamped the next day and a deadline due that day read as passed
 * (KI-2026-10-12-016). Every route that stamps or compares a planner's
 * calendar day asks this module instead, and
 * `src/test/calendar-day-slices-guard.test.ts` refuses new slices.
 *
 * WHERE THE ZONE COMES FROM, in order, and the caller is told which one:
 *
 *   1. `workspace_setting`: the IANA zone an owner or admin chose
 *      (`workspaces.time_zone`, 20261017000007).
 *   2. `home_country`: the workspace's recorded home country, only when the
 *      Unicode CLDR data built into `Intl` lists exactly one zone for it.
 *      A country with several zones (the United States, Canada, Mexico,
 *      Australia, Brazil and others) yields nothing; no zone is guessed from a
 *      subdivision or a bounding box.
 *   3. `utc_fallback`: UTC, said out loud so a caller can label it.
 *
 * Nothing here names a place. Each zone is either the workspace's own setting
 * or CLDR's answer for the workspace's own country.
 *
 * A date-only value (`YYYY-MM-DD`) is already a calendar day and is never
 * shifted into a zone. Whether a date-only deadline has passed stays the
 * `isDeadlinePast` rule: only once that day has ended everywhere.
 */

import { calendarDateInTimeZone, isDeadlinePast, validTimeZone } from "@/lib/work/deadlines";

export const UTC_TIME_ZONE = "UTC";

/** The `workspaces` columns the calendar reads. */
export const WORKSPACE_CALENDAR_COLUMNS = "time_zone, home_country_code";

export type WorkspaceTimeZoneSource = "workspace_setting" | "home_country" | "utc_fallback";

export type WorkspaceCalendar = {
  /** A canonical IANA name `Intl` accepts. */
  timeZone: string;
  source: WorkspaceTimeZoneSource;
};

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
// An instant names its offset: `Z`, `+00:00`, `-0700` or `+05`.
const EXPLICIT_OFFSET = /(?:Z|[+-]\d{2}(?::?\d{2})?)$/i;

/** Today's calendar date, `YYYY-MM-DD`, in an IANA zone. Throws a RangeError on a zone `Intl` rejects. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  return calendarDateInTimeZone(now, timeZone);
}

/**
 * The calendar day a stored value falls on in a zone.
 *
 * A date-only value is returned unchanged: `2026-10-11` read as an instant is
 * midnight UTC, which is the evening of the 10th in the Americas. An instant
 * without an explicit offset, or an unparseable value, is null.
 */
export function calendarDayOf(value: string | null | undefined, timeZone: string): string | null {
  if (!value) return null;
  const text = String(value).trim();
  if (DATE_ONLY.test(text)) return text;
  if (!EXPLICIT_OFFSET.test(text)) return null;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return calendarDateInTimeZone(parsed, timeZone);
}

/** The wall-clock time, `HH:MM` on a 24-hour clock, of an instant in a zone. Null for a date-only or unreadable value. */
export function wallClockTimeOf(value: string | null | undefined, timeZone: string): string | null {
  if (!value) return null;
  const text = String(value).trim();
  if (DATE_ONLY.test(text) || !EXPLICIT_OFFSET.test(text)) return null;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(parsed);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("hour")}:${part("minute")}`;
}

/**
 * The zone that reaches each calendar day first (UTC+14). POSIX `Etc/` names
 * invert the sign, so `Etc/GMT-14` is fourteen hours ahead of UTC.
 */
export const EARLIEST_TIME_ZONE = "Etc/GMT-14";

/**
 * The latest calendar date any zone has reached. A read that spans workspaces
 * (the reminder sweep) bounds its window with this, then decides each
 * workspace's own window on that workspace's calendar.
 */
export function latestTodayAnywhere(now: Date = new Date()): string {
  return todayIn(EARLIEST_TIME_ZONE, now);
}

// A `datetime-local` value: wall-clock date and time, no zone.
const WALL_CLOCK = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;
const DAY_MS = 86_400_000;

/** How far a zone's wall clock is ahead of UTC at an instant, in milliseconds. */
function zoneOffsetMs(instantMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(instantMs));
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((entry) => entry.type === type)?.value);
  const wallAsUtc = Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"), part("second"));
  const wholeSecond = instantMs - (((instantMs % 1000) + 1000) % 1000);
  return wallAsUtc - wholeSecond;
}

/**
 * An instant as a `datetime-local` input wants it (`YYYY-MM-DDTHH:MM`), on a
 * zone's calendar and clock. Empty for a missing, date-only, offset-less or
 * unreadable value, so the input shows nothing rather than a guess.
 */
export function dateTimeInputOf(value: string | null | undefined, timeZone: string): string {
  const time = wallClockTimeOf(value, timeZone);
  const day = calendarDayOf(value, timeZone);
  return day && time ? `${day}T${time}` : "";
}

/**
 * The UTC instant (ISO 8601) of a wall-clock date and time in a zone: what a
 * `datetime-local` input typed in the workspace's zone means.
 *
 * Daylight saving time is resolved the way `Temporal`'s "compatible" rule
 * does. A time that occurs twice (the autumn hour) is the earlier one; a time
 * that never occurs (the spring gap) moves forward by the gap, so 2:30 a.m. on
 * the spring-forward night is 3:30 a.m. Null for a value that is not a real
 * date and time, or a zone `Intl` rejects.
 */
export function instantFromWallClock(wallClock: string | null | undefined, timeZone: string): string | null {
  const match = WALL_CLOCK.exec(String(wallClock ?? "").trim());
  const zone = validTimeZone(timeZone);
  if (!match || !zone) return null;
  const [year, month, day, hour, minute, second] = match.slice(1).map((field) => Number(field ?? 0));
  const wall = Date.UTC(year, month - 1, day, hour, minute, second);
  const check = new Date(wall);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day ||
    check.getUTCHours() !== hour ||
    check.getUTCMinutes() !== minute
  ) {
    return null;
  }
  const before = zoneOffsetMs(wall - DAY_MS, zone);
  const after = zoneOffsetMs(wall + DAY_MS, zone);
  const matching = [...new Set([wall - before, wall - after])]
    .filter((instant) => instant + zoneOffsetMs(instant, zone) === wall)
    .sort((left, right) => left - right);
  return new Date(matching[0] ?? wall - before).toISOString();
}

/**
 * How a date or time input names its zone: the zone itself, or UTC said out
 * loud when the workspace has none.
 */
export function timeZoneInputLabel(calendar: WorkspaceCalendar | null | undefined): string {
  if (!calendar || calendar.source === "utc_fallback") return "UTC, no workspace time zone set";
  return calendar.timeZone;
}

/** Whether a value is a calendar day (`YYYY-MM-DD`) rather than an instant. */
export function isDateOnly(value: string | null | undefined): boolean {
  return typeof value === "string" && DATE_ONLY.test(value.trim());
}

/**
 * Whether a recorded TIMESTAMPTZ (a close time, a decision deadline) has passed.
 *
 * An instant is compared as an instant: a call that closed at 09:00 UTC has
 * closed at 09:00 UTC, not at the end of that day anywhere. A date-only value
 * keeps the `isDeadlinePast` rule (past once the day has ended everywhere).
 * A missing value, an unparseable one, or a timestamp with no offset is not
 * past: a record with no readable deadline has not missed one.
 */
export function isTimestampPast(isoInstant: string | null | undefined, now: Date): boolean {
  if (!isoInstant) return false;
  const text = String(isoInstant).trim();
  if (DATE_ONLY.test(text)) return isDeadlinePast(text, now);
  if (!EXPLICIT_OFFSET.test(text)) return false;
  const parsed = new Date(text).getTime();
  if (Number.isNaN(parsed)) return false;
  return parsed <= now.getTime();
}

type IntlLocaleWithTimeZones = Intl.Locale & { getTimeZones?: () => string[] | undefined };

/**
 * The zone for a home country, only when CLDR lists exactly one. Null for a
 * multi-zone country, an unknown code, or a runtime without
 * `Intl.Locale.prototype.getTimeZones`.
 */
export function singleTimeZoneForCountry(countryCode: unknown): string | null {
  if (typeof countryCode !== "string" || !/^[A-Za-z]{2}$/.test(countryCode)) return null;
  try {
    const locale = new Intl.Locale(`und-${countryCode.toUpperCase()}`) as IntlLocaleWithTimeZones;
    if (typeof locale.getTimeZones !== "function") return null;
    const zones = locale.getTimeZones();
    return Array.isArray(zones) && zones.length === 1 ? validTimeZone(zones[0]) : null;
  } catch {
    return null;
  }
}

/** The workspace's zone from its row, and which rule chose it. */
export function resolveWorkspaceTimeZone(
  row: { time_zone?: unknown; home_country_code?: unknown } | null | undefined
): WorkspaceCalendar {
  const stated = typeof row?.time_zone === "string" ? validTimeZone(row.time_zone) : null;
  if (stated) return { timeZone: stated, source: "workspace_setting" };
  const fromCountry = singleTimeZoneForCountry(row?.home_country_code);
  if (fromCountry) return { timeZone: fromCountry, source: "home_country" };
  return { timeZone: UTC_TIME_ZONE, source: "utc_fallback" };
}

// `PromiseLike`, not `Promise`: a PostgrestBuilder is thenable, not a Promise.
type WorkspaceRowQuery = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (
        column: string,
        value: string
      ) => {
        maybeSingle: () => PromiseLike<{ data: unknown; error: { message: string } | null }>;
      };
    };
  };
};

/**
 * Any Supabase client. Typed loosely on purpose: comparing the real client's
 * generic `from` with a narrow structural type makes TypeScript give up
 * (TS2589) at every call site. The one query is typed inside.
 */
export type WorkspaceCalendarReader = { from: (table: string) => unknown };

export type LoadedWorkspaceCalendar = WorkspaceCalendar & {
  /** The saved `time_zone` exactly as stored, or null when none is saved or the read failed. */
  setting: string | null;
  /** What applies when no zone is saved: the home-country zone or UTC. */
  fallback: WorkspaceCalendar;
  /** The read's error, when the row could not be read. The calendar is then UTC. */
  readError: string | null;
};

const UTC_CALENDAR: WorkspaceCalendar = { timeZone: UTC_TIME_ZONE, source: "utc_fallback" };

/**
 * Read a workspace's calendar. Never throws and never blocks the caller's
 * write: a failed read (including a database where 20261017000007 is not yet
 * applied, so `time_zone` does not exist) answers UTC with the error attached,
 * which is what every caller did before this module existed.
 */
export async function loadWorkspaceCalendar(
  supabase: WorkspaceCalendarReader,
  workspaceId: string
): Promise<LoadedWorkspaceCalendar> {
  try {
    const { data, error } = await (supabase as WorkspaceRowQuery)
      .from("workspaces")
      .select(WORKSPACE_CALENDAR_COLUMNS)
      .eq("id", workspaceId)
      .maybeSingle();
    if (error) return { ...UTC_CALENDAR, setting: null, fallback: UTC_CALENDAR, readError: error.message };
    const row = (data ?? null) as { time_zone?: unknown; home_country_code?: unknown } | null;
    return {
      ...resolveWorkspaceTimeZone(row),
      setting: typeof row?.time_zone === "string" && row.time_zone ? row.time_zone : null,
      fallback: resolveWorkspaceTimeZone({ home_country_code: row?.home_country_code }),
      readError: null,
    };
  } catch (error) {
    return {
      ...UTC_CALENDAR,
      setting: null,
      fallback: UTC_CALENDAR,
      readError: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Today in the workspace's zone, with the zone and its source. */
export async function todayInWorkspace(
  supabase: WorkspaceCalendarReader,
  workspaceId: string,
  now: Date = new Date()
): Promise<LoadedWorkspaceCalendar & { today: string }> {
  const calendar = await loadWorkspaceCalendar(supabase, workspaceId);
  return { ...calendar, today: todayIn(calendar.timeZone, now) };
}

/** Today in the browser's own zone. For client code stamping a date the planner submits. */
export function browserToday(now: Date = new Date()): string {
  const zone = validTimeZone(Intl.DateTimeFormat("en-US").resolvedOptions().timeZone) ?? UTC_TIME_ZONE;
  return todayIn(zone, now);
}

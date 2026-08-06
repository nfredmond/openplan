/**
 * ROLLING SEVEN GTFS DAY NAMES UP INTO THE GROUPS A PLANNER ACTUALLY REPORTS —
 * AT READ TIME, NEVER AT WRITE TIME.
 *
 * ================================================== WHY THE DATABASE STORES 7
 *
 * The derived rows are stored under GTFS's own seven day names. That is more
 * rows than "weekday / Saturday / Sunday" needs, and storing the three would be
 * smaller and faster. It would also be a mistake that costs a migration to
 * undo, because MONDAY-TO-FRIDAY IS A CONVENTION, NOT A FACT:
 *
 *   - The Gulf states and much of the Middle East run a Sunday-to-Thursday
 *     workweek; Friday is their weekend day and Sunday is an ordinary commute
 *     day with peak service.
 *   - Israel's workweek is Sunday to Thursday, with Friday a short day.
 *   - Nepal's weekend is Saturday alone.
 *   - Even inside the US, an agency's Friday service is often materially
 *     different from its Tuesday service, and a planner analysing a Friday
 *     evening corridor needs the Friday row rather than a five-day average that
 *     buried it.
 *
 * OpenPlan's stated scope is the US today and WORLDWIDE eventually (product
 * non-negotiable #0). A schema that has already collapsed Monday into "weekday"
 * cannot un-collapse it: the underlying counts are gone. A schema that keeps the
 * seven can be regrouped forever, by anyone, without touching the data.
 *
 * ================================================= SO THE GROUPING LIVES HERE
 *
 * THIS FILE IS THE SEAM. Adding a country whose week is shaped differently means
 * adding a profile to the registry below — a data change in one file — and never
 * a migration, never a backfill, and never a re-ingest of every agency's feed.
 *
 * The second profile exists to PROVE the seam is real rather than to serve a
 * user today. A registry with exactly one entry is indistinguishable from a
 * hardcoded value that has been given a nicer name, and this repository has
 * already been burned by exactly that (see the registry default-flip hazard: two
 * defect classes were invisible while only one entry existed).
 */

import { GTFS_SERVICE_DAY_NAMES, type GtfsServiceDayName, type GtfsServiceLevel } from "./types";

/** A group of GTFS day names reported as one line. */
export type ServiceDayGroup = {
  /** Stable identifier. Stored nowhere; used as a React key and a test anchor. */
  key: string;
  /** What a planner reads. */
  label: string;
  /** The GTFS day names rolled into it, in week order. */
  days: readonly GtfsServiceDayName[];
};

/** A named way of grouping the week. */
export type ServiceDayGroupingProfile = {
  key: string;
  label: string;
  /** Where this workweek shape applies, for whoever is choosing a profile. */
  appliesTo: string;
  groups: readonly ServiceDayGroup[];
};

/**
 * MONDAY-TO-FRIDAY WEEKDAY. The United States, Canada, Europe, and most of the
 * Americas — and the default, because the US is the current scope.
 */
export const MONDAY_TO_FRIDAY_WORKWEEK: ServiceDayGroupingProfile = {
  key: "monday_friday_workweek",
  label: "Weekday / Saturday / Sunday",
  appliesTo: "United States, Canada, Europe, and anywhere with a Monday-to-Friday workweek.",
  groups: [
    { key: "weekday", label: "Weekday", days: ["monday", "tuesday", "wednesday", "thursday", "friday"] },
    { key: "saturday", label: "Saturday", days: ["saturday"] },
    { key: "sunday", label: "Sunday", days: ["sunday"] },
  ],
};

/**
 * SUNDAY-TO-THURSDAY WORKWEEK. Israel, and with local variation much of the
 * Gulf. Friday is the weekend day and Sunday carries full commute service.
 *
 * Applying the US profile to such an agency reports their busiest commute day
 * as "Sunday" — the line a planner reads as leisure service — and averages
 * their quiet Friday into the weekday number. Both errors are silent.
 */
export const SUNDAY_TO_THURSDAY_WORKWEEK: ServiceDayGroupingProfile = {
  key: "sunday_thursday_workweek",
  label: "Workweek / Friday / Saturday",
  appliesTo: "Israel and, with local variation, much of the Gulf.",
  groups: [
    { key: "workweek", label: "Workweek", days: ["sunday", "monday", "tuesday", "wednesday", "thursday"] },
    { key: "friday", label: "Friday", days: ["friday"] },
    { key: "saturday", label: "Saturday", days: ["saturday"] },
  ],
};

/**
 * EVERY DAY ON ITS OWN. Not a workweek shape but an analysis mode — a planner
 * comparing Friday evening service to Tuesday evening service needs this, and
 * having it here means the UI never has to bypass the grouping to get at the
 * stored rows.
 */
export const EVERY_DAY_SEPARATELY: ServiceDayGroupingProfile = {
  key: "every_day",
  label: "Every day separately",
  appliesTo: "Any agency, when the differences between days are the subject.",
  groups: GTFS_SERVICE_DAY_NAMES.map((day) => ({
    key: day,
    label: day.charAt(0).toUpperCase() + day.slice(1),
    days: [day] as const,
  })),
};

export const SERVICE_DAY_GROUPING_PROFILES: readonly ServiceDayGroupingProfile[] = [
  MONDAY_TO_FRIDAY_WORKWEEK,
  SUNDAY_TO_THURSDAY_WORKWEEK,
  EVERY_DAY_SEPARATELY,
];

/**
 * The profile used when nobody has chosen one.
 *
 * A DEFAULT, NOT A CONSTANT. It is the right answer for the current scope and
 * the wrong answer for a Gulf agency, and naming it `DEFAULT` is what keeps that
 * distinction visible at every call site.
 */
export const DEFAULT_SERVICE_DAY_GROUPING_PROFILE = MONDAY_TO_FRIDAY_WORKWEEK;

export function serviceDayGroupingProfile(key: string | null | undefined): ServiceDayGroupingProfile {
  if (!key) return DEFAULT_SERVICE_DAY_GROUPING_PROFILE;
  return (
    SERVICE_DAY_GROUPING_PROFILES.find((profile) => profile.key === key) ??
    DEFAULT_SERVICE_DAY_GROUPING_PROFILE
  );
}

/**
 * One group's summary, rolled up from the day rows inside it.
 *
 * `varies` and the min/max are not decoration. "Weekday: 42 trips" is a
 * SUMMARY, and a summary that cannot say it is hiding a range is a summary that
 * misleads — a stop with 60 trips Monday to Thursday and 8 on Friday is not a
 * 49-trip stop, and a planner scheduling Friday evening outreach needs to see
 * the 8.
 */
export type ServiceDayGroupSummary = {
  group: ServiceDayGroup;
  /** Day rows that were present. A group with none yields `daysPresent: []`. */
  daysPresent: GtfsServiceDayName[];
  /** Day names in the group that had no row at all — no service, or not derived. */
  daysMissing: GtfsServiceDayName[];
  /**
   * The representative day: trips per day is the MEDIAN across the days
   * present, not the sum. A weekday group is one representative DAY of service,
   * and summing five days would report a five-times-too-frequent stop.
   */
  tripsPerDay: number | null;
  minTripsPerDay: number | null;
  maxTripsPerDay: number | null;
  /** True when the days in this group do not all have the same trip count. */
  varies: boolean;
  /** Earliest first departure and latest last departure across the group. */
  firstDepartureSeconds: number | null;
  lastDepartureSeconds: number | null;
  /** Median across the days present; null when no day could determine one. */
  medianPeakHeadwayMinutes: number | null;
  /** The tightest tier met on ANY day in the group, and on EVERY day. */
  bestFrequentServiceTierMinutes: number | null;
  worstFrequentServiceTierMinutes: number | null;
  /** Peak hours observed across the group, ascending. Usually one value. */
  peakHours: number[];
};

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  const value = sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  return Math.round(value * 10) / 10;
}

/**
 * Roll a set of per-day service levels into a profile's groups.
 *
 * Takes the rows for ONE entity (one stop, or one route direction). Rows for a
 * day name that appears more than once are a caller error, not something to
 * merge silently — the last one wins and the situation cannot arise from
 * `parseGtfsFeed`, which emits at most one row per (entity, day).
 */
export function groupServiceDays(
  rows: readonly GtfsServiceLevel[],
  profile: ServiceDayGroupingProfile = DEFAULT_SERVICE_DAY_GROUPING_PROFILE,
): ServiceDayGroupSummary[] {
  const byDay = new Map<GtfsServiceDayName, GtfsServiceLevel>();
  for (const row of rows) byDay.set(row.serviceDay, row);

  return profile.groups.map((group) => {
    const present = group.days.filter((day) => byDay.has(day));
    const missing = group.days.filter((day) => !byDay.has(day));
    const dayRows = present.map((day) => byDay.get(day)!);

    const tripCounts = dayRows.map((row) => row.tripsPerDay);
    const firsts = dayRows
      .map((row) => row.firstDepartureSeconds)
      .filter((value): value is number => value !== null);
    const lasts = dayRows
      .map((row) => row.lastDepartureSeconds)
      .filter((value): value is number => value !== null);
    const headways = dayRows
      .map((row) => row.peakHeadwayMinutes)
      .filter((value): value is number => value !== null);
    const tiers = dayRows
      .map((row) => row.frequentServiceTierMinutes)
      .filter((value): value is number => value !== null);
    const peakHours = [...new Set(dayRows.map((row) => row.peakHour).filter((value): value is number => value !== null))];
    peakHours.sort((a, b) => a - b);

    return {
      group,
      daysPresent: present,
      daysMissing: missing,
      tripsPerDay: median(tripCounts),
      minTripsPerDay: tripCounts.length > 0 ? Math.min(...tripCounts) : null,
      maxTripsPerDay: tripCounts.length > 0 ? Math.max(...tripCounts) : null,
      varies: tripCounts.length > 1 && Math.min(...tripCounts) !== Math.max(...tripCounts),
      firstDepartureSeconds: firsts.length > 0 ? Math.min(...firsts) : null,
      lastDepartureSeconds: lasts.length > 0 ? Math.max(...lasts) : null,
      medianPeakHeadwayMinutes: median(headways),
      // The tightest tier met anywhere in the group, and the tightest met
      // everywhere. A stop that is 15-minute on Tuesday and 30-minute on Friday
      // is honestly described by both numbers and dishonestly by either alone.
      bestFrequentServiceTierMinutes: tiers.length > 0 ? Math.min(...tiers) : null,
      worstFrequentServiceTierMinutes:
        tiers.length > 0 && tiers.length === present.length ? Math.max(...tiers) : null,
      peakHours,
    };
  });
}

/** `HH:MM` for a seconds-after-service-day-start value, keeping hours past 24. */
export function formatServiceDaySeconds(seconds: number | null): string {
  if (seconds === null) return "—";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

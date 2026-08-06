/**
 * WHAT OPENPLAN IS ALLOWED TO SAY ABOUT A NUMBER IT DERIVED FROM A GTFS FEED.
 *
 * Every constant here is a sentence that must travel with a service-level
 * figure wherever it is displayed, exported, or written into a plan document.
 * They are constants and not inline strings for the same reason the claim-tier
 * labels are centralised: a caveat that exists in three places drifts into three
 * different promises, and the weakest one is the one somebody eventually cites.
 *
 * WHY THE CAVEATS ARE THIS SPECIFIC. The service-level numbers are exactly the
 * kind that get lifted out of a screen and into a regional transportation plan,
 * a Title VI service-equity analysis, or a transit-priority determination —
 * documents that are adopted, litigated, and relied on. A figure with no stated
 * basis is indistinguishable from a measured one once it is in a table, and by
 * then nobody remembers that the headway was an hourly average.
 *
 * `selectGtfsCaveats` returns only the ones that APPLY to a given feed, because
 * a wall of eight caveats on every screen is read as boilerplate and therefore
 * read by nobody.
 */

import {
  BASIC_SERVICE_HEADWAY_MINUTES,
  FREQUENT_SERVICE_HEADWAY_MINUTES,
  SERVICE_DAY_HOUR_BINS,
} from "./service-levels";

/**
 * THE ONE THAT ALWAYS APPLIES, and the reason the whole lane is shaped as it is.
 *
 * OpenPlan derives service levels and DISCARDS the timetable. It can say how
 * often the bus comes; it cannot say what time the 4:15 leaves, and it must
 * never appear to. A rider who plans a trip on a stale static schedule misses
 * the bus; that is a real harm and it belongs to the agency's own trip planner
 * and its real-time feed, which OpenPlan does not read.
 */
export const GTFS_NOT_A_TIMETABLE_CAVEAT =
  "These are trip counts derived from a published schedule for one service day — not a timetable. " +
  "OpenPlan records how often service runs, and deliberately does not store individual departure times, " +
  "so it cannot tell a rider when the next vehicle leaves. Use the agency's own trip planner for that.";

/**
 * THE HEADWAY CAVEAT. The trade the bounded-memory histogram makes, stated
 * plainly rather than buried.
 */
export const GTFS_HOURLY_AVERAGE_HEADWAY_CAVEAT =
  "Headways are hourly averages (60 minutes ÷ departures in that hour), not measured gaps between vehicles. " +
  "Six departures clustered in twenty minutes and six spread evenly across the hour both report a 10-minute headway. " +
  "This is a screening-grade measure of frequency, not a schedule adherence or a passenger wait time.";

/**
 * THE PEAK-WINDOW CAVEAT. Reported alongside the derived hour so the reader can
 * check it, which is the entire point of deriving it rather than assuming it.
 */
export const GTFS_DERIVED_PEAK_WINDOW_CAVEAT =
  "The peak hour is derived from the feed — it is the clock hour with the most departures — and is reported " +
  "with every headway so it can be checked. OpenPlan does not assume a 6–9 AM peak, because many systems " +
  "peak at midday, at school bell times, or at shift change, and an assumed window would report the wrong hour " +
  "without saying so.";

/** The frequent-service tiers, and how they differ from a statutory test. */
export const GTFS_FREQUENT_SERVICE_TIER_CAVEAT =
  `Frequent-service tiers are reported at ${FREQUENT_SERVICE_HEADWAY_MINUTES} and ${BASIC_SERVICE_HEADWAY_MINUTES} minutes ` +
  "of peak headway. These are OpenPlan's screening tiers and are NOT a determination under any statute. " +
  "California's major-transit-stop and high-quality-transit-corridor tests, and comparable tests elsewhere, define the " +
  "peak period by statute, may require service in both the morning and afternoon commute periods, and may require two " +
  "intersecting routes — OpenPlan derives the peak hour from the data instead. Use this to find candidate locations, " +
  "then confirm each one against the applicable statutory definition.";

/** Frequency-based feeds, and the `exact_times` distinction kept rather than flattened. */
export const GTFS_FREQUENCIES_EXPANSION_CAVEAT =
  "Some trips in this feed are published as frequencies (a start time, an end time, and a headway) rather than as " +
  "individual departures. OpenPlan expands those windows into departures for counting, which reproduces the agency's " +
  "own stated frequency. Trips marked exact_times=1 expand identically for counting but describe scheduled departures " +
  "rather than approximate ones; every derived row records which method produced it.";

/**
 * THE REPRESENTATIVE-DATE CAVEAT. A feed's Tuesdays are not all alike, and the
 * one we counted is named.
 */
export const GTFS_REPRESENTATIVE_DATE_CAVEAT =
  "A feed usually covers months of service, and its Tuesdays are not all the same Tuesday — services start and end " +
  "mid-window and holidays are added and removed by date. Each day's counts describe ONE date, the busiest of that " +
  "weekday inside the feed's window, and that date is reported so the figure can be reproduced.";

/**
 * THE BLANK-TIME CAVEAT. Only applies to feeds that actually contain blank
 * times, which is why it is conditional.
 */
export const GTFS_INTERPOLATED_STOP_TIME_CAVEAT =
  "GTFS only requires times at timepoints, and this feed leaves some stop times blank. OpenPlan counts a departure " +
  "only where the feed states one and does not interpolate between timepoints, so service at those stops is " +
  "undercounted. The number of blank stop times is reported with the feed.";

/**
 * THE PAST-MIDNIGHT CAVEAT. Applies only when a feed actually contains a
 * departure past the last bin.
 */
export const GTFS_PAST_MIDNIGHT_CAVEAT =
  `Departures after midnight belong to the day whose service they run under, and GTFS writes them as 24:00:00 and later; ` +
  `OpenPlan preserves that. A small number of departures in this feed fall past ${SERVICE_DAY_HOUR_BINS}:00:00 — they are ` +
  "included in the trip counts but not in the hour-by-hour histogram, so they do not affect the peak hour or headway.";

/** The dangling-reference caveat, applied only when the feed has some. */
export const GTFS_DANGLING_REFERENCE_CAVEAT =
  "Some rows in this feed refer to stops or trips the feed never defines. Published feeds routinely do, and OpenPlan " +
  "counts rather than rejects them: a departure at a stop the feed does not locate still counts toward its route, but " +
  "cannot be attributed to a place on the map. The counts are reported with the feed.";

/** Every caveat, so a test can assert the set is exhaustive and none drifts. */
export const GTFS_CAVEATS = {
  notATimetable: GTFS_NOT_A_TIMETABLE_CAVEAT,
  hourlyAverageHeadway: GTFS_HOURLY_AVERAGE_HEADWAY_CAVEAT,
  derivedPeakWindow: GTFS_DERIVED_PEAK_WINDOW_CAVEAT,
  frequentServiceTiers: GTFS_FREQUENT_SERVICE_TIER_CAVEAT,
  frequenciesExpansion: GTFS_FREQUENCIES_EXPANSION_CAVEAT,
  representativeDate: GTFS_REPRESENTATIVE_DATE_CAVEAT,
  interpolatedStopTimes: GTFS_INTERPOLATED_STOP_TIME_CAVEAT,
  pastMidnight: GTFS_PAST_MIDNIGHT_CAVEAT,
  danglingReferences: GTFS_DANGLING_REFERENCE_CAVEAT,
} as const;

/**
 * The four that apply to EVERY derived service level, whatever the feed looks
 * like. Anything displaying a headway or a trip count shows at least these.
 */
export const GTFS_ALWAYS_APPLICABLE_CAVEATS: readonly string[] = [
  GTFS_NOT_A_TIMETABLE_CAVEAT,
  GTFS_HOURLY_AVERAGE_HEADWAY_CAVEAT,
  GTFS_DERIVED_PEAK_WINDOW_CAVEAT,
  GTFS_REPRESENTATIVE_DATE_CAVEAT,
];

/** What a caveat selection needs to know about a parsed feed. */
export type GtfsCaveatContext = {
  /** True when any derived row came from a frequencies.txt expansion. */
  usesFrequencies: boolean;
  /** Blank (non-timepoint) stop times seen. */
  stopTimesWithoutTime: number;
  /** Departures at or past the last histogram bin. */
  departuresBeyondBinRange: number;
  /** Rows naming a stop or trip the feed never defines. */
  danglingReferences: number;
  /** True when a frequent-service tier is being displayed. */
  showsFrequentServiceTier: boolean;
};

/**
 * The caveats that apply to THIS feed, in reading order.
 *
 * Conditional on purpose. A caveat about frequency-based trips on a feed with
 * none is noise, and noise is what trains a reader to skip the ones that matter.
 */
export function selectGtfsCaveats(context: GtfsCaveatContext): string[] {
  const caveats = [...GTFS_ALWAYS_APPLICABLE_CAVEATS];
  if (context.showsFrequentServiceTier) caveats.push(GTFS_FREQUENT_SERVICE_TIER_CAVEAT);
  if (context.usesFrequencies) caveats.push(GTFS_FREQUENCIES_EXPANSION_CAVEAT);
  if (context.stopTimesWithoutTime > 0) caveats.push(GTFS_INTERPOLATED_STOP_TIME_CAVEAT);
  if (context.departuresBeyondBinRange > 0) caveats.push(GTFS_PAST_MIDNIGHT_CAVEAT);
  if (context.danglingReferences > 0) caveats.push(GTFS_DANGLING_REFERENCE_CAVEAT);
  return caveats;
}

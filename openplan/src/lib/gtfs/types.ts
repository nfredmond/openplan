/**
 * THE VOCABULARY OF THE GTFS LANE. Types and closed enumerations only — no I/O,
 * no logic, nothing that can fail.
 *
 * THE PRODUCT DECISION EVERY TYPE HERE ENCODES. OpenPlan derives SERVICE LEVELS
 * from a feed and never keeps the timetable. There is no `stop_times` row and no
 * `trips` row anywhere in this file, and that absence is the design: the product
 * must be able to answer "how often does the bus come here" and must never be
 * able to answer "what time is the 4:15". A departure time exists inside the
 * parser for the microseconds it takes to increment a counter, and is then gone.
 *
 * Why that is the right line and not merely a storage saving: a timetable is a
 * PROMISE to a rider, it is stale the moment an agency reroutes, and honouring
 * it would put OpenPlan in the trip-planning business against real-time feeds it
 * does not read. A service level is a PLANNING FACT about a published schedule —
 * it is what a planner cites in an RTP, a Title VI service-equity analysis, or a
 * transit-priority determination, and it stays true for the schedule it names.
 *
 * `workers/aequilibrae_worker/gtfs_skim.py` is the domain reference this lane
 * was ported from. Where this code deliberately differs from it, the difference
 * is stated at the point of difference rather than here.
 */

/**
 * EVERY WAY READING A FEED CAN FAIL, as a closed set.
 *
 * Closed because the failure code reaches a planner as an explanation and
 * reaches the database as a status. An open string would let one lane invent
 * `"error"` and another invent `"failed"`, and the read layer would have to
 * guess. Each code names a DIFFERENT THING THE PLANNER CAN DO, which is the only
 * test a failure vocabulary has to pass:
 *
 *   too_large                     - shrink the feed, or raise the operator cap.
 *   not_a_zip                     - you uploaded something that is not a feed.
 *   ambiguous_archive             - the zip contains two files with one name;
 *                                   nobody can say which is the real stops.txt.
 *   missing_required_file         - the feed is incomplete; the detail names it.
 *   no_usable_stops               - stops.txt parsed but no stop had usable
 *                                   coordinates.
 *   no_usable_service             - the feed parsed and produced no departures
 *                                   at all on any service day.
 *   fetch_failed                  - the URL did not answer.       (fetch lane)
 *   fetch_timed_out               - the URL answered too slowly.  (fetch lane)
 *   host_not_allowed              - the URL points somewhere this deployment
 *                                   will not fetch from.          (fetch lane)
 *   catalog_unavailable           - the feed catalog could not be read; this is
 *                                   an UNKNOWN, never "no feed". (catalog lane)
 *   catalog_entry_requires_key    - the catalog entry needs an API key this
 *                                   deployment does not hold.     (catalog lane)
 *   catalog_entry_deprecated      - the catalog says this feed is superseded.
 *                                                                 (catalog lane)
 *   partial_write                 - the feed parsed and the write did not
 *                                   finish; the stored feed is incomplete and
 *                                   must not be read as ready.    (persist lane)
 *   abandoned                     - the parse ran out of its wall-clock budget,
 *                                   or a member stream failed part-way.
 *
 * Six of these belong to lanes this module does not own (fetch, catalog,
 * persist). They live here anyway because the vocabulary must be ONE closed set
 * for the read layer to switch on — a second enum in a second file is how a
 * status column ends up with two spellings of the same failure.
 * `GTFS_PARSE_FAILURE_CODES` below is the subset `parseGtfsFeed` can actually
 * produce, and there is a test asserting it produces nothing outside it.
 */
export const GTFS_FAILURE_CODES = [
  "too_large",
  "not_a_zip",
  "ambiguous_archive",
  "missing_required_file",
  "no_usable_stops",
  "no_usable_service",
  "fetch_failed",
  "fetch_timed_out",
  "host_not_allowed",
  "catalog_unavailable",
  "catalog_entry_requires_key",
  "catalog_entry_deprecated",
  "partial_write",
  "abandoned",
] as const;

export type GtfsFailureCode = (typeof GTFS_FAILURE_CODES)[number];

/**
 * The subset `parseGtfsFeed` may return. Anything else in the union above is
 * another lane's to produce, and a test proves this module never returns one.
 */
export const GTFS_PARSE_FAILURE_CODES = [
  "too_large",
  "not_a_zip",
  "ambiguous_archive",
  "missing_required_file",
  "no_usable_stops",
  "no_usable_service",
  "abandoned",
] as const;

export type GtfsParseFailureCode = (typeof GTFS_PARSE_FAILURE_CODES)[number];

export function isGtfsFailureCode(value: unknown): value is GtfsFailureCode {
  return typeof value === "string" && (GTFS_FAILURE_CODES as readonly string[]).includes(value);
}

/**
 * PROBLEMS THAT DO NOT STOP A PARSE, as a closed set.
 *
 * THE RULE THIS ENCODES, and it is the single most important thing ported from
 * `gtfs_skim.py`: a bad ROW never kills a FEED. Published feeds routinely carry
 * dangling stop references, blank times and duplicate ids — that comment in the
 * reference calls dangling references "the ordinary case, not a pathological
 * one", and it is right. An agency whose feed is 99.99% clean must not be told
 * OpenPlan cannot read their data.
 *
 * But a problem silently absorbed is a lie of omission, so every one is COUNTED
 * and a bounded sample is KEPT. The counts are what let a planner see that 4
 * rows were dropped and not 400,000.
 *
 *   bad_csv_row                 - the row could not be read as CSV at all, or
 *                                 lacked the key column its table is keyed on.
 *   bad_time_value              - a time was present and unparseable. NOT the
 *                                 same as a blank time, which is legal GTFS for
 *                                 a non-timepoint stop and is counted separately
 *                                 in `stopTimesWithoutTime`.
 *   dangling_stop_reference     - stop_times names a stop_id stops.txt never
 *                                 defines. The departure still counts toward its
 *                                 ROUTE (the time is real) but cannot count
 *                                 toward a STOP, because we do not know where
 *                                 that stop is. This is exactly gtfs_skim.py's
 *                                 treatment, ported.
 *   dangling_trip_reference     - stop_times names a trip_id trips.txt never
 *                                 defines. Unattributable to route or service.
 *   dangling_service_reference  - trips names a service_id neither calendar file
 *                                 defines. The trip runs on no known day.
 *   duplicate_key               - two rows share a primary key. LAST WINS, and
 *                                 the count says how often it happened.
 *   departure_past_bin_range    - a departure at or after 30:00:00. Counted in
 *                                 trips-per-day but excluded from the histogram,
 *                                 because it falls outside the 30 bins. See
 *                                 `service-levels.ts`.
 *   bin_saturated               - more than 65,535 departures in one clock hour
 *                                 at one stop. Impossible in reality; recorded
 *                                 rather than allowed to wrap silently.
 *   bad_frequency_row           - a frequencies.txt row whose window or headway
 *                                 could not be read.
 *   frequency_exact_times       - a frequencies.txt row with `exact_times=1`.
 *                                 Not an error at all: it expands identically
 *                                 for COUNTING, and the distinction is recorded
 *                                 here rather than flattened away silently.
 *   frequency_trip_without_stop_times - a trip listed in frequencies.txt that
 *                                 stop_times.txt never mentions, so there is
 *                                 nothing to offset.
 *   service_window_truncated    - the calendar window was longer than the date
 *                                 enumeration cap and was clipped.
 */
export const GTFS_PARSE_WARNING_CODES = [
  "bad_csv_row",
  "bad_time_value",
  "dangling_stop_reference",
  "dangling_trip_reference",
  "dangling_service_reference",
  "duplicate_key",
  "departure_past_bin_range",
  "bin_saturated",
  "bad_frequency_row",
  "frequency_exact_times",
  "frequency_trip_without_stop_times",
  "service_window_truncated",
] as const;

export type GtfsParseWarningCode = (typeof GTFS_PARSE_WARNING_CODES)[number];

/** One warning class: how often, and a bounded sample of what it looked like. */
export type GtfsParseWarning = {
  code: GtfsParseWarningCode;
  /** Unbounded. An integer costs nothing and a truncated count would lie. */
  count: number;
  /** At most `maxWarningExamples`, each truncated to `maxWarningExampleChars`. */
  examples: string[];
};

/**
 * GTFS'S OWN SEVEN DAY NAMES, in `calendar.txt` column order.
 *
 * These are what the DATABASE stores, deliberately. Rolling Monday-to-Friday up
 * into "weekday" is a US/European convention that is wrong in much of the world
 * — see `service-day-groups.ts`, which does that rollup at READ time so a
 * deployment in a Sunday-to-Thursday workweek changes a registry entry rather
 * than a migration.
 */
export const GTFS_SERVICE_DAY_NAMES = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

export type GtfsServiceDayName = (typeof GTFS_SERVICE_DAY_NAMES)[number];

/**
 * HOW A DERIVED ROW'S DEPARTURES WERE OBTAINED.
 *
 * This is provenance, and it survives into the read layer on EVERY row for one
 * reason: a headway derived from `frequencies.txt` is a headway the agency
 * STATED, while a headway derived from `stop_times.txt` is one OpenPlan counted.
 * Those are different strengths of evidence and a planner is entitled to know
 * which one is under a number they are about to cite.
 *
 *   scheduled   - every departure came from stop_times.txt.
 *   frequencies - every departure came from expanding a frequencies.txt window.
 *   mixed       - both, which is the normal case for a feed that uses
 *                 frequencies for a handful of trips.
 */
export const GTFS_DERIVATION_METHODS = ["scheduled", "frequencies", "mixed"] as const;

export type GtfsDerivationMethod = (typeof GTFS_DERIVATION_METHODS)[number];

/**
 * WHY A MEDIAN HEADWAY IS OR IS NOT AVAILABLE.
 *
 * `not_determined` exists because the alternative is worse. A stop with one bus
 * at 06:10 and one at 18:40 has two served hours out of a thirteen-hour span; a
 * median taken over served hours only would read "60 minutes", which is a claim
 * of hourly service that the schedule flatly contradicts. When more than half
 * the span has no departure at all, there is no honest median and this says so.
 */
export const GTFS_MEDIAN_HEADWAY_BASES = [
  /** The median of hourly averages across the service span. */
  "hourly_average_over_span",
  /** More than half the hours in the span have no departure; no median is claimed. */
  "not_determined_span_mostly_unserved",
  /** Fewer than two departures; a headway is not a meaningful idea yet. */
  "not_determined_too_few_departures",
] as const;

export type GtfsMedianHeadwayBasis = (typeof GTFS_MEDIAN_HEADWAY_BASES)[number];

/**
 * ONE DERIVED SERVICE LEVEL — the whole point of this lane.
 *
 * Read it as: "on <serviceDay>, as scheduled on <representativeDate>, this stop
 * (or route direction) had <tripsPerDay> departures between <first> and <last>,
 * busiest in the hour beginning <peakHour>."
 */
export type GtfsServiceLevel = {
  serviceDay: GtfsServiceDayName;

  /**
   * THE ACTUAL DATE THESE COUNTS DESCRIBE, `YYYY-MM-DD`.
   *
   * A feed's Tuesdays are not all the same Tuesday: services start and end mid
   * window, and `calendar_dates.txt` adds and removes service on named dates.
   * So one date is chosen per day name — the busiest one in the feed's window —
   * and it is REPORTED, because "Tuesday" alone is not auditable and this is.
   * Null only when the day name's service comes from a calendar with no usable
   * dates at all.
   */
  representativeDate: string | null;

  /** Departures counted on that day. The primary fact; everything else derives. */
  tripsPerDay: number;

  /** Seconds after service-day start (NOT after midnight — see `peakHour`). */
  firstDepartureSeconds: number | null;
  lastDepartureSeconds: number | null;
  /** last - first. Null when there are no departures. Zero when there is one. */
  spanSeconds: number | null;

  /**
   * The clock hour with the most departures, 0-29, counted from service-day
   * start. 24-29 are legitimate: GTFS expresses a 00:40 departure belonging to
   * Tuesday's service as `24:40:00`, and collapsing that into hour 0 would move
   * Tuesday night's service onto Tuesday morning.
   *
   * DERIVED FROM THE DATA, never assumed. An assumed 06:00-09:00 peak is a
   * hardcoded agency convention (product non-negotiable #0) and is wrong for
   * every system whose load is midday, school-bell, or shift-change shaped.
   */
  peakHour: number | null;
  /** Departures in that hour. A raw count, and the only unqualified fact here. */
  peakHourDepartures: number;

  /**
   * 60 / peakHourDepartures. AN HOURLY AVERAGE, NOT A MEASURED GAP — the
   * histogram threw the individual times away, which is what bounds this
   * lane's memory. Six departures clustered in ten minutes and six spread
   * evenly both yield 10.
   */
  peakHeadwayMinutes: number | null;
  /**
   * True when the peak hour held one departure or none, so 60 is a LOWER bound
   * on the true headway rather than an estimate of it. Without this flag a
   * once-a-day stop reports "60 minute headway" and reads as hourly service.
   */
  peakHeadwayIsLowerBound: boolean;

  medianHeadwayMinutes: number | null;
  medianHeadwayBasis: GtfsMedianHeadwayBasis;

  /** Hours in [firstHour, lastHour] with at least one departure. */
  servedHours: number;
  /** Hours in [firstHour, lastHour] inclusive. servedHours < spanHours = gaps. */
  spanHours: number;

  /**
   * The tightest frequent-service tier this meets on peak headway, or null.
   * See `FREQUENT_SERVICE_TIERS` in `service-levels.ts` for what the tiers are
   * and why there are exactly two.
   */
  frequentServiceTierMinutes: number | null;

  derivationMethod: GtfsDerivationMethod;
  /**
   * Departures here contributed by schedule-based trips, and by frequency-based
   * trips. They sum to `tripsPerDay`.
   *
   * NAMED "trip count" BECAUSE THAT IS WHAT THEY ARE AT ROUTE LEVEL, where a
   * trip contributes exactly one departure. At STOP level they are departures,
   * which differs from distinct trips only for a loop or out-and-back pattern
   * that visits the same stop twice on one trip — where the departure count is
   * the more useful number anyway, because a rider at that stop really does get
   * two chances to board. Counting distinct trips per (stop, service) would
   * require a set per histogram slot, which is exactly the per-departure
   * storage the whole design exists to avoid.
   */
  scheduledTripCount: number;
  frequencyTripCount: number;
  /** Departures at or after 30:00:00, counted in tripsPerDay, absent from bins. */
  departuresBeyondBinRange: number;
};

export type GtfsStopServiceLevel = GtfsServiceLevel & {
  stopId: string;
  /**
   * The routes that served this stop on this day, sorted.
   *
   * NOT merely a count, and the difference is the point: a stop served by four
   * routes at 30-minute headways and a stop served by one route at 7-minute
   * headways can have identical trip counts and are completely different
   * places — one is a transfer point, the other is a corridor. A planner
   * siting anything at either needs to know which one they are looking at.
   */
  routeIds: string[];
  /** `routeIds.length`, carried so a reader need not compute it. */
  routesServing: number;
};

/**
 * Route service levels are keyed by DIRECTION as well as route, and that is not
 * optional detail. A two-way route with four departures an hour has a 30-minute
 * headway in each direction; adding the directions together reports 15 and
 * overstates the service by exactly 2x. `gtfs_skim.py` keys its lines
 * `(route_id, direction_id)` for the same reason.
 *
 * A route-level departure is counted ONCE PER TRIP, at the trip's first stop —
 * not once per stop_times row, which would multiply every route's frequency by
 * the number of stops on it.
 */
export type GtfsRouteServiceLevel = GtfsServiceLevel & {
  routeId: string;
  /** GTFS `direction_id`, or null when the feed omits it. */
  directionId: number | null;
  /**
   * Distinct stops this route direction served on this day.
   *
   * Counted across every trip, not read off one representative pattern: a route
   * whose peak trips run express and whose midday trips run local serves more
   * stops than any single trip visits, and a "longest trip wins" shortcut —
   * which is what `gtfs_skim.py` does, correctly, for its own purpose of
   * building ONE canonical pattern to skim — would undercount it here.
   */
  stopsServed: number;
};

/** A stop as the feed defines it. Coordinates are required to be usable. */
export type GtfsStopRecord = {
  stopId: string;
  name: string | null;
  lat: number;
  lon: number;
  /** GTFS location_type; 0/absent = a boardable stop, 1 = a station. */
  locationType: number | null;
  parentStation: string | null;
  wheelchairBoarding: number | null;
};

export type GtfsRouteRecord = {
  routeId: string;
  agencyId: string | null;
  shortName: string | null;
  longName: string | null;
  /** GTFS route_type. 3 = bus. Null when absent or unreadable. */
  routeType: number | null;
  color: string | null;
  textColor: string | null;
};

export type GtfsAgencyRecord = {
  agencyId: string | null;
  name: string;
  url: string | null;
  /**
   * IANA timezone, as the feed states it. NOT defaulted to anything: a feed
   * whose agency.txt omits it gets null, because inventing `America/New_York`
   * for an agency in Guam is a fabricated fact about someone else's system.
   */
  timezone: string | null;
  lang: string | null;
  phone: string | null;
};

export type GtfsFeedInfoRecord = {
  publisherName: string | null;
  publisherUrl: string | null;
  lang: string | null;
  startDate: string | null;
  endDate: string | null;
  version: string | null;
};

/** Where the feed's validity window was derived from. */
export type GtfsServiceWindowSource = "calendar" | "calendar_dates" | "both" | "none";

/**
 * The feed's validity window, min/max over BOTH calendar files.
 *
 * Over both because `calendar_dates.txt` is a FIRST-CLASS source, not a
 * fallback: 2 of 16 sampled live US feeds ship no `calendar.txt` at all. A
 * window read only from `calendar.txt` reports "none" for those agencies and
 * makes a working feed look broken.
 */
export type GtfsServiceWindow = {
  startDate: string | null;
  endDate: string | null;
  source: GtfsServiceWindowSource;
};

/**
 * WHICH SERVICE THE COUNTS FOR ONE DAY NAME DESCRIBE — the audit trail behind
 * `representativeDate`. A planner who disbelieves a Saturday number can read
 * exactly which date and which service ids produced it.
 */
export type GtfsServiceDayBasis = {
  serviceDay: GtfsServiceDayName;
  representativeDate: string | null;
  /** The service_ids active on that date. Sorted, so the record is stable. */
  serviceIds: string[];
  /** Scheduled trips across those services — how the date was chosen. */
  tripCount: number;
  /** Dates of this day name inside the feed window that were considered. */
  candidateDateCount: number;
};

/** Row and byte tallies, kept so a feed's cost is inspectable after the fact. */
export type GtfsParseStats = {
  archiveBytes: number;
  bytesDecompressed: number;
  elapsedMs: number;
  stopTimesRows: number;
  /** Rows whose time fields were blank. Legal GTFS; see the caveat about them. */
  stopTimesWithoutTime: number;
  tripRows: number;
  /** Peak count of live (stop, service) histogram slots — the memory that mattered. */
  stopServicePairs: number;
  routeServicePairs: number;
  /** Trips whose departures came from stop_times.txt. */
  scheduledTrips: number;
  /** Trips whose departures came from a frequencies.txt window. */
  frequencyTrips: number;
  /** Of those, how many declared `exact_times=1`. */
  exactTimesFrequencyTrips: number;
};

/** Everything one feed yields. No timetable anywhere in it, by construction. */
export type ParsedGtfsFeed = {
  /** Basenames of the archive members that were present. Provenance for a UI. */
  filesPresent: string[];
  agencies: GtfsAgencyRecord[];
  feedInfo: GtfsFeedInfoRecord | null;
  routes: GtfsRouteRecord[];
  stops: GtfsStopRecord[];
  serviceWindow: GtfsServiceWindow;
  serviceDayBases: GtfsServiceDayBasis[];
  stopServiceLevels: GtfsStopServiceLevel[];
  routeServiceLevels: GtfsRouteServiceLevel[];
  /** Feed-wide derivation method. Per-row methods may differ from it. */
  derivationMethod: GtfsDerivationMethod;
  warnings: GtfsParseWarning[];
  stats: GtfsParseStats;
};

export type GtfsParseSuccess = { ok: true; feed: ParsedGtfsFeed };

export type GtfsParseFailure = {
  ok: false;
  code: GtfsParseFailureCode;
  /**
   * What a person can act on. For `missing_required_file` it NAMES the file —
   * "your feed is missing something" is not a message anybody can use.
   */
  detail: string;
};

export type GtfsParseResult = GtfsParseSuccess | GtfsParseFailure;

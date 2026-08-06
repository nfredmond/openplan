/**
 * READING A GTFS FEED END TO END, AND NEVER THROWING BECAUSE OF WHAT IS IN IT.
 *
 * `parseGtfsFeed` returns `{ok:true, feed}` or `{ok:false, code, detail}`. It
 * throws only for a programming error — a bug in this file — never for anything
 * a feed can contain. That is not stylistic. Every input here comes from outside
 * the deployment, an exception escaping into a route handler becomes a 500 with
 * no explanation, and the person on the other end is a planner who was told
 * their agency's data does not work and given nothing to act on. Every refusal
 * below names something a person can do.
 *
 * ===================================================== THE ORDER OF THE READS
 *
 * The tables are read in dependency order, and the order IS the memory design:
 *
 *   stops.txt     -> the set of stop ids that exist and where they are. Read
 *                    first so a stop_times row can be checked against it as it
 *                    streams, rather than buffered until stops are known.
 *   routes.txt    -> route ids and presentation.
 *   agency.txt    -> who publishes this.
 *   calendar.txt + calendar_dates.txt
 *                 -> which service ids run on which dates. BOTH, always: 2 of
 *                    16 sampled live US feeds ship no calendar.txt at all, so
 *                    calendar_dates is a first-class source and never a
 *                    fallback.
 *   trips.txt     -> trip -> (route, direction, service). Read before
 *                    stop_times so each stop_time can be attributed as it
 *                    streams instead of being held.
 *   frequencies.txt -> which trips are frequency-based, if any.
 *   stop_times.txt -> streamed, counted, discarded. The 126 MB one.
 *
 * ============================================ HOW THIS DIFFERS FROM THE PYTHON
 *
 * `workers/aequilibrae_worker/gtfs_skim.py` is the domain reference and most of
 * what is here is a port of its judgement. Two deliberate departures:
 *
 * 1. IT REFUSES ANY FEED WITH A NON-EMPTY `frequencies.txt`; THIS ONE DOES NOT.
 *    That refusal is right for a skim that reads scheduled stop_times deltas and
 *    would silently mis-skim a frequency feed. It is wrong here, measurably: of
 *    16 randomly sampled live US feeds, 7 ship the file, 6 of those are
 *    header-only, and the seventh carries 4 rows covering 2 trips out of 18,150.
 *    A blanket refusal rejects an entire agency over two trips. And a headway is
 *    precisely what this lane wants — `frequencies.txt` STATES one, which is
 *    better evidence than counting departures. So the decision is made PER TRIP:
 *    a trip listed in frequencies.txt has its departures expanded from its
 *    windows; every other trip is schedule-based; and `derivation_method`
 *    records which produced each row.
 *
 * 2. IT PICKS ONE REPRESENTATIVE SERVICE DAY FOR THE WHOLE FEED; THIS ONE
 *    DERIVES ALL SEVEN. The skim needs a single day to build one matrix. A
 *    planning record needs Saturday to exist even when Saturday is quiet, and
 *    needs Friday to be distinguishable from Tuesday.
 *
 * ==================================================== WHAT IS NEVER PERSISTED
 *
 * No `stop_times` row and no `trips` row survives this function. They are parsed
 * in the stream and thrown away; what comes out is counts. See
 * `service-levels.ts` for why, and `caveats.ts` for what may be said about the
 * result.
 */

import {
  GtfsArchiveLimitError,
  GtfsArchiveStreamError,
  openGtfsZip,
  type GtfsArchive,
} from "./zip";
import { resolveGtfsLimits, type GtfsLimitEnv, type ResolvedGtfsLimits } from "./limits";
import {
  DepartureHistogram,
  deriveServiceLevelMetrics,
  parseGtfsTimeToSeconds,
  type DepartureSource,
} from "./service-levels";
import {
  GTFS_PARSE_WARNING_CODES,
  GTFS_SERVICE_DAY_NAMES,
  type GtfsAgencyRecord,
  type GtfsFeedInfoRecord,
  type GtfsParseFailureCode,
  type GtfsParseResult,
  type GtfsParseWarning,
  type GtfsParseWarningCode,
  type GtfsRouteRecord,
  type GtfsRouteServiceLevel,
  type GtfsServiceDayBasis,
  type GtfsServiceDayName,
  type GtfsServiceWindow,
  type GtfsServiceWindowSource,
  type GtfsStopRecord,
  type GtfsStopServiceLevel,
} from "./types";

/**
 * Files a feed must contain, with `calendar.txt` / `calendar_dates.txt` as an
 * EITHER-OR rather than a requirement on the first.
 *
 * The either-or is measured, not defensive: 2 of 16 sampled live US feeds ship
 * only `calendar_dates.txt`. Requiring `calendar.txt` would tell those two
 * agencies their feed is malformed when it is entirely valid GTFS.
 */
export const GTFS_REQUIRED_FILES = ["agency.txt", "stops.txt", "routes.txt", "trips.txt", "stop_times.txt"] as const;
export const GTFS_REQUIRED_CALENDAR_FILES = ["calendar.txt", "calendar_dates.txt"] as const;

/** Rows between wall-clock checks. Frequent enough to bound, rare enough to be free. */
const DEADLINE_CHECK_ROW_INTERVAL = 20_000;

/* -------------------------------------------------------------------------- */
/* Internal error types. Each maps to exactly one failure code at the boundary. */
/* -------------------------------------------------------------------------- */

class GtfsRowLimitError extends Error {
  constructor(readonly table: string, readonly cap: number) {
    super(`${table} has more than ${cap.toLocaleString("en-US")} rows.`);
  }
}

class GtfsPairLimitError extends Error {
  constructor(readonly kind: "stop" | "route", readonly cap: number) {
    super(
      `This feed needs more than ${cap.toLocaleString("en-US")} ${kind}/service combinations, ` +
        `which is past what this deployment will hold in memory.`,
    );
  }
}

class GtfsBudgetError extends Error {
  constructor(readonly phase: string, readonly budgetMs: number) {
    super(
      `Reading this feed passed the ${(budgetMs / 1000).toFixed(0)}-second budget for this deployment while ${phase}.`,
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Warnings                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Counts every warning and keeps a bounded sample of each.
 *
 * THE COUNT IS UNBOUNDED AND THE EXAMPLES ARE NOT. An integer costs nothing and
 * a truncated count would understate a systematic problem — "4 bad rows" and
 * "400,000 bad rows" are the difference between a typo and a broken export, and
 * that is the single most useful thing this can tell an agency.
 */
class WarningCollector {
  readonly #counts = new Map<GtfsParseWarningCode, number>();
  readonly #examples = new Map<GtfsParseWarningCode, string[]>();

  constructor(private readonly maxExamples: number, private readonly maxExampleChars: number) {}

  add(code: GtfsParseWarningCode, example?: string): void {
    this.#counts.set(code, (this.#counts.get(code) ?? 0) + 1);
    if (example === undefined) return;
    const kept = this.#examples.get(code) ?? [];
    if (kept.length >= this.maxExamples) return;
    kept.push(example.length > this.maxExampleChars ? `${example.slice(0, this.maxExampleChars)}…` : example);
    this.#examples.set(code, kept);
  }

  count(code: GtfsParseWarningCode): number {
    return this.#counts.get(code) ?? 0;
  }

  /** In declaration order, so the record is stable between runs of one feed. */
  toArray(): GtfsParseWarning[] {
    return GTFS_PARSE_WARNING_CODES.filter((code) => this.#counts.has(code)).map((code) => ({
      code,
      count: this.#counts.get(code) ?? 0,
      examples: this.#examples.get(code) ?? [],
    }));
  }
}

/* -------------------------------------------------------------------------- */
/* Interning                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * String id -> dense integer index.
 *
 * The histogram addresses everything by integer so it never holds a string. A
 * feed's stop ids alone are 6,446 strings at King County and would be repeated
 * once per histogram slot without this.
 */
class StringInterner {
  readonly #index = new Map<string, number>();
  readonly #values: string[] = [];

  intern(value: string): number {
    const existing = this.#index.get(value);
    if (existing !== undefined) return existing;
    const next = this.#values.length;
    this.#values.push(value);
    this.#index.set(value, next);
    return next;
  }

  /** Index of an already-known value, or -1. Never adds — that is the point. */
  lookup(value: string): number {
    return this.#index.get(value) ?? -1;
  }

  valueAt(index: number): string {
    return this.#values[index];
  }

  get size(): number {
    return this.#values.length;
  }
}

/** A growable Int32 column. Used for the per-trip and frequency-buffer arrays. */
class Int32Column {
  #data: Int32Array;
  #length = 0;

  constructor(initialCapacity = 1024) {
    this.#data = new Int32Array(Math.max(16, initialCapacity));
  }

  push(value: number): void {
    if (this.#length >= this.#data.length) {
      const next = new Int32Array(this.#data.length * 2);
      next.set(this.#data);
      this.#data = next;
    }
    this.#data[this.#length++] = value;
  }

  get(index: number): number {
    return this.#data[index];
  }

  set(index: number, value: number): void {
    this.#data[index] = value;
  }

  get length(): number {
    return this.#length;
  }
}

/* -------------------------------------------------------------------------- */
/* Small parsers. None of them throw; all of them return null on nonsense.      */
/* -------------------------------------------------------------------------- */

function cell(row: Record<string, string>, key: string): string {
  const value = row[key];
  return typeof value === "string" ? value.trim() : "";
}

function optionalCell(row: Record<string, string>, key: string): string | null {
  const value = cell(row, key);
  return value === "" ? null : value;
}

function parseIntegerCell(row: Record<string, string>, key: string): number | null {
  const value = cell(row, key);
  if (value === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function parseFloatCell(row: Record<string, string>, key: string): number | null {
  const value = cell(row, key);
  if (value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** `YYYYMMDD` as an integer, or null. Comparable and sortable as written. */
function parseGtfsDate(value: string): number | null {
  if (!/^\d{8}$/.test(value)) return null;
  const asNumber = Number(value);
  const month = Math.floor(asNumber / 100) % 100;
  const day = asNumber % 100;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return asNumber;
}

function formatGtfsDate(value: number): string {
  const text = String(value);
  return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
}

function dateIntToUtc(value: number): Date {
  const year = Math.floor(value / 10000);
  const month = Math.floor(value / 100) % 100;
  const day = value % 100;
  return new Date(Date.UTC(year, month - 1, day));
}

function utcToDateInt(date: Date): number {
  return date.getUTCFullYear() * 10000 + (date.getUTCMonth() + 1) * 100 + date.getUTCDate();
}

/** `Date.getUTCDay()` is 0 = Sunday; GTFS_SERVICE_DAY_NAMES starts at Monday. */
const WEEKDAY_INDEX_TO_DAY_NAME: readonly GtfsServiceDayName[] = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

/* -------------------------------------------------------------------------- */
/* Options                                                                     */
/* -------------------------------------------------------------------------- */

export type ParseGtfsFeedOptions = {
  limits?: ResolvedGtfsLimits;
  env?: GtfsLimitEnv;
  /**
   * Clock for the wall-clock budget. Injected so a test can drive the budget to
   * expiry without sleeping — a budget test that actually waits three minutes
   * is a test nobody runs.
   */
  now?: () => number;
};

/* -------------------------------------------------------------------------- */
/* The parse                                                                   */
/* -------------------------------------------------------------------------- */

export async function parseGtfsFeed(
  bytes: Uint8Array,
  options: ParseGtfsFeedOptions = {},
): Promise<GtfsParseResult> {
  const limits = options.limits ?? resolveGtfsLimits(options.env);
  const now = options.now ?? (() => Date.now());
  const startedAt = now();

  const opened = await openGtfsZip(bytes, { limits });
  if (!opened.ok) return { ok: false, code: opened.code, detail: opened.detail };
  const archive = opened.archive;

  const missing = GTFS_REQUIRED_FILES.filter((file) => !archive.has(file));
  if (missing.length > 0) {
    return {
      ok: false,
      code: "missing_required_file",
      detail:
        `This feed is missing ${missing.length === 1 ? "a required file" : "required files"}: ${missing.join(", ")}. ` +
        `A GTFS feed must contain ${GTFS_REQUIRED_FILES.join(", ")}, and at least one of ` +
        `${GTFS_REQUIRED_CALENDAR_FILES.join(" or ")}.`,
    };
  }
  if (!GTFS_REQUIRED_CALENDAR_FILES.some((file) => archive.has(file))) {
    return {
      ok: false,
      code: "missing_required_file",
      detail:
        `This feed is missing its service calendar: it has neither ${GTFS_REQUIRED_CALENDAR_FILES.join(" nor ")}. ` +
        `Either file is acceptable — many feeds publish only calendar_dates.txt — but without one of them there is no ` +
        `way to know which days any trip runs on.`,
    };
  }

  try {
    return await readFeed({ archive, limits, now, startedAt, archiveBytes: bytes.byteLength });
  } catch (error) {
    const failure = failureForError(error);
    if (failure) return failure;
    // A programming error. Rethrown deliberately: swallowing it would turn a bug
    // in this file into "your feed could not be read", and the agency would spend
    // days re-exporting a feed that was always fine.
    throw error;
  }
}

function failureForError(error: unknown): { ok: false; code: GtfsParseFailureCode; detail: string } | null {
  if (error instanceof GtfsArchiveLimitError) return { ok: false, code: "too_large", detail: error.message };
  if (error instanceof GtfsRowLimitError) return { ok: false, code: "too_large", detail: error.message };
  if (error instanceof GtfsPairLimitError) return { ok: false, code: "too_large", detail: error.message };
  if (error instanceof GtfsBudgetError) return { ok: false, code: "abandoned", detail: error.message };
  if (error instanceof GtfsArchiveStreamError) {
    return {
      ok: false,
      code: "abandoned",
      detail:
        `Reading ${error.table} stopped part-way: ${error.message}. The archive may be truncated or corrupt — ` +
        `re-download or re-export the feed and try again.`,
    };
  }
  return null;
}

type ReadContext = {
  archive: GtfsArchive;
  limits: ResolvedGtfsLimits;
  now: () => number;
  startedAt: number;
  archiveBytes: number;
};

async function readFeed(context: ReadContext): Promise<GtfsParseResult> {
  const { archive, limits, now, startedAt } = context;
  const warnings = new WarningCollector(limits.maxWarningExamples, limits.maxWarningExampleChars);

  const checkDeadline = (phase: string): void => {
    if (now() - startedAt > limits.parseBudgetMs) throw new GtfsBudgetError(phase, limits.parseBudgetMs);
  };

  /** Stream one table, counting rows and honouring both bounds. */
  const eachRow = async (
    table: string,
    phase: string,
    handler: (row: Record<string, string>, index: number) => void,
  ): Promise<number> => {
    let index = 0;
    for await (const row of archive.streamTable(table)) {
      if (index >= limits.maxRowsPerTable) throw new GtfsRowLimitError(table, limits.maxRowsPerTable);
      handler(row, index);
      index += 1;
      if (index % DEADLINE_CHECK_ROW_INTERVAL === 0) checkDeadline(phase);
    }
    checkDeadline(phase);
    return index;
  };

  /* ------------------------------------------------------------------ stops */

  const stopIds = new StringInterner();
  const stops: GtfsStopRecord[] = [];
  const stopRecordByIndex = new Map<number, GtfsStopRecord>();

  await eachRow("stops.txt", "reading stops", (row) => {
    const stopId = cell(row, "stop_id");
    if (!stopId) {
      warnings.add("bad_csv_row", "stops.txt row with no stop_id");
      return;
    }
    const lat = parseFloatCell(row, "stop_lat");
    const lon = parseFloatCell(row, "stop_lon");
    if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      // A stop we cannot place is not a stop we can report service at. It is
      // dropped from the interner, which turns every later reference to it into
      // a counted `dangling_stop_reference` rather than a silently mislocated
      // pin. `gtfs_skim.py` makes the same choice for the same reason.
      warnings.add("bad_csv_row", `stops.txt ${stopId} has no usable coordinates`);
      return;
    }
    const record: GtfsStopRecord = {
      stopId,
      name: optionalCell(row, "stop_name"),
      lat,
      lon,
      locationType: parseIntegerCell(row, "location_type"),
      parentStation: optionalCell(row, "parent_station"),
      wheelchairBoarding: parseIntegerCell(row, "wheelchair_boarding"),
    };
    const existingIndex = stopIds.lookup(stopId);
    if (existingIndex >= 0) {
      warnings.add("duplicate_key", `stops.txt stop_id ${stopId}`);
      stopRecordByIndex.set(existingIndex, record);
      return;
    }
    const index = stopIds.intern(stopId);
    stopRecordByIndex.set(index, record);
  });

  for (let index = 0; index < stopIds.size; index += 1) {
    const record = stopRecordByIndex.get(index);
    if (record) stops.push(record);
  }

  if (stops.length === 0) {
    return {
      ok: false,
      code: "no_usable_stops",
      detail:
        "No stop in this feed has usable coordinates, so nothing in it can be placed on a map or counted at a " +
        "location. Check that stops.txt has stop_lat and stop_lon columns with numeric values.",
    };
  }

  /* ----------------------------------------------------------------- routes */

  const routeIds = new StringInterner();
  const routeRecordByIndex = new Map<number, GtfsRouteRecord>();

  await eachRow("routes.txt", "reading routes", (row) => {
    const routeId = cell(row, "route_id");
    if (!routeId) {
      warnings.add("bad_csv_row", "routes.txt row with no route_id");
      return;
    }
    const record: GtfsRouteRecord = {
      routeId,
      agencyId: optionalCell(row, "agency_id"),
      shortName: optionalCell(row, "route_short_name"),
      longName: optionalCell(row, "route_long_name"),
      routeType: parseIntegerCell(row, "route_type"),
      color: optionalCell(row, "route_color"),
      textColor: optionalCell(row, "route_text_color"),
    };
    const existing = routeIds.lookup(routeId);
    if (existing >= 0) {
      warnings.add("duplicate_key", `routes.txt route_id ${routeId}`);
      routeRecordByIndex.set(existing, record);
      return;
    }
    routeRecordByIndex.set(routeIds.intern(routeId), record);
  });

  const routes: GtfsRouteRecord[] = [];
  for (let index = 0; index < routeIds.size; index += 1) {
    const record = routeRecordByIndex.get(index);
    if (record) routes.push(record);
  }

  /* --------------------------------------------------------- agency + info */

  const agencies: GtfsAgencyRecord[] = [];
  await eachRow("agency.txt", "reading agencies", (row) => {
    const name = cell(row, "agency_name");
    if (!name) {
      warnings.add("bad_csv_row", "agency.txt row with no agency_name");
      return;
    }
    agencies.push({
      agencyId: optionalCell(row, "agency_id"),
      name,
      url: optionalCell(row, "agency_url"),
      // NOT defaulted. See GtfsAgencyRecord — inventing a timezone is inventing
      // a fact about somebody else's system, and every derived time here is
      // relative to the service day anyway, so nothing needs a guess.
      timezone: optionalCell(row, "agency_timezone"),
      lang: optionalCell(row, "agency_lang"),
      phone: optionalCell(row, "agency_phone"),
    });
  });

  let feedInfo: GtfsFeedInfoRecord | null = null;
  await eachRow("feed_info.txt", "reading feed info", (row, index) => {
    if (index > 0) return;
    feedInfo = {
      publisherName: optionalCell(row, "feed_publisher_name"),
      publisherUrl: optionalCell(row, "feed_publisher_url"),
      lang: optionalCell(row, "feed_lang"),
      startDate: optionalCell(row, "feed_start_date"),
      endDate: optionalCell(row, "feed_end_date"),
      version: optionalCell(row, "feed_version"),
    };
  });

  /* --------------------------------------------------------------- calendar */

  const calendar = await readServiceCalendar({ eachRow, warnings });

  /* ------------------------------------------------------------------ trips */

  const tripIndexById = new Map<string, number>();
  const tripRoute = new Int32Column();
  const tripService = new Int32Column();
  const tripDirection = new Int32Column();
  /** Trips per service id, which is how a representative date is chosen. */
  const tripsPerService = new Map<number, number>();
  /** (routeIndex, directionId) -> a dense entity index for the route histogram. */
  const routeDirectionIndex = new Map<string, number>();
  const routeDirectionRoute: number[] = [];
  const routeDirectionDirection: (number | null)[] = [];
  const tripRouteDirection = new Int32Column();

  const tripRows = await eachRow("trips.txt", "reading trips", (row) => {
    const tripId = cell(row, "trip_id");
    const routeId = cell(row, "route_id");
    const serviceId = cell(row, "service_id");
    if (!tripId || !routeId || !serviceId) {
      warnings.add("bad_csv_row", `trips.txt row missing trip_id/route_id/service_id: ${tripId || "(no trip_id)"}`);
      return;
    }
    if (tripIndexById.has(tripId)) {
      warnings.add("duplicate_key", `trips.txt trip_id ${tripId}`);
      // Last wins, matching every other table here. The earlier slot is left in
      // place and simply stops being reachable by id.
    }
    const routeIndex = routeIds.lookup(routeId);
    const serviceIndex = calendar.serviceIds.lookup(serviceId);
    if (serviceIndex < 0) {
      // The trip runs on no day either calendar file describes, so it cannot be
      // attributed to a service day at all. Counted, not fatal.
      warnings.add("dangling_service_reference", `trips.txt ${tripId} -> service_id ${serviceId}`);
      return;
    }
    if (routeIndex < 0) {
      warnings.add("bad_csv_row", `trips.txt ${tripId} -> unknown route_id ${routeId}`);
      return;
    }

    const rawDirection = parseIntegerCell(row, "direction_id");
    const direction = rawDirection === null || rawDirection < 0 ? null : rawDirection;
    const key = `${routeIndex}:${direction ?? "null"}`;
    let entityIndex = routeDirectionIndex.get(key);
    if (entityIndex === undefined) {
      entityIndex = routeDirectionRoute.length;
      routeDirectionIndex.set(key, entityIndex);
      routeDirectionRoute.push(routeIndex);
      routeDirectionDirection.push(direction);
    }

    const slot = tripRoute.length;
    tripRoute.push(routeIndex);
    tripService.push(serviceIndex);
    tripDirection.push(direction ?? -1);
    tripRouteDirection.push(entityIndex);
    tripIndexById.set(tripId, slot);
    tripsPerService.set(serviceIndex, (tripsPerService.get(serviceIndex) ?? 0) + 1);
  });

  /* ------------------------------------------------------------ frequencies */

  const frequencyWindowsByTrip = await readFrequencies({ eachRow, warnings, tripIndexById });

  /* ------------------------------------------------------------- stop_times */

  const stopHistogram = new DepartureHistogram({
    maxPairs: limits.maxStopServicePairs,
    onWarning: (code, example) => warnings.add(code, example),
  });
  const routeHistogram = new DepartureHistogram({
    maxPairs: limits.maxRouteServicePairs,
    onWarning: (code, example) => warnings.add(code, example),
  });

  /**
   * Per trip, the earliest-sequence departure seen — the trip's own start.
   *
   * The sentinel is `INT32_MAX`, NOT `Number.MAX_SAFE_INTEGER`. Writing
   * MAX_SAFE_INTEGER into an Int32Array wraps it to -1, no comparison would
   * ever be less than that, and every route-level departure in every feed would
   * be silently dropped — a whole half of this lane's output, with a green
   * suite, because a stop-level test would not notice.
   */
  const tripFirstSequence = new Int32Array(tripRoute.length).fill(0x7fffffff);
  const tripFirstDeparture = new Int32Array(tripRoute.length).fill(-1);

  // Buffered rows for frequency-based trips only. See limits.ts for why holding
  // these is affordable and why holding all of stop_times would not be.
  const bufferedTrip = new Int32Column();
  const bufferedStop = new Int32Column();
  const bufferedSeconds = new Int32Column();
  const bufferedSequence = new Int32Column();

  let stopTimesWithoutTime = 0;

  /*
   * WHICH ROUTES SERVE WHICH STOPS, per service. Membership, not departures —
   * so it is recorded once per (stop, service, route) rather than once per
   * departure, and it is unaffected by whether the trip is schedule- or
   * frequency-based.
   *
   * Kept as sets rather than counters because a stop's ROUTE LIST is what
   * distinguishes a transfer point from a corridor, and because a counter
   * cannot be summed across the several service ids that make up one day name
   * without double-counting a route that appears in two of them.
   */
  const stopRoutesByService = new Map<number, Map<number, Set<number>>>();
  const routeStopsByService = new Map<number, Map<number, Set<number>>>();

  const recordMembership = (
    index: Map<number, Map<number, Set<number>>>,
    entityIndex: number,
    serviceIndex: number,
    memberIndex: number,
  ): void => {
    let byService = index.get(entityIndex);
    if (!byService) {
      byService = new Map<number, Set<number>>();
      index.set(entityIndex, byService);
    }
    let members = byService.get(serviceIndex);
    if (!members) {
      members = new Set<number>();
      byService.set(serviceIndex, members);
    }
    members.add(memberIndex);
  };

  const stopTimesRows = await eachRow("stop_times.txt", "reading stop times", (row) => {
    const tripId = cell(row, "trip_id");
    const tripSlot = tripId ? tripIndexById.get(tripId) : undefined;
    if (tripSlot === undefined) {
      warnings.add("dangling_trip_reference", `stop_times.txt -> trip_id ${tripId || "(blank)"}`);
      return;
    }

    const rawTime = cell(row, "departure_time") || cell(row, "arrival_time");
    if (!rawTime) {
      // Legal GTFS: only timepoints require a time. Counted separately from a
      // MALFORMED time, because one is the spec working as intended and the
      // other is a broken export, and telling an agency the wrong one wastes
      // their afternoon.
      stopTimesWithoutTime += 1;
      return;
    }
    const seconds = parseGtfsTimeToSeconds(rawTime);
    if (seconds === null) {
      warnings.add("bad_time_value", `stop_times.txt ${tripId} -> "${rawTime}"`);
      return;
    }

    const sequence = parseIntegerCell(row, "stop_sequence") ?? 0;
    if (sequence < tripFirstSequence[tripSlot]) {
      tripFirstSequence[tripSlot] = sequence;
      tripFirstDeparture[tripSlot] = seconds;
    }

    const stopId = cell(row, "stop_id");
    let stopIndex = stopId ? stopIds.lookup(stopId) : -1;
    if (stopIndex < 0) {
      // "The ordinary case, not a pathological one" — gtfs_skim.py's words, and
      // it is right. The departure still counts toward its ROUTE, because the
      // time is real; it cannot count toward a STOP, because we do not know
      // where that stop is.
      warnings.add("dangling_stop_reference", `stop_times.txt ${tripId} -> stop_id ${stopId || "(blank)"}`);
      stopIndex = -1;
    }

    // Membership is recorded before the frequency branch, because a route
    // serves a stop whether its departures are listed or stated as a headway.
    if (stopIndex >= 0) {
      const serviceIndex = tripService.get(tripSlot);
      recordMembership(stopRoutesByService, stopIndex, serviceIndex, tripRoute.get(tripSlot));
      recordMembership(routeStopsByService, tripRouteDirection.get(tripSlot), serviceIndex, stopIndex);
    }

    if (frequencyWindowsByTrip.has(tripSlot)) {
      if (bufferedTrip.length >= limits.maxBufferedFrequencyStopTimes) {
        throw new GtfsRowLimitError("stop_times.txt (frequency-based trips)", limits.maxBufferedFrequencyStopTimes);
      }
      bufferedTrip.push(tripSlot);
      bufferedStop.push(stopIndex);
      bufferedSeconds.push(seconds);
      bufferedSequence.push(sequence);
      return;
    }

    if (stopIndex >= 0) {
      const serviceIndex = tripService.get(tripSlot);
      if (!stopHistogram.addDeparture(stopIndex, serviceIndex, seconds, "scheduled")) {
        throw new GtfsPairLimitError("stop", limits.maxStopServicePairs);
      }
    }
  });

  /*
   * ROUTE-LEVEL DEPARTURES ARE COUNTED ONCE PER TRIP, at the trip's own first
   * stop — never once per stop_times row, which would multiply a route's
   * frequency by the number of stops on it and report a 30-minute route as
   * running every thirty seconds.
   *
   * Done here rather than in the stream because a trip's first stop is only
   * knowable once its rows are all seen: GTFS requires stop_times to be ordered
   * by stop_sequence within a trip but does not require the trips themselves to
   * be grouped, and a feed that interleaves them must not silently lose service.
   */
  for (let slot = 0; slot < tripRoute.length; slot += 1) {
    const departure = tripFirstDeparture[slot];
    if (departure < 0) continue;
    if (frequencyWindowsByTrip.has(slot)) continue;
    if (!routeHistogram.addDeparture(tripRouteDirection.get(slot), tripService.get(slot), departure, "scheduled")) {
      throw new GtfsPairLimitError("route", limits.maxRouteServicePairs);
    }
  }

  const frequencyStats = expandFrequencyTrips({
    frequencyWindowsByTrip,
    buffered: {
      trip: bufferedTrip,
      stop: bufferedStop,
      seconds: bufferedSeconds,
      sequence: bufferedSequence,
    },
    tripService,
    tripRouteDirection,
    stopHistogram,
    routeHistogram,
    warnings,
    limits,
    checkDeadline,
  });

  checkDeadline("deriving service levels");

  /* ---------------------------------------------------- representative dates */

  const serviceDayBases = chooseRepresentativeDates({ calendar, tripsPerService, warnings, limits });

  /* ------------------------------------------------------------- derivation */

  const stopServiceLevels: GtfsStopServiceLevel[] = [];
  const routeServiceLevels: GtfsRouteServiceLevel[] = [];

  for (const basis of serviceDayBases) {
    const serviceIndexes = basis.serviceIds
      .map((serviceId) => calendar.serviceIds.lookup(serviceId))
      .filter((index) => index >= 0);
    if (serviceIndexes.length === 0) continue;

    /** Union a membership index across the service ids that make up this day. */
    const membersFor = (
      index: Map<number, Map<number, Set<number>>>,
      entityIndex: number,
    ): number[] => {
      const byService = index.get(entityIndex);
      if (!byService) return [];
      const union = new Set<number>();
      for (const serviceIndex of serviceIndexes) {
        const members = byService.get(serviceIndex);
        if (!members) continue;
        for (const member of members) union.add(member);
      }
      return [...union];
    };

    for (const stopIndex of stopHistogram.entityIndexes()) {
      const aggregated = stopHistogram.aggregate(stopIndex, serviceIndexes);
      if (!aggregated) continue;
      const metrics = deriveServiceLevelMetrics(aggregated);
      if (metrics.tripsPerDay === 0) continue;
      const routeIdsHere = membersFor(stopRoutesByService, stopIndex)
        .map((index) => routeIds.valueAt(index))
        .sort();
      stopServiceLevels.push({
        stopId: stopIds.valueAt(stopIndex),
        serviceDay: basis.serviceDay,
        representativeDate: basis.representativeDate,
        routeIds: routeIdsHere,
        routesServing: routeIdsHere.length,
        ...metrics,
      });
    }

    for (const entityIndex of routeHistogram.entityIndexes()) {
      const aggregated = routeHistogram.aggregate(entityIndex, serviceIndexes);
      if (!aggregated) continue;
      const metrics = deriveServiceLevelMetrics(aggregated);
      if (metrics.tripsPerDay === 0) continue;
      routeServiceLevels.push({
        routeId: routeIds.valueAt(routeDirectionRoute[entityIndex]),
        directionId: routeDirectionDirection[entityIndex],
        serviceDay: basis.serviceDay,
        representativeDate: basis.representativeDate,
        stopsServed: membersFor(routeStopsByService, entityIndex).length,
        ...metrics,
      });
    }
    checkDeadline("deriving service levels");
  }

  if (stopServiceLevels.length === 0 && routeServiceLevels.length === 0) {
    return {
      ok: false,
      code: "no_usable_service",
      detail:
        "This feed parsed, but it produced no departures on any service day — every trip either has no stop times, " +
        "no readable departure times, or runs on no day the calendar describes. There is nothing to report service " +
        "levels from.",
    };
  }

  const scheduledTrips = tripRoute.length - frequencyWindowsByTrip.size;
  const derivationMethod =
    frequencyStats.frequencyTripsExpanded === 0
      ? "scheduled"
      : scheduledTrips === 0
        ? "frequencies"
        : "mixed";

  return {
    ok: true,
    feed: {
      filesPresent: archive.tableNames,
      agencies,
      feedInfo,
      routes,
      stops,
      serviceWindow: calendar.window,
      serviceDayBases,
      stopServiceLevels,
      routeServiceLevels,
      derivationMethod,
      warnings: warnings.toArray(),
      stats: {
        archiveBytes: context.archiveBytes,
        bytesDecompressed: archive.bytesDecompressed,
        elapsedMs: now() - startedAt,
        stopTimesRows,
        stopTimesWithoutTime,
        tripRows,
        stopServicePairs: stopHistogram.pairCount,
        routeServicePairs: routeHistogram.pairCount,
        scheduledTrips,
        frequencyTrips: frequencyStats.frequencyTripsExpanded,
        exactTimesFrequencyTrips: frequencyStats.exactTimesTrips,
      },
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Calendar                                                                    */
/* -------------------------------------------------------------------------- */

type ServiceCalendar = {
  serviceIds: StringInterner;
  /** Per service index, a 7-bit mask in GTFS_SERVICE_DAY_NAMES order. */
  weekdayMask: Map<number, number>;
  startDate: Map<number, number>;
  endDate: Map<number, number>;
  /** dateInt -> serviceIndex -> 1 (added) or 2 (removed). */
  exceptions: Map<number, Map<number, number>>;
  window: GtfsServiceWindow;
  /** All dates named by calendar_dates, so they are considered even out of window. */
  exceptionDates: number[];
};

async function readServiceCalendar(input: {
  eachRow: (
    table: string,
    phase: string,
    handler: (row: Record<string, string>, index: number) => void,
  ) => Promise<number>;
  warnings: WarningCollector;
}): Promise<ServiceCalendar> {
  const { eachRow, warnings } = input;
  const serviceIds = new StringInterner();
  const weekdayMask = new Map<number, number>();
  const startDate = new Map<number, number>();
  const endDate = new Map<number, number>();
  const exceptions = new Map<number, Map<number, number>>();

  await eachRow("calendar.txt", "reading the service calendar", (row) => {
    const serviceId = cell(row, "service_id");
    if (!serviceId) {
      warnings.add("bad_csv_row", "calendar.txt row with no service_id");
      return;
    }
    const index = serviceIds.intern(serviceId);
    if (weekdayMask.has(index)) warnings.add("duplicate_key", `calendar.txt service_id ${serviceId}`);

    let mask = 0;
    GTFS_SERVICE_DAY_NAMES.forEach((day, bit) => {
      if (cell(row, day) === "1") mask |= 1 << bit;
    });
    weekdayMask.set(index, mask);

    const start = parseGtfsDate(cell(row, "start_date"));
    const end = parseGtfsDate(cell(row, "end_date"));
    if (start === null || end === null) {
      warnings.add("bad_csv_row", `calendar.txt ${serviceId} has an unreadable start_date/end_date`);
      return;
    }
    startDate.set(index, start);
    endDate.set(index, end);
  });

  const exceptionDates = new Set<number>();

  await eachRow("calendar_dates.txt", "reading calendar exceptions", (row) => {
    const serviceId = cell(row, "service_id");
    const date = parseGtfsDate(cell(row, "date"));
    const exceptionType = parseIntegerCell(row, "exception_type");
    if (!serviceId || date === null || (exceptionType !== 1 && exceptionType !== 2)) {
      warnings.add("bad_csv_row", `calendar_dates.txt row unreadable: ${serviceId || "(no service_id)"}`);
      return;
    }
    const index = serviceIds.intern(serviceId);
    const byService = exceptions.get(date) ?? new Map<number, number>();
    byService.set(index, exceptionType);
    exceptions.set(date, byService);
    exceptionDates.add(date);
  });

  // THE WINDOW IS MIN/MAX OVER BOTH FILES. A window read only from calendar.txt
  // reports nothing for the two-in-sixteen agencies that publish only
  // calendar_dates.txt, and a working feed then looks undated.
  //
  // Accumulated into arrays rather than running min/max into a `let` because
  // these are written inside a callback: TypeScript's control-flow analysis
  // narrows a `let x: number | null = null` back to `null` at the point of use,
  // and the resulting code either fails to compile or quietly compares against
  // a type that no longer includes a number.
  const calendarDates = [...startDate.values(), ...endDate.values()];
  const startCandidates = [...calendarDates, ...exceptionDates];
  const endCandidates = startCandidates;
  const source: GtfsServiceWindowSource =
    calendarDates.length > 0 && exceptionDates.size > 0
      ? "both"
      : calendarDates.length > 0
        ? "calendar"
        : exceptionDates.size > 0
          ? "calendar_dates"
          : "none";

  return {
    serviceIds,
    weekdayMask,
    startDate,
    endDate,
    exceptions,
    exceptionDates: [...exceptionDates].sort((a, b) => a - b),
    window: {
      startDate: startCandidates.length > 0 ? formatGtfsDate(Math.min(...startCandidates)) : null,
      endDate: endCandidates.length > 0 ? formatGtfsDate(Math.max(...endCandidates)) : null,
      source,
    },
  };
}

/**
 * CHOOSING THE ONE DATE EACH DAY NAME'S COUNTS DESCRIBE.
 *
 * A feed's Tuesdays are not interchangeable. Services start and end mid-window,
 * `calendar_dates.txt` adds and removes service by date, and a school-term
 * service and a summer service routinely both exist in one feed. Summing every
 * service that is ever active on a Tuesday would double or triple that day's
 * trips — alternating-week services would be added together as though they ran
 * simultaneously.
 *
 * So each day name gets ONE DATE: the date of that weekday, inside the feed's
 * window, with the most scheduled trips. That is the same "busiest wins" rule
 * `gtfs_skim.py` uses to pick its single modeled day, generalised to seven, and
 * ranked by TRIP VOLUME rather than by count of service ids for the reason its
 * comment gives — a day split across many small service ids must not out-rank a
 * busy day with one.
 *
 * THE DATE IS REPORTED, which is the part that makes the number auditable. "42
 * trips on Tuesday" cannot be checked by anybody; "42 trips on Tuesday, as
 * scheduled on 2026-09-15" can be checked against the agency's own timetable in
 * about a minute.
 *
 * IT DOES NOT DEPEND ON TODAY'S DATE, deliberately. Ranking by "the next
 * Tuesday" would make the same feed derive different numbers on different days,
 * and a planning record that changes when nothing changed is not a record. The
 * window is reported alongside, so a feed that expired last year is visible as
 * an expired feed rather than as a wrong one.
 */
function chooseRepresentativeDates(input: {
  calendar: ServiceCalendar;
  tripsPerService: Map<number, number>;
  warnings: WarningCollector;
  limits: ResolvedGtfsLimits;
}): GtfsServiceDayBasis[] {
  const { calendar, tripsPerService, warnings, limits } = input;

  const starts = [...calendar.startDate.values()];
  const ends = [...calendar.endDate.values()];
  const candidateBounds = [...starts, ...ends, ...calendar.exceptionDates];
  if (candidateBounds.length === 0) {
    return GTFS_SERVICE_DAY_NAMES.map((serviceDay) => ({
      serviceDay,
      representativeDate: null,
      serviceIds: [],
      tripCount: 0,
      candidateDateCount: 0,
    }));
  }

  const windowStart = Math.min(...candidateBounds);
  const windowEnd = Math.max(...candidateBounds);

  type Best = { date: number; tripCount: number; serviceIndexes: number[]; candidates: number };
  const best = new Map<GtfsServiceDayName, Best>();

  let cursor = dateIntToUtc(windowStart);
  const end = dateIntToUtc(windowEnd);
  let examined = 0;
  let truncated = false;

  while (cursor.getTime() <= end.getTime()) {
    if (examined >= limits.maxServiceDates) {
      truncated = true;
      break;
    }
    examined += 1;
    const dateInt = utcToDateInt(cursor);
    const dayName = WEEKDAY_INDEX_TO_DAY_NAME[cursor.getUTCDay()];
    const bit = GTFS_SERVICE_DAY_NAMES.indexOf(dayName);

    const active = new Set<number>();
    for (const [serviceIndex, mask] of calendar.weekdayMask) {
      if ((mask & (1 << bit)) === 0) continue;
      const start = calendar.startDate.get(serviceIndex);
      const stop = calendar.endDate.get(serviceIndex);
      if (start === undefined || stop === undefined) continue;
      if (dateInt < start || dateInt > stop) continue;
      active.add(serviceIndex);
    }
    const overrides = calendar.exceptions.get(dateInt);
    if (overrides) {
      for (const [serviceIndex, exceptionType] of overrides) {
        if (exceptionType === 1) active.add(serviceIndex);
        else active.delete(serviceIndex);
      }
    }

    const existing = best.get(dayName);
    const candidates = (existing?.candidates ?? 0) + 1;
    if (active.size > 0) {
      let tripCount = 0;
      for (const serviceIndex of active) tripCount += tripsPerService.get(serviceIndex) ?? 0;
      if (!existing || tripCount > existing.tripCount) {
        best.set(dayName, { date: dateInt, tripCount, serviceIndexes: [...active], candidates });
        cursor = new Date(cursor.getTime() + 86_400_000);
        continue;
      }
    }
    if (existing) existing.candidates = candidates;
    else best.set(dayName, { date: 0, tripCount: 0, serviceIndexes: [], candidates });
    cursor = new Date(cursor.getTime() + 86_400_000);
  }

  if (truncated) {
    warnings.add(
      "service_window_truncated",
      `the feed's calendar spans more than ${limits.maxServiceDates} days; only the first ${limits.maxServiceDates} were examined`,
    );
  }

  return GTFS_SERVICE_DAY_NAMES.map((serviceDay) => {
    const chosen = best.get(serviceDay);
    if (!chosen || chosen.date === 0) {
      return {
        serviceDay,
        representativeDate: null,
        serviceIds: [],
        tripCount: 0,
        candidateDateCount: chosen?.candidates ?? 0,
      };
    }
    return {
      serviceDay,
      representativeDate: formatGtfsDate(chosen.date),
      serviceIds: chosen.serviceIndexes.map((index) => calendar.serviceIds.valueAt(index)).sort(),
      tripCount: chosen.tripCount,
      candidateDateCount: chosen.candidates,
    };
  });
}

/* -------------------------------------------------------------------------- */
/* frequencies.txt                                                             */
/* -------------------------------------------------------------------------- */

type FrequencyWindow = { start: number; end: number; headwaySeconds: number; exactTimes: boolean };

async function readFrequencies(input: {
  eachRow: (
    table: string,
    phase: string,
    handler: (row: Record<string, string>, index: number) => void,
  ) => Promise<number>;
  warnings: WarningCollector;
  tripIndexById: Map<string, number>;
}): Promise<Map<number, FrequencyWindow[]>> {
  const { eachRow, warnings, tripIndexById } = input;
  const byTrip = new Map<number, FrequencyWindow[]>();

  await eachRow("frequencies.txt", "reading frequencies", (row) => {
    const tripId = cell(row, "trip_id");
    const start = parseGtfsTimeToSeconds(cell(row, "start_time"));
    const end = parseGtfsTimeToSeconds(cell(row, "end_time"));
    const headway = parseIntegerCell(row, "headway_secs");
    if (!tripId || start === null || end === null || headway === null || headway <= 0 || end <= start) {
      warnings.add("bad_frequency_row", `frequencies.txt ${tripId || "(no trip_id)"}`);
      return;
    }
    const tripSlot = tripIndexById.get(tripId);
    if (tripSlot === undefined) {
      warnings.add("dangling_trip_reference", `frequencies.txt -> trip_id ${tripId}`);
      return;
    }
    const exactTimes = parseIntegerCell(row, "exact_times") === 1;
    if (exactTimes) {
      // NOT AN ERROR. exact_times=1 means the departures really are at
      // start, start+headway, ... rather than approximately so — which expands
      // IDENTICALLY for counting. Recorded rather than flattened away, because
      // the distinction matters to anyone reading the derivation method and
      // costs one counter to keep.
      warnings.add("frequency_exact_times", `frequencies.txt ${tripId} declares exact_times=1`);
    }
    const windows = byTrip.get(tripSlot) ?? [];
    windows.push({ start, end, headwaySeconds: headway, exactTimes });
    byTrip.set(tripSlot, windows);
  });

  return byTrip;
}

/**
 * EXPANDING FREQUENCY-BASED TRIPS INTO DEPARTURES.
 *
 * A frequency window states that the trip departs every `headway_secs` from
 * `start_time` up to (not including) `end_time`. Each run's departure at a given
 * stop is the run's start plus that stop's OFFSET within the trip — the
 * difference between its own stop_time and the trip's first stop_time — which is
 * why the trip's rows had to be held until now.
 *
 * PER TRIP, NOT PER FEED. A feed with four frequency rows covering two of its
 * 18,150 trips gets those two expanded and the other 18,148 counted from their
 * schedules. `gtfs_skim.py` refuses the whole feed instead, which is right for
 * what it does and wrong here — see the header of this file.
 */
function expandFrequencyTrips(input: {
  frequencyWindowsByTrip: Map<number, FrequencyWindow[]>;
  buffered: { trip: Int32Column; stop: Int32Column; seconds: Int32Column; sequence: Int32Column };
  tripService: Int32Column;
  tripRouteDirection: Int32Column;
  stopHistogram: DepartureHistogram;
  routeHistogram: DepartureHistogram;
  warnings: WarningCollector;
  limits: ResolvedGtfsLimits;
  checkDeadline: (phase: string) => void;
}): { frequencyTripsExpanded: number; exactTimesTrips: number } {
  const {
    frequencyWindowsByTrip,
    buffered,
    tripService,
    tripRouteDirection,
    stopHistogram,
    routeHistogram,
    warnings,
    limits,
    checkDeadline,
  } = input;

  if (frequencyWindowsByTrip.size === 0) return { frequencyTripsExpanded: 0, exactTimesTrips: 0 };

  // Group the buffered rows by trip. Rows are few by construction, so an array
  // of indexes per trip is affordable here in a way it never would be for the
  // whole of stop_times.
  const rowsByTrip = new Map<number, number[]>();
  for (let i = 0; i < buffered.trip.length; i += 1) {
    const tripSlot = buffered.trip.get(i);
    const rows = rowsByTrip.get(tripSlot) ?? [];
    rows.push(i);
    rowsByTrip.set(tripSlot, rows);
  }

  let expandedDepartures = 0;
  let frequencyTripsExpanded = 0;
  let exactTimesTrips = 0;
  const source: DepartureSource = "frequencies";

  for (const [tripSlot, windows] of frequencyWindowsByTrip) {
    const rows = rowsByTrip.get(tripSlot);
    if (!rows || rows.length === 0) {
      warnings.add("frequency_trip_without_stop_times", `trip slot ${tripSlot} has frequencies but no stop times`);
      continue;
    }
    // The trip's base is its lowest stop_sequence, not its earliest row.
    let baseSequence = Number.MAX_SAFE_INTEGER;
    let baseSeconds = 0;
    for (const rowIndex of rows) {
      const sequence = buffered.sequence.get(rowIndex);
      if (sequence < baseSequence) {
        baseSequence = sequence;
        baseSeconds = buffered.seconds.get(rowIndex);
      }
    }

    const serviceIndex = tripService.get(tripSlot);
    const routeEntity = tripRouteDirection.get(tripSlot);
    if (windows.some((window) => window.exactTimes)) exactTimesTrips += 1;
    frequencyTripsExpanded += 1;

    for (const window of windows) {
      for (let runStart = window.start; runStart < window.end; runStart += window.headwaySeconds) {
        // One route-level departure per RUN, at the trip's first stop.
        if (!routeHistogram.addDeparture(routeEntity, serviceIndex, runStart, source)) {
          throw new GtfsPairLimitError("route", limits.maxRouteServicePairs);
        }
        for (const rowIndex of rows) {
          const stopIndex = buffered.stop.get(rowIndex);
          if (stopIndex < 0) continue;
          expandedDepartures += 1;
          if (expandedDepartures > limits.maxExpandedFrequencyDepartures) {
            throw new GtfsRowLimitError("frequencies.txt (expanded departures)", limits.maxExpandedFrequencyDepartures);
          }
          const offset = buffered.seconds.get(rowIndex) - baseSeconds;
          if (!stopHistogram.addDeparture(stopIndex, serviceIndex, runStart + offset, source)) {
            throw new GtfsPairLimitError("stop", limits.maxStopServicePairs);
          }
        }
        if (expandedDepartures % 100_000 === 0) checkDeadline("expanding frequency-based trips");
      }
    }
  }

  return { frequencyTripsExpanded, exactTimesTrips };
}

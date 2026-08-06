/**
 * THE HISTOGRAM, AND EVERY NUMBER DERIVED FROM IT. Pure — no zip, no database,
 * no clock. Feed it departures, ask it for service levels.
 *
 * ================================================================= THE PROBLEM
 *
 * King County Metro's `stop_times.txt` holds 2,167,134 rows (measured
 * 2026-08-05); CTA Chicago's is roughly six times that. Keeping every departure
 * time in a JavaScript array — the obvious implementation, and the one a reader
 * would expect — costs eight bytes per number plus array overhead, and the
 * arrays are per stop, so a CTA-class feed lands somewhere near half a gigabyte
 * for a job whose OUTPUT is a few tens of thousands of rows. On a serverless
 * function that is not slow, it is dead.
 *
 * ================================================================ THE SOLUTION
 *
 * Never keep a departure time. Keep a 30-bin `Uint16Array` histogram of the
 * clock hour it fell in, per (entity, service), plus the earliest and latest
 * departure as two `Int32Array` entries:
 *
 *     30 x Uint16 bins   60 bytes
 *     first departure     4 bytes   (Int32, seconds after service-day start)
 *     last  departure     4 bytes
 *     ------------------------------
 *                        68 bytes per (entity, service) pair
 *
 * MEMORY THEN DEPENDS ON ENTITIES x SERVICES, NOT ON ROW COUNT. A CTA-class
 * feed is roughly 11,000 stops x ~30 calendar services = ~330,000 pairs =
 * ~22 MB of payload, and that number does not move when the feed's 12 million
 * stop_times rows become 24 million. THAT BOUNDED-MEMORY PROPERTY IS THE ONLY
 * REASON INGESTING A FEED INSIDE A REQUEST IS DEFENSIBLE AT ALL; it is the
 * argument that makes the whole lane work without a worker, and anything that
 * reintroduces per-departure storage destroys it.
 *
 * Two things are stored SPARSELY rather than in the packed arrays, because they
 * are rare enough that a column for them would cost more than they do: the
 * count of departures that came from a `frequencies.txt` expansion, and the
 * count that fell past the last bin. Adding either as a fourth typed array
 * would cost 4 bytes on all 330,000 pairs to serve the handful that use it.
 *
 * ========================================================= WHAT IT TRADES AWAY
 *
 * A HEADWAY WITHIN AN HOUR BECOMES AN AVERAGE, NOT A MEASURED GAP. Six
 * departures in an hour report a 10-minute headway whether they were evenly
 * spaced or all six came within twelve minutes of each other. There is no way
 * to recover the difference once the times are gone, and the times are gone by
 * design.
 *
 * That is SCREENING-GRADE, and this codebase already has the vocabulary and the
 * habit for saying so. It is disclosed in `caveats.ts`, it is carried on every
 * row through `peakHeadwayIsLowerBound` and `medianHeadwayBasis`, and it is not
 * hidden behind a number that looks more precise than it is. The alternative —
 * a true measured headway — costs the per-departure storage above, and would
 * buy precision that a published static schedule does not really have anyway.
 *
 * ==================================== WHY 30 BINS AND NOT 24, WHICH IS THE BUG
 *
 * GTFS times legitimately exceed 24:00:00. A trip belonging to Tuesday's
 * service that leaves at forty minutes past midnight is written `24:40:00`, not
 * `00:40:00`, and the distinction is the whole point: the first is Tuesday
 * night's service and the second would be Tuesday morning's. With 24 bins that
 * departure either wraps into hour 0 — moving a night bus to dawn and corrupting
 * both the first-departure and the peak-hour derivation — or is dropped, which
 * silently deletes the late-evening service of every rail and night-owl operator
 * in the country. 30 bins covers every real feed's span; anything past 30:00:00
 * is counted in the totals and reported as `departure_past_bin_range` rather
 * than folded into a bin it does not belong in.
 */

import type {
  GtfsDerivationMethod,
  GtfsMedianHeadwayBasis,
  GtfsParseWarningCode,
} from "./types";

/**
 * BINS IN A SERVICE DAY'S HISTOGRAM. Read the header before changing this.
 * 30 = hours 0 through 29, i.e. up to 29:59:59 after service-day start.
 */
export const SERVICE_DAY_HOUR_BINS = 30;

const SECONDS_PER_HOUR = 3600;
const MINUTES_PER_HOUR = 60;

/** The ceiling of a `Uint16Array` bin. One more departure than this saturates it. */
const BIN_MAX = 65_535;

/**
 * THE TWO FREQUENT-SERVICE THRESHOLDS OPENPLAN REPORTS, AND WHY THERE ARE
 * EXACTLY TWO.
 *
 * 15 MINUTES is the common US and California statutory transit-priority test.
 * California defines a "major transit stop" and a "high-quality transit
 * corridor" around bus service with headways of 15 minutes or better during
 * peak commute periods, and those definitions drive CEQA streamlining, housing
 * density allowances and parking-requirement relief. A planner asking "which of
 * our stops qualify" is asking a 15-minute question, and it is usually the only
 * threshold in the statute.
 *
 * 30 MINUTES is here because 15 is useless in most of the country. A rural
 * agency where nothing anywhere is ever better than hourly gets one answer from
 * a 15-minute test — no — for every stop it owns, on every day, forever. That is
 * a report that cannot distinguish the county's busiest transit centre from a
 * flag stop with two buses a day, and it makes the whole measure worthless
 * exactly where planning capacity is thinnest. 30 minutes separates a corridor
 * from a lifeline route, which is the distinction a rural planner is actually
 * making.
 *
 * THEY ARE CONSTANTS, NOT LITERALS AT CALL SITES (product non-negotiable #0).
 * A threshold typed as `15` inside a query is a policy decision hidden in an
 * expression, and the next jurisdiction with a 20-minute test would need a code
 * change in every place it appears instead of one.
 *
 * NOT operator-tunable by environment variable, deliberately: these two tiers
 * are the reporting VOCABULARY the read layer and its labels are built on, and
 * a deployment that quietly redefined "frequent" to 45 minutes would publish
 * incomparable numbers under the same word. A per-workspace configured
 * threshold is a real future feature; it belongs in workspace configuration
 * with its own label, not in an env var that reinterprets an existing one.
 */
export const FREQUENT_SERVICE_HEADWAY_MINUTES = 15;

/** See `FREQUENT_SERVICE_HEADWAY_MINUTES` — the rural-legible second tier. */
export const BASIC_SERVICE_HEADWAY_MINUTES = 30;

/** Both tiers, tightest first. Iteration order is what picks the tier reported. */
export const FREQUENT_SERVICE_TIERS: readonly number[] = [
  FREQUENT_SERVICE_HEADWAY_MINUTES,
  BASIC_SERVICE_HEADWAY_MINUTES,
];

/**
 * GTFS `HH:MM:SS` (hours may and do exceed 24) to seconds after service-day
 * start. Null when the value is absent or cannot be read.
 *
 * DELIBERATE DIFFERENCES FROM `gtfs_skim.py`'s `_parse_gtfs_time`, which is the
 * domain reference for this lane:
 *
 *   - IT ACCEPTS `HH:MM` AS WELL AS `HH:MM:SS`. The reference requires exactly
 *     three parts. Two-part times are out of spec but are emitted by several
 *     GTFS-adjacent exporters, and `07:30` has exactly one possible meaning.
 *     Refusing it would drop real departures over a missing `:00`.
 *   - IT VALIDATES MINUTES AND SECONDS ARE UNDER 60, AND HOURS ARE NOT
 *     NEGATIVE. The reference does not, so `10:99:00` becomes 10:39 there.
 *     Here it is a `bad_time_value` and is counted, because a time that means
 *     nothing should be reported rather than quietly relocated.
 *
 * Empty is NOT a bad value and returns null without complaint: GTFS only
 * requires times at timepoints, so a blank `departure_time` is ordinary. The
 * caller counts those separately (`stopTimesWithoutTime`) precisely so the two
 * never blur.
 */
export function parseGtfsTimeToSeconds(value: string | undefined | null): number | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(":");
  if (parts.length !== 2 && parts.length !== 3) return null;
  const hours = Number(parts[0]);
  const minutes = Number(parts[1]);
  const seconds = parts.length === 3 ? Number(parts[2]) : 0;
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || !Number.isInteger(seconds)) return null;
  if (hours < 0 || minutes < 0 || seconds < 0) return null;
  if (minutes > 59 || seconds > 59) return null;
  return hours * SECONDS_PER_HOUR + minutes * MINUTES_PER_HOUR + seconds;
}

/** Where a departure came from. Carried per row so provenance survives the read. */
export type DepartureSource = "scheduled" | "frequencies";

/** One (entity, service) pair's accumulated departures, summed and ready to derive. */
export type AggregatedDepartures = {
  /** Length `SERVICE_DAY_HOUR_BINS`. Departures per clock hour of the service day. */
  bins: Uint32Array;
  firstDepartureSeconds: number | null;
  lastDepartureSeconds: number | null;
  frequencyDepartures: number;
  departuresBeyondBinRange: number;
};

/**
 * THE ACCUMULATOR. One per entity kind (stops, route-directions).
 *
 * Entities and services are addressed by INTEGER INDEX, not by id string. The
 * caller interns the ids once; this class never holds a string, which is what
 * keeps the per-pair cost at 68 bytes instead of 68 bytes plus two string
 * references and their backing characters.
 *
 * THE INDEX IS A NESTED MAP, entity -> (service -> slot), rather than one map
 * keyed on a packed integer. The nested form costs about the same (the inner
 * maps hold the same total number of entries) and it IS the by-entity index the
 * day-name rollup needs, which the flat form would have to build separately.
 */
export class DepartureHistogram {
  #capacity: number;
  #count = 0;
  #bins: Uint16Array;
  #first: Int32Array;
  #last: Int32Array;
  /** Sparse: slot -> departures that came from a frequencies.txt expansion. */
  readonly #frequencyDepartures = new Map<number, number>();
  /** Sparse: slot -> departures at or past 30:00:00, counted but unbinned. */
  readonly #beyondRange = new Map<number, number>();
  readonly #slots = new Map<number, Map<number, number>>();
  readonly #maxPairs: number;
  readonly #onWarning: (code: GtfsParseWarningCode, example?: string) => void;

  constructor(options: {
    maxPairs: number;
    onWarning: (code: GtfsParseWarningCode, example?: string) => void;
    /** Initial slot capacity. Only worth setting in a test. */
    initialCapacity?: number;
  }) {
    this.#maxPairs = options.maxPairs;
    this.#onWarning = options.onWarning;
    this.#capacity = Math.max(16, options.initialCapacity ?? 1024);
    this.#bins = new Uint16Array(this.#capacity * SERVICE_DAY_HOUR_BINS);
    this.#first = new Int32Array(this.#capacity);
    this.#last = new Int32Array(this.#capacity);
  }

  /** Live (entity, service) pairs. The number the memory bound is about. */
  get pairCount(): number {
    return this.#count;
  }

  get entityCount(): number {
    return this.#slots.size;
  }

  #grow(): void {
    // Doubling, which costs a transient 1.5x during the copy. A feed at the
    // pair ceiling therefore peaks around 150 MB rather than 100 MB, and that
    // is the honest number — stated here rather than in a claim of 100.
    const next = this.#capacity * 2;
    const bins = new Uint16Array(next * SERVICE_DAY_HOUR_BINS);
    bins.set(this.#bins);
    const first = new Int32Array(next);
    first.set(this.#first);
    const last = new Int32Array(next);
    last.set(this.#last);
    this.#bins = bins;
    this.#first = first;
    this.#last = last;
    this.#capacity = next;
  }

  /**
   * Reserve the slot for one (entity, service) pair, or null when the pair
   * ceiling is reached.
   *
   * Returning null rather than throwing lets the caller decide whether a feed
   * this large is a refusal or a truncation. `parse.ts` makes it a refusal:
   * silently stopping halfway would report a real agency's service as smaller
   * than it is, which is a wrong number rather than a missing one.
   */
  #slotFor(entityIndex: number, serviceIndex: number): number | null {
    let byService = this.#slots.get(entityIndex);
    if (!byService) {
      byService = new Map<number, number>();
      this.#slots.set(entityIndex, byService);
    }
    const existing = byService.get(serviceIndex);
    if (existing !== undefined) return existing;
    if (this.#count >= this.#maxPairs) return null;
    if (this.#count >= this.#capacity) this.#grow();
    const slot = this.#count++;
    this.#first[slot] = -1;
    this.#last[slot] = -1;
    byService.set(serviceIndex, slot);
    return slot;
  }

  /**
   * Record one departure.
   *
   * Returns false ONLY when the pair ceiling refused a new slot — every other
   * oddity (a saturated bin, a time past the last bin) is recorded as a warning
   * and still counted, because losing a departure silently is the failure mode
   * this whole lane is built to avoid.
   */
  addDeparture(
    entityIndex: number,
    serviceIndex: number,
    seconds: number,
    source: DepartureSource,
  ): boolean {
    const slot = this.#slotFor(entityIndex, serviceIndex);
    if (slot === null) return false;

    const current = this.#first[slot];
    if (current < 0 || seconds < current) this.#first[slot] = seconds;
    if (seconds > this.#last[slot]) this.#last[slot] = seconds;

    const hour = Math.floor(seconds / SECONDS_PER_HOUR);
    if (hour >= SERVICE_DAY_HOUR_BINS) {
      // Counted in the totals, absent from the histogram. Folding it into the
      // last bin would put a 31:00 departure in the 29:00 hour and corrupt the
      // peak; dropping it would understate the day's trips.
      this.#beyondRange.set(slot, (this.#beyondRange.get(slot) ?? 0) + 1);
      this.#onWarning("departure_past_bin_range", `${seconds}s after service-day start`);
    } else {
      const binIndex = slot * SERVICE_DAY_HOUR_BINS + hour;
      if (this.#bins[binIndex] >= BIN_MAX) {
        // 65,536 departures in one hour at one stop is not a thing that happens.
        // Recorded instead of wrapping to zero, which is what an unchecked
        // Uint16 increment does and is the worst possible outcome: the busiest
        // hour in the feed would report as the emptiest.
        this.#onWarning("bin_saturated", `hour ${hour} exceeded ${BIN_MAX} departures`);
      } else {
        this.#bins[binIndex] += 1;
      }
    }

    if (source === "frequencies") {
      this.#frequencyDepartures.set(slot, (this.#frequencyDepartures.get(slot) ?? 0) + 1);
    }
    return true;
  }

  /** Entity indexes that recorded at least one departure. */
  entityIndexes(): IterableIterator<number> {
    return this.#slots.keys();
  }

  /** Service indexes recorded for one entity. */
  serviceIndexesFor(entityIndex: number): IterableIterator<number> {
    return (this.#slots.get(entityIndex) ?? new Map<number, number>()).keys();
  }

  /**
   * Sum one entity's departures across a SET of services — which is how a GTFS
   * day name is answered.
   *
   * A day name is served by however many `service_id`s happen to be active on
   * it, so a "Tuesday" row is the sum of the Tuesday services' histograms.
   * Summing is exact for bins and counts, min/max for the endpoints, and it is
   * why the histogram is keyed by service and not by day: keying by day would
   * multiply the memory by five for the weekdays alone.
   *
   * Returns null when this entity had no departures on any of those services —
   * which is the normal case for most (stop, day) combinations and must not
   * produce a row of zeroes claiming the stop exists but is unserved. It does
   * not; it simply is not in that day's service.
   */
  aggregate(entityIndex: number, serviceIndexes: Iterable<number>): AggregatedDepartures | null {
    const byService = this.#slots.get(entityIndex);
    if (!byService) return null;

    const bins = new Uint32Array(SERVICE_DAY_HOUR_BINS);
    let first: number | null = null;
    let last: number | null = null;
    let frequencyDepartures = 0;
    let beyond = 0;
    let found = false;

    for (const serviceIndex of serviceIndexes) {
      const slot = byService.get(serviceIndex);
      if (slot === undefined) continue;
      found = true;
      const base = slot * SERVICE_DAY_HOUR_BINS;
      for (let hour = 0; hour < SERVICE_DAY_HOUR_BINS; hour += 1) {
        bins[hour] += this.#bins[base + hour];
      }
      const slotFirst = this.#first[slot];
      const slotLast = this.#last[slot];
      if (slotFirst >= 0 && (first === null || slotFirst < first)) first = slotFirst;
      if (slotLast >= 0 && (last === null || slotLast > last)) last = slotLast;
      frequencyDepartures += this.#frequencyDepartures.get(slot) ?? 0;
      beyond += this.#beyondRange.get(slot) ?? 0;
    }

    if (!found) return null;
    return {
      bins,
      firstDepartureSeconds: first,
      lastDepartureSeconds: last,
      frequencyDepartures,
      departuresBeyondBinRange: beyond,
    };
  }
}

/** Everything derivable from one aggregated histogram. */
export type ServiceLevelMetrics = {
  tripsPerDay: number;
  firstDepartureSeconds: number | null;
  lastDepartureSeconds: number | null;
  spanSeconds: number | null;
  peakHour: number | null;
  peakHourDepartures: number;
  peakHeadwayMinutes: number | null;
  peakHeadwayIsLowerBound: boolean;
  medianHeadwayMinutes: number | null;
  medianHeadwayBasis: GtfsMedianHeadwayBasis;
  servedHours: number;
  spanHours: number;
  frequentServiceTierMinutes: number | null;
  derivationMethod: GtfsDerivationMethod;
  scheduledTripCount: number;
  frequencyTripCount: number;
  departuresBeyondBinRange: number;
};

/** Round to one decimal so a headway reads as 7.5, not 7.499999999999999. */
function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * THE DERIVATION. Pure arithmetic over one aggregated histogram.
 *
 * THE PEAK IS THE BUSIEST CLOCK HOUR IN THE DATA. It is never an assumed
 * 06:00-09:00, and the derived hour is REPORTED so a planner can audit it. An
 * assumed peak window is a hardcoded agency convention (product non-negotiable
 * #0) and it is wrong for a system whose load is midday, school-bell or
 * shift-change shaped — which is most rural and many suburban systems. It also
 * hides its own error: a stop whose real peak is 14:00 reports its 07:00
 * service under the word "peak" and nothing in the output says otherwise.
 *
 * Ties go to the EARLIEST hour, so the same feed always derives the same peak.
 */
export function deriveServiceLevelMetrics(input: AggregatedDepartures): ServiceLevelMetrics {
  const { bins, frequencyDepartures, departuresBeyondBinRange } = input;

  let binTotal = 0;
  let firstBin = -1;
  let lastBin = -1;
  let peakHour: number | null = null;
  let peakHourDepartures = 0;

  for (let hour = 0; hour < SERVICE_DAY_HOUR_BINS; hour += 1) {
    const count = bins[hour];
    if (count === 0) continue;
    binTotal += count;
    if (firstBin < 0) firstBin = hour;
    lastBin = hour;
    if (count > peakHourDepartures) {
      peakHourDepartures = count;
      peakHour = hour;
    }
  }

  const tripsPerDay = binTotal + departuresBeyondBinRange;
  const first = input.firstDepartureSeconds;
  const last = input.lastDepartureSeconds;
  const spanSeconds = first === null || last === null ? null : last - first;

  const spanHours = firstBin < 0 ? 0 : lastBin - firstBin + 1;
  let servedHours = 0;
  for (let hour = firstBin < 0 ? 0 : firstBin; firstBin >= 0 && hour <= lastBin; hour += 1) {
    if (bins[hour] > 0) servedHours += 1;
  }

  // An hourly average, not a measured gap. See the module header.
  const peakHeadwayMinutes = peakHourDepartures > 0 ? round1(MINUTES_PER_HOUR / peakHourDepartures) : null;
  const peakHeadwayIsLowerBound = peakHourDepartures <= 1;

  const { medianHeadwayMinutes, medianHeadwayBasis } = deriveMedianHeadway({
    bins,
    firstBin,
    lastBin,
    tripsPerDay,
  });

  let frequentServiceTierMinutes: number | null = null;
  if (peakHeadwayMinutes !== null) {
    for (const tier of FREQUENT_SERVICE_TIERS) {
      if (peakHeadwayMinutes <= tier) {
        frequentServiceTierMinutes = tier;
        break;
      }
    }
  }

  const frequencyTripCount = Math.min(frequencyDepartures, tripsPerDay);
  const scheduledTripCount = tripsPerDay - frequencyTripCount;
  const derivationMethod: GtfsDerivationMethod =
    frequencyTripCount === 0 ? "scheduled" : scheduledTripCount === 0 ? "frequencies" : "mixed";

  return {
    tripsPerDay,
    firstDepartureSeconds: first,
    lastDepartureSeconds: last,
    spanSeconds,
    peakHour,
    peakHourDepartures,
    peakHeadwayMinutes,
    peakHeadwayIsLowerBound,
    medianHeadwayMinutes,
    medianHeadwayBasis,
    servedHours,
    spanHours,
    frequentServiceTierMinutes,
    derivationMethod,
    scheduledTripCount,
    frequencyTripCount,
    departuresBeyondBinRange,
  };
}

/**
 * THE MEDIAN HEADWAY, AND THE CASE WHERE IT REFUSES TO ANSWER.
 *
 * Every hour inside the service span contributes one hourly-average headway:
 * 60 / departures for a served hour, and INFINITY for an hour with no departure
 * at all. Taking the median over served hours only — the obvious
 * implementation — produces the single worst number this module could emit: a
 * stop with one bus at 06:10 and one at 18:40 has two served hours, each with
 * one departure, so its median headway would read 60 MINUTES. A planner would
 * see hourly service on a route that runs twice a day.
 *
 * So the unserved hours are counted, and when they outnumber the served ones the
 * median is genuinely undefined and this says so instead of inventing a figure.
 * That is the same posture as the fiscal engine's `not_determined`: a refusal
 * with a stated reason is a better artifact than a plausible wrong answer, and
 * it is the one a planner can act on — the reason names the gap.
 */
function deriveMedianHeadway(input: {
  bins: Uint32Array;
  firstBin: number;
  lastBin: number;
  tripsPerDay: number;
}): { medianHeadwayMinutes: number | null; medianHeadwayBasis: GtfsMedianHeadwayBasis } {
  if (input.tripsPerDay < 2 || input.firstBin < 0) {
    return { medianHeadwayMinutes: null, medianHeadwayBasis: "not_determined_too_few_departures" };
  }

  const hourly: number[] = [];
  for (let hour = input.firstBin; hour <= input.lastBin; hour += 1) {
    const count = input.bins[hour];
    hourly.push(count > 0 ? MINUTES_PER_HOUR / count : Number.POSITIVE_INFINITY);
  }
  hourly.sort((a, b) => a - b);

  const middle = hourly.length >> 1;
  const median =
    hourly.length % 2 === 1 ? hourly[middle] : (hourly[middle - 1] + hourly[middle]) / 2;

  if (!Number.isFinite(median)) {
    return { medianHeadwayMinutes: null, medianHeadwayBasis: "not_determined_span_mostly_unserved" };
  }
  return { medianHeadwayMinutes: round1(median), medianHeadwayBasis: "hourly_average_over_span" };
}

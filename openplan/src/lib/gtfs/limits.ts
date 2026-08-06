/**
 * EVERY NUMBER THE GTFS READER IS BOUNDED BY, IN ONE PLACE, EACH WITH AN
 * OPERATOR OVERRIDE AND A NOTE SAYING WHERE THE NUMBER CAME FROM.
 *
 * WHY A FILE OF NUMBERS EXISTS AT ALL. A GTFS feed is the largest untrusted
 * input OpenPlan accepts. It arrives as a zip an agency (or a catalog, or a
 * stranger) hands us, it is decompressed inside our own process, and one of its
 * members is routinely two orders of magnitude larger than the archive that
 * carried it. Every bound below is the answer to "what stops a feed from taking
 * the deployment down", and every one of them is a JUDGEMENT that a different
 * operator on different hardware may reasonably make differently. That makes
 * them CONFIGURATION, not literals at call sites (product non-negotiable #0).
 *
 * WHERE THE NUMBERS COME FROM. They are anchored on measured real feeds, not on
 * round numbers that felt safe:
 *
 *   - BART (downloaded and measured 2026-08-05): 892,312 B zip -> 4.82 MB
 *     uncompressed. stop_times.txt 2.73 MB / 57,188 rows, 4,417 trips,
 *     287 stops, 14 routes, 11 calendar services. Expansion 5.4x.
 *   - King County Metro (downloaded and measured 2026-08-05): 17,475,566 B zip
 *     -> 143.1 MB uncompressed. stop_times.txt 126.6 MB / 2,167,134 rows,
 *     62,614 trips, 6,446 stops, 157 routes, 21 calendar services.
 *     Expansion 8.2x. NOTE: this is more than double the 12.8 MiB / 57.8 MB /
 *     1,087,215-row figure this work was scoped against — the agency's feed
 *     grew. Numbers below are anchored on the LIVE measurement, and the
 *     discrepancy is left here on purpose: a feed's size is not a constant, so
 *     any ceiling set snugly against one measurement will be wrong within a
 *     year.
 *   - CTA Chicago (size only, not downloaded): 94 MiB zip. Everything below
 *     that says "CTA-class" is EXTRAPOLATED from King County by archive ratio
 *     (94 MiB / 16.7 MiB = 5.6x) and is an estimate, not a measurement.
 *
 * A DEFAULT MUST FIT THE LARGEST REAL US FEED AND STILL REFUSE A BOMB. Those
 * two requirements are what set every ceiling here; a ceiling that rejects CTA
 * is a product that does not work in Chicago, and a ceiling with no upper bound
 * at all is a denial-of-service surface on a free public deployment.
 *
 * THE OVERRIDE CONVENTION, matching `src/lib/config/run-cap.ts`: an unparseable
 * or non-positive value falls back to the DEFAULT rather than to zero. A typo in
 * an optional env var must never become a limit of 0, which would refuse every
 * feed on earth and read to a planner as "GTFS is broken".
 */

/** One bound: its env var, its default, and why the default is that number. */
export type GtfsLimit = {
  /** The environment variable an operator sets to change this bound. */
  readonly env: string;
  /** The value used when the operator sets nothing. */
  readonly defaultValue: number;
  /** Where the default came from. Rendered nowhere; read by whoever changes it. */
  readonly rationale: string;
};

function limit(env: string, defaultValue: number, rationale: string): GtfsLimit {
  return { env, defaultValue, rationale } as const;
}

/**
 * THE ARCHIVE ITSELF, as bytes on the wire or bytes uploaded.
 *
 * 192 MiB: CTA's real feed is 94 MiB, the largest US feed measured, and a
 * ceiling barely above the largest known input is a ceiling that will refuse
 * next year's version of it. Doubling the largest measured feed and rounding is
 * the smallest defensible headroom.
 */
export const GTFS_MAX_ARCHIVE_BYTES = limit(
  "OPENPLAN_GTFS_MAX_ARCHIVE_BYTES",
  192 * 1024 * 1024,
  "2x the largest measured US feed (CTA Chicago, 94 MiB) rounded up.",
);

/**
 * ONE MEMBER, DECOMPRESSED. `stop_times.txt` is always the member that matters;
 * every other table is noise beside it.
 *
 * 2 GiB: King County Metro's stop_times.txt is 126.6 MB (measured). Scaling by
 * archive size, a CTA-class stop_times.txt is plausibly ~700 MB. 2 GiB clears
 * that with ~3x room and still refuses the classic 42 KiB -> 4.5 PiB deflate
 * bomb by six orders of magnitude.
 *
 * This bound is enforced on BYTES ACTUALLY DECOMPRESSED, streaming, not on the
 * size the archive declares. See `zip.ts` for why the declared size may only
 * ever reject and may never admit.
 */
export const GTFS_MAX_MEMBER_UNCOMPRESSED_BYTES = limit(
  "OPENPLAN_GTFS_MAX_MEMBER_UNCOMPRESSED_BYTES",
  2 * 1024 * 1024 * 1024,
  "~3x an extrapolated CTA-class stop_times.txt (King County: 126.6 MB measured).",
);

/**
 * ALL MEMBERS WE READ, DECOMPRESSED, ADDED UP. Separate from the per-member cap
 * because a bomb can also be spread across many members that are each innocent.
 */
export const GTFS_MAX_TOTAL_UNCOMPRESSED_BYTES = limit(
  "OPENPLAN_GTFS_MAX_TOTAL_UNCOMPRESSED_BYTES",
  3 * 1024 * 1024 * 1024,
  "1.5x the per-member cap: stop_times dominates, everything else is rounding.",
);

/**
 * DECLARED EXPANSION RATIO an archive may claim before we refuse to start.
 *
 * Measured ratios: BART 5.4x, King County 8.2x. GTFS is CSV of short repeated
 * tokens, which deflate handles well but not miraculously; a ratio above 100
 * is not a transit feed. This is an EARLY reject only — a lying header that
 * understates its expansion is caught by the streaming byte counters above.
 */
export const GTFS_MAX_DECLARED_COMPRESSION_RATIO = limit(
  "OPENPLAN_GTFS_MAX_COMPRESSION_RATIO",
  100,
  "Measured feeds expand 5.4-8.2x; 100x is ~12x headroom and still not a bomb.",
);

/**
 * ROWS IN ONE TABLE. Bounds work, not memory — rows are consumed and discarded.
 *
 * 40,000,000: King County Metro's stop_times.txt is 2,167,134 rows (measured).
 * A CTA-class feed extrapolates to roughly 12M. Three times that is a bound no
 * real feed has approached, and it still stops an endless generator.
 */
export const GTFS_MAX_ROWS_PER_TABLE = limit(
  "OPENPLAN_GTFS_MAX_ROWS_PER_TABLE",
  40_000_000,
  "~3x an extrapolated CTA stop_times.txt (King County: 2,167,134 rows measured).",
);

/**
 * THE MEMORY BOUND THAT MAKES INLINE INGEST DEFENSIBLE.
 *
 * The histogram costs 68 bytes per (stop, service) pair that actually sees a
 * departure: 30 x Uint16 bins (60 B) plus two Int32 endpoints (8 B). CTA is
 * roughly 11,000 stops x ~30 calendar services = ~330,000 pairs = ~22 MB, and
 * that number does NOT move with the 8M rows that produced it.
 *
 * 1,500,000 pairs = ~102 MB, which is ~4.5x the CTA-class estimate. Exceeding
 * it is not a bomb, it is a feed unlike any measured one, and the honest answer
 * is to refuse rather than to swap.
 */
export const GTFS_MAX_STOP_SERVICE_PAIRS = limit(
  "OPENPLAN_GTFS_MAX_STOP_SERVICE_PAIRS",
  1_500_000,
  "~4.5x a CTA-class estimate (11k stops x ~30 services); ~102 MB at 68 B/pair.",
);

/**
 * The same bound for the route histogram, which is keyed by
 * (route, direction, service) and is always one to two orders of magnitude
 * smaller than the stop histogram. It exists so a feed with a pathological
 * route table fails on its own terms instead of borrowing the stop bound.
 */
export const GTFS_MAX_ROUTE_SERVICE_PAIRS = limit(
  "OPENPLAN_GTFS_MAX_ROUTE_SERVICE_PAIRS",
  200_000,
  "King County: 157 routes x 2 directions x 21 services (<=6,594 measured); ~30x headroom.",
);

/**
 * STOP_TIMES ROWS BUFFERED FOR FREQUENCY-BASED TRIPS.
 *
 * A trip listed in `frequencies.txt` cannot be accumulated as it streams: its
 * departures are the frequency windows offset by each stop's position within
 * the trip, and the trip's own base time is only known once its first row is
 * seen. Those rows are therefore held until the stream ends.
 *
 * This is affordable because frequency trips are RARE. Of 16 sampled live US
 * feeds, 7 shipped `frequencies.txt`, 6 of those were header-only, and the one
 * with content covered 2 trips out of 18,150. Neither BART nor King County
 * ships the file at all. The buffer is packed into typed arrays at 16 bytes a
 * row, so 3,000,000 rows is ~48 MB — enough for a feed that is ENTIRELY
 * frequency-based at King County scale (2,167,134 rows measured).
 */
export const GTFS_MAX_BUFFERED_FREQUENCY_STOP_TIMES = limit(
  "OPENPLAN_GTFS_MAX_BUFFERED_FREQUENCY_STOP_TIMES",
  3_000_000,
  "~1.4x King County's whole stop_times table, at 16 B/row packed (~48 MB).",
);

/**
 * DEPARTURES A FEED'S `frequencies.txt` MAY EXPAND TO, IN TOTAL.
 *
 * Expansion is the one place where a small input produces unbounded work: a
 * single row reading `start 04:00, end 28:00, headway 30 seconds` on a 60-stop
 * trip is 2,880 runs x 60 stops = 172,800 departures from ONE row. The
 * histogram absorbs them at no memory cost — they are counter increments — but
 * the loop still has to run, so this bounds CPU rather than memory.
 *
 * 20,000,000 is roughly nine times King County's entire stop_times table, which
 * no legitimate frequency feed approaches, and it stops a hand-written
 * one-second headway from running until the request dies.
 */
export const GTFS_MAX_EXPANDED_FREQUENCY_DEPARTURES = limit(
  "OPENPLAN_GTFS_MAX_EXPANDED_FREQUENCY_DEPARTURES",
  20_000_000,
  "~9x King County's whole stop_times table; bounds CPU, not memory.",
);

/**
 * CALENDAR DATES ENUMERATED when choosing each day name's representative date.
 *
 * A feed's `calendar.txt` window is normally a season (90-180 days) and
 * occasionally a full year. 1,100 days covers three years, which is longer than
 * any published static feed's validity, and bounds a feed whose `end_date` is
 * a typo three centuries out.
 */
export const GTFS_MAX_SERVICE_DATES = limit(
  "OPENPLAN_GTFS_MAX_SERVICE_DATES",
  1_100,
  "~3 years; published feed windows are a season to a year. Bounds a typo'd end_date.",
);

/**
 * WALL-CLOCK BUDGET for one parse, checked cooperatively between and within
 * table streams.
 *
 * 180,000 ms: a serverless function on the common hosting tier is capped near
 * 300 s, and a parse that consumes the whole function has no time left to
 * write anything. A self-hosted deployment with a worker can raise it. Like
 * `gtfs_skim.py`'s stage budget this is COOPERATIVE — it can only stop the
 * parse where the deadline is checked, which is per table and every N rows,
 * so it bounds the parse tightly but is not a hard guarantee.
 */
export const GTFS_PARSE_BUDGET_MS = limit(
  "OPENPLAN_GTFS_PARSE_BUDGET_MS",
  180_000,
  "Under the ~300 s serverless function ceiling, leaving time to persist.",
);

/**
 * WARNING EXAMPLES KEPT PER WARNING CODE. Counts are unbounded (an integer);
 * examples are not, because a feed with a million bad rows would otherwise
 * carry a million strings into a database row.
 */
export const GTFS_MAX_WARNING_EXAMPLES = limit(
  "OPENPLAN_GTFS_MAX_WARNING_EXAMPLES",
  20,
  "Enough to see the shape of a systematic problem; small enough to store inline.",
);

/** Characters kept from any one warning example. */
export const GTFS_MAX_WARNING_EXAMPLE_CHARS = limit(
  "OPENPLAN_GTFS_MAX_WARNING_EXAMPLE_CHARS",
  200,
  "A GTFS row's identifying fields fit; a pathological 8 KB cell does not.",
);

/** Every bound, so a test can assert the set and an operator doc can list it. */
export const GTFS_LIMITS = [
  GTFS_MAX_ARCHIVE_BYTES,
  GTFS_MAX_MEMBER_UNCOMPRESSED_BYTES,
  GTFS_MAX_TOTAL_UNCOMPRESSED_BYTES,
  GTFS_MAX_DECLARED_COMPRESSION_RATIO,
  GTFS_MAX_ROWS_PER_TABLE,
  GTFS_MAX_STOP_SERVICE_PAIRS,
  GTFS_MAX_ROUTE_SERVICE_PAIRS,
  GTFS_MAX_BUFFERED_FREQUENCY_STOP_TIMES,
  GTFS_MAX_EXPANDED_FREQUENCY_DEPARTURES,
  GTFS_MAX_SERVICE_DATES,
  GTFS_MAX_WARNING_EXAMPLES,
  GTFS_MAX_WARNING_EXAMPLE_CHARS,
] as const;

/**
 * The shape a bound is resolved against.
 *
 * A plain record rather than `NodeJS.ProcessEnv`, which this project's Next.js
 * type augmentation makes non-trivial to satisfy with an object literal — a
 * test pinning one bound should be able to pass `{}` and not fight the types.
 * `process.env` satisfies this, which is the only compatibility that matters.
 */
export type GtfsLimitEnv = Record<string, string | undefined>;

/**
 * Resolve one bound against an environment.
 *
 * Anything that is not a finite positive number falls back to the default. The
 * environment is a PARAMETER rather than a module-level read so a test can pin
 * a bound without mutating `process.env` — the same reason `gtfs_skim.py`'s
 * `discovery_enabled` takes its raw string.
 */
export function resolveGtfsLimit(bound: GtfsLimit, env: GtfsLimitEnv = process.env): number {
  const raw = env[bound.env]?.trim();
  if (!raw) return bound.defaultValue;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return bound.defaultValue;
  return parsed;
}

/** Every bound resolved once, so a parse reads the environment exactly one time. */
export type ResolvedGtfsLimits = {
  maxArchiveBytes: number;
  maxMemberUncompressedBytes: number;
  maxTotalUncompressedBytes: number;
  maxDeclaredCompressionRatio: number;
  maxRowsPerTable: number;
  maxStopServicePairs: number;
  maxRouteServicePairs: number;
  maxBufferedFrequencyStopTimes: number;
  maxExpandedFrequencyDepartures: number;
  maxServiceDates: number;
  parseBudgetMs: number;
  maxWarningExamples: number;
  maxWarningExampleChars: number;
};

export function resolveGtfsLimits(env: GtfsLimitEnv = process.env): ResolvedGtfsLimits {
  return {
    maxArchiveBytes: resolveGtfsLimit(GTFS_MAX_ARCHIVE_BYTES, env),
    maxMemberUncompressedBytes: resolveGtfsLimit(GTFS_MAX_MEMBER_UNCOMPRESSED_BYTES, env),
    maxTotalUncompressedBytes: resolveGtfsLimit(GTFS_MAX_TOTAL_UNCOMPRESSED_BYTES, env),
    maxDeclaredCompressionRatio: resolveGtfsLimit(GTFS_MAX_DECLARED_COMPRESSION_RATIO, env),
    maxRowsPerTable: resolveGtfsLimit(GTFS_MAX_ROWS_PER_TABLE, env),
    maxStopServicePairs: resolveGtfsLimit(GTFS_MAX_STOP_SERVICE_PAIRS, env),
    maxRouteServicePairs: resolveGtfsLimit(GTFS_MAX_ROUTE_SERVICE_PAIRS, env),
    maxBufferedFrequencyStopTimes: resolveGtfsLimit(GTFS_MAX_BUFFERED_FREQUENCY_STOP_TIMES, env),
    maxExpandedFrequencyDepartures: resolveGtfsLimit(GTFS_MAX_EXPANDED_FREQUENCY_DEPARTURES, env),
    maxServiceDates: resolveGtfsLimit(GTFS_MAX_SERVICE_DATES, env),
    parseBudgetMs: resolveGtfsLimit(GTFS_PARSE_BUDGET_MS, env),
    maxWarningExamples: resolveGtfsLimit(GTFS_MAX_WARNING_EXAMPLES, env),
    maxWarningExampleChars: resolveGtfsLimit(GTFS_MAX_WARNING_EXAMPLE_CHARS, env),
  };
}

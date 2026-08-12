/**
 * The NEUTRAL crash vocabulary — one declaration, no jurisdiction inside it.
 *
 * WHAT THIS FILE IS. Every dimension the Safety module can filter, paint, count
 * or cite is declared here exactly once: its neutral values, the column that
 * stores it, what an absent value means, and what an unrecognised value maps to.
 * A crash source is then a DESCRIPTOR (`CrashSourceVocabularyDescriptor`) that
 * says, per dimension, whether it supplies the dimension at all and how its own
 * spellings translate into these values. `ccrs-vocabulary.ts` is one such
 * descriptor; adding a second state, or a second country, means adding another
 * descriptor beside it and registering an adapter. It does not mean editing this
 * file, a filter enum, a route, or a screen.
 *
 * WHY THE VALUES ARE NAMED THE WAY THEY ARE. Each one names the PHYSICAL FACT,
 * never a code from one jurisdiction's reporting form. `dark_unlighted` rather
 * than a KABCO-style letter; `angle` rather than California's "BROADSIDE";
 * `severe_injury` rather than "A". A planner in a state that spells it
 * differently, or a country that does not use KABCO at all, gets the same
 * vocabulary and supplies their own mapping table. The one place a source's own
 * spelling is allowed to exist is inside its descriptor and, for values that fell
 * outside it, in the per-source attributes blob that travels with the row.
 *
 * WHY UNRECOGNISED VALUES ARE COUNTED RATHER THAN CLEANED. Real agency feeds
 * carry a controlled head and a dirty tail — free text an officer typed. Fuzzy
 * matching that tail is inventing an observation about a real collision, so the
 * rule here is: an exact declared match maps, and everything else lands on the
 * dimension's `unmapped` value with its raw string preserved and a tally kept.
 * The tally is disclosed on the ingest, so "we could not classify 314 of these"
 * is a sentence the product can actually say.
 *
 * THREE STATES, NEVER TWO. For every dimension a value can be:
 *   - a mapped neutral value;
 *   - `absent` — the source records this dimension but supplied nothing for this
 *     crash (the neutral `unknown` member);
 *   - NOT SUPPLIED AT ALL — the source has no such field. That is a property of
 *     the SOURCE, not of the crash, so it is recorded once per ingest in
 *     `dimension_coverage` and the corresponding column is left NULL. A facet
 *     whose source declares `not_supplied` must render as disabled with a reason,
 *     never as an empty list, or the absence reads as a finding.
 */

/**
 * Crash severity band.
 *
 * `severe_injury` is the "suspected serious injury" band (KABCO A where KABCO is
 * in use) — fatal + severe_injury together are the KSI measure safety programmes
 * are built on.
 *
 * `unknown` is not a filler value and it is not "pdo with a question mark". It
 * exists because a source can report a collision while supplying no casualty
 * counts at all: in the California feed that is roughly 4.7% of records
 * statewide and 9.5% in one rural county (probed 2026-08-11). Before this band
 * existed those records were stored as property-damage-only, because a missing
 * count parsed to 0 and zero killed plus zero injured is the definition of PDO.
 * That is the module's own rule broken — a count that could not be read is not
 * zero — and it silently understated killed-or-injured totals.
 */
export const CRASH_SEVERITIES = ["fatal", "severe_injury", "injury", "pdo", "unknown"] as const;
export type CrashSeverity = (typeof CRASH_SEVERITIES)[number];

/**
 * Manner of collision — how the vehicles (or a vehicle and a person) came
 * together. `vehicle_pedestrian` is a manner, not a mode flag: the mode flags
 * live on the involvement booleans and the party rows.
 */
export const CRASH_COLLISION_TYPES = [
  "rear_end",
  "sideswipe",
  "head_on",
  "angle",
  "hit_object",
  "overturn",
  "vehicle_pedestrian",
  "other",
  "unknown",
] as const;
export type CrashCollisionType = (typeof CRASH_COLLISION_TYPES)[number];

/**
 * Lighting at the time of the collision.
 *
 * The highest-value facet in this file for a planner: "crashes after dark on an
 * unlit roadway" is a countermeasure trigger — lighting, delineation, retro-
 * reflective signing — that a jurisdiction can fund and build.
 * `dark_lighting_inoperative` is kept separate from `dark_unlighted` because
 * they lead to different work: one is a maintenance ticket, the other is capital.
 */
export const CRASH_LIGHTING_CONDITIONS = [
  "daylight",
  "dawn_dusk",
  "dark_lighted",
  "dark_unlighted",
  "dark_lighting_inoperative",
  "unknown",
] as const;
export type CrashLighting = (typeof CRASH_LIGHTING_CONDITIONS)[number];

/**
 * Weather at the time of the collision.
 *
 * Deliberately coarse. Feeds of this kind have a small controlled head and a
 * long tail of operator free text — observed examples from one state's 2025
 * file include an indoor car wash, a named wildfire's smoke, and a blowing-dust
 * visibility estimate. Every one of those is a real observation and none of them
 * is a weather CATEGORY, so they map to `other` with the raw string preserved.
 * Nothing in this module may guess that "LIGHT DRIZZLE" means `rain`.
 */
export const CRASH_WEATHER_CONDITIONS = [
  "clear",
  "cloudy",
  "rain",
  "snow",
  "fog",
  "wind",
  "other",
  "unknown",
] as const;
export type CrashWeather = (typeof CRASH_WEATHER_CONDITIONS)[number];

/**
 * What a person was doing in the collision.
 *
 * `motorcyclist` is in this list even though the source that prompted the list
 * has no such value — it derives one from a vehicle-type column. A vocabulary
 * shaped by one source's gaps is a vocabulary the next source has to fight.
 */
export const CRASH_PARTY_ROLES = [
  "driver",
  "passenger",
  "pedestrian",
  "bicyclist",
  "motorcyclist",
  "parked_vehicle",
  "other",
  "unknown",
] as const;
export type CrashPartyRole = (typeof CRASH_PARTY_ROLES)[number];

/**
 * Injury outcome for ONE person, which is a different measurement from the
 * crash-level severity band above: a fatal crash contains people who were not
 * hurt, and an injury crash contains people who were.
 *
 * `no_apparent_injury` is only ever written when a source positively states it.
 * An absent injury code means `unknown`, because a person row with no code is
 * routinely a witness or an uninjured passenger AND routinely a person whose
 * outcome was never filled in, and nothing in the data separates the two.
 */
export const CRASH_PERSON_INJURIES = [
  "fatal",
  "suspected_serious",
  "suspected_minor",
  "possible",
  "no_apparent_injury",
  "unknown",
] as const;
export type CrashPersonInjury = (typeof CRASH_PERSON_INJURIES)[number];

/**
 * Age band for a person in a collision.
 *
 * ONE banding, used everywhere, so counts from different surfaces compare. The
 * exact age is never stored, never logged and never returned: an age plus a
 * precise coordinate plus a date identifies a person in a small town. Banding
 * happens inside the adapter, before a row exists.
 */
export const CRASH_AGE_BANDS = ["under_15", "15_24", "25_44", "45_64", "65_plus", "unknown"] as const;
export type CrashAgeBand = (typeof CRASH_AGE_BANDS)[number];

/** The dimensions a source declares capability for, one by one. */
export const CRASH_DIMENSIONS = [
  "severity",
  "collision_type",
  "lighting",
  "weather",
  "party_role",
  "person_injury",
] as const;
export type CrashDimension = (typeof CRASH_DIMENSIONS)[number];

/**
 * The canonical storage column for each dimension.
 *
 * Exported as data rather than written out at each call site so that the query
 * builder, the client-side predicate and the filter panel are generated from ONE
 * string per dimension. Two hand-written copies of the same filter set is the
 * defect this constant exists to make impossible.
 */
export const CRASH_DIMENSION_COLUMNS = {
  severity: "severity",
  collision_type: "collision_type",
  lighting: "lighting",
  weather: "weather",
  party_role: "party_role",
  person_injury: "person_injury",
} as const satisfies Record<CrashDimension, string>;

/** Columns on the crash row that denormalize party involvement for map queries. */
export const CRASH_INVOLVEMENT_COLUMNS = {
  pedestrian: "pedestrian_involved",
  bicyclist: "bicyclist_involved",
  motorcyclist: "motorcyclist_involved",
} as const;

export type CrashDimensionSpec = {
  label: string;
  /** Every neutral value, including the two escape values below. */
  values: readonly string[];
  /** The value meaning "this source records the dimension but said nothing here". */
  absent: string;
  /** The value an unrecognised source spelling lands on. */
  unmapped: string;
  /** Where the dimension is stored. */
  column: string;
  /** Which table the column lives on. */
  table: "crash" | "party";
};

export const CRASH_DIMENSION_SPECS: Readonly<Record<CrashDimension, CrashDimensionSpec>> = {
  severity: {
    label: "Severity",
    values: CRASH_SEVERITIES,
    absent: "unknown",
    // A severity is DERIVED from counts rather than mapped from a string, so an
    // unrecognised input is the same statement as an absent one: not classified.
    unmapped: "unknown",
    column: CRASH_DIMENSION_COLUMNS.severity,
    table: "crash",
  },
  collision_type: {
    label: "Manner of collision",
    values: CRASH_COLLISION_TYPES,
    absent: "unknown",
    unmapped: "other",
    column: CRASH_DIMENSION_COLUMNS.collision_type,
    table: "crash",
  },
  lighting: {
    label: "Lighting",
    values: CRASH_LIGHTING_CONDITIONS,
    absent: "unknown",
    // Lighting has no `other` member on purpose: the physical possibilities are
    // closed (it is light, it is twilight, or it is dark with the lights on, off
    // or broken). A spelling outside that set is something we failed to read,
    // which is `unknown`, not a sixth kind of darkness.
    unmapped: "unknown",
    column: CRASH_DIMENSION_COLUMNS.lighting,
    table: "crash",
  },
  weather: {
    label: "Weather",
    values: CRASH_WEATHER_CONDITIONS,
    absent: "unknown",
    unmapped: "other",
    column: CRASH_DIMENSION_COLUMNS.weather,
    table: "crash",
  },
  party_role: {
    label: "Person's role",
    values: CRASH_PARTY_ROLES,
    absent: "unknown",
    unmapped: "other",
    column: CRASH_DIMENSION_COLUMNS.party_role,
    table: "party",
  },
  person_injury: {
    label: "Injury outcome",
    values: CRASH_PERSON_INJURIES,
    absent: "unknown",
    unmapped: "unknown",
    column: CRASH_DIMENSION_COLUMNS.person_injury,
    table: "party",
  },
};

/**
 * What a source can say about a dimension.
 *
 * `partial` is the honest middle and is used more than it looks: a fatality
 * census can tell you a pedestrian was involved without carrying a person-level
 * record for anybody, which is `party_role: "partial"` — some roles derivable,
 * no person rows.
 */
export type CrashDimensionSupport = "supplied" | "partial" | "not_supplied";

export const CRASH_DIMENSION_SUPPORTS = ["supplied", "partial", "not_supplied"] as const;

export type CrashDimensionCapability = Readonly<Record<CrashDimension, CrashDimensionSupport>>;

/**
 * The capability of a source that carries crash-level counts and nothing else:
 * no lighting, no weather, no manner of collision, no person rows.
 *
 * Declared in the neutral module rather than beside any one adapter, because it
 * is a SHAPE that many sources have — a fatality census, a summary extract, an
 * early integration with a state that publishes only totals — and a shape copied
 * into each adapter is a shape that drifts. `party_role: "partial"` is the
 * load-bearing entry: pedestrian and bicyclist involvement are derivable from
 * crash-level counts, motorcyclist involvement is not, and there are no person
 * rows at all. Rendered as a disabled facet that is a true sentence; rendered as
 * an empty result it would be a false one.
 */
export const CRASH_LEVEL_ONLY_DIMENSION_SUPPORT: CrashDimensionCapability = {
  severity: "partial",
  collision_type: "not_supplied",
  lighting: "not_supplied",
  weather: "not_supplied",
  party_role: "partial",
  person_injury: "not_supplied",
};

/**
 * A source's whole relationship to the neutral vocabulary, in one value.
 *
 * This is the "descriptor, not a code change" contract. Everything a new
 * jurisdiction needs to say is here: which dimensions it supplies, and how its
 * own strings translate. No branch anywhere in the module names a source.
 */
export type CrashSourceVocabularyDescriptor = {
  /** The registry adapter id this descriptor belongs to. */
  sourceId: string;
  support: CrashDimensionCapability;
  /**
   * Raw source spelling → neutral value, per dimension.
   *
   * Keys are matched after trimming and upper-casing, which is still an EXACT
   * declared match — it absorbs a feed's casing drift and its stray leading
   * spaces without ever guessing at a value nobody declared. Source typos are
   * declared literally, because the typo is what the field actually contains.
   */
  maps: Readonly<Partial<Record<CrashDimension, Readonly<Record<string, string>>>>>;
};

function normalizeRaw(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export type CrashDimensionMapping = {
  /** The neutral value to store. */
  value: string;
  /** The source's own string, when it supplied one. */
  raw: string | null;
  /**
   * True when the source supplied a value this descriptor does not declare.
   * Counted per ingest and disclosed; the raw string is preserved on the row.
   */
  unmapped: boolean;
};

/**
 * Translate one raw source value into the neutral vocabulary.
 *
 * The single interpreter. Every dimension of every source goes through it, so
 * "absent", "declared" and "unrecognised" mean the same three things everywhere,
 * and a new source cannot accidentally invent a fourth behaviour.
 *
 * Returns `null` for the whole mapping when the source does not supply the
 * dimension at all — the caller writes NULL to the column, and the ingest's
 * `dimension_coverage` is what explains why.
 */
export function mapCrashDimension(
  descriptor: CrashSourceVocabularyDescriptor,
  dimension: CrashDimension,
  raw: unknown
): CrashDimensionMapping | null {
  if (descriptor.support[dimension] === "not_supplied") return null;

  const spec = CRASH_DIMENSION_SPECS[dimension];
  const normalized = normalizeRaw(raw);
  if (normalized === null) return { value: spec.absent, raw: null, unmapped: false };

  const table = descriptor.maps[dimension] ?? {};
  const hit = table[normalized.toUpperCase()];
  if (hit !== undefined) return { value: hit, raw: normalized, unmapped: false };

  return { value: spec.unmapped, raw: normalized, unmapped: true };
}

/**
 * Age → band, in the one place every surface reads it from.
 *
 * A non-finite, negative or implausible age is `unknown` rather than a guess.
 * The upper bound is a data-quality filter, not a claim about human lifespan:
 * agency feeds use large sentinel ages, and banding one into `65_plus` would put
 * a placeholder into an equity count.
 */
export function toCrashAgeBand(value: unknown): CrashAgeBand {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseInt(value.trim(), 10)
        : Number.NaN;
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 120) return "unknown";
  if (parsed < 15) return "under_15";
  if (parsed < 25) return "15_24";
  if (parsed < 45) return "25_44";
  if (parsed < 65) return "45_64";
  return "65_plus";
}

/**
 * A casualty count as the source gave it, or null when it did not give one.
 *
 * THE RULE THIS ENCODES: a count that could not be read is not zero. A missing
 * `NumberKilled` is not "nobody died"; a negative one (observed in the wild) is
 * a data error, not "nobody died" either. Both come back null, which is what
 * makes the `unknown` severity band reachable instead of collapsing into `pdo`.
 */
export function toCasualtyCount(value: unknown): number | null {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim().length > 0
        ? Number.parseFloat(value.trim())
        : Number.NaN;
  if (!Number.isFinite(parsed)) return null;
  const whole = Math.trunc(parsed);
  return whole < 0 ? null : whole;
}

/**
 * Derive the severity band from two casualty counts that may each be unreadable.
 *
 * Order matters and is deliberate. A positive count is a POSITIVE observation
 * and survives its partner being missing: a collision reporting three deaths is
 * fatal whether or not the injured column was filled in. Only when no positive
 * observation exists and something is missing does the band become `unknown` —
 * which is exactly the case that used to be stored as property-damage-only.
 *
 * `severe_injury` is never returned here. It is a separate, later determination
 * made from person-level injury records, and a function that could reach it from
 * two crash-level counts would be inventing it.
 */
export function deriveSeverityFromCounts(
  killedCount: number | null,
  injuredCount: number | null
): CrashSeverity {
  if (killedCount !== null && killedCount > 0) return "fatal";
  if (injuredCount !== null && injuredCount > 0) return "injury";
  if (killedCount === 0 && injuredCount === 0) return "pdo";
  return "unknown";
}

export function isCrashSeverity(value: unknown): value is CrashSeverity {
  return typeof value === "string" && (CRASH_SEVERITIES as readonly string[]).includes(value);
}

export function isCrashDimension(value: unknown): value is CrashDimension {
  return typeof value === "string" && (CRASH_DIMENSIONS as readonly string[]).includes(value);
}

/**
 * Every neutral value a descriptor maps onto must exist in the vocabulary.
 *
 * Exported rather than kept in a test because it is the check a descriptor
 * author wants at the moment they write one: a typo in a mapping target is
 * otherwise a value that reaches a CHECK constraint at ingest time, against a
 * live source, on someone else's machine. Returns the offending pairs so the
 * message can name them.
 */
export function findDescriptorVocabularyViolations(
  descriptor: CrashSourceVocabularyDescriptor
): Array<{ dimension: CrashDimension; raw: string; value: string; problem: string }> {
  const violations: Array<{ dimension: CrashDimension; raw: string; value: string; problem: string }> = [];

  for (const dimension of CRASH_DIMENSIONS) {
    const table = descriptor.maps[dimension];
    const support = descriptor.support[dimension];

    if (support === "not_supplied") {
      for (const [raw, value] of Object.entries(table ?? {})) {
        violations.push({
          dimension,
          raw,
          value,
          problem: "declares a mapping for a dimension it also declares not_supplied",
        });
      }
      continue;
    }

    for (const [raw, value] of Object.entries(table ?? {})) {
      if (raw !== raw.toUpperCase()) {
        violations.push({
          dimension,
          raw,
          value,
          problem: "mapping keys are matched upper-cased, so a lower-case key can never match",
        });
      }
      if (!CRASH_DIMENSION_SPECS[dimension].values.includes(value)) {
        violations.push({ dimension, raw, value, problem: "maps onto a value outside the neutral vocabulary" });
      }
    }
  }

  return violations;
}

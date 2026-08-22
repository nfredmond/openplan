/**
 * THE ENGAGEMENT <-> SAFETY SEAM: what residents mapped, beside where collisions
 * have been reported in the same places.
 *
 * The grant sentence a planner is reaching for is "the public told us this
 * corner is dangerous, and the collision history says so too." This module
 * assembles the evidence for that sentence and REFUSES TO WRITE IT, for three
 * reasons that are worth stating because each one is a way this could quietly
 * become dishonest.
 *
 * 1. PROXIMITY IS NOT ABOUTNESS. A comment asking for a bench sits in the same
 *    100 m as the collisions at that corner. Nothing here decides that a
 *    comment is ABOUT the crashes near it — that pairing is a judgement, and a
 *    judgement rendered as a green tick is one nobody re-examines. Every figure
 *    below is a count or a distance.
 * 2. A NUMBER WITHOUT ITS DENOMINATOR FLATTERS. Downtown, every point on the
 *    map has collisions within 100 m; a probe at one real Sacramento corner
 *    returned 258. Reported alone, "12 collisions near this comment" reads as a
 *    finding wherever it appears. `summarizeCampaignCorroboration` therefore
 *    computes the campaign's OWN distribution — what share of its mapped
 *    comments have any collision nearby, and the median count among those — so
 *    the reader can see whether a number is remarkable or is simply the city.
 * 3. ZERO HAS TWO MEANINGS AND ONLY ONE OF THEM IS ABOUT THE ROAD. A workspace
 *    holds only the crash data it has acquired, so "no collisions near this
 *    comment" is either "none happened" or "nobody ever asked". These are
 *    `CrashRecordCoverage` states, never collapsed, because collapsing them
 *    tells a resident who correctly flagged a dangerous corner in an
 *    unacquired county that the record contradicts them.
 *
 * Pure and deterministic — the route does the fetching, this does the
 * arithmetic, and the AI (if it ever narrates this) is given these figures
 * rather than the rows.
 */

import {
  SAFETY_CRASH_DATA_CAVEAT,
  SAFETY_GEOCODING_CAVEAT,
  SAFETY_UNCLASSIFIED_SEVERITY_CAVEAT,
} from "@/lib/safety/caveats";

/**
 * The default radius around a resident's pin, in metres.
 *
 * A pin dropped on a phone is not survey-grade, and the thing a resident means
 * by "this corner" is an intersection and its approaches. 100 m is close to the
 * 250 ft that US intersection-related crash assignment conventionally uses, and
 * it is stated on screen every time rather than assumed — the number a planner
 * defends in a grant application has to be one they chose.
 */
export const DEFAULT_CRASH_PROXIMITY_METERS = 100;

/**
 * The band the radius may be moved within.
 *
 * Below the floor the radius is inside a single pin's own placement error, so
 * the answer says more about the resident's thumb than about the road. Above
 * the ceiling "near this comment" has stopped meaning anything a planner can
 * defend — a kilometre spans several corridors — and the query stops being
 * cheap at the same point.
 */
export const MIN_CRASH_PROXIMITY_METERS = 10;
export const MAX_CRASH_PROXIMITY_METERS = 1000;

/** `?radius=` is user input; anything outside the band is clamped, never rejected silently. */
export function clampCrashProximityMeters(value: unknown): number {
  const n = typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN;
  if (!Number.isFinite(n)) return DEFAULT_CRASH_PROXIMITY_METERS;
  return Math.min(MAX_CRASH_PROXIMITY_METERS, Math.max(MIN_CRASH_PROXIMITY_METERS, Math.round(n)));
}

/**
 * Whether the crash record can speak about this place AT ALL.
 *
 * `not_acquired` is not a smaller version of "no crashes" — it is the absence of
 * a reading. The two must stay separate all the way to the screen.
 */
export type CrashRecordCoverage = "covered" | "not_acquired";

/** How completely a covering acquisition could express severity (safety_crash_ingests). */
export type SeverityCompleteness = "kabco_full" | "fatal_injury_only" | "fatal_only";

/** One row of `engagement_items_with_nearby_crashes`, as the route reads it. */
export type NearbyCrashRow = {
  id: string;
  campaign_id: string;
  category_id: string | null;
  title: string | null;
  body: string | null;
  latitude: number | null;
  longitude: number | null;
  votes_count: number | null;
  covered_by_ingest: boolean | null;
  coverage_years: number[] | null;
  coverage_severity_completeness: string[] | null;
  crash_total: number | null;
  fatal_count: number | null;
  severe_injury_count: number | null;
  injury_count: number | null;
  pdo_count: number | null;
  killed_total: number | null;
  injured_total: number | null;
  pedestrian_crashes: number | null;
  bicyclist_crashes: number | null;
  nearest_crash_meters: number | null;
  earliest_crash_year: number | null;
  latest_crash_year: number | null;
};

export type CommentCrashRecord = {
  itemId: string;
  categoryId: string | null;
  title: string | null;
  snippet: string;
  votes: number;
  coverage: CrashRecordCoverage;
  /** The years the covering acquisitions asked for, sorted. Empty when uncovered. */
  coverageYears: number[];
  /** The WEAKEST instrument that covered this point — what bounds the reading. */
  weakestSeverityCompleteness: SeverityCompleteness | null;
  crashTotal: number;
  fatal: number;
  severeInjury: number;
  injury: number;
  pdo: number;
  killed: number;
  injured: number;
  pedestrian: number;
  bicyclist: number;
  nearestMeters: number | null;
  earliestYear: number | null;
  latestYear: number | null;
  /** The one-line reading, already carrying its own coverage caveat. */
  sentence: string;
};

export type CampaignCrashCorroboration = {
  radiusMeters: number;
  /** Mapped, approved comments the query returned. */
  mappedTotal: number;
  /** Of those, how many sit inside an acquisition's footprint. */
  coveredTotal: number;
  /** Of the covered ones, how many have at least one collision within the radius. */
  withAnyCrash: number;
  /** Share of COVERED comments with any collision, 0–100, or null when nothing is covered. */
  withAnyCrashPct: number | null;
  /** Median collision count among covered comments that have any. Null when there are none. */
  medianCrashesWhereAny: number | null;
  items: CommentCrashRecord[];
  /** Every caveat this reading carries, deduplicated, in the order they matter. */
  caveats: string[];
};

/**
 * The data-level disclosure that some comments were never measured.
 *
 * Exported because a surface that ALREADY says this more prominently — the
 * console renders a whole block naming the count — should not repeat it in its
 * caveat list, and the way to skip a sentence without risking drift is to
 * compare against the sentence itself.
 */
export const UNMEASURED_COMMENTS_CAVEAT =
  "Some mapped comments sit outside every completed crash acquisition. Those are reported " +
  "as unmeasured, never as locations without collisions.";

const SEVERITY_RANK: Record<SeverityCompleteness, number> = {
  fatal_only: 0,
  fatal_injury_only: 1,
  kabco_full: 2,
};

function asCount(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

/** The weakest instrument among those that covered a point, or null when none did. */
export function weakestCompleteness(values: readonly string[] | null): SeverityCompleteness | null {
  if (!values || values.length === 0) return null;
  const known = values.filter((v): v is SeverityCompleteness => v in SEVERITY_RANK);
  if (known.length === 0) return null;
  return known.reduce((worst, next) => (SEVERITY_RANK[next] < SEVERITY_RANK[worst] ? next : worst));
}

/** A year list as a reader should see it — a range when contiguous, a list when it has holes. */
export function describeYears(years: readonly number[]): string | null {
  const sorted = [...new Set(years.filter((y) => Number.isFinite(y)))].sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return String(sorted[0]);
  const contiguous = sorted.every((year, index) => index === 0 || year === sorted[index - 1] + 1);
  // A GAP IS NOT A RANGE. "2019–2024" over data missing 2021 claims a year
  // nobody retrieved, and a quiet year is exactly what a reader would lean on.
  return contiguous ? `${sorted[0]}–${sorted[sorted.length - 1]}` : sorted.join(", ");
}

function snippetOf(title: string | null, body: string | null): string {
  const text = (title || body || "").replace(/\s+/g, " ").trim();
  if (!text) return "(no comment text)";
  return text.length <= 140 ? text : `${text.slice(0, 140).trimEnd()}…`;
}

/**
 * The one-line reading for a single comment.
 *
 * Note what it never says: "confirmed", "validated", "supported". It reports a
 * count within a stated distance over a stated period, and where the record
 * cannot speak it says that instead of saying nothing happened.
 */
export function describeCommentCrashRecord(
  record: Omit<CommentCrashRecord, "sentence">,
  radiusMeters: number
): string {
  if (record.coverage === "not_acquired") {
    return (
      `Nobody has retrieved collisions for this location, so nothing can be said about it ` +
      `either way. This is not a reading of zero.`
    );
  }

  const period = describeYears(record.coverageYears);
  const withinPeriod = period ? ` in ${period}` : "";

  if (record.crashTotal === 0) {
    return `No reported collisions within ${radiusMeters} m${withinPeriod}.`;
  }

  const bands = [
    record.fatal > 0 ? `${record.fatal} fatal` : null,
    record.severeInjury > 0 ? `${record.severeInjury} serious injury` : null,
    record.injury > 0 ? `${record.injury} injury` : null,
    record.pdo > 0 ? `${record.pdo} property damage only` : null,
  ].filter(Boolean) as string[];

  const harm = [
    record.killed > 0 ? `${record.killed} killed` : null,
    record.injured > 0 ? `${record.injured} injured` : null,
  ].filter(Boolean) as string[];

  const modes = [
    record.pedestrian > 0 ? `${record.pedestrian} involving a pedestrian` : null,
    record.bicyclist > 0 ? `${record.bicyclist} involving a bicyclist` : null,
  ].filter(Boolean) as string[];

  return [
    `${record.crashTotal} collision${record.crashTotal === 1 ? "" : "s"} within ${radiusMeters} m${withinPeriod}`,
    bands.length > 0 ? `: ${bands.join(", ")}` : "",
    harm.length > 0 ? `. ${harm.join(", ")}` : "",
    modes.length > 0 ? `. ${modes.join(", ")}` : "",
    ".",
  ].join("");
}

function toRecord(row: NearbyCrashRow, radiusMeters: number): CommentCrashRecord {
  const covered = row.covered_by_ingest === true;
  const base: Omit<CommentCrashRecord, "sentence"> = {
    itemId: row.id,
    categoryId: row.category_id,
    title: row.title,
    snippet: snippetOf(row.title, row.body),
    votes: asCount(row.votes_count),
    coverage: covered ? "covered" : "not_acquired",
    coverageYears: covered ? [...(row.coverage_years ?? [])].sort((a, b) => a - b) : [],
    weakestSeverityCompleteness: covered
      ? weakestCompleteness(row.coverage_severity_completeness)
      : null,
    // AN UNCOVERED POINT REPORTS NO COUNTS AT ALL. The function returns zeros
    // there because SQL has to return something; carrying them forward would
    // let a surface render "0 collisions" for a place nobody measured.
    crashTotal: covered ? asCount(row.crash_total) : 0,
    fatal: covered ? asCount(row.fatal_count) : 0,
    severeInjury: covered ? asCount(row.severe_injury_count) : 0,
    injury: covered ? asCount(row.injury_count) : 0,
    pdo: covered ? asCount(row.pdo_count) : 0,
    killed: covered ? asCount(row.killed_total) : 0,
    injured: covered ? asCount(row.injured_total) : 0,
    pedestrian: covered ? asCount(row.pedestrian_crashes) : 0,
    bicyclist: covered ? asCount(row.bicyclist_crashes) : 0,
    nearestMeters:
      covered && typeof row.nearest_crash_meters === "number" && Number.isFinite(row.nearest_crash_meters)
        ? Math.round(row.nearest_crash_meters * 10) / 10
        : null,
    earliestYear: covered ? row.earliest_crash_year : null,
    latestYear: covered ? row.latest_crash_year : null,
  };
  return { ...base, sentence: describeCommentCrashRecord(base, radiusMeters) };
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * The campaign's whole reading, including the distribution that makes any one
 * comment's number interpretable. Feed it the rows exactly as the function
 * returned them.
 */
export function summarizeCampaignCorroboration(
  rows: readonly NearbyCrashRow[],
  radiusMeters: number
): CampaignCrashCorroboration {
  const items = rows.map((row) => toRecord(row, radiusMeters));
  const covered = items.filter((item) => item.coverage === "covered");
  const withAny = covered.filter((item) => item.crashTotal > 0);

  const caveats: string[] = [];
  if (covered.length > 0) {
    caveats.push(SAFETY_CRASH_DATA_CAVEAT);
    // Ungeocoded crashes can never satisfy a distance predicate, so every count
    // here is a floor. This is the campaign-level statement of the same fact
    // `describeGeocodingShortfall` makes for one acquisition.
    caveats.push(SAFETY_GEOCODING_CAVEAT);
    if (covered.some((item) => item.pdo > 0)) caveats.push(SAFETY_UNCLASSIFIED_SEVERITY_CAVEAT);
  }
  if (items.some((item) => item.coverage === "not_acquired")) {
    caveats.push(UNMEASURED_COMMENTS_CAVEAT);
  }

  return {
    radiusMeters,
    mappedTotal: items.length,
    coveredTotal: covered.length,
    withAnyCrash: withAny.length,
    withAnyCrashPct:
      covered.length > 0 ? Math.round((withAny.length / covered.length) * 1000) / 10 : null,
    medianCrashesWhereAny: median(withAny.map((item) => item.crashTotal)),
    items,
    caveats: [...new Set(caveats)],
  };
}

/**
 * The sentence that stops a single count from reading as a finding.
 *
 * Null when there is no distribution to describe — with nothing covered there is
 * no denominator, and inventing one ("0% of 0") is worse than saying nothing.
 */
export function describeCorroborationBaseline(
  summary: CampaignCrashCorroboration
): string | null {
  if (summary.coveredTotal === 0) return null;
  const pct = summary.withAnyCrashPct;
  if (pct === null) return null;
  const median = summary.medianCrashesWhereAny;
  return (
    `${summary.withAnyCrash} of the ${summary.coveredTotal} mapped comments inside crash coverage ` +
    `(${pct}%) have at least one collision within ${summary.radiusMeters} m` +
    (median !== null ? `, a median of ${median} each` : "") +
    `. Read any single comment's count against that: in a dense area most points have collisions ` +
    `nearby, and the number worth acting on is the one well above this line.`
  );
}
